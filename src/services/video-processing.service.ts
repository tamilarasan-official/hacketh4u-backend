import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { spawn } from "node:child_process";
import { createWriteStream, createReadStream } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { env } from "../config/env";
import { garageS3 } from "../config/garage";
import { performance } from "../config/performance";
import { buildPublicMediaUrl } from "./media-url.service";

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
  { label: "480p", width: 854, height: 480, bandwidth: 1_400_000, crf: 25 },
];

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
      stdio: ["ignore", "ignore", "pipe"],
    });
    const timeout = setTimeout(
      () => child.kill("SIGKILL"),
      performance.FFMPEG_TIMEOUT_MS,
    );

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 12_000) {
        stderr = stderr.slice(-12_000);
      }
    });
    child.on("error", (e) => {
      clearTimeout(timeout);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
    });
  });
}

async function downloadGarageObject(
  objectKey: string,
  destination: string,
): Promise<void> {
  const result = await garageS3.send(
    new GetObjectCommand({
      Bucket: env.GARAGE_S3_BUCKET,
      Key: objectKey,
    }),
  );

  if (!result.Body) {
    throw new Error(`Garage object has no body: ${objectKey}`);
  }

  await pipeline(
    result.Body as NodeJS.ReadableStream,
    createWriteStream(destination),
  );
}

async function uploadDirectory(
  localDir: string,
  objectPrefix: string,
): Promise<void> {
  const entries = (await readdir(localDir, { withFileTypes: true })).sort(
    (a, b) =>
      Number(a.name.endsWith(".m3u8")) - Number(b.name.endsWith(".m3u8")),
  );

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
        Body: createReadStream(localPath),
        ContentType: contentTypeForFile(localPath),
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
  }
}

async function createVariant(
  inputPath: string,
  outputRoot: string,
  variant: HlsVariant,
): Promise<void> {
  const variantDir = path.join(outputRoot, variant.label);
  await mkdir(variantDir, { recursive: true });

  await runFfmpeg([
    "-y",
    "-i",
    inputPath,
    "-vf",
    `scale=-2:'trunc(min(${variant.height},ih)/2)*2':force_original_aspect_ratio=decrease`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-threads",
    String(performance.FFMPEG_THREADS),
    "-r",
    "30",
    "-g",
    "180",
    "-keyint_min",
    "180",
    "-sc_threshold",
    "0",
    "-force_key_frames",
    "expr:gte(t,n_forced*6)",
    "-maxrate",
    String(variant.bandwidth),
    "-bufsize",
    String(variant.bandwidth * 2),
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
    "-hls_flags",
    "independent_segments",
    "-hls_segment_filename",
    path.join(variantDir, "segment_%03d.ts"),
    path.join(variantDir, "index.m3u8"),
  ]);
}

async function createMasterPlaylist(outputRoot: string): Promise<void> {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3"];

  for (const variant of variants) {
    const files = await readdir(path.join(outputRoot, variant.label));
    const first = files.find((f) => f.endsWith(".ts"));
    if (!first) throw new Error("No HLS segments produced");
    const metadata = await probe(path.join(outputRoot, variant.label, first));
    const playlist = await readFile(
      path.join(outputRoot, variant.label, "index.m3u8"),
      "utf8",
    );
    let duration = 0,
      peak = 0;
    for (const row of playlist.split(/\r?\n/)) {
      if (row.startsWith("#EXTINF:"))
        duration = Number(row.slice(8).split(",")[0]);
      else if (row && !row.startsWith("#")) {
        if (row.includes("/") || row.includes("..") || duration <= 0)
          throw new Error("Invalid generated HLS playlist");
        peak = Math.max(
          peak,
          ((await stat(path.join(outputRoot, variant.label, row))).size * 8) /
            duration,
        );
      }
    }
    if (!peak) throw new Error("Empty HLS rendition");
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${Math.ceil(peak * 1.1)},RESOLUTION=${metadata.width}x${metadata.height}`,
      `${variant.label}/index.m3u8`,
    );
  }

  await writeFile(
    path.join(outputRoot, "master.m3u8"),
    `${lines.join("\n")}\n`,
    "utf8",
  );
}
async function probe(file: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "json",
      file,
    ]);
    let output = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 30000);
    child.stdout.on("data", (b) => {
      output += b.toString();
      if (output.length > 100000) child.kill("SIGKILL");
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        const stream = JSON.parse(output).streams[0];
        if (code !== 0 || !stream?.width || !stream?.height)
          throw new Error("Invalid video metadata");
        resolve(stream);
      } catch (e) {
        reject(e);
      }
    });
  });
}

export async function processGarageVideoToHls(
  input: ProcessGarageVideoInput,
): Promise<ProcessedVideoResult> {
  if (!input.contentType.toLowerCase().startsWith("video/")) {
    throw new Error(`Unsupported video content type: ${input.contentType}`);
  }

  const workDir = path.join(
    tmpdir(),
    `hacketh4u-video-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  const inputPath = path.join(workDir, "source-video");
  const outputRoot = path.join(workDir, "hls");
  const hlsObjectPrefix = input.objectKey
    .replace(/^videos\/raw\//, "videos/hls/")
    .replace(/\.[^.]+$/, "");

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
      qualities[variant.label] = buildPublicMediaUrl(
        `${hlsObjectPrefix}/${variant.label}/index.m3u8`,
      );
    }

    return {
      streamingUrl: buildPublicMediaUrl(`${hlsObjectPrefix}/master.m3u8`),
      qualities,
      hlsObjectPrefix,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
