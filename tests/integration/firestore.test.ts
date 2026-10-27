import { it, expect, vi, afterAll } from "vitest";
import { Firestore } from "firebase-admin/firestore";
import { createHmac } from "node:crypto";
vi.hoisted(() => {
  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:19189";
});
vi.mock("../../src/config/firebase", async () => {
  const { Firestore } = await import("firebase-admin/firestore");
  return {
    firestore: new Firestore({ projectId: "demo-hacketh4u-local" }),
    firebaseAuth: {},
  };
});
vi.mock("../../src/config/razorpay", () => ({
  razorpay: {
    orders: {
      create: vi.fn(async () => ({ id: "order-local-" + Date.now() })),
    },
    payments: { fetch: vi.fn() },
  },
}));
import { firestore } from "../../src/config/firebase";
import { razorpay } from "../../src/config/razorpay";
import { completePayment } from "../../src/services/payment-transition";
import {
  createPaymentOrder,
  getPaymentByInternalId,
  listUserPayments,
  handleRazorpayWebhook,
  completeFreePurchase,
} from "../../src/services/payment.service";
const test = it.skipIf(process.env.RUN_FIRESTORE_TESTS !== "true");
const suffix = Date.now().toString();
afterAll(async () => {
  await firestore.terminate();
});
test("real Firestore concurrent callbacks commit exactly one grant", async () => {
  const id = "p-" + suffix,
    uid = "u-" + suffix,
    course = "c-" + suffix;
  await firestore
    .collection("payments")
    .doc(id)
    .set({
      userId: uid,
      paymentStatus: "pending",
      courses: [{ courseId: course, subscriptionPeriod: 30 }],
    });
  await Promise.all(
    Array.from({ length: 6 }, () => completePayment(firestore, id, "provider")),
  );
  expect(
    (await firestore.collection("courses").doc(course).get()).data()
      ?.studentCount,
  ).toBe(1);
  expect(
    (
      await firestore
        .collection("entitlements")
        .doc(uid + "_" + course)
        .get()
    ).data()?.status,
  ).toBe("active");
}, 30000);
test("checkout repeats reuse the same order and reject changed amounts", async () => {
  const id = "order-" + suffix,
    course = "priced-" + suffix;
  await firestore
    .collection("courses")
    .doc(course)
    .set({ title: "test", price: 100, gstPercentage: 18 });
  const input = {
    paymentId: id,
    userId: "buyer-" + suffix,
    userEmail: "test@example.test",
    userName: "Test",
    userPhone: "test",
    amount: 11800,
    courses: [{ courseId: course }],
  };
  const first = await createPaymentOrder(input);
  const second = await createPaymentOrder(input);
  expect(first.orderId).toBe(second.orderId);
  expect(razorpay.orders.create).toHaveBeenCalledTimes(1);
  await expect(createPaymentOrder({ ...input, amount: 1 })).rejects.toThrow(
    "price changed",
  );
  await expect(getPaymentByInternalId(id, "other-user")).rejects.toThrow(
    "not found",
  );
  expect((await getPaymentByInternalId(id, input.userId)).userId).toBe(
    input.userId,
  );
});
test("pagination returns disjoint pages without dropping tied timestamps", async () => {
  const uid = "pages-" + suffix,
    date = new Date();
  for (let i = 0; i < 5; i++)
    await firestore
      .collection("payments")
      .doc(uid + "-" + i)
      .set({ userId: uid, createdAt: date });
  const first = await listUserPayments(uid, 2);
  const second = await listUserPayments(uid, 2, first.nextCursor);
  const third = await listUserPayments(uid, 2, second.nextCursor);
  expect(
    new Set(
      [...first.payments, ...second.payments, ...third.payments].map(
        (p) => p.id,
      ),
    ).size,
  ).toBe(5);
  expect(third.nextCursor).toBeNull();
});
test("signed webhook is idempotent and failed event cannot undo completed payment", async () => {
  const id = "hook-" + suffix,
    order = "hook-order-" + suffix;
  await firestore
    .collection("payments")
    .doc(id)
    .set({
      razorpayOrderId: order,
      finalAmount: 10,
      currency: "INR",
      paymentStatus: "pending",
      userId: "hook-user-" + suffix,
      courses: [],
    });
  const body = {
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: "provider",
          order_id: order,
          amount: 1000,
          currency: "INR",
        },
      },
    },
  };
  const send = async (b: typeof body) => {
    const raw = JSON.stringify(b);
    return handleRazorpayWebhook(
      raw,
      createHmac("sha256", "test-webhook").update(raw).digest("hex"),
      b,
    );
  };
  await Promise.all([send(body), send(body)]);
  await send({ ...body, event: "payment.failed" });
  expect(
    (await firestore.collection("payments").doc(id).get()).data()
      ?.paymentStatus,
  ).toBe("completed");
  await expect(
    handleRazorpayWebhook(JSON.stringify(body), "wrong", body),
  ).rejects.toThrow("Invalid webhook");
});
test("free checkout cannot grant a paid course from client supplied totals", async () => {
  const course = "free-attack-" + suffix;
  await firestore.collection("courses").doc(course).set({ price: 99 });
  await expect(
    completeFreePurchase({
      paymentId: "free-" + suffix,
      userId: "attacker",
      userEmail: "test@example.test",
      userName: "test",
      userPhone: "test",
      finalAmount: 0,
      courses: [{ courseId: course }],
    }),
  ).rejects.toThrow("price changed");
});
