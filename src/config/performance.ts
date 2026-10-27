import { z } from "zod";

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
    PROTECTED_PLAYBACK: bool,
    PLAYBACK_SECRET: z.string().min(32).optional(),
    PLAYBACK_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(14400)
      .default(7200),
    RATE_LIMIT_ENABLED: bool,
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(10).default(240),
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
if (performance.PROTECTED_PLAYBACK && !performance.PLAYBACK_SECRET) {
  throw new Error("PROTECTED_PLAYBACK requires PLAYBACK_SECRET");
}
