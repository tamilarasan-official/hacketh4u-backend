import { firestore } from "../config/firebase";
import { HttpError } from "../utils/http-error";
import { FieldValue } from "firebase-admin/firestore";

export async function getUserProfile(userId: string): Promise<Record<string, unknown>> {
  const doc = await firestore.collection("users").doc(userId).get();
  if (!doc.exists) {
    throw new HttpError(404, "User profile not found.");
  }

  return {
    id: doc.id,
    ...doc.data()
  };
}

export async function ensureUserProfile(input: {
  userId: string;
  email: string | null;
  phoneNumber: string | null;
  name: string;
  fcmToken?: string;
}): Promise<{ userId: string; created: boolean }> {
  const userRef = firestore.collection("users").doc(input.userId);

  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userRef);
    const current = snapshot.data() ?? {};
    const profile: Record<string, unknown> = {
      role: current.role ?? "user",
      isEnabled: current.isEnabled ?? true,
      updatedAt: FieldValue.serverTimestamp()
    };

    if (typeof current.name !== "string" || !current.name.trim()) {
      profile.name = input.name;
    }
    if (typeof current.email !== "string" || !current.email.trim()) {
      profile.email = input.email ?? "";
    }
    if (typeof current.phoneNumber !== "string" || !current.phoneNumber.trim()) {
      profile.phoneNumber = input.phoneNumber ?? "";
    }
    if (!snapshot.exists) {
      profile.createdAt = FieldValue.serverTimestamp();
    }
    if (input.fcmToken) {
      profile.fcmToken = input.fcmToken;
      profile.fcmTokenUpdatedAt = FieldValue.serverTimestamp();
    }

    transaction.set(userRef, profile, { merge: true });
    return { userId: input.userId, created: !snapshot.exists };
  });
}
