import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

function firstDefined(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === "string" && value.trim().length > 0);
}

const resolvedEnv: NodeJS.ProcessEnv = {
  ...process.env,
  GARAGE_S3_ACCESS_KEY_ID: firstDefined(
    process.env.GARAGE_S3_ACCESS_KEY_ID,
    process.env.GARAGE_ACCESS_KEY_ID,
    process.env.S3_ACCESS_KEY_ID,
    process.env.AWS_ACCESS_KEY_ID
  ),
  GARAGE_S3_SECRET_ACCESS_KEY: firstDefined(
    process.env.GARAGE_S3_SECRET_ACCESS_KEY,
    process.env.GARAGE_SECRET_ACCESS_KEY,
    process.env.S3_SECRET_ACCESS_KEY,
    process.env.AWS_SECRET_ACCESS_KEY
  )
};

console.info("Backend env presence", {
  PORT: Boolean(resolvedEnv.PORT),
  NODE_ENV: Boolean(resolvedEnv.NODE_ENV),
  FIREBASE_PROJECT_ID: Boolean(resolvedEnv.FIREBASE_PROJECT_ID),
  FIREBASE_CLIENT_EMAIL: Boolean(resolvedEnv.FIREBASE_CLIENT_EMAIL),
  FIREBASE_PRIVATE_KEY: Boolean(resolvedEnv.FIREBASE_PRIVATE_KEY),
  RAZORPAY_KEY_ID: Boolean(resolvedEnv.RAZORPAY_KEY_ID),
  RAZORPAY_KEY_SECRET: Boolean(resolvedEnv.RAZORPAY_KEY_SECRET),
  GARAGE_S3_ENDPOINT: Boolean(resolvedEnv.GARAGE_S3_ENDPOINT),
  GARAGE_S3_BUCKET: Boolean(resolvedEnv.GARAGE_S3_BUCKET),
  GARAGE_S3_ACCESS_KEY_ID: Boolean(resolvedEnv.GARAGE_S3_ACCESS_KEY_ID),
  GARAGE_S3_SECRET_ACCESS_KEY: Boolean(resolvedEnv.GARAGE_S3_SECRET_ACCESS_KEY),
  fallbackGarageAccessKeyId: firstDefined(
    process.env.GARAGE_ACCESS_KEY_ID,
    process.env.S3_ACCESS_KEY_ID,
    process.env.AWS_ACCESS_KEY_ID
  )
    ? true
    : false,
  fallbackGarageSecretAccessKey: firstDefined(
    process.env.GARAGE_SECRET_ACCESS_KEY,
    process.env.S3_SECRET_ACCESS_KEY,
    process.env.AWS_SECRET_ACCESS_KEY
  )
    ? true
    : false
});

const envSchema = z.object({
  PORT: z.coerce.number().default(8080),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_BASE_URL: z.string().url().optional(),
  ALLOWED_ORIGINS: z.string().default(""),
  FIREBASE_PROJECT_ID: z.string().min(1),
  FIREBASE_CLIENT_EMAIL: z.string().min(1),
  FIREBASE_PRIVATE_KEY: z.string().min(1),
  RAZORPAY_KEY_ID: z.string().min(1),
  RAZORPAY_KEY_SECRET: z.string().min(1),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1).optional(),
  GARAGE_S3_ENDPOINT: z.string().url(),
  GARAGE_S3_REGION: z.string().default("garage"),
  GARAGE_S3_BUCKET: z.string().min(1),
  GARAGE_S3_ACCESS_KEY_ID: z.string().min(1),
  GARAGE_S3_SECRET_ACCESS_KEY: z.string().min(1),
  GARAGE_S3_PUBLIC_BASE_URL: z.string().url(),
  // Virtual-hosted addressing is the default. Self-hosted stores such as
  // Garage need this set to "true" explicitly.
  GARAGE_S3_FORCE_PATH_STYLE: z.string().default("false")
});

const parsed = envSchema.safeParse(resolvedEnv);

if (!parsed.success) {
  console.error("Invalid backend environment variables", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  FIREBASE_PRIVATE_KEY: parsed.data.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  ALLOWED_ORIGINS: parsed.data.ALLOWED_ORIGINS
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  GARAGE_S3_FORCE_PATH_STYLE:
    parsed.data.GARAGE_S3_FORCE_PATH_STYLE.toLowerCase() === "true"
};
