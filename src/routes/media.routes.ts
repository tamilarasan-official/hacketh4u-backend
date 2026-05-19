import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { completeUpload, createSignedUpload, deleteObject } from "../services/media.service";

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
