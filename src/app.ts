import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";
import { adminRouter } from "./routes/admin.routes";
import { authRouter } from "./routes/auth.routes";
import { entitlementRouter } from "./routes/entitlement.routes";
import { healthRouter } from "./routes/health.routes";
import { mediaRouter } from "./routes/media.routes";
import { paymentRouter } from "./routes/payment.routes";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || env.ALLOWED_ORIGINS.length === 0 || env.ALLOWED_ORIGINS.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error(`Origin not allowed: ${origin}`));
      }
    })
  );
  app.use(morgan("dev"));
  app.use(
    express.json({
      limit: "10mb",
      verify: (req, _res, buf) => {
        (req as Express.Request).rawBody = buf.toString("utf8");
      }
    })
  );

  app.get("/", (_req, res) => {
    res.json({
      service: "hacketh4u-backend",
      env: env.NODE_ENV,
      docs: "/health"
    });
  });

  app.use("/health", healthRouter);
  app.use("/auth", authRouter);
  app.use("/admin", adminRouter);
  app.use("/payments", paymentRouter);
  app.use("/entitlements", entitlementRouter);
  app.use("/media", mediaRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
