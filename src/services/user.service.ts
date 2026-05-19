import { firestore } from "../config/firebase";
import { HttpError } from "../utils/http-error";

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
