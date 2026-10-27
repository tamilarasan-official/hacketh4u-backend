import type { NextFunction, Request, Response } from "express";
import { firebaseAuth } from "../config/firebase";
import { HttpError } from "../utils/http-error";
import { limitAuthenticatedUser } from "./rate-limit";

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      throw new HttpError(401, "Missing or invalid Authorization header.");
    }

    const token = authHeader.slice("Bearer ".length).trim();
    const decoded = await firebaseAuth.verifyIdToken(token);
    req.authUser = decoded;
    await limitAuthenticatedUser(decoded.uid, res);
    next();
  } catch (error) {
    next(error);
  }
}
