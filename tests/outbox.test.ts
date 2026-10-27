import { vi, it, expect, beforeEach } from "vitest";
const state = vi.hoisted(() => ({ docs: new Map<string, any>(), fail: false }));
vi.mock("../src/config/firebase", () => ({
  firestore: {
    collection: () => ({
      doc: (id: string) => ({
        id,
        set: async (d: any) =>
          state.docs.set(id, { ...state.docs.get(id), ...d }),
      }),
    }),
    runTransaction: async (fn: any) =>
      fn({
        get: async (r: any) => ({ exists: state.docs.has(r.id) }),
        create: (r: any, d: any) => state.docs.set(r.id, d),
      }),
  },
}));
vi.mock("../src/config/queues", () => ({
  videoQueue: {
    add: vi.fn(async () => {
      if (state.fail) throw new Error("Redis unavailable");
      return { id: "job" };
    }),
  },
}));
import { persistVideoJob } from "../src/services/job-outbox.service";
import { videoQueue } from "../src/config/queues";
beforeEach(() => {
  state.docs.clear();
  state.fail = false;
  vi.clearAllMocks();
});
it("Redis outage leaves a durable pending job instead of dropping uploaded work", async () => {
  state.fail = true;
  expect(
    await persistVideoJob({
      mediaId: "m",
      objectKey: "videos/raw/u/a",
      publicUrl: "https://example.test/a",
      contentType: "video/mp4",
    }),
  ).toBe("video-m");
  expect(state.docs.get("video-m").status).toBe("pending");
});
it("successful dispatch uses a deterministic job ID", async () => {
  await persistVideoJob({
    mediaId: "m",
    objectKey: "videos/raw/u/a",
    publicUrl: "https://example.test/a",
    contentType: "video/mp4",
  });
  expect(videoQueue.add).toHaveBeenCalledWith(
    "process-video",
    expect.anything(),
    { jobId: "video-m" },
  );
  expect(state.docs.get("video-m").status).toBe("sent");
});
