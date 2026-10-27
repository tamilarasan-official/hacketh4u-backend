import IORedis from "ioredis";
import { performance } from "../config/performance";
// Cache uses a separate optional Redis instance. Never change the queue's eviction policy.
export const cacheRedis = performance.CACHE_REDIS_URL
  ? new IORedis(performance.CACHE_REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      commandTimeout: 1000,
      enableOfflineQueue: false,
    })
  : null;
cacheRedis?.on("error", () => {});
void cacheRedis?.connect().catch(() => {});
const pending = new Map<string, Promise<unknown>>();
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  load: () => Promise<T>,
): Promise<T> {
  try {
    const value = await cacheRedis?.get(key);
    if (value) return JSON.parse(value) as T;
  } catch {
    /* optional cache */
  }
  if (pending.has(key)) return pending.get(key) as Promise<T>;
  const promise = (async () => {
    const result = await load();
    try {
      if (cacheRedis?.status === "ready")
        await cacheRedis.set(key, JSON.stringify(result), "EX", ttlSeconds);
    } catch {
      /* optional cache */
    }
    return result;
  })();
  if (pending.size < 1000) pending.set(key, promise);
  try {
    return await promise;
  } finally {
    if (pending.get(key) === promise) pending.delete(key);
  }
}
export async function invalidateCache(key: string): Promise<void> {
  try {
    await cacheRedis?.del(key);
  } catch {
    /* TTL bounds stale data */
  }
}
