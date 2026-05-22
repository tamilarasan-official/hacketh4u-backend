import crypto from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { firestore } from "../config/firebase";
import { razorpay } from "../config/razorpay";
import { env } from "../config/env";
import { HttpError } from "../utils/http-error";

type CreateOrderInput = {
  paymentId?: string;
  userId: string;
  userEmail: string;
  userName: string;
  userPhone: string;
  amount: number;
  currency?: string;
  courses: Array<{
    courseId: string;
    courseTitle: string;
    instructorName: string;
    thumbnailUrl?: string;
    price: number;
    originalPrice?: number;
    subscriptionPeriod?: number;
  }>;
  couponCode?: string | null;
  couponId?: string | null;
  discountAmount?: number;
  gstAmount?: number;
  totalAmount?: number;
};

type CompleteFreePurchaseInput = {
  paymentId?: string;
  userId: string;
  userEmail: string;
  userName: string;
  userPhone: string;
  currency?: string;
  courses: PaymentCourse[];
  couponCode?: string | null;
  couponId?: string | null;
  discountAmount?: number;
  gstAmount?: number;
  totalAmount?: number;
  finalAmount?: number;
};

type PaymentCourse = CreateOrderInput["courses"][number];

function buildEntitlementFromCourse(
  paymentDocId: string,
  userId: string,
  course: PaymentCourse
): Record<string, unknown> {
  const startDate = new Date();
  const subscriptionDays = course.subscriptionPeriod ?? 0;
  const isLifetime = subscriptionDays <= 0;
  const accessEndDate = isLifetime
    ? new Date("2099-12-31T00:00:00.000Z")
    : new Date(startDate.getTime() + subscriptionDays * 24 * 60 * 60 * 1000);

  return {
    userId,
    courseId: course.courseId,
    sourcePaymentId: paymentDocId,
    status: "active",
    grantedAt: FieldValue.serverTimestamp(),
    accessStartDate: startDate,
    accessEndDate,
    isLifetime
  };
}

async function applyCompletedPayment(
  paymentDocId: string,
  paymentData: FirebaseFirestore.DocumentData,
  razorpayPaymentId: string | null
): Promise<void> {
  await firestore.collection("payments").doc(paymentDocId).update({
    paymentStatus: "completed",
    razorpayPaymentId,
    updatedAt: FieldValue.serverTimestamp()
  });

  const courses = (paymentData.courses as PaymentCourse[]) ?? [];
  const batch = firestore.batch();

  for (const course of courses) {
    const entitlementRef = firestore
      .collection("entitlements")
      .doc(`${paymentData.userId}_${course.courseId}`);
    batch.set(
      entitlementRef,
      buildEntitlementFromCourse(paymentDocId, String(paymentData.userId), course),
      { merge: true }
    );

    const courseRef = firestore.collection("courses").doc(course.courseId);
    batch.set(
      courseRef,
      {
        studentCount: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );
  }

  await batch.commit();
}

async function applyFailedPayment(
  paymentDocId: string,
  razorpayPaymentId: string | null
): Promise<void> {
  await firestore.collection("payments").doc(paymentDocId).update({
    paymentStatus: "failed",
    razorpayPaymentId,
    updatedAt: FieldValue.serverTimestamp()
  });
}

function buildInternalPaymentId(explicitPaymentId?: string): string {
  return (
    explicitPaymentId?.trim() ||
    `pay_${Date.now()}_${Math.floor(Math.random() * 10000)
      .toString()
      .padStart(4, "0")}`
  );
}

export async function createPaymentOrder(input: CreateOrderInput): Promise<Record<string, unknown>> {
  if (!input.courses.length) {
    throw new HttpError(400, "At least one course is required for payment.");
  }

  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new HttpError(400, "Amount must be a positive number in paise.");
  }

  const internalPaymentId = buildInternalPaymentId(input.paymentId);

  const razorpayOrder = await razorpay.orders.create({
    amount: input.amount,
    currency: input.currency ?? "INR",
    receipt: internalPaymentId,
    notes: {
      userId: input.userId
    }
  });

  const paymentRecord = {
    paymentId: internalPaymentId,
    razorpayOrderId: razorpayOrder.id,
    userId: input.userId,
    userEmail: input.userEmail,
    userName: input.userName,
    userPhone: input.userPhone,
    courses: input.courses,
    totalAmount: input.totalAmount ?? input.amount / 100,
    discountAmount: input.discountAmount ?? 0,
    gstAmount: input.gstAmount ?? 0,
    finalAmount: input.amount / 100,
    couponCode: input.couponCode ?? null,
    couponId: input.couponId ?? null,
    paymentStatus: "pending",
    paymentMethod: "razorpay",
    currency: input.currency ?? "INR",
    paymentDate: new Date(),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  };

  const docRef = await firestore.collection("payments").add(paymentRecord);

  return {
    paymentDocId: docRef.id,
    paymentId: internalPaymentId,
    orderId: razorpayOrder.id,
    keyId: env.RAZORPAY_KEY_ID,
    amount: razorpayOrder.amount,
    currency: razorpayOrder.currency
  };
}

