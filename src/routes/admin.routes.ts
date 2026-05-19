import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireAdmin } from "../middleware/admin";
import { setUserEnabledStatus } from "../services/admin.service";

export const adminRouter = Router();

adminRouter.post("/users/:userId/disable", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const result = await setUserEnabledStatus(
      String(req.params.userId),
      false,
      req.authUser!.uid
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/users/:userId/enable", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const result = await setUserEnabledStatus(
      String(req.params.userId),
      true,
      req.authUser!.uid
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});
