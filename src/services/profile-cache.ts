import { randomUUID } from "node:crypto";
interface CacheConnection {
  status: string;
  eval(script: string, numberOfKeys: number, ...args: (string | number)[]): Promise<unknown>;
}
const read = `local v=redis.call('GET',KEYS[2]); if not v then
  v=ARGV[1]; redis.call('SET',KEYS[2],v,'EX',120) end;
  return {redis.call('GET',KEYS[1]),v}`;
const publish = `if (redis.call('GET',KEYS[2]) or '') == ARGV[1] then
  redis.call('SET',KEYS[1],ARGV[2],'EX',ARGV[3]); return 1 end; return 0`;
const invalidate = `redis.call('SET',KEYS[2],ARGV[1],'EX',120);
  return redis.call('DEL',KEYS[1])`;

// Generation checks prevent an older read from undoing another replica's invalidation.
export function createProfileCache(client: CacheConnection | null) {
  const pending = new Map<string, Promise<unknown>>();
  const counts = { hits: 0, misses: 0, coalesced: 0, errors: 0, invalidations: 0, stalePublishesPrevented: 0 };
  async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
    const started = Date.now();
    let version = "", canPublish = false;
    if (client?.status === "ready") {
      try {
        const [value, generation] = await client.eval(read, 2, key, `${key}:generation`, randomUUID()) as [string | null, string];
        version = generation ?? "";
        if (value) { counts.hits++; return JSON.parse(value) as T; }
        canPublish = true;
      } catch { counts.errors++; }
    }
    counts.misses++;
    const pendingKey = `${key}\0${version}`;
    const existing = pending.get(pendingKey);
    if (existing) { counts.coalesced++; return existing as Promise<T>; }
    const promise = (async () => {
      const result = await load();
      // No publication after the generation retention window could have elapsed.
      if (canPublish && client?.status === "ready" && Date.now() - started < 10000) {
        try {
          const stored = await client.eval(publish, 2, key, `${key}:generation`, version,
            JSON.stringify(result), Math.max(1, Math.min(60, ttl)));
          if (!Number(stored)) counts.stalePublishesPrevented++;
        } catch { counts.errors++; }
      }
      return result;
    })();
    if (pending.size < 1000) pending.set(pendingKey, promise);
    try { return await promise; }
    finally { if (pending.get(pendingKey) === promise) pending.delete(pendingKey); }
  }
  async function invalidateCache(key: string) {
    for (const k of pending.keys()) if (k.startsWith(`${key}\0`)) pending.delete(k);
    counts.invalidations++;
    if (client?.status !== "ready") return;
    try { await client.eval(invalidate, 2, key, `${key}:generation`, randomUUID()); }
    catch { counts.errors++; }
  }
  return { cached, invalidateCache, snapshot: () => ({ configured: !!client, ready: client?.status === "ready", ...counts }) };
}
