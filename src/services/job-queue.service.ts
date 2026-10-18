import { videoQueue } from "../config/queues";

export type VideoProcessingJob = {
  mediaId: string;
  objectKey: string;
  publicUrl: string;
  contentType: string;
};

export async function enqueueVideoProcessing(input: VideoProcessingJob): Promise<string> {
  const job = await videoQueue.add("process-video", input, {
    jobId: `video-${input.mediaId}`
  });
  return job.id ?? `video-${input.mediaId}`;
}
