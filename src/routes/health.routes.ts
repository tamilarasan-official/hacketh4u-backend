import { Router, type RequestHandler } from "express";
import { timingSafeEqual } from "node:crypto";
import { hostname } from "node:os";
import { readiness } from "../services/readiness.service";
import { metricSnapshot } from "../services/metrics.service";
import { performance } from "../config/performance";
import { cacheSnapshot } from "../services/cache.service";

export const healthRouter = Router();
healthRouter.get("/ready", async (_req, res) => {
  try {
    const checks = await readiness();
    res
      .status(Object.values(checks).every(Boolean) ? 200 : 503)
      .json({ checks });
  } catch {
    res.status(503).json({ ok: false });
  }
});
const requireMetrics: RequestHandler = (req, res, next) => {
  const actual = Buffer.from(req.header("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${performance.METRICS_TOKEN ?? ""}`);
  if (!performance.METRICS_TOKEN || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    res.status(404).end();
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  next();
};
healthRouter.get("/metrics", requireMetrics, (_req, res) => {
  res.json({ ...metricSnapshot(), instance: hostname(), cache: cacheSnapshot(), features: {
    rateLimiting: performance.RATE_LIMIT_ENABLED,
    playbackSessions: performance.PLAYBACK_SESSIONS_ENABLED || performance.PROTECTED_PLAYBACK,
    publicVideoBlocked: performance.PROTECTED_PLAYBACK,
    imageCdnRedirect: performance.IMAGE_CDN_REDIRECT_ENABLED,
    storageKeepAlive: performance.STORAGE_KEEP_ALIVE,
  } });
});
healthRouter.get("/diagnostics", requireMetrics, (req, res) => {
  res.json({ instance: hostname(), clientIp: req.ip, forwardedChain: req.ips, peer: req.socket.remoteAddress });
});

healthRouter.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "hacketh4u-backend",
    timestamp: new Date().toISOString(),
  });
});
