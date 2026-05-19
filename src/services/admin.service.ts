import { FieldValue } from "firebase-admin/firestore";
import { firestore } from "../config/firebase";

export async function setUserEnabledStatus(
  targetUserId: string,
  isEnabled: boolean,
  adminUserId: string
): Promise<Record<string, unknown>> {
  await firestore.collection("users").doc(targetUserId).set(
    {
      isEnabled,
      statusUpdatedAt: FieldValue.serverTimestamp(),
      statusUpdatedBy: adminUserId,
      updatedAt: FieldValue.serverTimestamp()
    },
    { merge: true }
  );

  return {
    userId: targetUserId,
    isEnabled
  };
}
