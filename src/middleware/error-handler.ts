import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../utils/http-error";

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new HttpError(404, `Route not found: ${req.method} ${req.originalUrl}`));
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (error instanceof HttpError) {
    res.status(error.statusCode).json({
      error: error.message,
      details: error.details ?? null
    });
    return;
  }

  const message = error instanceof Error ? error.message : "Internal server error";
  console.error("Unhandled backend error", error);
  res.status(500).json({
    error: message
  });
}
