type Metric = { count: number; errors: number; totalMs: number; maxMs: number };
const metrics = new Map<string, Metric>();
export function observe(name: string, ms: number, failed = false): void {
  const key = metrics.has(name) || metrics.size < 100 ? name : "other";
  const m = metrics.get(key) ?? { count: 0, errors: 0, totalMs: 0, maxMs: 0 };
  m.count++;
  m.errors += Number(failed);
  m.totalMs += ms;
  m.maxMs = Math.max(m.maxMs, ms);
  metrics.set(key, m);
}
export function metricSnapshot() {
  return {
    uptimeSeconds: process.uptime(),
    memory: process.memoryUsage(),
    metrics: Object.fromEntries(metrics),
  };
}
