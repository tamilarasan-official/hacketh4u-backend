import express, { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import {
  completeUpload,
  createSignedUpload,
  deleteObject,
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

mediaRouter.post(
  "/upload",
  requireAuth,
  express.raw({
    type: "*/*",
    limit: "1024mb"
  }),
  async (req, res, next) => {
    try {
      const fileName = req.header("x-file-name")?.trim() ?? "";
      const contentType = req.header("content-type")?.trim() ?? "";
      const folder = req.header("x-folder")?.trim() ?? "";
      const entityType = req.header("x-entity-type")?.trim() ?? "";
      const entityId = req.header("x-entity-id")?.trim() ?? "";

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

      const fileBuffer = Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(req.body ?? []);

      const result = await uploadObjectDirect({
        userId: req.authUser!.uid,
        fileBuffer,
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
