import { Queue } from "bullmq";
import IORedis from "ioredis";
import { env } from "./env";

export const redisConnection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: 1,
  enableReadyCheck: true,
  enableOfflineQueue: false,
  commandTimeout: 2000,
});
redisConnection.on("error", () => {});
export const workerConnection = {
  url: env.REDIS_URL,
  maxRetriesPerRequest: null,
};
export function createWorkerConnection() {
  const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  connection.on("error", () => {});
  return connection;
}

export const videoQueue = new Queue("video-processing", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 1000 },
  },
});

export const backgroundQueue = new Queue("background", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2_000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 1000 },
  },
});

export const bucketQueue = new Queue("bucket", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2_000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 1000 },
  },
});

export async function closeQueues(): Promise<void> {
  await Promise.all([
    videoQueue.close(),
    backgroundQueue.close(),
    bucketQueue.close(),
  ]);
  await redisConnection.quit();
}
