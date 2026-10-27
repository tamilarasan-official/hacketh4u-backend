import type { RequestHandler } from "express";
import { createHash } from "node:crypto";
import { performance } from "../config/performance";
import { redisConnection } from "../config/queues";
import { HttpError } from "../utils/http-error";
const script =
  "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n";
export const rateLimit: RequestHandler = async (req, res, next) => {
  if (
    !performance.RATE_LIMIT_ENABLED ||
    req.path.startsWith("/health") ||
    req.path === "/payments/webhooks/razorpay"
  )
    return next();
  if (redisConnection.status !== "ready")
    return next(
      new HttpError(503, "Request admission temporarily unavailable."),
    );
  try {
    const identity = createHash("sha256")
      .update(req.ip ?? req.socket.remoteAddress ?? "unknown")
      .digest("hex");
    const count = Number(
      await redisConnection.eval(
        script,
        1,
        `rate:${identity}:${Math.floor(Date.now() / 60000)}`,
      ),
    );
    if (count > performance.RATE_LIMIT_PER_MINUTE) {
      res.setHeader("Retry-After", "60");
      throw new HttpError(429, "Too many requests.");
    }
    next();
  } catch (error) {
    next(
      error instanceof HttpError
        ? error
        : new HttpError(503, "Request admission temporarily unavailable."),
    );
  }
};
