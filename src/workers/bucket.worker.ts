import { Worker } from "bullmq";
import { bucketQueue, closeQueues, redisConnection } from "../config/queues";

const worker = new Worker(
  "bucket",
  async (job) => {
    console.info("Bucket job received", { jobId: job.id, name: job.name });
    return { accepted: true };
  },
  { connection: redisConnection, concurrency: 2 }
);

worker.on("error", (error) => console.error("Bucket worker error", error));

async function shutdown(signal: string): Promise<void> {
  console.info(`Bucket worker received ${signal}`);
  await worker.close();
  await bucketQueue.close();
  await closeQueues();
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
console.info("Bucket worker started");
