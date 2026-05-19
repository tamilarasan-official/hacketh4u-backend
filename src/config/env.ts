import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

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
  GARAGE_S3_REGION: z.string().default("us-east-1"),
  GARAGE_S3_BUCKET: z.string().min(1),
  GARAGE_S3_ACCESS_KEY_ID: z.string().min(1),
  GARAGE_S3_SECRET_ACCESS_KEY: z.string().min(1),
  GARAGE_S3_PUBLIC_BASE_URL: z.string().url(),
  GARAGE_S3_FORCE_PATH_STYLE: z.string().default("true")
});

const parsed = envSchema.safeParse(process.env);

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
