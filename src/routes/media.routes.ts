import express, { Router } from "express";
import Busboy from "busboy";
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
import { HttpError } from "../utils/http-error";

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
      const contentTypeHeader = req.header("content-type") ?? "";
      const fileSizeHeader = req.header("x-file-size")?.trim();
      const fileSize = fileSizeHeader ? Number(fileSizeHeader) : undefined;

      if (contentTypeHeader.toLowerCase().includes("multipart/form-data")) {
        const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
          const busboy = Busboy({
            headers: req.headers,
            limits: {
              files: 1,
              fileSize: 1024 * 1024 * 1024
            }
          });

          let fileName = req.header("x-file-name")?.trim() ?? "";
          let folder = req.header("x-folder")?.trim() ?? "";
          let entityType = req.header("x-entity-type")?.trim() ?? "";
          let entityId = req.header("x-entity-id")?.trim() ?? "";
          let declaredContentType = req.header("x-upload-content-type")?.trim() ?? "";
          let fileStream: Readable | null = null;
          let uploadMimeType = "";
          let fileReceived = false;
          let parserFinished = false;
          let settled = false;
          let uploadPromise: Promise<Record<string, unknown>> | null = null;
          let uploadResult: Record<string, unknown> | null = null;

          const cleanup = () => {
            req.off("aborted", handleAbort);
            busboy.off("error", safeReject);
          };

          const safeResolve = (value: Record<string, unknown>) => {
            if (settled) {
              return;
            }
            settled = true;
            cleanup();
            resolve(value);
          };

          const safeReject = (error: unknown) => {
            if (settled) {
              return;
            }
            settled = true;
            cleanup();
            reject(error);
          };

          const maybeResolve = () => {
            if (parserFinished && uploadResult) {
              safeResolve(uploadResult);
            }
          };

          const handleAbort = () => {
            const abortError = new HttpError(499, "Upload was interrupted by the client.");
            if (fileStream && !fileStream.destroyed) {
              fileStream.destroy(abortError);
            }
            safeReject(abortError);
          };

          busboy.on("field", (fieldName, value) => {
            switch (fieldName) {
              case "fileName":
                fileName = value.trim();
                break;
              case "folder":
                folder = value.trim();
                break;
              case "entityType":
                entityType = value.trim();
                break;
              case "entityId":
                entityId = value.trim();
                break;
              case "contentType":
                declaredContentType = value.trim();
                break;
              default:
                break;
            }
          });

          busboy.on("file", (fieldName, stream, info) => {
            if (fieldName !== "file") {
              stream.resume();
              return;
            }

            if (fileReceived) {
              stream.resume();
              safeReject(new Error("Only a single file is supported per upload."));
              return;
            }

            fileReceived = true;
            fileStream = stream as unknown as Readable;
            uploadMimeType = info.mimeType;
            stream.once("error", safeReject);
            stream.once("limit", () => {
              safeReject(new Error("Uploaded file exceeds the maximum supported size."));
            });

            uploadPromise = (async () => {
              const payload = uploadRequestSchema.parse({
                fileName: fileName || info.filename,
                contentType: declaredContentType || uploadMimeType || "application/octet-stream",
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

              return uploadObjectDirect({
                userId: req.authUser!.uid,
                fileStream: fileStream as Readable,
                fileSize: Number.isFinite(fileSize) ? fileSize : undefined,
                entityType,
                entityId,
                ...payload
              });
            })();

            uploadPromise
              .then((result) => {
                uploadResult = result;
                maybeResolve();
              })
              .catch(safeReject);
          });

          busboy.once("error", safeReject);
          req.once("aborted", handleAbort);

          busboy.on("finish", () => {
            parserFinished = true;
            if (!uploadPromise || !fileReceived) {
              safeReject(new Error("No file was received in the upload request."));
              return;
            }
            maybeResolve();
          });

          req.pipe(busboy);
        });

        res.status(201).json(result);
        return;
      }

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
