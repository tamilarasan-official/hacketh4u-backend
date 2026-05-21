import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
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

  await garageS3.send(
    new PutObjectCommand({
      Bucket: env.GARAGE_S3_BUCKET,
      Key: objectKey,
      ContentType: input.contentType,
      Body: input.fileStream,
      ...(input.fileSize != null ? { ContentLength: input.fileSize } : {})
    })
  );

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

export async function getObject(objectKey: string) {
  if (!objectKey.trim()) {
    throw new HttpError(400, "objectKey is required.");
  }

  return garageS3.send(
    new GetObjectCommand({
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
