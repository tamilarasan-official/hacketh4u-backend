import { vi } from "vitest";
vi.mock("../src/config/env", () => ({
  env: {
    PORT: 3000,
    NODE_ENV: "test",
    APP_BASE_URL: "https://api.test",
    ALLOWED_ORIGINS: [],
    REDIS_URL: "redis://:local-test-only@127.0.0.1:16379",
    GARAGE_S3_BUCKET: "test-bucket",
    GARAGE_S3_ENDPOINT: "http://127.0.0.1:19000",
    GARAGE_S3_REGION: "us-east-1",
    GARAGE_S3_FORCE_PATH_STYLE: true,
    GARAGE_S3_PUBLIC_BASE_URL: "https://bucket.test",
    GARAGE_S3_ACCESS_KEY_ID: "test",
    GARAGE_S3_SECRET_ACCESS_KEY: "test",
    RAZORPAY_KEY_ID: "test",
    RAZORPAY_KEY_SECRET: "test-secret",
    RAZORPAY_WEBHOOK_SECRET: "test-webhook",
  },
}));
vi.mock("../src/config/firebase", () => ({
  firestore: {},
  firebaseAuth: { verifyIdToken: vi.fn() },
}));
vi.mock("../src/config/queues", () => ({
  redisConnection: { status: "ready", ping: vi.fn().mockResolvedValue("PONG") },
  videoQueue: { add: vi.fn() },
  backgroundQueue: {},
  bucketQueue: {},
}));
