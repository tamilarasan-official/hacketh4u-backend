import { videoQueue } from "../config/queues";
import { persistVideoJob } from "./job-outbox.service";

export type VideoProcessingJob = {
  mediaId: string;
  objectKey: string;
  publicUrl: string;
  contentType: string;
};

export async function enqueueVideoProcessing(
  input: VideoProcessingJob,
): Promise<string> {
  return persistVideoJob(input);
}
