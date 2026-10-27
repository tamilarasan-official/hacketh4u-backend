import { firestore } from "../config/firebase";
import { videoQueue } from "../config/queues";
import type { VideoProcessingJob } from "./job-queue.service";
export async function persistVideoJob(
  input: VideoProcessingJob,
): Promise<string> {
  const id = `video-${input.mediaId}`,
    ref = firestore.collection("job_outbox").doc(id);
  await firestore.runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    if (!existing.exists)
      tx.create(ref, {
        payload: input,
        status: "pending",
        createdAt: new Date(),
      });
  });
  try {
    await deliverVideoJob(id, input);
  } catch {
    /* durable pending record is retried by background worker */
  }
  return id;
}
async function deliverVideoJob(id: string, input: VideoProcessingJob) {
  await videoQueue.add("process-video", input, { jobId: id });
  await firestore
    .collection("job_outbox")
    .doc(id)
    .set({ status: "sent", sentAt: new Date() }, { merge: true });
}
export async function dispatchPendingJobs() {
  const docs = await firestore
    .collection("job_outbox")
    .where("status", "==", "pending")
    .limit(50)
    .get();
  for (const doc of docs.docs)
    await deliverVideoJob(doc.id, doc.data().payload as VideoProcessingJob);
  return { dispatched: docs.size };
}
