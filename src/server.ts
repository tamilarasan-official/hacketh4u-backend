import http from "node:http";
import { env } from "./config/env";
import { createApp } from "./app";
import { closeQueues } from "./config/queues";
import { cacheRedis } from "./services/cache.service";

const app = createApp();
const server = http.createServer(app);

// Keep large mobile uploads alive on slower networks.
server.requestTimeout = 1000 * 60 * 60;
server.headersTimeout = 30_000;
server.keepAliveTimeout = 1000 * 75;

server.listen(env.PORT, () => {
  console.log(`Hacketh4u backend listening on port ${env.PORT}`);
});
let closing = false;
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    if (closing) return;
    closing = true;
    const deadline = setTimeout(() => {
      server.closeAllConnections();
      process.exit(1);
    }, 25000);
    deadline.unref();
    server.close(() => {
      void Promise.allSettled([closeQueues(), cacheRedis?.quit()]).finally(
        () => {
          clearTimeout(deadline);
          process.exit(0);
        },
      );
    });
    server.closeIdleConnections();
  });
