import { firestore } from "../config/firebase";
import { redisConnection } from "../config/queues";
import { garageS3 } from "../config/garage";
import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { env } from "../config/env";
let latest: { at: number; result: Record<string, boolean> } | undefined;
let pending: Promise<Record<string, boolean>> | undefined;
export async function readiness() {
  if (latest && Date.now() - latest.at < 10000) return latest.result;
  if (pending) return pending;
  pending = (async () => {
    const checks = await Promise.allSettled(
      [
        redisConnection.status === "ready"
          ? redisConnection.ping()
          : Promise.reject(new Error("Redis unavailable")),
        firestore.collection("_health").limit(1).get(),
        garageS3.send(new HeadBucketCommand({ Bucket: env.GARAGE_S3_BUCKET }), {
          abortSignal: AbortSignal.timeout(2000),
        }),
      ].map((p) => bounded<unknown>(p, 2500)),
    );
    const result = Object.fromEntries(
      ["redis", "firestore", "storage"].map((name, i) => [
        name,
        checks[i].status === "fulfilled",
      ]),
    );
    latest = { at: Date.now(), result };
    return result;
  })();
  try {
    return await pending;
  } finally {
    pending = undefined;
  }
}
export async function bounded<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Dependency timeout")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
