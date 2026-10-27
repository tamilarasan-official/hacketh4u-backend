import { readFile } from "node:fs/promises";
export type HostSample = { cpu: number[]; total: number; available: number };
export async function readHostSample(proc: string): Promise<HostSample> {
  const [stat, mem] = await Promise.all([
    readFile(proc + "/stat", "utf8"),
    readFile(proc + "/meminfo", "utf8"),
  ]);
  const cpu = stat.split("\n")[0].trim().split(/\s+/).slice(1, 9).map(Number);
  const values = Object.fromEntries(
    mem
      .trim()
      .split("\n")
      .map((l) => {
        const [k, v] = l.split(":");
        return [k, Number(v.trim().split(/\s+/)[0]) * 1024];
      }),
  );
  if (
    !values.MemTotal ||
    !Number.isFinite(values.MemAvailable) ||
    cpu.length !== 8
  )
    throw new Error("Host metrics unavailable");
  return { cpu, total: values.MemTotal, available: values.MemAvailable };
}
export function resourceUsage(previous: HostSample, current: HostSample) {
  const delta = current.cpu.map((n, i) => n - previous.cpu[i]),
    total = delta.reduce((a, b) => a + b, 0);
  return {
    cpu:
      total > 0
        ? Math.max(0, Math.min(100, 100 * (1 - (delta[3] + delta[4]) / total)))
        : 0,
    memory: 100 * (1 - current.available / current.total),
  };
}
export class SustainedAlerts {
  private counts = new Map<string, number>();
  private active = new Set<string>();
  constructor(private samples: number) {}
  update(key: string, breached: boolean): "alert" | "recovery" | null {
    if (!breached) {
      this.counts.set(key, 0);
      if (this.active.delete(key)) return "recovery";
      return null;
    }
    const n = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, n);
    if (n >= this.samples && !this.active.has(key)) {
      this.active.add(key);
      return "alert";
    }
    return null;
  }
  retry(key: string) {
    this.active.delete(key);
  }
}
