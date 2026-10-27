import { describe, it, expect } from "vitest";
import IORedis from "ioredis";
import { randomUUID } from "node:crypto";
import { createProfileCache } from "../../src/services/profile-cache";
import { consumeAdmission } from "../../src/services/admission.service";

describe.skipIf(process.env.RUN_REDIS_TESTS !== "true")("rollout with isolated real Redis", () => {
  it("shares hits and invalidation across replicas, and prevents a slow stale publish", async () => {
    const a = new IORedis("redis://:local-cache-only@127.0.0.1:16380");
    const b = new IORedis("redis://:local-cache-only@127.0.0.1:16380");
    const key = `profile:test-${randomUUID()}`;
    const ca = createProfileCache(a), cb = createProfileCache(b);
    try {
      await Promise.all([a.ping(), b.ping()]);
      expect(await ca.cached(key, 15, async () => ({ name: "old" }))).toEqual({ name: "old" });
      expect(await cb.cached(key, 15, async () => { throw Error("must hit"); })).toEqual({ name: "old" });
      expect(cb.snapshot().hits).toBe(1);
      await cb.invalidateCache(key);
      let release!: (v: { name: string }) => void;
      let began!: () => void;
      const started = new Promise<void>(r => { began = r; });
      const slow = ca.cached(key, 15, () => { began(); return new Promise<{ name: string }>(r => { release = r; }); });
      await started;
      await cb.invalidateCache(key);
      await cb.cached(key, 15, async () => ({ name: "new" }));
      release({ name: "stale" });
      await slow;
      expect(await ca.cached(key, 15, async () => { throw Error("must hit new"); })).toEqual({ name: "new" });
      expect(ca.snapshot().stalePublishesPrevented).toBe(1);
      expect(await a.ttl(key)).toBeGreaterThan(0);
      a.disconnect();
      expect(await ca.cached(key, 15, async () => ({ name: "database" }))).toEqual({ name: "database" });
    } finally { a.disconnect(); b.disconnect(); }
  });
  it("enforces one atomic budget across replicas and separates identities and lanes", async () => {
    const a = new IORedis("redis://:local-test-only@127.0.0.1:16379");
    const b = new IORedis("redis://:local-test-only@127.0.0.1:16379");
    try {
      await Promise.all([a.ping(), b.ping()]);
      const id = randomUUID();
      const now = 1800000010000;
      const results = await Promise.all(Array.from({ length: 20 }, (_, n) => consumeAdmission(n % 2 ? a : b, "test-api", id, 10, now)));
      expect(results.filter(x => x.allowed)).toHaveLength(10);
      expect(results[0].retryAfter).toBe(50);
      expect((await consumeAdmission(a, "test-api", id + "other", 10, now)).allowed).toBe(true);
      expect((await consumeAdmission(a, "test-media", id, 10, now)).allowed).toBe(true);
      expect((await consumeAdmission(a, "test-api", id, 10, now + 60000)).allowed).toBe(true);
      a.disconnect();
      await expect(consumeAdmission(a, "test-api", id, 10)).rejects.toMatchObject({ statusCode: 503 });
      expect((await b.config("GET", "maxmemory-policy"))).toEqual(["maxmemory-policy", "noeviction"]);
    } finally { a.disconnect(); b.disconnect(); }
  });
});
