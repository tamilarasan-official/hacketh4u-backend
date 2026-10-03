import { S3Client } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import https from "node:https";
import { env } from "./env";

// The configured region is used verbatim. An earlier version rewrote it to
// "garage" for any non-AWS endpoint, which silently broke SigV4 signing against
// other S3-compatible providers (DigitalOcean Spaces signs with sgp1).
export const garageSigningRegion = env.GARAGE_S3_REGION;

export const garageS3 = new S3Client({
  endpoint: env.GARAGE_S3_ENDPOINT,
  region: garageSigningRegion,
  forcePathStyle: env.GARAGE_S3_FORCE_PATH_STYLE,
  maxAttempts: 1,
  requestHandler: new NodeHttpHandler({
    connectionTimeout: 5_000,
    requestTimeout: 25_000,
    socketTimeout: 25_000,
    // Spaces connections can become stale in a long-lived API process. A
    // fresh socket per request is more reliable than reusing a dead socket.
    httpsAgent: new https.Agent({
      keepAlive: false,
      maxSockets: 32
    })
  }),
  // DigitalOcean Spaces rejects the CRC32 integrity headers newer AWS SDK
  // versions send by default. Do not remove.
  requestChecksumCalculation: "WHEN_REQUIRED",
  credentials: {
    accessKeyId: env.GARAGE_S3_ACCESS_KEY_ID,
    secretAccessKey: env.GARAGE_S3_SECRET_ACCESS_KEY
  }
});
