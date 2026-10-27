import { vi, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { Readable } from "node:stream";
vi.mock("../src/services/media.service", () => ({ getObject: vi.fn(), headObject: vi.fn() }));
vi.mock("../src/services/entitlement.service", () => ({ getCourseEntitlement: vi.fn() }));
vi.mock("../src/config/firebase", () => ({
  firebaseAuth: { verifyIdToken: vi.fn() },
  firestore: { collection: vi.fn((collection: string) => ({ doc: () => ({ get: async () => ({ data: () => collection === "videos"
    ? { courseId: "c", streamingUrl: "https://api.test/media/public/videos/hls/u/v/master.m3u8" }
    : { role: "user" } }) }) })) },
}));
import { performance } from "../src/config/performance";
import { firebaseAuth } from "../src/config/firebase";
import { getCourseEntitlement } from "../src/services/entitlement.service";
import { getObject } from "../src/services/media.service";
import { signPlayback } from "../src/services/playback.service";
import { mediaRouter } from "../src/routes/media.routes";
import { playbackRouter } from "../src/routes/playback.routes";
import { errorHandler } from "../src/middleware/error-handler";
const app = express(); app.use(express.json());
app.use("/playback", playbackRouter); app.use("/media", mediaRouter); app.use(errorHandler);
beforeEach(() => {
  vi.clearAllMocks();
  performance.PROTECTED_PLAYBACK = false;
  performance.PLAYBACK_SESSIONS_ENABLED = true;
  performance.PLAYBACK_TEST_USER_IDS = "u";
  performance.PLAYBACK_SECRET = "separate-playback-test-secret-32-characters";
  vi.mocked(firebaseAuth.verifyIdToken).mockResolvedValue({ uid: "u" } as any);
  vi.mocked(getCourseEntitlement).mockResolvedValue({ hasAccess: true } as any);
  vi.mocked(getObject).mockImplementation(async (_key, range) => ({ Body: Readable.from("abc"), ContentLength: 3,
    ...(range ? { ContentRange: "bytes 0-2/10" } : {}) }) as any);
});
async function session() { return request(app).post("/playback/session").set("Authorization", "Bearer local-test").send({ courseId: "c", videoId: "v" }); }
it("pilot serves existing public video and signed relative HLS/seek requests together", async () => {
  expect((await request(app).get("/media/public/videos/hls/u/v/master.m3u8")).status).toBe(200);
  const r = await session(); expect(r.status).toBe(200);
  const url = new URL(r.body.url);
  const segment = new URL("720p/1.ts", url).pathname;
  expect((await request(app).get(url.pathname)).status).toBe(200);
  const seek = await request(app).get(segment).set("Range", "bytes=0-2");
  expect(seek.status).toBe(206); expect(seek.headers["cache-control"]).toBe("private, no-store");
  performance.PROTECTED_PLAYBACK = true;
  expect((await request(app).get("/media/public/videos/hls/u/v/master.m3u8")).status).toBe(403);
  expect((await request(app).get(url.pathname)).status).toBe(200);
});
it("rejects unpaid access, then rejects a previously issued session after access revocation", async () => {
  const r = await session(); expect(r.status).toBe(200);
  vi.mocked(getCourseEntitlement).mockResolvedValue({ hasAccess: false } as any);
  expect((await session()).status).toBe(403);
  expect((await request(app).get(new URL(r.body.url).pathname)).status).toBe(403);
});
it("requires authentication and the pilot allowlist, and supports disabling session creation", async () => {
  expect((await request(app).post("/playback/session").send({ courseId: "c", videoId: "v" })).status).toBe(401);
  performance.PLAYBACK_TEST_USER_IDS = "different-user";
  expect((await session()).status).toBe(403);
  performance.PLAYBACK_SESSIONS_ENABLED = false;
  expect((await session()).status).toBe(503);
});
it("rejects expired, tampered and out-of-scope sessions before any storage read", async () => {
  const token = signPlayback({ uid: "u", courseId: "c", key: "videos/hls/u/v", prefix: true, exp: 1 }, performance.PLAYBACK_SECRET!);
  expect((await request(app).get(`/playback/media/${token}/videos/hls/u/v/a.ts`)).status).toBe(403);
  const r = await session(); const path = new URL(r.body.url).pathname;
  expect((await request(app).get(path.replace("/videos/hls/u/v/", "/videos/hls/u/other/"))).status).toBe(403);
  expect((await request(app).get(path.replace("/playback/media/", "/playback/media/x"))).status).toBe(403);
  expect(getObject).not.toHaveBeenCalled();
});
