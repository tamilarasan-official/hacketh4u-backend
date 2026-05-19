import { S3Client } from "@aws-sdk/client-s3";
import { env } from "./env";

function resolveGarageRegion(): string {
  const endpoint = env.GARAGE_S3_ENDPOINT.toLowerCase();
  const isCustomS3Endpoint = !endpoint.includes("amazonaws.com");

  if (isCustomS3Endpoint && env.GARAGE_S3_REGION === "us-east-1") {
    return "garage";
  }

  return env.GARAGE_S3_REGION;
}

export const garageSigningRegion = resolveGarageRegion();

export const garageS3 = new S3Client({
  endpoint: env.GARAGE_S3_ENDPOINT,
  region: garageSigningRegion,
  forcePathStyle: env.GARAGE_S3_FORCE_PATH_STYLE,
  requestChecksumCalculation: "WHEN_REQUIRED",
  credentials: {
    accessKeyId: env.GARAGE_S3_ACCESS_KEY_ID,
    secretAccessKey: env.GARAGE_S3_SECRET_ACCESS_KEY
  }
});
