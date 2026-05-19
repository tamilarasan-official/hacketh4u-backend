import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import {
  createPaymentOrder,
  getPaymentByInternalId,
  handleRazorpayWebhook,
  listUserPayments,
  verifyPaymentFromClient
} from "../services/payment.service";

const createOrderSchema = z.object({
  paymentId: z.string().min(1).optional(),
  amount: z.number().int().positive(),
  currency: z.string().default("INR"),
  userEmail: z.string().email(),
  userName: z.string().min(1),
  userPhone: z.string().min(1),
  totalAmount: z.number().nonnegative().optional(),
  discountAmount: z.number().nonnegative().optional(),
  gstAmount: z.number().nonnegative().optional(),
  couponCode: z.string().nullable().optional(),
  couponId: z.string().nullable().optional(),
  courses: z
    .array(
      z.object({
        courseId: z.string().min(1),
        courseTitle: z.string().min(1),
        instructorName: z.string().min(1),
        thumbnailUrl: z.string().optional(),
        price: z.number().nonnegative(),
        originalPrice: z.number().nonnegative().optional(),
        subscriptionPeriod: z.number().int().nonnegative().optional()
      })
    )
    .min(1)
});

const verifyClientPaymentSchema = z.object({
  paymentId: z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  razorpayOrderId: z.string().min(1),
  razorpaySignature: z.string().min(1)
});

export const paymentRouter = Router();

paymentRouter.post("/create-order", requireAuth, async (req, res, next) => {
  try {
    const payload = createOrderSchema.parse(req.body);
    const result = await createPaymentOrder({
      ...payload,
      userId: req.authUser!.uid
    });
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

paymentRouter.get("/history", requireAuth, async (req, res, next) => {
  try {
    const payments = await listUserPayments(req.authUser!.uid);
    res.json({
      payments
    });
  } catch (error) {
    next(error);
  }
});

paymentRouter.post("/verify-client-result", requireAuth, async (req, res, next) => {
  try {
    const payload = verifyClientPaymentSchema.parse(req.body);
    const result = await verifyPaymentFromClient({
      userId: req.authUser!.uid,
      ...payload
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

paymentRouter.get("/:paymentId", requireAuth, async (req, res, next) => {
  try {
    const payment = await getPaymentByInternalId(String(req.params.paymentId));
    res.json(payment);
  } catch (error) {
    next(error);
  }
});

paymentRouter.post("/webhooks/razorpay", async (req, res, next) => {
  try {
    const signature = req.header("x-razorpay-signature");
    const result = await handleRazorpayWebhook(
      req.rawBody ?? JSON.stringify(req.body),
      signature,
      req.body as Record<string, unknown>
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});
