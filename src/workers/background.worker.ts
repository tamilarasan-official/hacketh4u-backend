import { Worker } from "bullmq";
import { closeQueues, createWorkerConnection } from "../config/queues";
import { dispatchPendingJobs } from "../services/job-outbox.service";
import { workerHeartbeat } from "./worker-health";
const redisConnection = createWorkerConnection();

const worker = new Worker(
  "background",
  async (job) => {
    if (job.name !== "dispatch-outbox")
      throw new Error("Unsupported background job: " + job.name);
    return dispatchPendingJobs();
  },
  { connection: redisConnection, concurrency: 5 },
);

worker.on("error", (error) => console.error("Background worker error", error));
let dispatching = false;
const sweep = async () => {
  if (dispatching) return;
  dispatching = true;
  try {
    await dispatchPendingJobs();
  } catch (e) {
    console.error(
      "Outbox dispatch failed",
      e instanceof Error ? e.message : "unknown",
    );
  } finally {
    dispatching = false;
  }
};
const timer = setInterval(() => void sweep(), 30000);
void sweep();
const stopHeartbeat = workerHeartbeat(() => redisConnection.status === "ready");

async function shutdown(signal: string): Promise<void> {
  console.info(`Background worker received ${signal}`);
  await worker.close();
  clearInterval(timer);
  stopHeartbeat();
  await redisConnection.quit();
  await closeQueues();
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
console.info("Background worker started");
