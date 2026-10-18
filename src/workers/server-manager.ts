import os from "node:os";
import nodemailer from "nodemailer";
import { env } from "../config/env";

type MetricSnapshot = { cpu: number; memory: number; timestamp: string };

const cooldowns = new Map<string, number>();
const cooldownMs = 15 * 60 * 1000;

const mailer = env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }
    })
  : null;

function snapshot(): MetricSnapshot {
  const load = os.loadavg()[0] ?? 0;
  const cpu = Math.min(100, (load / Math.max(os.cpus().length, 1)) * 100);
  const memory = ((os.totalmem() - os.freemem()) / os.totalmem()) * 100;
  return { cpu, memory, timestamp: new Date().toISOString() };
}

async function notify(subject: string, text: string): Promise<void> {
  if (!env.ALERT_EMAIL_TO || !mailer || !env.SMTP_FROM) {
    console.warn("Monitoring alert not emailed: SMTP alert configuration is incomplete", { subject });
    return;
  }

  await mailer.sendMail({ from: env.SMTP_FROM, to: env.ALERT_EMAIL_TO, subject, text });
}

async function alertOnce(key: string, subject: string, text: string): Promise<void> {
  const now = Date.now();
  if ((cooldowns.get(key) ?? 0) > now) return;
  cooldowns.set(key, now + cooldownMs);
  try {
    await notify(subject, text);
  } catch (error) {
    console.error("Monitoring email failed", { subject, message: error instanceof Error ? error.message : String(error) });
  }
}

async function check(): Promise<void> {
  const metrics = snapshot();
  console.info("Server metrics", metrics);

  if (metrics.cpu >= env.MONITOR_THRESHOLD_PERCENT) {
    await alertOnce("cpu", "Hacketh4u server CPU alert", `CPU usage is ${metrics.cpu.toFixed(1)}% at ${metrics.timestamp}.`);
  }
  if (metrics.memory >= env.MONITOR_THRESHOLD_PERCENT) {
    await alertOnce("memory", "Hacketh4u server memory alert", `Memory usage is ${metrics.memory.toFixed(1)}% at ${metrics.timestamp}.`);
  }

  try {
    const response = await fetch(env.MONITOR_TARGET_URL, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) {
      await alertOnce("health", "Hacketh4u API health alert", `Health endpoint returned HTTP ${response.status}.`);
    }
  } catch (error) {
    await alertOnce("health", "Hacketh4u API health alert", `Health endpoint failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const timer = setInterval(() => void check(), env.MONITOR_INTERVAL_MS);
void check();
console.info("Server manager started", { intervalMs: env.MONITOR_INTERVAL_MS, thresholdPercent: env.MONITOR_THRESHOLD_PERCENT });

async function shutdown(signal: string): Promise<void> {
  console.info(`Server manager received ${signal}`);
  clearInterval(timer);
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
