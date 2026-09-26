import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { ensureUserProfile, getUserProfile } from "../services/user.service";

export const authRouter = Router();

const profileSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phoneNumber: z.string().max(32).optional(),
  fcmToken: z.string().max(4096).optional()
});

authRouter.post("/profile", requireAuth, async (req, res, next) => {
  try {
    const input = profileSchema.parse(req.body);
    const user = req.authUser!;
    const result = await ensureUserProfile({
      userId: user.uid,
      email: user.email ?? null,
      phoneNumber: input.phoneNumber || user.phone_number || null,
      name: input.name,
      fcmToken: input.fcmToken
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

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
