import { vi, it, expect } from "vitest";
import express from "express";
import request from "supertest";
vi.mock("../src/config/performance", () => ({
  performance: {
    PROTECTED_PLAYBACK: true,
    PLAYBACK_SECRET: "test-secret-at-least-32-characters",
  },
}));
vi.mock("../src/services/media.service", () => ({
  getObject: vi.fn(),
  headObject: vi.fn(),
}));
import { mediaRouter } from "../src/routes/media.routes";
import { errorHandler } from "../src/middleware/error-handler";
const app = express();
app.use("/media", mediaRouter);
app.use(errorHandler);
it.each([
  "/media/public/videos/raw/u/a.mp4",
  "/media/public/%76ideos/raw/u/a.mp4",
])("rejects public video bypass %s", async (path) => {
  expect((await request(app).get(path)).status).toBe(403);
});
