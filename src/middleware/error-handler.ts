import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../utils/http-error";
import { ZodError } from "zod";

export function notFoundHandler(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  next(new HttpError(404, `Route not found: ${req.method} ${req.originalUrl}`));
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (res.headersSent) {
    res.destroy(error instanceof Error ? error : undefined);
    return;
  }
  if (error instanceof ZodError) {
    res
      .status(400)
      .json({ error: "Invalid request.", fields: error.flatten().fieldErrors });
    return;
  }
  const code = (error as { code?: string })?.code;
  if (code?.startsWith("auth/")) {
    res.status(401).json({ error: "Invalid or expired authentication." });
    return;
  }
  if (error instanceof HttpError) {
    res.status(error.statusCode).json({
      error: error.message,
      details: error.details ?? null,
    });
    return;
  }

  const message = "Internal server error";
  console.error("Unhandled backend error", error);
  res.status(500).json({
    error: message,
  });
}
