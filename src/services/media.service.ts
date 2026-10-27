import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { createHash } from "node:crypto";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Readable } from "node:stream";
import { firestore } from "../config/firebase";
import { env } from "../config/env";
import { garageS3, garageSigningRegion } from "../config/garage";
import { HttpError } from "../utils/http-error";
import { enqueueVideoProcessing } from "./job-queue.service";
import {
  buildPublicMediaUrl,
  assertOwner,
  validateObjectKey,
  validateRange,
} from "./media-url.service";
import { performance } from "../config/performance";

type UploadFolder =
  | "user-profiles"
  | "course-thumbnails"
  | "mentor-profiles"
  | "banner-images"
  | "certificate-templates"
  | "video-thumbnails"
  | "videos/raw";

type RequestUploadInput = {
  userId: string;
  fileName: string;
  contentType: string;
  folder: UploadFolder;
};

type DirectUploadInput = RequestUploadInput & {
  entityType: string;
  entityId: string;
  fileStream: Readable;
  fileSize?: number;
};

type MultipartUploadInitInput = RequestUploadInput & {
  entityType: string;
  entityId: string;
  fileSize?: number;
};

type MultipartUploadPartInput = {
  userId: string;
  objectKey: string;
  uploadId: string;
  partNumber: number;
  body: Buffer;
};

type MultipartUploadCompleteInput = {
  userId: string;
  objectKey: string;
  uploadId: string;
  publicUrl: string;
  entityType: string;
  entityId: string;
  contentType: string;
  parts: Array<{
    partNumber: number;
    eTag: string;
  }>;
};

type MultipartUploadAbortInput = {
  userId: string;
  objectKey: string;
  uploadId: string;
};

const GARAGE_READ_TIMEOUT_MS = performance.STORAGE_DEADLINE_MS;
const GARAGE_READ_ATTEMPTS = 2;

function shouldProcessVideo(
  folderOrObjectKey: string,
  contentType: string,
): boolean {
  return (
    folderOrObjectKey.startsWith("videos/raw") &&
    contentType.toLowerCase().startsWith("video/")
  );
}

