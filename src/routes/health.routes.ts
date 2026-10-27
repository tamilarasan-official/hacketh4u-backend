import { Router } from "express";
import { readiness } from "../services/readiness.service";
import { metricSnapshot } from "../services/metrics.service";
import { performance } from "../config/performance";

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
healthRouter.get("/metrics", (req, res) => {
  if (
    !performance.METRICS_TOKEN ||
    req.header("authorization") !== `Bearer ${performance.METRICS_TOKEN}`
  ) {
    res.status(404).end();
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.json(metricSnapshot());
});

healthRouter.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "hacketh4u-backend",
    timestamp: new Date().toISOString(),
  });
});
