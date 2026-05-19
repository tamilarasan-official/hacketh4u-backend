import type { NextFunction, Request, Response } from "express";
import { firebaseAuth } from "../config/firebase";
import { HttpError } from "../utils/http-error";

export async function requireAuth(
  req: Request,
  _res: Response,
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
    next();
  } catch (error) {
    next(error);
  }
}
