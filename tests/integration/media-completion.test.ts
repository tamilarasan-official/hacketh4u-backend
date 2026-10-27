import { afterAll, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

vi.hoisted(() => {
  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:19189";
});
vi.mock("../../src/config/firebase", async () => {
  const { Firestore } = await import("firebase-admin/firestore");
  return { firestore: new Firestore({ projectId: "demo-hacketh4u-local" }) };
});
vi.mock("../../src/config/garage", () => ({
  garageS3: { send: vi.fn(async () => ({ ContentType: "video/mp4" })) },
  garageSigningRegion: "us-east-1",
}));

import { firestore } from "../../src/config/firebase";
import { videoQueue } from "../../src/config/queues";
import {
  completeUpload,
  completeMultipartUpload,
} from "../../src/services/media.service";

const test = it.skipIf(process.env.RUN_FIRESTORE_TESTS !== "true");
const suffix = Date.now().toString();
afterAll(() => firestore.terminate());

for (const method of ["signed", "multipart"] as const) {
  test(`${method} completion retry preserves processed metadata and does not requeue`, async () => {
    const objectKey = `videos/raw/local-user/${suffix}-${method}.mp4`;
    const id = createHash("sha256").update(objectKey).digest("hex");
    const ref = firestore.collection("media_uploads").doc(id);
    const input = {
      userId: "local-user", objectKey, publicUrl: "https://ignored.test",
      contentType: "video/mp4", entityType: "video", entityId: "test-video",
      uploadId: "mock-upload", parts: [{ partNumber: 1, eTag: "mock-etag" }],
    };
    const complete = method === "signed" ? completeUpload : completeMultipartUpload;
    expect((await complete(input)).status).toBe("processing");
    expect((await ref.get()).data()?.status).toBe("queued");
    const processed = {
      ...(await ref.get()).data(), status: "processed",
      streamingUrl: "https://api.test/existing-master.m3u8",
      qualities: { "480p": "https://api.test/existing-480p.m3u8" },
    };
    await ref.set(processed);
    vi.mocked(videoQueue.add).mockClear();
    const result = await complete(input);
    expect(result.status).toBe("processed");
    expect(result.streamingUrl).toBe(processed.streamingUrl);
    expect(result.qualities).toEqual(processed.qualities);
    expect((await ref.get()).data()).toEqual(processed);
    expect(videoQueue.add).not.toHaveBeenCalled();
  });
}

test("concurrent completion records one upload and one durable outbox entry", async () => {
  const objectKey = `videos/raw/local-user/${suffix}-concurrent.mp4`;
  const id = createHash("sha256").update(objectKey).digest("hex");
  const input = {
    userId: "local-user", objectKey, publicUrl: "https://ignored.test",
    contentType: "video/mp4", entityType: "video", entityId: "test-video",
  };
  const results = await Promise.all(Array.from({ length: 6 }, () => completeUpload(input)));
  expect(new Set(results.map((r) => r.id))).toEqual(new Set([id]));
  const uploads = await firestore.collection("media_uploads").where("objectKey", "==", objectKey).get();
  expect(uploads.size).toBe(1);
  const outbox = await firestore.collection("job_outbox").doc(`video-${id}`).get();
  expect(outbox.data()?.payload.objectKey).toBe(objectKey);
  expect(outbox.data()?.status).toBe("sent");
}, 30000);
