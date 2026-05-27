import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  UploadPartCommand
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Readable } from "node:stream";
import { firestore } from "../config/firebase";
import { env } from "../config/env";
import { garageS3, garageSigningRegion } from "../config/garage";
import { HttpError } from "../utils/http-error";

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
  objectKey: string;
  uploadId: string;
};

function buildObjectKey(input: RequestUploadInput): string {
  const safeFileName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${input.folder}/${input.userId}/${Date.now()}_${safeFileName}`;
}

function buildPublicMediaUrl(objectKey: string): string {
  const baseUrl = (env.APP_BASE_URL || "").replace(/\/$/, "");
  if (baseUrl) {
    return `${baseUrl}/media/public/${objectKey}`;
  }
  return `${env.GARAGE_S3_PUBLIC_BASE_URL.replace(/\/$/, "")}/${env.GARAGE_S3_BUCKET}/${objectKey}`;
}

export async function createSignedUpload(input: RequestUploadInput): Promise<Record<string, unknown>> {
  if (!input.fileName.trim()) {
    throw new HttpError(400, "fileName is required.");
  }

  const objectKey = buildObjectKey(input);

  const command = new PutObjectCommand({
    Bucket: env.GARAGE_S3_BUCKET,
    Key: objectKey,
    ContentType: input.contentType
  });

  const uploadUrl = await getSignedUrl(garageS3, command, {
    expiresIn: 900,
    signingRegion: garageSigningRegion
  });

  return {
    bucket: env.GARAGE_S3_BUCKET,
    objectKey,
    uploadUrl,
    publicUrl: buildPublicMediaUrl(objectKey)
  };
}

export async function uploadObjectDirect(input: DirectUploadInput): Promise<Record<string, unknown>> {
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
    contentType: input.contentType
  });

  const upload = new Upload({
    client: garageS3,
    params: {
      Bucket: env.GARAGE_S3_BUCKET,
      Key: objectKey,
      ContentType: input.contentType,
      Body: input.fileStream,
      ...(input.fileSize != null ? { ContentLength: input.fileSize } : {})
    },
    queueSize: 1,
    partSize: 8 * 1024 * 1024,
    leavePartsOnError: false
  });

  try {
    await upload.done();
  } catch (error) {
    console.error("Garage upload failed", {
      objectKey,
      entityType: input.entityType,
      entityId: input.entityId,
      message: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }

  console.info("Garage upload completed", {
    objectKey,
    entityType: input.entityType,
    entityId: input.entityId
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
    updatedAt: new Date()
  };

  const docRef = await firestore.collection("media_uploads").add(record);

  return {
    id: docRef.id,
    objectKey,
    publicUrl
  };
}

export async function initiateMultipartUpload(
  input: MultipartUploadInitInput
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
      ContentType: input.contentType
    })
  );

  if (!result.UploadId) {
    throw new HttpError(500, "Failed to initialize multipart upload.");
  }

  console.info("Initialized Garage multipart upload", {
    objectKey,
    entityType: input.entityType,
    entityId: input.entityId,
    fileSize: input.fileSize ?? null,
    contentType: input.contentType
  });

  return {
    uploadId: result.UploadId,
    objectKey,
    publicUrl
  };
}

export async function uploadMultipartPart(
  input: MultipartUploadPartInput
): Promise<Record<string, unknown>> {
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
      ContentLength: input.body.length
    })
  );

  if (!result.ETag) {
    throw new HttpError(500, "Failed to upload multipart chunk.");
  }

  return {
    partNumber: input.partNumber,
    eTag: result.ETag
  };
}

export async function completeMultipartUpload(
  input: MultipartUploadCompleteInput
): Promise<Record<string, unknown>> {
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
      PartNumber: part.partNumber
    }));

  await garageS3.send(
    new CompleteMultipartUploadCommand({
      Bucket: env.GARAGE_S3_BUCKET,
      Key: input.objectKey,
      UploadId: input.uploadId,
      MultipartUpload: {
        Parts: sortedParts
      }
    })
  );

  console.info("Garage multipart upload completed", {
    objectKey: input.objectKey,
    entityType: input.entityType,
    entityId: input.entityId,
    parts: sortedParts.length
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
    updatedAt: new Date()
  };

  const docRef = await firestore.collection("media_uploads").add(record);

  return {
    id: docRef.id,
    objectKey: input.objectKey,
    publicUrl: input.publicUrl
  };
}

export async function abortMultipartUpload(input: MultipartUploadAbortInput): Promise<void> {
  if (!input.objectKey.trim() || !input.uploadId.trim()) {
    return;
  }

  await garageS3.send(
    new AbortMultipartUploadCommand({
      Bucket: env.GARAGE_S3_BUCKET,
      Key: input.objectKey,
      UploadId: input.uploadId
    })
  );
}

export async function getObject(objectKey: string, range?: string) {
  if (!objectKey.trim()) {
    throw new HttpError(400, "objectKey is required.");
  }

  return garageS3.send(
    new GetObjectCommand({
      Bucket: env.GARAGE_S3_BUCKET,
      Key: objectKey,
      ...(range ? { Range: range } : {})
    })
  );
}

export async function headObject(objectKey: string) {
  if (!objectKey.trim()) {
    throw new HttpError(400, "objectKey is required.");
  }

  return garageS3.send(
    new HeadObjectCommand({
      Bucket: env.GARAGE_S3_BUCKET,
      Key: objectKey
    })
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

export async function completeUpload(input: CompleteUploadInput): Promise<Record<string, unknown>> {
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
    updatedAt: new Date()
  };

  const docRef = await firestore.collection("media_uploads").add(record);
  return {
    id: docRef.id,
    ...record
  };
}

type DeleteUploadInput = {
  userId: string;
  objectKey: string;
};

export async function deleteObject(input: DeleteUploadInput): Promise<Record<string, unknown>> {
  if (!input.objectKey.trim()) {
    throw new HttpError(400, "objectKey is required.");
  }

  await garageS3.send(
    new DeleteObjectCommand({
      Bucket: env.GARAGE_S3_BUCKET,
      Key: input.objectKey
    })
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
        updatedAt: new Date()
      },
      { merge: true }
    );
  }

  return {
    deleted: true,
    objectKey: input.objectKey
  };
}
