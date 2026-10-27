import { vi, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { Readable } from "node:stream";
import { PassThrough } from "node:stream";
import http from "node:http";
vi.mock("../src/services/media.service", () => ({
  getObject: vi.fn(),
  headObject: vi.fn(),
}));
import { getObject, headObject } from "../src/services/media.service";
import { mediaRouter } from "../src/routes/media.routes";
import { errorHandler } from "../src/middleware/error-handler";
import { HttpError } from "../src/utils/http-error";
const app = express();
app.use("/media", mediaRouter);
app.use(errorHandler);
beforeEach(() => vi.clearAllMocks());
it("streams full content with media headers", async () => {
  vi.mocked(getObject).mockResolvedValue({
    Body: Readable.from("hello"),
    ContentLength: 5,
    ContentType: "application/octet-stream",
    ETag: "tag",
  } as any);
  const r = await request(app).get("/media/public/videos/hls/u/a/1.ts");
  expect(r.status).toBe(200);
  expect(r.headers["content-type"]).toBe("video/mp2t");
  expect(r.body.toString()).toBe("hello");
});
it("serves byte ranges as 206 with Content-Range", async () => {
  vi.mocked(getObject).mockResolvedValue({
    Body: Readable.from("abc"),
    ContentLength: 3,
    ContentRange: "bytes 0-2/5",
  } as any);
  const r = await request(app)
    .get("/media/public/images/u/a")
    .set("Range", "bytes=0-2");
  expect(r.status).toBe(206);
  expect(r.headers["content-range"]).toBe("bytes 0-2/5");
  expect(vi.mocked(getObject).mock.calls[0][1]).toBe("bytes=0-2");
});
it("HEAD uses metadata only", async () => {
  vi.mocked(headObject).mockResolvedValue({ ContentLength: 10 } as any);
  const r = await request(app).head("/media/public/images/u/a");
  expect(r.status).toBe(200);
  expect(getObject).not.toHaveBeenCalled();
});
it("maps missing storage objects without exposing provider errors", async () => {
  vi.mocked(getObject).mockRejectedValue(
    new HttpError(404, "Media not found."),
  );
  const r = await request(app).get("/media/public/images/u/a");
  expect(r.status).toBe(404);
  expect(r.body.error).toBe("Media not found.");
});
it("conditional request destroys unused upstream body", async () => {
  const body = Readable.from("hello");
  vi.mocked(getObject).mockResolvedValue({ Body: body, ETag: "tag" } as any);
  const r = await request(app)
    .get("/media/public/images/u/a")
    .set("If-None-Match", "tag");
  expect(r.status).toBe(304);
  expect(body.destroyed).toBe(true);
});
it("missing ETag does not accidentally return 304", async () => {
  vi.mocked(getObject).mockResolvedValue({
    Body: Readable.from("hello"),
  } as any);
  expect((await request(app).get("/media/public/images/u/a")).status).toBe(200);
});
it("viewer disconnect aborts and destroys the storage stream", async () => {
  const body = new PassThrough();
  let signal: AbortSignal | undefined;
  vi.mocked(getObject).mockImplementation(async (_key, _range, s) => {
    signal = s;
    return { Body: body } as any;
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const port = (server.address() as any).port;
  const timer = setInterval(() => body.write(Buffer.alloc(1024)), 10);
  try {
    await new Promise<void>((resolve, reject) => {
      const req = http.get(
        `http://127.0.0.1:${port}/media/public/images/u/a`,
        (res) =>
          res.once("data", () => {
            res.destroy();
            resolve();
          }),
      );
      req.on("error", reject);
    });
    await vi.waitFor(() => {
      expect(body.destroyed).toBe(true);
      expect(signal?.aborted).toBe(true);
    });
  } finally {
    clearInterval(timer);
    body.destroy();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
