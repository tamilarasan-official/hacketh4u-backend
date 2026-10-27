import { firestore } from "../config/firebase";
import { HttpError } from "../utils/http-error";
export function priceCourses(
  courses: Array<{ id: string; data: Record<string, any> }>,
  coupon?: Record<string, any>,
  now = Date.now(),
) {
  if (
    !courses.length ||
    courses.length > 50 ||
    new Set(courses.map((c) => c.id)).size !== courses.length
  )
    throw new HttpError(400, "Choose 1-50 distinct courses.");
  if (
    coupon &&
    (coupon.isActive !== true ||
      !Number.isFinite(Number(coupon.discountPercentage)) ||
      Number(coupon.discountPercentage) < 0 ||
      Number(coupon.discountPercentage) > 100 ||
      (coupon.validUntil && coupon.validUntil.toMillis() <= now) ||
      (coupon.courseId && !courses.some((c) => c.id === coupon.courseId)))
  )
    throw new HttpError(400, "Coupon is inactive, expired or not applicable.");
  let total = 0,
    discount = 0,
    tax = 0;
  const priced = courses.map(({ id, data }) => {
    const price = Number(data.price),
      gst = Number(data.gstPercentage ?? 0),
      days = Number(data.subscriptionPeriod ?? 0);
    if (
      !Number.isFinite(price) ||
      price < 0 ||
      !Number.isFinite(gst) ||
      gst < 0 ||
      gst > 100 ||
      !Number.isInteger(days) ||
      days < 0
    )
      throw new HttpError(409, "Course pricing requires correction.");
    const paise = Math.round(price * 100),
      off =
        coupon && (!coupon.courseId || coupon.courseId === id)
          ? Math.round((paise * Number(coupon.discountPercentage)) / 100)
          : 0;
    total += paise;
    discount += off;
    return {
      courseId: id,
      courseTitle: String(data.title ?? ""),
      instructorName: String(data.instructorName ?? ""),
      thumbnailUrl: String(data.thumbnailUrl ?? ""),
      price: paise / 100,
      originalPrice: Number(data.originalPrice ?? price),
      subscriptionPeriod: days,
    };
  });
  // Preserve the existing cart's proportional order-discount tax allocation.
  tax = Math.round(
    courses.reduce((sum, c) => {
      const paise = Math.round(Number(c.data.price) * 100);
      return (
        sum +
        ((paise - (total ? (paise / total) * discount : 0)) *
          Number(c.data.gstPercentage ?? 0)) /
          100
      );
    }, 0),
  );
  return {
    courses: priced,
    amount: total - discount + tax,
    totalAmount: total / 100,
    discountAmount: discount / 100,
    gstAmount: tax / 100,
    finalAmount: (total - discount + tax) / 100,
  };
}
export async function authoritativePrice(input: {
  courses: Array<{ courseId: string }>;
  couponId?: string | null;
  couponCode?: string | null;
}) {
  const ids = input.courses.map((c) => c.courseId);
  if (
    !ids.length ||
    ids.length > 50 ||
    ids.some((id) => !id || id.includes("/")) ||
    new Set(ids).size !== ids.length
  )
    throw new HttpError(400, "Invalid course selection.");
  const docs = await firestore.getAll(
    ...ids.map((id) => firestore.collection("courses").doc(id)),
  );
  if (docs.some((d) => !d.exists))
    throw new HttpError(404, "Course not found.");
  let coupon: Record<string, any> | undefined;
  if (input.couponCode || input.couponId) {
    if (!input.couponId || input.couponId.includes("/"))
      throw new HttpError(400, "couponId is required.");
    coupon = (
      await firestore.collection("coupons").doc(input.couponId).get()
    ).data();
    if (
      !coupon ||
      String(coupon.code).toUpperCase() !==
        input.couponCode?.trim().toUpperCase()
    )
      throw new HttpError(400, "Invalid coupon.");
  }
  return priceCourses(
    docs.map((d) => ({ id: d.id, data: d.data()! })),
    coupon,
  );
}
