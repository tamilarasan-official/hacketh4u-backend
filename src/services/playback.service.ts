import { createHmac, timingSafeEqual } from "node:crypto";
import { performance } from "../config/performance";
import { env } from "../config/env";
import { firestore } from "../config/firebase";
import { getCourseEntitlement } from "./entitlement.service";
import { HttpError } from "../utils/http-error";
import { validateObjectKey } from "./media-url.service";
export type PlaybackClaims = {
  uid: string;
  courseId: string;
  key: string;
  prefix: boolean;
  exp: number;
};
function signature(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}
export function signPlayback(claims: PlaybackClaims, secret: string): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return payload + "." + signature(payload, secret);
}
export function verifyPlayback(
  token: string,
  key: string,
  secret: string,
  now = Date.now(),
): PlaybackClaims {
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra || token.length > 4096)
    throw new HttpError(403, "Invalid playback session.");
  const expected = Buffer.from(signature(payload, secret)),
    actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    throw new HttpError(403, "Invalid playback session.");
  let claims: PlaybackClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch {
    throw new HttpError(403, "Invalid playback session.");
  }
  validateObjectKey(key);
  if (
    !Number.isFinite(claims.exp) ||
    claims.exp * 1000 <= now ||
    !claims.uid ||
    !claims.courseId ||
    !(claims.prefix ? key.startsWith(claims.key + "/") : key === claims.key)
  )
    throw new HttpError(403, "Playback session expired or outside scope.");
  return claims;
}
export async function requireCourseAccess(uid: string, courseId: string) {
  const access = await getCourseEntitlement(uid, courseId);
  if (access.hasAccess) return;
  const user = await firestore.collection("users").doc(uid).get();
  if (user.data()?.role === "admin" && user.data()?.isEnabled !== false) return;
  throw new HttpError(403, "Course access required.");
}
export async function createPlayback(
  uid: string,
  courseId: string,
  videoId: string,
) {
  if (
    !performance.PROTECTED_PLAYBACK ||
    !performance.PLAYBACK_SECRET ||
    !env.APP_BASE_URL
  )
    throw new HttpError(503, "Protected playback is not enabled.");
  await requireCourseAccess(uid, courseId);
  const video = (
    await firestore.collection("videos").doc(videoId).get()
  ).data();
  if (!video || video.courseId !== courseId)
    throw new HttpError(404, "Video not found.");
  const url = new URL(String(video.streamingUrl || video.videoUrl));
  const bases = [
    env.APP_BASE_URL + "/media/public/",
    env.GARAGE_S3_PUBLIC_BASE_URL.replace(/\/$/, "") + "/",
  ];
  const base = bases.find((x) => url.href.startsWith(x));
  if (!base)
    throw new HttpError(
      409,
      "Video needs storage migration before protected playback.",
    );
  const key = validateObjectKey(
    decodeURIComponent(url.href.slice(base.length)),
  );
  if (!key.startsWith("videos/"))
    throw new HttpError(403, "Invalid video resource.");
  const isHls = key.endsWith(".m3u8");
  const claims: PlaybackClaims = {
    uid,
    courseId,
    key: isHls ? key.slice(0, key.lastIndexOf("/")) : key,
    prefix: isHls,
    exp: Math.floor(Date.now() / 1000) + performance.PLAYBACK_TTL_SECONDS,
  };
  const token = signPlayback(claims, performance.PLAYBACK_SECRET);
  return {
    url: `${env.APP_BASE_URL}/playback/media/${token}/${key.split("/").map(encodeURIComponent).join("/")}`,
    expiresAt: claims.exp * 1000,
  };
}
