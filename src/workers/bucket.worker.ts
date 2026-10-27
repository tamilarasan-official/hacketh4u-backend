import { Worker } from "bullmq";
import { closeQueues, createWorkerConnection } from "../config/queues";
import { headObject } from "../services/media.service";
import { workerHeartbeat } from "./worker-health";
const redisConnection = createWorkerConnection();

const worker = new Worker(
  "bucket",
  async (job) => {
    if (job.name !== "verify-object" || typeof job.data?.objectKey !== "string")
      throw new Error("Unsupported bucket job");
    const object = await headObject(job.data.objectKey);
    return { exists: true, bytes: object.ContentLength, etag: object.ETag };
  },
  { connection: redisConnection, concurrency: 2 },
);

worker.on("error", (error) => console.error("Bucket worker error", error));
const stopHeartbeat = workerHeartbeat(() => redisConnection.status === "ready");

async function shutdown(signal: string): Promise<void> {
  console.info(`Bucket worker received ${signal}`);
  await worker.close();
  stopHeartbeat();
  await redisConnection.quit();
  await closeQueues();
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
console.info("Bucket worker started");
