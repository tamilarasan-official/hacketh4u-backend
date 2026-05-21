import express, { Router } from "express";
import type { Readable } from "node:stream";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import {
  completeUpload,
  createSignedUpload,
  deleteObject,
  getObject,
  uploadObjectDirect
} from "../services/media.service";

const uploadRequestSchema = z.object({
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  folder: z.enum([
    "user-profiles",
    "course-thumbnails",
    "mentor-profiles",
    "banner-images",
    "certificate-templates",
    "video-thumbnails",
    "videos/raw"
  ])
});

const completeUploadSchema = z.object({
  objectKey: z.string().min(1),
  publicUrl: z.string().url(),
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  contentType: z.string().min(1)
});

const deleteObjectSchema = z.object({
  objectKey: z.string().min(1)
});

export const mediaRouter = Router();

mediaRouter.get("/public/*", async (req, res, next) => {
  try {
    const wildcardParams = req.params as Record<string, string | string[] | undefined>;
    const rawObjectKey = wildcardParams["0"] ?? wildcardParams[""];
    const objectKey = decodeURIComponent(
      Array.isArray(rawObjectKey) ? rawObjectKey[0] ?? "" : rawObjectKey ?? ""
    );
    const result = await getObject(objectKey);

    if (result.ContentType) {
      res.setHeader("Content-Type", result.ContentType);
    }
    if (result.ContentLength != null) {
      res.setHeader("Content-Length", result.ContentLength.toString());
    }
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");

    const body = result.Body as NodeJS.ReadableStream | undefined;
    if (!body) {
      res.status(404).json({ error: "Object not found." });
      return;
    }

    body.on("error", next);
    body.pipe(res);
  } catch (error) {
    next(error);
  }
});

mediaRouter.post(
  "/upload",
  requireAuth,
  async (req, res, next) => {
    try {
      const fileName = req.header("x-file-name")?.trim() ?? "";
      const contentType = req.header("content-type")?.trim() ?? "";
      const folder = req.header("x-folder")?.trim() ?? "";
      const entityType = req.header("x-entity-type")?.trim() ?? "";
      const entityId = req.header("x-entity-id")?.trim() ?? "";
      const fileSizeHeader = req.header("x-file-size")?.trim();
      const fileSize = fileSizeHeader ? Number(fileSizeHeader) : undefined;

      const payload = uploadRequestSchema.parse({
        fileName,
        contentType,
        folder
      });

      if (!entityType || !entityId) {
        throw new z.ZodError([
          {
            code: "custom",
            path: ["entityType"],
            message: "entityType and entityId are required."
          }
        ]);
      }

      const result = await uploadObjectDirect({
        userId: req.authUser!.uid,
        fileStream: req as unknown as Readable,
        fileSize: Number.isFinite(fileSize) ? fileSize : undefined,
        entityType,
        entityId,
        ...payload
      });
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }
);

mediaRouter.post("/upload-url", requireAuth, async (req, res, next) => {
  try {
    const payload = uploadRequestSchema.parse(req.body);
    const result = await createSignedUpload({
      userId: req.authUser!.uid,
      ...payload
    });
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

mediaRouter.post("/complete", requireAuth, async (req, res, next) => {
  try {
    const payload = completeUploadSchema.parse(req.body);
    const result = await completeUpload({
      userId: req.authUser!.uid,
      ...payload
    });
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

mediaRouter.post("/delete", requireAuth, async (req, res, next) => {
  try {
    const payload = deleteObjectSchema.parse(req.body);
    const result = await deleteObject({
      userId: req.authUser!.uid,
      ...payload
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});
