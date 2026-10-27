import { firestore } from "../config/firebase";
import { FieldPath } from "firebase-admin/firestore";
import { pageOptions } from "./pagination";

export async function getCourseEntitlement(
  userId: string,
  courseId: string,
): Promise<Record<string, unknown>> {
  const entitlementId = `${userId}_${courseId}`;
  const doc = await firestore
    .collection("entitlements")
    .doc(entitlementId)
    .get();

  if (!doc.exists) {
    return {
      hasAccess: false,
      isExpired: false,
      reason: "No entitlement found.",
    };
  }

  const data = doc.data() ?? {};
  const status = String(data.status ?? "inactive");
  const accessEndDate = data.accessEndDate?.toDate?.() as Date | undefined;
  const isExpired = accessEndDate
    ? accessEndDate.getTime() < Date.now()
    : false;
  const hasAccess = status === "active" && !isExpired;

  return {
    hasAccess,
    isExpired,
    status,
    sourcePaymentId: data.sourcePaymentId ?? null,
    accessStartDate: data.accessStartDate ?? null,
    accessEndDate: data.accessEndDate ?? null,
    isLifetime: data.isLifetime ?? false,
    reason: hasAccess
      ? null
      : isExpired
        ? "Course access expired."
        : "Entitlement inactive.",
  };
}

export async function listUserEntitlements(
  userId: string,
  limit?: unknown,
  cursor?: unknown,
) {
  // Older installed clients do not understand nextCursor. Preserve their complete list.
  if (limit === undefined && cursor === undefined) {
    const all = await firestore
      .collection("entitlements")
      .where("userId", "==", userId)
      .where("status", "==", "active")
      .get();
    return {
      entitlements: all.docs
        .filter((d) => {
          const end = d.data().accessEndDate?.toDate?.();
          return !end || end.getTime() >= Date.now();
        })
        .map((d) => ({ id: d.id, ...d.data() })),
      nextCursor: null,
    };
  }
  const page = pageOptions(limit, cursor);
  let query = firestore
    .collection("entitlements")
    .where("userId", "==", userId)
    .where("status", "==", "active")
    .orderBy(FieldPath.documentId())
    .limit(page.size + 1);
  if (page.cursor) query = query.startAfter(page.cursor);
  const snapshot = await query.get();

  const entitlements: Array<Record<string, unknown>> = snapshot.docs
    .slice(0, page.size)
    .map(
      (doc) =>
        ({
          id: doc.id,
          ...doc.data(),
        }) as Record<string, unknown>,
    )
    .filter((item) => {
      const accessEndDate = item["accessEndDate"] as
        | { toDate?: () => Date }
        | undefined;
      const endDate = accessEndDate?.toDate?.();
      return !endDate || endDate.getTime() >= Date.now();
    });

  return {
    entitlements,
    nextCursor:
      snapshot.size > page.size ? snapshot.docs[page.size - 1].id : null,
  };
}
