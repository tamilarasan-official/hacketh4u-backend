import { vi, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
vi.mock("../src/config/queues", () => ({ redisConnection: { status: "ready", eval: vi.fn() } }));
import { redisConnection } from "../src/config/queues";
import { firebaseAuth } from "../src/config/firebase";
import { performance } from "../src/config/performance";
import { rateLimit } from "../src/middleware/rate-limit";
import { requireAuth } from "../src/middleware/auth";
import { errorHandler } from "../src/middleware/error-handler";
const app = express(); app.set("trust proxy", "loopback"); app.use(rateLimit);
app.get("/private", requireAuth, (_q, r) => r.json({ ok: true }));
app.use((_q, r) => r.json({ ok: true })); app.use(errorHandler);
const counts = new Map<string, number>();
beforeEach(() => {
  counts.clear(); vi.clearAllMocks();
  performance.RATE_LIMIT_ENABLED = true; performance.RATE_LIMIT_IP_PER_MINUTE = 20;
  performance.RATE_LIMIT_MEDIA_PER_MINUTE = 30; performance.RATE_LIMIT_PER_MINUTE = 2;
  vi.mocked(redisConnection.eval).mockImplementation(async (_script, _n, key) => {
    const k = String(key); const n = (counts.get(k) ?? 0) + 1; counts.set(k, n); return n;
  });
  vi.mocked(firebaseAuth.verifyIdToken).mockImplementation(async t => {
    if (t === "invalid") throw Object.assign(Error("invalid"), { code: "auth/invalid-id-token" });
    return { uid: t } as any;
  });
});
it("uses verified user identity so users on one Wi-Fi have separate API budgets", async () => {
  const get = (uid: string) => request(app).get("/private").set("Authorization", `Bearer ${uid}`);
  expect((await get("a")).status).toBe(200); expect((await get("a")).status).toBe(200);
  const denied = await get("a"); expect(denied.status).toBe(429);
  expect(Number(denied.headers["retry-after"])).toBeGreaterThan(0);
  expect((await get("b")).status).toBe(200);
  const before = [...counts.keys()].filter(k => k.includes("user-api")).length;
  expect((await get("invalid")).status).toBe(401);
  expect([...counts.keys()].filter(k => k.includes("user-api"))).toHaveLength(before);
});
it("media does not exhaust API budgets and independent client IPs have separate limits", async () => {
  performance.RATE_LIMIT_MEDIA_PER_MINUTE = 1;
  const media = (ip: string) => request(app).get("/playback/media/token/videos/a.ts").set("X-Forwarded-For", ip);
  expect((await media("203.0.113.1")).status).toBe(200);
  expect((await media("203.0.113.1")).status).toBe(429);
  expect((await media("203.0.113.2")).status).toBe(200);
  expect((await request(app).get("/private").set("X-Forwarded-For", "203.0.113.1").set("Authorization", "Bearer a")).status).toBe(200);
});
it("fails closed on Redis errors while health and verified webhook ingress stay exempt", async () => {
  vi.mocked(redisConnection.eval).mockRejectedValue(Error("offline"));
  expect((await request(app).get("/private")).status).toBe(503);
  expect((await request(app).get("/health/ready")).status).toBe(200);
  expect((await request(app).post("/payments/webhooks/razorpay")).status).toBe(200);
  expect((await request(app).get("/payments/webhooks/razorpay")).status).toBe(503);
  performance.RATE_LIMIT_ENABLED = false;
  expect((await request(app).get("/private").set("Authorization", "Bearer a")).status).toBe(200);
});
