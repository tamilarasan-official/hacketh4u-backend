import type { NextFunction, Request, Response } from "express";
import { firestore } from "../config/firebase";
import { HttpError } from "../utils/http-error";

export async function requireAdmin(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authUser = req.authUser;
    if (!authUser) {
      throw new HttpError(401, "Authentication required.");
    }

    const doc = await firestore.collection("users").doc(authUser.uid).get();
    if (!doc.exists) {
      throw new HttpError(404, "Admin profile not found.");
    }

    const role = doc.data()?.role;
    if (role != "admin") {
      throw new HttpError(403, "Admin access required.");
    }

    next();
  } catch (error) {
    next(error);
  }
}
