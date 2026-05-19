import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { getUserProfile } from "../services/user.service";

export const authRouter = Router();

authRouter.get("/verify", requireAuth, async (req, res, next) => {
  try {
    const firebaseUser = req.authUser!;
    const profile = await getUserProfile(firebaseUser.uid);
    res.json({
      ok: true,
      user: {
        uid: firebaseUser.uid,
        email: firebaseUser.email ?? null,
        phoneNumber: firebaseUser.phone_number ?? null
      },
      profile
    });
  } catch (error) {
    next(error);
  }
});
