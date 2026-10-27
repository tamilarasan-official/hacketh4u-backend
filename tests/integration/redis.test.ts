import { it, expect, vi } from "vitest";
import IORedis from "ioredis";
import { Queue, Worker } from "bullmq";
it.skipIf(process.env.RUN_REDIS_TESTS !== "true")(
  "isolated authenticated Redis deduplicates job IDs and processes a real job",
  async () => {
    const connection = new IORedis("redis://:local-test-only@127.0.0.1:16379", {
      maxRetriesPerRequest: null,
    });
    const name = "local-validation-" + Date.now();
    const queue = new Queue(name, { connection });
    let count = 0;
    const worker = new Worker(
      name,
      async () => {
        count++;
        return { ok: true };
      },
      { connection },
    );
    try {
      await worker.waitUntilReady();
      expect(await connection.ping()).toBe("PONG");
      await queue.add("check", {}, { jobId: "one" });
      await queue.add("check", {}, { jobId: "one" });
      await vi.waitFor(() => expect(count).toBe(1));
      await vi.waitFor(async () =>
        expect(await (await queue.getJob("one"))?.getState()).toBe("completed"),
      );
    } finally {
      await worker.close();
      await queue.close();
      await connection.quit();
    }
  },
);
