import os from "node:os";
import nodemailer from "nodemailer";
import { env } from "../config/env";
import {
  readHostSample,
  resourceUsage,
  SustainedAlerts,
  type HostSample,
} from "../services/host-metrics";
import { performance } from "../config/performance";
import { workerHeartbeat } from "./worker-health";

type MetricSnapshot = { cpu: number; memory: number; timestamp: string };

const cooldowns = new Map<string, number>();
const pendingAlerts = new Map<string, { subject: string; text: string }>();
const cooldownMs = 15 * 60 * 1000;

const mailer =
  env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD
    ? nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_PORT === 465,
        auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
      })
    : null;

let previous: HostSample | undefined;
let lastSuccess = Date.now();
const alerts = new SustainedAlerts(performance.MONITOR_SUSTAINED_SAMPLES);
let checking = false;
const stopHeartbeat = workerHeartbeat(
  () => Date.now() - lastSuccess < env.MONITOR_INTERVAL_MS * 3,
);

async function notify(subject: string, text: string): Promise<void> {
  if (!env.ALERT_EMAIL_TO || !mailer || !env.SMTP_FROM) {
    console.warn(
      "Monitoring alert not emailed: SMTP alert configuration is incomplete",
      { subject },
    );
    throw new Error("SMTP alert configuration incomplete");
  }

  await mailer.sendMail({
    from: env.SMTP_FROM,
    to: env.ALERT_EMAIL_TO,
    subject,
    text,
  });
}

async function alertOnce(
  key: string,
  subject: string,
  text: string,
): Promise<void> {
  pendingAlerts.set(key, { subject, text });
  const now = Date.now();
  if ((cooldowns.get(key) ?? 0) > now) return;
  try {
    await notify(subject, text);
    pendingAlerts.delete(key);
    cooldowns.set(key, now + cooldownMs);
  } catch (error) {
    console.error("Monitoring email failed", {
      subject,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function check(): Promise<void> {
  if (checking) return;
  checking = true;
  try {
    const current = await readHostSample(performance.HOST_PROC_PATH);
    if (!previous) {
      previous = current;
      return;
    }
    const metrics = {
      ...resourceUsage(previous, current),
      timestamp: new Date().toISOString(),
    };
    previous = current;
    console.info("Server metrics", metrics);
    for (const key of ["cpu", "memory"] as const) {
      const event = alerts.update(
        key,
        metrics[key] >= env.MONITOR_THRESHOLD_PERCENT,
      );
      if (event === "recovery") cooldowns.delete(key);
      if (event)
        await alertOnce(
          key,
          `Hacketh4u ${key} ${event}`,
          `${key}: ${metrics[key].toFixed(1)}% at ${metrics.timestamp}`,
        );
    }

    try {
      const response = await fetch(env.MONITOR_TARGET_URL, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      if (alerts.update("health", false) === "recovery") {
        cooldowns.delete("health");
        await alertOnce(
          "health",
          "Hacketh4u API recovered",
          "Readiness restored.",
        );
      }
    } catch (error) {
      if (alerts.update("health", true) === "alert")
        await alertOnce(
          "health",
          "Hacketh4u API health alert",
          `Health endpoint failed: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
    lastSuccess = Date.now();
    for (const [key, message] of pendingAlerts)
      await alertOnce(key, message.subject, message.text);
  } catch (error) {
    console.error(
      "Monitoring failed",
      error instanceof Error ? error.message : "unknown",
    );
  } finally {
    checking = false;
  }
}

const timer = setInterval(() => void check(), env.MONITOR_INTERVAL_MS);
void check();
console.info("Server manager started", {
  intervalMs: env.MONITOR_INTERVAL_MS,
  thresholdPercent: env.MONITOR_THRESHOLD_PERCENT,
});

async function shutdown(signal: string): Promise<void> {
  console.info(`Server manager received ${signal}`);
  clearInterval(timer);
  stopHeartbeat();
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
