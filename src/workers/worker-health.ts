import { writeFile } from "node:fs/promises";
import { performance } from "../config/performance";
export function workerHeartbeat(ready: () => boolean) {
  const tick = () =>
    void writeFile(
      performance.WORKER_HEARTBEAT_FILE,
      JSON.stringify({ at: Date.now(), ready: ready() }),
    ).catch(() => {});
  tick();
  const timer = setInterval(tick, 10000);
  timer.unref();
  return () => clearInterval(timer);
}
