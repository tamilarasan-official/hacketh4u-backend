import IORedis from "ioredis";
import { performance } from "../config/performance";
import { createProfileCache } from "./profile-cache";
// Separate optional Redis. The job queue's eviction and persistence stay unchanged.
export const cacheRedis = performance.CACHE_REDIS_URL
  ? new IORedis(performance.CACHE_REDIS_URL, {
      lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 1000,
      commandTimeout: 1000, enableOfflineQueue: false,
    })
  : null;
cacheRedis?.on("error", () => {});
void cacheRedis?.connect().catch(() => {});
const cache = createProfileCache(cacheRedis);
export const cached = cache.cached;
export const invalidateCache = cache.invalidateCache;
export const cacheSnapshot = cache.snapshot;
