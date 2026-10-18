import { Worker } from "bullmq";
import { firestore } from "../config/firebase";
import { redisConnection, closeQueues } from "../config/queues";
import { processGarageVideoToHls } from "../services/video-processing.service";
import type { VideoProcessingJob } from "../services/job-queue.service";

const worker = new Worker<VideoProcessingJob>(
  "video-processing",
  async (job) => {
    const { mediaId, objectKey, publicUrl, contentType } = job.data;
    const ref = firestore.collection("media_uploads").doc(mediaId);
    await ref.set({ status: "processing", updatedAt: new Date(), processingAttempts: job.attemptsMade + 1 }, { merge: true });

    try {
      const processed = await processGarageVideoToHls({ objectKey, publicUrl, contentType });
      await ref.set({ ...processed, status: "processed", updatedAt: new Date() }, { merge: true });
      console.info("Video processing completed", { mediaId, objectKey, jobId: job.id });
      return processed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ref.set({ status: "processing_failed", processingError: message, updatedAt: new Date() }, { merge: true });
      console.error("Video processing failed", { mediaId, objectKey, jobId: job.id, message });
      throw error;
    }
  },
  { connection: redisConnection, concurrency: 1 }
);

worker.on("error", (error) => console.error("Video worker error", error));

async function shutdown(signal: string): Promise<void> {
  console.info(`Video worker received ${signal}`);
  await worker.close();
  await closeQueues();
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
console.info("Video worker started");