async function withGarageTimeout<T>(
  operation: string,
  objectKey: string,
  run: (abortSignal: AbortSignal) => Promise<T>,
  parentSignal?: AbortSignal,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= GARAGE_READ_ATTEMPTS; attempt += 1) {
    const abortController = new AbortController();
    const timeout = setTimeout(
      () => abortController.abort(),
      GARAGE_READ_TIMEOUT_MS,
    );

    try {
      const signal = parentSignal
        ? AbortSignal.any([parentSignal, abortController.signal])
        : abortController.signal;
      return await run(signal);
    } catch (error) {
      lastError = error;
      if (parentSignal?.aborted)
        throw new HttpError(499, "Client disconnected.");
      const message = error instanceof Error ? error.message : String(error);
      console.error("Garage media operation failed", {
        operation,
        objectKey,
        attempt,
        message,
      });

      const statusCode = (error as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode;
      if (statusCode === 404) throw new HttpError(404, "Media not found.");
      if (statusCode === 416)
        throw new HttpError(416, "Range not satisfiable.");
      if (statusCode === 403)
        throw new HttpError(502, "Media storage access failed.");
      const retryable =
        abortController.signal.aborted ||
        statusCode == null ||
        statusCode >= 500 ||
        /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|socket|timeout/i.test(
          message,
        );

      if (!retryable || attempt === GARAGE_READ_ATTEMPTS) {
        if (abortController.signal.aborted) {
          throw new HttpError(504, "Media storage request timed out.", {
            operation,
            objectKey,
          });
        }
        throw new HttpError(
          /timeout/i.test(message) ? 504 : 502,
          "Media storage unavailable.",
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError;
}

function buildObjectKey(input: RequestUploadInput): string {
  const safeFileName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${input.folder}/${input.userId}/${Date.now()}_${safeFileName}`;
}

function buildHlsUrls(objectKey: string): {
  streamingUrl: string;
  qualities: Record<string, string>;
  hlsObjectPrefix: string;
} {
  const hlsObjectPrefix = objectKey
    .replace(/^videos\/raw\//, "videos/hls/")
    .replace(/\.[^.]+$/, "");
  return {
    streamingUrl: buildPublicMediaUrl(`${hlsObjectPrefix}/master.m3u8`),
    qualities: {
      "720p": buildPublicMediaUrl(`${hlsObjectPrefix}/720p/index.m3u8`),
      "480p": buildPublicMediaUrl(`${hlsObjectPrefix}/480p/index.m3u8`),
    },
    hlsObjectPrefix,
  };
}

export async function createSignedUpload(
  input: RequestUploadInput,
): Promise<Record<string, unknown>> {
  if (!input.fileName.trim()) {
    throw new HttpError(400, "fileName is required.");
  }

  const objectKey = buildObjectKey(input);

  const command = new PutObjectCommand({
    Bucket: env.GARAGE_S3_BUCKET,
    Key: objectKey,
    ContentType: input.contentType,
  });

  const uploadUrl = await getSignedUrl(garageS3, command, {
    expiresIn: 900,
    signingRegion: garageSigningRegion,
  });

  return {
    bucket: env.GARAGE_S3_BUCKET,
    objectKey,
    uploadUrl,
    publicUrl: buildPublicMediaUrl(objectKey),
  };
}

export async function uploadObjectDirect(
  input: DirectUploadInput,
): Promise<Record<string, unknown>> {
  if (!input.fileName.trim()) {
    throw new HttpError(400, "fileName is required.");
  }

  if (input.fileSize != null && input.fileSize <= 0) {
    throw new HttpError(400, "File body is empty.");
  }

  const objectKey = buildObjectKey(input);
  const publicUrl = buildPublicMediaUrl(objectKey);
  console.info("Starting Garage upload", {
    objectKey,
    entityType: input.entityType,
    entityId: input.entityId,
    fileSize: input.fileSize ?? null,
    contentType: input.contentType,
  });

  const upload = new Upload({
    client: garageS3,
    params: {
      Bucket: env.GARAGE_S3_BUCKET,
      Key: objectKey,
      ContentType: input.contentType,
      Body: input.fileStream,
      ...(input.fileSize != null ? { ContentLength: input.fileSize } : {}),
    },
    queueSize: 1,
    partSize: 8 * 1024 * 1024,
    leavePartsOnError: false,
  });

  try {
    await upload.done();
  } catch (error) {
    console.error("Garage upload failed", {
      objectKey,
      entityType: input.entityType,
      entityId: input.entityId,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  console.info("Garage upload completed", {
    objectKey,
    entityType: input.entityType,
    entityId: input.entityId,
  });

  const record = {
    userId: input.userId,
    objectKey,
    publicUrl,
    entityType: input.entityType,
    entityId: input.entityId,
    contentType: input.contentType,
    status: "uploaded",
    storageProvider: "garage-s3",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return finishRecordedUpload(record);
}

export async function initiateMultipartUpload(
  input: MultipartUploadInitInput,
): Promise<Record<string, unknown>> {
  if (!input.fileName.trim()) {
    throw new HttpError(400, "fileName is required.");
  }

  if (input.fileSize != null && input.fileSize <= 0) {
    throw new HttpError(400, "File body is empty.");
  }

  const objectKey = buildObjectKey(input);
  const publicUrl = buildPublicMediaUrl(objectKey);

  const result = await garageS3.send(
    new CreateMultipartUploadCommand({
      Bucket: env.GARAGE_S3_BUCKET,
      Key: objectKey,
      ContentType: input.contentType,
    }),
  );

  if (!result.UploadId) {
    throw new HttpError(500, "Failed to initialize multipart upload.");
  }

  console.info("Initialized Garage multipart upload", {
    objectKey,
    entityType: input.entityType,
    entityId: input.entityId,
    fileSize: input.fileSize ?? null,
    contentType: input.contentType,
  });

  return {
    uploadId: result.UploadId,
    objectKey,
    publicUrl,
  };
}

export async function uploadMultipartPart(
  input: MultipartUploadPartInput,
): Promise<Record<string, unknown>> {
  assertOwner(input.objectKey, input.userId);
  if (!input.objectKey.trim()) {
    throw new HttpError(400, "objectKey is required.");
  }

  if (!input.uploadId.trim()) {
    throw new HttpError(400, "uploadId is required.");
  }

  if (!Number.isInteger(input.partNumber) || input.partNumber < 1) {
    throw new HttpError(400, "partNumber must be a positive integer.");
  }

  if (input.body.length === 0) {
    throw new HttpError(400, "Chunk body is empty.");
  }

  const result = await garageS3.send(
    new UploadPartCommand({
      Bucket: env.GARAGE_S3_BUCKET,
      Key: input.objectKey,
      UploadId: input.uploadId,
      PartNumber: input.partNumber,
      Body: input.body,
      ContentLength: input.body.length,
    }),
  );

  if (!result.ETag) {
    throw new HttpError(500, "Failed to upload multipart chunk.");
  }

  return {
    partNumber: input.partNumber,
    eTag: result.ETag,
  };
}

export async function completeMultipartUpload(
  input: MultipartUploadCompleteInput,
): Promise<Record<string, unknown>> {
  assertOwner(input.objectKey, input.userId);
  input.publicUrl = buildPublicMediaUrl(input.objectKey);
  if (!input.objectKey.trim()) {
    throw new HttpError(400, "objectKey is required.");
  }

  if (!input.uploadId.trim()) {
    throw new HttpError(400, "uploadId is required.");
  }

  if (!input.parts.length) {
    throw new HttpError(400, "At least one uploaded part is required.");
  }

  const sortedParts = [...input.parts]
    .sort((a, b) => a.partNumber - b.partNumber)
    .map((part) => ({
      ETag: part.eTag,
      PartNumber: part.partNumber,
    }));

  await garageS3.send(
    new CompleteMultipartUploadCommand({
      Bucket: env.GARAGE_S3_BUCKET,
      Key: input.objectKey,
      UploadId: input.uploadId,
      MultipartUpload: {
        Parts: sortedParts,
      },
    }),
  );

  console.info("Garage multipart upload completed", {
    objectKey: input.objectKey,
    entityType: input.entityType,
    entityId: input.entityId,
    parts: sortedParts.length,
  });

  const record = {
    userId: input.userId,
    objectKey: input.objectKey,
    publicUrl: input.publicUrl,
    entityType: input.entityType,
    entityId: input.entityId,
    contentType: input.contentType,
    status: "uploaded",
    storageProvider: "garage-s3",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return finishRecordedUpload(record);
}

export async function abortMultipartUpload(
  input: MultipartUploadAbortInput,
): Promise<void> {
  assertOwner(input.objectKey, input.userId);
  if (!input.objectKey.trim() || !input.uploadId.trim()) {
    return;
  }

  await garageS3.send(
    new AbortMultipartUploadCommand({
      Bucket: env.GARAGE_S3_BUCKET,
      Key: input.objectKey,
      UploadId: input.uploadId,
    }),
  );
}

export async function getObject(
  objectKey: string,
  range?: string,
  signal?: AbortSignal,
) {
  validateObjectKey(objectKey);
  validateRange(range);
  if (!objectKey.trim()) {
    throw new HttpError(400, "objectKey is required.");
  }

  return withGarageTimeout(
    "getObject",
    objectKey,
    (abortSignal) =>
      garageS3.send(
        new GetObjectCommand({
          Bucket: env.GARAGE_S3_BUCKET,
          Key: objectKey,
          ...(range ? { Range: range } : {}),
        }),
        { abortSignal },
      ),
    signal,
  );
}

export async function headObject(objectKey: string, signal?: AbortSignal) {
  validateObjectKey(objectKey);
  if (!objectKey.trim()) {
    throw new HttpError(400, "objectKey is required.");
  }

  return withGarageTimeout(
    "headObject",
    objectKey,
    (abortSignal) =>
      garageS3.send(
        new HeadObjectCommand({
          Bucket: env.GARAGE_S3_BUCKET,
          Key: objectKey,
        }),
        { abortSignal },
      ),
    signal,
  );
}

type CompleteUploadInput = {
  userId: string;
  objectKey: string;
  publicUrl: string;
  entityType: string;
  entityId: string;
  contentType: string;
};

export async function completeUpload(
  input: CompleteUploadInput,
): Promise<Record<string, unknown>> {
  assertOwner(input.objectKey, input.userId);
  const stored = await headObject(input.objectKey);
  input.publicUrl = buildPublicMediaUrl(input.objectKey);
  input.contentType = stored.ContentType ?? input.contentType;
  const record = {
    userId: input.userId,
    objectKey: input.objectKey,
    publicUrl: input.publicUrl,
    entityType: input.entityType,
    entityId: input.entityId,
    contentType: input.contentType,
    status: "uploaded",
    storageProvider: "garage-s3",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return finishRecordedUpload(record);
}

type DeleteUploadInput = {
  userId: string;
  objectKey: string;
};

export async function deleteObject(
  input: DeleteUploadInput,
): Promise<Record<string, unknown>> {
  assertOwner(input.objectKey, input.userId);
  if (!input.objectKey.trim()) {
    throw new HttpError(400, "objectKey is required.");
  }

  await garageS3.send(
    new DeleteObjectCommand({
      Bucket: env.GARAGE_S3_BUCKET,
      Key: input.objectKey,
    }),
  );

  const snapshot = await firestore
    .collection("media_uploads")
    .where("objectKey", "==", input.objectKey)
    .limit(1)
    .get();

  if (!snapshot.empty) {
    await snapshot.docs[0].ref.set(
      {
        status: "deleted",
        deletedBy: input.userId,
        updatedAt: new Date(),
      },
      { merge: true },
    );
  }

  return {
    deleted: true,
    objectKey: input.objectKey,
  };
}

async function recordUpload(record: Record<string, any>) {
  const ref = firestore
    .collection("media_uploads")
    .doc(createHash("sha256").update(record.objectKey).digest("hex"));
  const data = await firestore.runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists) return existing.data()!;
    const video = shouldProcessVideo(record.objectKey, record.contentType);
    const created: Record<string, any> = {
      ...record,
      status: video ? "queued" : "uploaded",
    };
    tx.create(ref, created);
    if (video)
      tx.create(firestore.collection("job_outbox").doc("video-" + ref.id), {
        payload: {
          mediaId: ref.id,
          objectKey: record.objectKey,
          publicUrl: record.publicUrl,
          contentType: record.contentType,
        },
        status: "pending",
        createdAt: new Date(),
      });
    return created;
  });
  return { ref, data };
}

async function finishRecordedUpload(record: Record<string, any>) {
  const { ref, data } = await recordUpload(record);
  const video = shouldProcessVideo(data.objectKey, data.contentType);
  // Only the worker advances processing state. A repeated completion must not
  // downgrade a processed record or replace its published playback metadata.
  if (video && data.status === "queued") {
    await enqueueVideoProcessing({
      mediaId: ref.id,
      objectKey: data.objectKey,
      publicUrl: data.publicUrl,
      contentType: data.contentType,
    });
  }
  return {
    ...(video ? buildHlsUrls(data.objectKey) : {}),
    ...data,
    id: ref.id,
    // Preserve the existing asynchronous response contract for clients.
    status: data.status === "queued" ? "processing" : data.status,
    ...(video ? { jobId: `video-${ref.id}` } : {}),
  };
}
