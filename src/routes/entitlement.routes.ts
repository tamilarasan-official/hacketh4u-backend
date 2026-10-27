import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import {
  getCourseEntitlement,
  listUserEntitlements,
} from "../services/entitlement.service";

export const entitlementRouter = Router();

entitlementRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    res.json(
      await listUserEntitlements(
        req.authUser!.uid,
        req.query.limit,
        req.query.cursor,
      ),
    );
  } catch (error) {
    next(error);
  }
});

entitlementRouter.get(
  "/courses/:courseId",
  requireAuth,
  async (req, res, next) => {
    try {
      const courseId = String(req.params.courseId);
      const entitlement = await getCourseEntitlement(
        req.authUser!.uid,
        courseId,
      );
      res.json(entitlement);
    } catch (error) {
      next(error);
    }
  },
);
