import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { performance } from "../config/performance";
import {
  createPlayback,
  verifyPlayback,
  requireCourseAccess,
} from "../services/playback.service";
import { serveMedia } from "./media.routes";
import { HttpError } from "../utils/http-error";
export const playbackRouter = Router();
playbackRouter.post("/session", requireAuth, async (req, res, next) => {
  try {
    const input = z
      .object({
        courseId: z.string().regex(/^[^/]{1,128}$/),
        videoId: z.string().regex(/^[^/]{1,128}$/),
      })
      .parse(req.body);
    res.setHeader("Cache-Control", "no-store");
    res.json(
      await createPlayback(req.authUser!.uid, input.courseId, input.videoId),
    );
  } catch (e) {
    next(e);
  }
});
playbackRouter.get("/media/:token/*", async (req, res, next) => {
  try {
    if (!performance.PROTECTED_PLAYBACK || !performance.PLAYBACK_SECRET)
      throw new HttpError(403, "Protected playback disabled.");
    const key = String((req.params as unknown as Record<string, string>)["0"]);
    const claims = verifyPlayback(
      String(req.params.token),
      key,
      performance.PLAYBACK_SECRET,
    );
    await requireCourseAccess(claims.uid, claims.courseId);
    await serveMedia(req, res, next, key, true);
  } catch (e) {
    next(e);
  }
});
