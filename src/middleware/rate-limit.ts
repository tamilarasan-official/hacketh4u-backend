import type { RequestHandler, Response } from "express";
import { performance } from "../config/performance";
import { redisConnection } from "../config/queues";
import { consumeAdmission } from "../services/admission.service";
import { HttpError } from "../utils/http-error";
async function enforce(scope: string, identity: string, budget: number, res: Response) {
  const result = await consumeAdmission(redisConnection, scope, identity, budget);
  if (!result.allowed) {
    res.setHeader("Retry-After", String(result.retryAfter));
    throw new HttpError(429, "Too many requests.");
  }
}
export async function limitAuthenticatedUser(uid: string, res: Response) {
  if (performance.RATE_LIMIT_ENABLED) await enforce("user-api", uid, performance.RATE_LIMIT_PER_MINUTE, res);
}
export const rateLimit: RequestHandler = async (req, res, next) => {
  const read = req.method === "GET" || req.method === "HEAD";
  if (!performance.RATE_LIMIT_ENABLED ||
      (read && /^\/health(?:\/(?:ready|metrics|diagnostics))?\/?$/.test(req.path)) ||
      (req.method === "POST" && req.path === "/payments/webhooks/razorpay")) return next();
  try {
    const media = read && /^(?:\/media\/(?:public|image-origin)\/|\/playback\/media\/)/.test(req.path);
    await enforce(media ? "ip-media" : "ip-api", req.ip ?? req.socket.remoteAddress ?? "unknown",
      media ? performance.RATE_LIMIT_MEDIA_PER_MINUTE : performance.RATE_LIMIT_IP_PER_MINUTE, res);
    next();
  } catch (error) { next(error); }
};
