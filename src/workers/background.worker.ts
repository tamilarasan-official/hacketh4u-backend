import { Worker } from "bullmq";
import { backgroundQueue, closeQueues, redisConnection } from "../config/queues";

const worker = new Worker(
  "background",
  async (job) => {
    console.info("Background job received", { jobId: job.id, name: job.name });
    return { accepted: true };
  },
  { connection: redisConnection, concurrency: 5 }
);

worker.on("error", (error) => console.error("Background worker error", error));

async function shutdown(signal: string): Promise<void> {
  console.info(`Background worker received ${signal}`);
  await worker.close();
  await backgroundQueue.close();
  await closeQueues();
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
console.info("Background worker started");
