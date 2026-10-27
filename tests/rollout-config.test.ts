import { vi, it, expect, afterEach } from "vitest";
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
async function config(values: Record<string, string>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
  return import("../src/config/performance");
}
it("requires a signing secret for a sessions-only pilot", async () => {
  await expect(config({ PLAYBACK_SESSIONS_ENABLED: "true", PROTECTED_PLAYBACK: "false" })).rejects.toThrow("PLAYBACK_SECRET");
});
it("rejects queue/cache service reuse even with different credentials or database numbers", async () => {
  await expect(config({ REDIS_URL: "redis://:queue@redis:6379/0", CACHE_REDIS_URL: "redis://:cache@redis:6379/1" })).rejects.toThrow("separate Redis");
  expect((await config({ REDIS_URL: "redis://redis:6379", CACHE_REDIS_URL: "redis://:cache@profile-cache:6379" })).performance.CACHE_REDIS_URL).toContain("profile-cache");
});
it("allows a sessions-only pilot and refuses enforcing an allowlisted pilot on all users", async () => {
  const values = { PLAYBACK_SESSIONS_ENABLED: "true", PLAYBACK_SECRET: "s".repeat(40), PLAYBACK_TEST_USER_IDS: "u", PROTECTED_PLAYBACK: "false" };
  expect((await config(values)).playbackSessionsEnabled()).toBe(true);
  await expect(config({ ...values, PROTECTED_PLAYBACK: "true" })).rejects.toThrow("allowlist");
});
it.each(["", "0.0.0.0/0", "::/0", "true", "10.0.0.0/24, 0.0.0.0/0"])("refuses unsafe rate-limit proxy configuration %s", async proxy => {
  await expect(config({ RATE_LIMIT_ENABLED: "true", TRUSTED_PROXY_CIDRS: proxy })).rejects.toThrow("trusted proxy");
});
it("allows explicit proxy addresses", async () => {
  expect((await config({ RATE_LIMIT_ENABLED: "true", TRUSTED_PROXY_CIDRS: "172.19.0.5/32,10.0.1.7/32" })).performance.RATE_LIMIT_ENABLED).toBe(true);
});
it.each(["http://images.test", "https://user:password@images.test", "https://images.test?token=a"])("refuses unsafe CDN base %s", async url => {
  await expect(config({ PUBLIC_MEDIA_BASE_URL: url })).rejects.toThrow("HTTPS base URL");
});
it("refuses redirects without a destination", async () => {
  await expect(config({ IMAGE_CDN_REDIRECT_ENABLED: "true" })).rejects.toThrow("PUBLIC_MEDIA_BASE_URL");
});