export async function completeFreePurchase(
  input: CompleteFreePurchaseInput
): Promise<Record<string, unknown>> {
  if (!input.courses.length) {
    throw new HttpError(400, "At least one course is required for purchase.");
  }

  if ((input.finalAmount ?? 0) < 0 || (input.finalAmount ?? 0) > 0) {
    throw new HttpError(400, "Free purchase flow only supports zero-value checkouts.");
  }

  const internalPaymentId = buildInternalPaymentId(input.paymentId);

  const paymentRecord = {
    paymentId: internalPaymentId,
    razorpayOrderId: null,
    userId: input.userId,
    userEmail: input.userEmail,
    userName: input.userName,
    userPhone: input.userPhone,
    courses: input.courses,
    totalAmount: input.totalAmount ?? 0,
    discountAmount: input.discountAmount ?? 0,
    gstAmount: input.gstAmount ?? 0,
    finalAmount: input.finalAmount ?? 0,
    couponCode: input.couponCode ?? null,
    couponId: input.couponId ?? null,
    paymentStatus: "pending",
    paymentMethod: input.couponCode ? "coupon" : "free",
    currency: input.currency ?? "INR",
    paymentDate: new Date(),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  };

  const docRef = await firestore.collection("payments").add(paymentRecord);
  await applyCompletedPayment(docRef.id, paymentRecord, null);

  return {
    paymentDocId: docRef.id,
    paymentId: internalPaymentId,
    status: "completed",
    paymentMethod: paymentRecord.paymentMethod
  };
}

export async function listUserPayments(userId: string): Promise<Record<string, unknown>[]> {
  const snapshot = await firestore
    .collection("payments")
    .where("userId", "==", userId)
    .orderBy("createdAt", "desc")
    .get()
    .catch(async () =>
      firestore.collection("payments").where("userId", "==", userId).get()
    );

  const payments: Array<Record<string, unknown>> = snapshot.docs
    .map((doc) => ({
      id: doc.id,
      ...doc.data()
    }) as Record<string, unknown>)
    .sort((a, b) => {
      const aCreatedAt = (a["createdAt"] as { toMillis?: () => number } | undefined);
      const bCreatedAt = (b["createdAt"] as { toMillis?: () => number } | undefined);
      const aMs = aCreatedAt?.toMillis?.() ?? 0;
      const bMs = bCreatedAt?.toMillis?.() ?? 0;
      return bMs - aMs;
    });

  return payments;
}

export async function getPaymentByInternalId(paymentId: string): Promise<Record<string, unknown>> {
  const snapshot = await firestore
    .collection("payments")
    .where("paymentId", "==", paymentId)
    .limit(1)
    .get();

  if (snapshot.empty) {
    throw new HttpError(404, "Payment not found.");
  }

  const doc = snapshot.docs[0];
  return {
    id: doc.id,
    ...doc.data()
  };
}

export async function verifyPaymentFromClient(input: {
  userId: string;
  paymentId: string;
  razorpayPaymentId: string;
  razorpayOrderId: string;
  razorpaySignature: string;
}): Promise<Record<string, unknown>> {
  const snapshot = await firestore
    .collection("payments")
    .where("paymentId", "==", input.paymentId)
    .where("userId", "==", input.userId)
    .limit(1)
    .get();

  if (snapshot.empty) {
    throw new HttpError(404, "Payment record not found.");
  }

  const paymentDoc = snapshot.docs[0];
  const paymentData = paymentDoc.data();

  const generatedSignature = crypto
    .createHmac("sha256", env.RAZORPAY_KEY_SECRET)
    .update(`${input.razorpayOrderId}|${input.razorpayPaymentId}`)
    .digest("hex");

  if (generatedSignature !== input.razorpaySignature) {
    await applyFailedPayment(paymentDoc.id, input.razorpayPaymentId);
    throw new HttpError(400, "Invalid Razorpay payment signature.");
  }

  if (String(paymentData.paymentStatus ?? "") !== "completed") {
    await applyCompletedPayment(paymentDoc.id, paymentData, input.razorpayPaymentId);
  }

  return {
    paymentId: input.paymentId,
    paymentDocId: paymentDoc.id,
    status: "completed"
  };
}

export async function handleRazorpayWebhook(
  rawBody: string,
  signature: string | undefined,
  eventBody: Record<string, unknown>
): Promise<{ updated: boolean }> {
  if (!env.RAZORPAY_WEBHOOK_SECRET) {
    throw new HttpError(500, "Razorpay webhook secret is not configured.");
  }

  if (!signature) {
    throw new HttpError(400, "Missing Razorpay webhook signature.");
  }

  const expectedSignature = crypto
    .createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");

  if (expectedSignature !== signature) {
    throw new HttpError(401, "Invalid Razorpay webhook signature.");
  }

  const event = String(eventBody.event ?? "");
  if (event !== "payment.captured" && event !== "payment.failed") {
    return { updated: false };
  }

  const payload = eventBody.payload as Record<string, unknown> | undefined;
  const paymentEntity = payload?.payment as Record<string, unknown> | undefined;
  const paymentDetails = paymentEntity?.entity as Record<string, unknown> | undefined;
  const orderId = String(paymentDetails?.order_id ?? "");
  const razorpayPaymentId = String(paymentDetails?.id ?? "");

  if (!orderId) {
    throw new HttpError(400, "Webhook payload missing Razorpay order id.");
  }

  const paymentSnapshot = await firestore
    .collection("payments")
    .where("razorpayOrderId", "==", orderId)
    .limit(1)
    .get();

  if (paymentSnapshot.empty) {
    throw new HttpError(404, "Matching payment record not found.");
  }

  const paymentDoc = paymentSnapshot.docs[0];
  const paymentData = paymentDoc.data();
  const nextStatus = event === "payment.captured" ? "completed" : "failed";

  if (nextStatus === "completed") {
    if (String(paymentData.paymentStatus ?? "") !== "completed") {
      await applyCompletedPayment(paymentDoc.id, paymentData, razorpayPaymentId || null);
    }
  } else {
    if (String(paymentData.paymentStatus ?? "") !== "completed") {
      await applyFailedPayment(paymentDoc.id, razorpayPaymentId || null);
    }
  }

  return { updated: true };
}
