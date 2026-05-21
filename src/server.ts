import http from "node:http";
import { env } from "./config/env";
import { createApp } from "./app";

const app = createApp();
const server = http.createServer(app);

// Keep large mobile uploads alive on slower networks.
server.requestTimeout = 1000 * 60 * 60;
server.headersTimeout = 1000 * 60 * 65;
server.keepAliveTimeout = 1000 * 75;

server.listen(env.PORT, () => {
  console.log(`Hacketh4u backend listening on port ${env.PORT}`);
});
