import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { env } from "../config/env";
import { garageS3 } from "../config/garage";

type HlsVariant = {
  label: "720p" | "480p";
  width: number;
  height: number;
  bandwidth: number;
  crf: number;
};

type ProcessGarageVideoInput = {
  objectKey: string;
  publicUrl: string;
  contentType: string;
};

export type ProcessedVideoResult = {
  streamingUrl: string;
  qualities: Record<string, string>;
  hlsObjectPrefix: string;
};

const variants: HlsVariant[] = [
  { label: "720p", width: 1280, height: 720, bandwidth: 2_800_000, crf: 23 },
  { label: "480p", width: 854, height: 480, bandwidth: 1_400_000, crf: 25 }
];

function buildPublicMediaUrl(objectKey: string): string {
  const baseUrl = (env.APP_BASE_URL || "").replace(/\/$/, "");
  if (baseUrl) {
    return `${baseUrl}/media/public/${objectKey}`;
  }
  // The bucket is part of the public base URL (virtual-hosted addressing), so
  // it must not be repeated in the path.
  return `${env.GARAGE_S3_PUBLIC_BASE_URL.replace(/\/$/, "")}/${objectKey}`;
}

function contentTypeForFile(filePath: string): string {
  if (filePath.endsWith(".m3u8")) {
    return "application/vnd.apple.mpegurl";
  }
  if (filePath.endsWith(".ts")) {
    return "video/mp2t";
  }
  return "application/octet-stream";
}

async function runFfmpeg(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", args, {
      stdio: ["ignore", "ignore", "pipe"]
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 12_000) {
        stderr = stderr.slice(-12_000);
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
    });
  });
}

async function downloadGarageObject(objectKey: string, destination: string): Promise<void> {
  const result = await garageS3.send(
    new GetObjectCommand({
      Bucket: env.GARAGE_S3_BUCKET,
      Key: objectKey
    })
  );

  if (!result.Body) {
    throw new Error(`Garage object has no body: ${objectKey}`);
  }

  await pipeline(result.Body as NodeJS.ReadableStream, createWriteStream(destination));
}

async function uploadDirectory(localDir: string, objectPrefix: string): Promise<void> {
  const entries = await readdir(localDir, { withFileTypes: true });

  for (const entry of entries) {
    const localPath = path.join(localDir, entry.name);
    const objectKey = `${objectPrefix}/${entry.name}`;

    if (entry.isDirectory()) {
      await uploadDirectory(localPath, objectKey);
      continue;
    }

    await garageS3.send(
      new PutObjectCommand({
        Bucket: env.GARAGE_S3_BUCKET,
        Key: objectKey,
        Body: await readFile(localPath),
        ContentType: contentTypeForFile(localPath),
        CacheControl: "public, max-age=31536000, immutable"
      })
    );
  }
}

async function createVariant(inputPath: string, outputRoot: string, variant: HlsVariant): Promise<void> {
  const variantDir = path.join(outputRoot, variant.label);
  await mkdir(variantDir, { recursive: true });

  await runFfmpeg([
    "-y",
    "-i",
    inputPath,
    "-vf",
    `scale=-2:${variant.height}:force_original_aspect_ratio=decrease`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    String(variant.crf),
    "-c:a",
    "aac",
    "-b:a",
    "96k",
    "-hls_time",
    "6",
    "-hls_playlist_type",
    "vod",
    "-hls_segment_filename",
    path.join(variantDir, "segment_%03d.ts"),
    path.join(variantDir, "index.m3u8")
  ]);
}

async function createMasterPlaylist(outputRoot: string): Promise<void> {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3"];

  for (const variant of variants) {
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${variant.bandwidth},RESOLUTION=${variant.width}x${variant.height}`,
      `${variant.label}/index.m3u8`
    );
  }

  await writeFile(path.join(outputRoot, "master.m3u8"), `${lines.join("\n")}\n`, "utf8");
}

export async function processGarageVideoToHls(
  input: ProcessGarageVideoInput
): Promise<ProcessedVideoResult> {
  if (!input.contentType.toLowerCase().startsWith("video/")) {
    throw new Error(`Unsupported video content type: ${input.contentType}`);
  }

  const workDir = path.join(tmpdir(), `hacketh4u-video-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const inputPath = path.join(workDir, "source-video");
  const outputRoot = path.join(workDir, "hls");
  const hlsObjectPrefix = input.objectKey.replace(/^videos\/raw\//, "videos/hls/").replace(/\.[^.]+$/, "");

  await mkdir(outputRoot, { recursive: true });

  try {
    await downloadGarageObject(input.objectKey, inputPath);

    for (const variant of variants) {
      await createVariant(inputPath, outputRoot, variant);
    }
    await createMasterPlaylist(outputRoot);
    await uploadDirectory(outputRoot, hlsObjectPrefix);

    const qualities: Record<string, string> = {};
    for (const variant of variants) {
      qualities[variant.label] = buildPublicMediaUrl(`${hlsObjectPrefix}/${variant.label}/index.m3u8`);
    }

    return {
      streamingUrl: buildPublicMediaUrl(`${hlsObjectPrefix}/master.m3u8`),
      qualities,
      hlsObjectPrefix
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
