import { vi, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { Readable } from "node:stream";
vi.mock("../src/services/media.service", () => ({ getObject: vi.fn(), headObject: vi.fn() }));
vi.mock("../src/services/readiness.service", () => ({ readiness: vi.fn().mockResolvedValue({ storage: true }) }));
import { performance } from "../src/config/performance";
import { getObject, headObject } from "../src/services/media.service";
import { mediaRouter } from "../src/routes/media.routes";
import { healthRouter } from "../src/routes/health.routes";
import { errorHandler } from "../src/middleware/error-handler";
import { buildPublicMediaUrl } from "../src/services/media-url.service";
const app = express();
app.set("trust proxy", ["loopback", "10.0.1.7/32"]);
app.use("/media", mediaRouter); app.use("/health", healthRouter); app.use(errorHandler);
beforeEach(() => {
  vi.clearAllMocks();
  performance.PUBLIC_MEDIA_BASE_URL = "https://images.test";
  performance.IMAGE_CDN_REDIRECT_ENABLED = true;
  performance.PROTECTED_PLAYBACK = false;
  performance.METRICS_TOKEN = "metrics-local-test-token-32-characters";
  vi.mocked(getObject).mockImplementation(async () => ({ Body: Readable.from("image"), ContentLength: 5, ContentType: "image/png", ETag: '"tag"' }) as any);
  vi.mocked(headObject).mockResolvedValue({ ContentLength: 5 } as any);
});
it("redirects existing image URLs reversibly and generates CDN URLs only for public image folders", async () => {
  const result = await request(app).get("/media/public/course-thumbnails/u/a");
  expect(result.status).toBe(307);
  expect(result.headers.location).toBe("https://images.test/course-thumbnails/u/a");
  expect(result.headers["cache-control"]).toBe("no-store");
  expect(getObject).not.toHaveBeenCalled();
  expect(buildPublicMediaUrl("banner-images/u/a")).toContain("images.test/");
  expect(buildPublicMediaUrl("videos/raw/u/a")).toContain("api.test/media/public/");
  expect(buildPublicMediaUrl("certificate-templates/u/a")).toContain("api.test/media/public/");
  performance.IMAGE_CDN_REDIRECT_ENABLED = false;
  expect((await request(app).get("/media/public/course-thumbnails/u/a")).status).toBe(200);
});
it("image origin bypasses redirects, supports HEAD/conditional requests and denies videos", async () => {
  const path = "/media/image-origin/banner-images/u/a";
  expect((await request(app).get(path)).status).toBe(200);
  expect((await request(app).head(path)).status).toBe(200);
  expect(headObject).toHaveBeenCalledTimes(1);
  expect((await request(app).get(path).set("If-None-Match", '"tag"')).status).toBe(304);
  expect((await request(app).get("/media/image-origin/videos/hls/u/a.ts")).status).toBe(404);
  expect((await request(app).get("/media/image-origin/certificate-templates/u/a")).status).toBe(404);
});
it("rejects a CDN pointing back at the API to prevent redirect loops", async () => {
  performance.PUBLIC_MEDIA_BASE_URL = "https://api.test/media/public";
  expect((await request(app).get("/media/public/banner-images/u/a")).status).toBe(503);
});
it("metrics deny missing/wrong tokens and reveal feature state only with the correct token", async () => {
  expect((await request(app).get("/health/metrics")).status).toBe(404);
  expect((await request(app).get("/health/metrics").set("Authorization", "Bearer wrong")).status).toBe(404);
  const r = await request(app).get("/health/metrics").set("Authorization", `Bearer ${performance.METRICS_TOKEN}`);
  expect(r.status).toBe(200); expect(r.body.features.publicVideoBlocked).toBe(false);
  expect(r.headers["cache-control"]).toBe("no-store");
  expect(JSON.stringify(r.body)).not.toContain(performance.METRICS_TOKEN!);
});
it("trusted proxy walk ignores client-supplied addresses before the nearest untrusted hop", async () => {
  const r = await request(app).get("/health/diagnostics")
    .set("Authorization", `Bearer ${performance.METRICS_TOKEN}`)
    .set("X-Forwarded-For", "198.51.100.66, 203.0.113.20, 10.0.1.7");
  expect(r.status).toBe(200); expect(r.body.clientIp).toBe("203.0.113.20");
  expect((await request(app).get("/health/diagnostics")).status).toBe(404);
});
