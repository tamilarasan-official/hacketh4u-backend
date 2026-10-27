import { z } from "zod";
import { isIP } from "node:net";

const bool = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");
export const performance = z
  .object({
    STORAGE_KEEP_ALIVE: bool,
    STORAGE_MAX_SOCKETS: z.coerce.number().int().min(1).max(256).default(32),
    STORAGE_DEADLINE_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .max(60000)
      .default(15000),
    PUBLIC_MEDIA_BASE_URL: z.string().url().optional(),
    IMAGE_CDN_REDIRECT_ENABLED: bool,
    PROTECTED_PLAYBACK: bool,
    PLAYBACK_SESSIONS_ENABLED: bool,
    PLAYBACK_TEST_USER_IDS: z.string().default(""),
    PLAYBACK_SECRET: z.string().min(32).optional(),
    PLAYBACK_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(14400)
      .default(7200),
    RATE_LIMIT_ENABLED: bool,
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(10).default(240),
    RATE_LIMIT_IP_PER_MINUTE: z.coerce.number().int().min(10).default(3000),
    RATE_LIMIT_MEDIA_PER_MINUTE: z.coerce.number().int().min(10).default(6000),
    TRUSTED_PROXY_CIDRS: z.string().default(""),
    CACHE_REDIS_URL: z.string().url().optional(),
    METRICS_TOKEN: z.string().min(32).optional(),
    FFMPEG_TIMEOUT_MS: z.coerce.number().int().min(1000).default(3600000),
    FFMPEG_THREADS: z.coerce.number().int().min(1).max(8).default(2),
    WORKER_HEARTBEAT_FILE: z
      .string()
      .default("/tmp/hacketh4u-worker-health.json"),
    HOST_PROC_PATH: z.string().default("/proc"),
    MONITOR_SUSTAINED_SAMPLES: z.coerce.number().int().min(1).default(3),
  })
  .parse(process.env);
export function playbackSessionsEnabled() {
  return performance.PROTECTED_PLAYBACK || performance.PLAYBACK_SESSIONS_ENABLED;
}
if (playbackSessionsEnabled() && !performance.PLAYBACK_SECRET) {
  throw new Error("Playback sessions require PLAYBACK_SECRET");
}
if (performance.PROTECTED_PLAYBACK && performance.PLAYBACK_TEST_USER_IDS.trim()) {
  throw new Error("Remove the playback tester allowlist before enforcing protected playback");
}
const proxies = performance.TRUSTED_PROXY_CIDRS.split(",").map(x => x.trim()).filter(Boolean);
const explicitProxy = (value: string) => {
  const [ip, mask, extra] = value.split("/");
  const version = isIP(ip);
  return !!version && !extra && (mask === undefined || (/^\d+$/.test(mask) && Number(mask) > 0 && Number(mask) <= (version === 4 ? 32 : 128)));
};
if (performance.RATE_LIMIT_ENABLED && (!proxies.length || !proxies.every(explicitProxy))) {
  throw new Error("Rate limiting requires explicit trusted proxy addresses or CIDRs, never all addresses");
}
if (performance.CACHE_REDIS_URL) {
  const cache = new URL(performance.CACHE_REDIS_URL);
  const queue = new URL(process.env.REDIS_URL || "redis://redis:6379");
  if (!["redis:", "rediss:"].includes(cache.protocol) ||
      (cache.hostname === queue.hostname && (cache.port || "6379") === (queue.port || "6379")))
    throw new Error("CACHE_REDIS_URL must use a separate Redis service from the job queue");
}
if (performance.IMAGE_CDN_REDIRECT_ENABLED && !performance.PUBLIC_MEDIA_BASE_URL) {
  throw new Error("Image CDN redirects require PUBLIC_MEDIA_BASE_URL");
}
if (performance.PUBLIC_MEDIA_BASE_URL) {
  const url = new URL(performance.PUBLIC_MEDIA_BASE_URL);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new Error("PUBLIC_MEDIA_BASE_URL must be a credential-free HTTPS base URL");
}
