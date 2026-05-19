import { S3Client } from "@aws-sdk/client-s3";
import { env } from "./env";

export const garageS3 = new S3Client({
  endpoint: env.GARAGE_S3_ENDPOINT,
  region: env.GARAGE_S3_REGION,
  forcePathStyle: env.GARAGE_S3_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: env.GARAGE_S3_ACCESS_KEY_ID,
    secretAccessKey: env.GARAGE_S3_SECRET_ACCESS_KEY
  }
});
