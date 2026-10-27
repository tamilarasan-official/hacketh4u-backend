import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { HttpError } from "../utils/http-error";
export async function completePayment(
  db: Firestore,
  id: string,
  providerId: string | null,
) {
  const ref = db.collection("payments").doc(id);
  await db.runTransaction(async (tx) => {
    const payment = await tx.get(ref),
      data = payment.data();
    if (!data) throw new HttpError(404, "Payment not found.");
    if (data.paymentStatus === "completed") return;
    const courses = data.courses as Array<{
      courseId: string;
      subscriptionPeriod?: number;
    }>;
    if (!Array.isArray(courses) || courses.length > 50)
      throw new HttpError(409, "Invalid stored purchase.");
    const refs = courses.map((c) =>
      db.collection("entitlements").doc(`${data.userId}_${c.courseId}`),
    );
    const previous = refs.length ? await tx.getAll(...refs) : [];
    const now = new Date();
    tx.update(ref, {
      paymentStatus: "completed",
      razorpayPaymentId: providerId,
      updatedAt: FieldValue.serverTimestamp(),
    });
    courses.forEach((course, i) => {
      const days = course.subscriptionPeriod ?? 0;
      const oldEnd = previous[i]?.data()?.accessEndDate?.toDate?.() as
        | Date
        | undefined;
      const start = Math.max(now.getTime(), oldEnd?.getTime() ?? 0);
      const lifetime = days <= 0 || previous[i]?.data()?.isLifetime === true;
      tx.set(
        refs[i],
        {
          userId: data.userId,
          courseId: course.courseId,
          sourcePaymentId: id,
          status: "active",
          grantedAt: FieldValue.serverTimestamp(),
          accessStartDate: previous[i]?.data()?.accessStartDate ?? now,
          accessEndDate: lifetime
            ? new Date("2099-12-31")
            : new Date(start + days * 86400000),
          isLifetime: lifetime,
        },
        { merge: true },
      );
      if (!previous[i]?.exists)
        tx.set(
          db.collection("courses").doc(course.courseId),
          {
            studentCount: FieldValue.increment(1),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
    });
  });
}
