import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { observe } from "../services/metrics.service";
export const requestContext: RequestHandler = (req, res, next) => {
  const id = randomUUID(),
    start = performance.now();
  res.setHeader("X-Request-ID", id);
  res.once("finish", () => {
    const ms = performance.now() - start;
    // Only route templates: never object keys, tokens, query strings or user IDs.
    const route = req.route?.path
      ? `${req.baseUrl}${req.route.path}`
      : "unmatched";
    observe(`${req.method} ${route}`, ms, res.statusCode >= 500);
    if (res.statusCode >= 400 || Math.random() < 0.01)
      console.info(JSON.stringify({ id, route, status: res.statusCode, ms }));
  });
  next();
};
