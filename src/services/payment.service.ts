import crypto from "node:crypto";
import { FieldValue, FieldPath } from "firebase-admin/firestore";
import { firestore } from "../config/firebase";
import { razorpay } from "../config/razorpay";
import { env } from "../config/env";
import { HttpError } from "../utils/http-error";
import { authoritativePrice } from "./pricing.service";
import { completePayment } from "./payment-transition";
import { pageOptions } from "./pagination";
type Purchase = {
  paymentId?: string;
  userId: string;
  userEmail: string;
  userName: string;
  userPhone: string;
  amount?: number;
  finalAmount?: number;
  currency?: string;
  courses: Array<{ courseId: string }>;
  couponCode?: string | null;
  couponId?: string | null;
};
export function signaturesEqual(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
async function reserve(input: Purchase, free: boolean) {
  if (!input.paymentId || input.paymentId.length > 128)
    throw new HttpError(400, "A stable paymentId is required for idempotency.");
  if (input.currency && input.currency !== "INR")
    throw new HttpError(400, "Unsupported currency.");
  const price = await authoritativePrice(input);
  if (
    free
      ? price.amount !== 0
      : Math.abs(price.amount - Number(input.amount)) > 1
  )
    throw new HttpError(409, "Checkout price changed. Refresh the cart.");
  if (!free && price.amount <= 0)
    throw new HttpError(400, "Use free checkout.");
  const fingerprint = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        ids: input.courses.map((c) => c.courseId).sort(),
        coupon: input.couponId ?? null,
        amount: price.amount,
      }),
    )
    .digest("hex");
  const ref = firestore.collection("payments").doc(
    crypto
      .createHash("sha256")
      .update(input.userId + ":" + input.paymentId)
      .digest("hex"),
  );
  const record: Record<string, any> = {
    ...price,
    paymentId: input.paymentId,
    userId: input.userId,
    userEmail: input.userEmail,
    userName: input.userName,
    userPhone: input.userPhone,
    couponId: input.couponId ?? null,
    couponCode: input.couponCode ?? null,
    fingerprint,
    currency: "INR",
    paymentStatus: free ? "pending" : "creating",
    paymentMethod: free ? (input.couponId ? "coupon" : "free") : "razorpay",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    paymentDate: new Date(),
  };
  return firestore.runTransaction(async (tx) => {
    const old = await tx.get(ref);
    if (old.exists) {
      const data = old.data()!;
      if (data.fingerprint !== fingerprint)
        throw new HttpError(
          409,
          "paymentId was already used for another checkout.",
        );
      return { ref, record: data, created: false };
    }
    tx.create(ref, record);
    return { ref, record, created: true };
  });
}
export async function createPaymentOrder(
  input: Purchase,
): Promise<Record<string, unknown>> {
  const { ref, record, created } = await reserve(input, false);
  let orderId = record.razorpayOrderId as string | undefined;
  if (!created && !orderId)
    throw new HttpError(
      409,
      "Order creation is pending reconciliation. Retry this paymentId later.",
    );
  if (created) {
    // Provider timeouts are ambiguous: preserve the reservation instead of duplicating orders.
    const order = await razorpay.orders.create({
      amount: record.amount,
      currency: "INR",
      receipt: ref.id.slice(0, 40),
      notes: { userId: input.userId, paymentDocId: ref.id },
    });
    orderId = order.id;
    await ref.update({
      razorpayOrderId: orderId,
      paymentStatus: "pending",
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  return {
    paymentDocId: ref.id,
    paymentId: record.paymentId,
    orderId,
    keyId: env.RAZORPAY_KEY_ID,
    amount: record.amount,
    currency: "INR",
  };
}
export async function completeFreePurchase(
  input: Purchase,
): Promise<Record<string, unknown>> {
  const { ref, record } = await reserve(input, true);
  await completePayment(firestore, ref.id, null);
  return {
    paymentDocId: ref.id,
    paymentId: record.paymentId,
    status: "completed",
    paymentMethod: record.paymentMethod,
  };
}
export async function listUserPayments(
  uid: string,
  limit?: unknown,
  cursor?: unknown,
) {
  if (limit === undefined && cursor === undefined) {
    const all = await firestore
      .collection("payments")
      .where("userId", "==", uid)
      .orderBy("createdAt", "desc")
      .get();
    return {
      payments: all.docs.map((d) => ({ id: d.id, ...d.data() })),
      nextCursor: null,
    };
  }
  const page = pageOptions(limit, cursor);
  let query = firestore
    .collection("payments")
    .where("userId", "==", uid)
    .orderBy("createdAt", "desc")
    .orderBy(FieldPath.documentId())
    .limit(page.size + 1);
  if (page.cursor) {
    const doc = await firestore.collection("payments").doc(page.cursor).get();
    if (!doc.exists || doc.data()?.userId !== uid)
      throw new HttpError(400, "Invalid cursor.");
    query = query.startAfter(doc);
  }
  const snapshot = await query.get();
  return {
    payments: snapshot.docs
      .slice(0, page.size)
      .map((d) => ({ id: d.id, ...d.data() })),
    nextCursor:
      snapshot.size > page.size ? snapshot.docs[page.size - 1].id : null,
  };
}
export async function getPaymentByInternalId(
  paymentId: string,
  userId: string,
): Promise<Record<string, unknown>> {
  const s = await firestore
    .collection("payments")
    .where("paymentId", "==", paymentId)
    .where("userId", "==", userId)
    .limit(1)
    .get();
  if (s.empty) throw new HttpError(404, "Payment not found.");
  return { id: s.docs[0].id, ...s.docs[0].data() };
}
async function failed(id: string, providerId: string | null) {
  const ref = firestore.collection("payments").doc(id);
  await firestore.runTransaction(async (tx) => {
    const d = await tx.get(ref);
    if (d.data()?.paymentStatus !== "completed")
      tx.update(ref, {
        paymentStatus: "failed",
        razorpayPaymentId: providerId,
        updatedAt: FieldValue.serverTimestamp(),
      });
  });
}
export async function verifyPaymentFromClient(input: {
  userId: string;
  paymentId: string;
  razorpayPaymentId: string;
  razorpayOrderId: string;
  razorpaySignature: string;
}) {
  const payment = await getPaymentByInternalId(input.paymentId, input.userId);
  if (payment.razorpayOrderId !== input.razorpayOrderId)
    throw new HttpError(400, "Order mismatch.");
  const signature = crypto
    .createHmac("sha256", env.RAZORPAY_KEY_SECRET)
    .update(String(payment.razorpayOrderId) + "|" + input.razorpayPaymentId)
    .digest("hex");
  if (!signaturesEqual(signature, input.razorpaySignature))
    throw new HttpError(400, "Invalid payment signature.");
  const actual = await razorpay.payments.fetch(input.razorpayPaymentId);
  if (
    actual.order_id !== payment.razorpayOrderId ||
    actual.status !== "captured" ||
    Number(actual.amount) !== Math.round(Number(payment.finalAmount) * 100) ||
    actual.currency !== payment.currency
  )
    throw new HttpError(409, "Payment is not captured for the stored order.");
  await completePayment(firestore, String(payment.id), input.razorpayPaymentId);
  return {
    paymentId: input.paymentId,
    paymentDocId: payment.id,
    status: "completed",
  };
}
export async function handleRazorpayWebhook(
  raw: string,
  signature: string | undefined,
  body: Record<string, unknown>,
) {
  if (!env.RAZORPAY_WEBHOOK_SECRET)
    throw new HttpError(503, "Webhook not configured.");
  const expected = crypto
    .createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET)
    .update(raw)
    .digest("hex");
  if (!signature || !signaturesEqual(expected, signature))
    throw new HttpError(401, "Invalid webhook signature.");
  if (!["payment.captured", "payment.failed"].includes(String(body.event)))
    return { updated: false };
  const entity = (body.payload as any)?.payment?.entity;
  if (!entity?.order_id || !entity?.id)
    throw new HttpError(400, "Missing payment identity.");
  const s = await firestore
    .collection("payments")
    .where("razorpayOrderId", "==", entity.order_id)
    .limit(1)
    .get();
  if (s.empty) throw new HttpError(404, "Matching order not found.");
  const doc = s.docs[0],
    data = doc.data();
  if (
    Number(entity.amount) !== Math.round(Number(data.finalAmount) * 100) ||
    entity.currency !== data.currency
  )
    throw new HttpError(400, "Payment amount or currency mismatch.");
  if (body.event === "payment.captured")
    await completePayment(firestore, doc.id, entity.id);
  else await failed(doc.id, entity.id);
  return { updated: true };
}
