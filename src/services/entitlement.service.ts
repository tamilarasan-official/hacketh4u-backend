import { firestore } from "../config/firebase";

export async function getCourseEntitlement(userId: string, courseId: string): Promise<Record<string, unknown>> {
  const entitlementId = `${userId}_${courseId}`;
  const doc = await firestore.collection("entitlements").doc(entitlementId).get();

  if (!doc.exists) {
    return {
      hasAccess: false,
      isExpired: false,
      reason: "No entitlement found."
    };
  }

  const data = doc.data() ?? {};
  const status = String(data.status ?? "inactive");
  const accessEndDate = data.accessEndDate?.toDate?.() as Date | undefined;
  const isExpired = accessEndDate ? accessEndDate.getTime() < Date.now() : false;
  const hasAccess = status === "active" && !isExpired;

  return {
    hasAccess,
    isExpired,
    status,
    sourcePaymentId: data.sourcePaymentId ?? null,
    accessStartDate: data.accessStartDate ?? null,
    accessEndDate: data.accessEndDate ?? null,
    isLifetime: data.isLifetime ?? false,
    reason: hasAccess ? null : isExpired ? "Course access expired." : "Entitlement inactive."
  };
}

export async function listUserEntitlements(userId: string): Promise<Record<string, unknown>[]> {
  const snapshot = await firestore
    .collection("entitlements")
    .where("userId", "==", userId)
    .where("status", "==", "active")
    .get();

  const entitlements: Array<Record<string, unknown>> = snapshot.docs
    .map((doc) => ({
      id: doc.id,
      ...doc.data()
    }) as Record<string, unknown>)
    .filter((item) => {
      const accessEndDate = item["accessEndDate"] as { toDate?: () => Date } | undefined;
      const endDate = accessEndDate?.toDate?.();
      return !endDate || endDate.getTime() >= Date.now();
    });

  return entitlements;
}
