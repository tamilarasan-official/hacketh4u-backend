import { env } from "../config/env";
import { performance } from "../config/performance";
import { HttpError } from "../utils/http-error";

export function validateObjectKey(key: string): string {
  if (
    !key ||
    key.length > 1024 ||
    key.startsWith("/") ||
    key.includes("\\") ||
    key.split("/").some((x) => x === ".." || x === "." || !x) ||
    /[\x00-\x1f?#]/.test(key)
  ) {
    throw new HttpError(400, "Invalid object key.");
  }
  return key;
}
export function assertOwner(key: string, userId: string): void {
  validateObjectKey(key);
  const parts = key.split("/");
  const owner = parts[0] === "videos" ? parts[2] : parts[1];
  if (owner !== userId)
    throw new HttpError(403, "Object belongs to another user.");
}
const publicImageFolders = new Set([
  "user-profiles", "course-thumbnails", "mentor-profiles", "banner-images", "video-thumbnails",
]);
export function isPublicImageKey(key: string): boolean {
  return publicImageFolders.has(key.split("/")[0]);
}
export function imageCdnUrl(key: string): string | undefined {
  validateObjectKey(key);
  if (!isPublicImageKey(key) || !performance.PUBLIC_MEDIA_BASE_URL) return;
  if (env.APP_BASE_URL && new URL(performance.PUBLIC_MEDIA_BASE_URL).origin === new URL(env.APP_BASE_URL).origin)
    throw new HttpError(503, "Image delivery origin must be separate from the API origin.");
  return performance.PUBLIC_MEDIA_BASE_URL.replace(/\/$/, "") + "/" + key.split("/").map(encodeURIComponent).join("/");
}
export function buildPublicMediaUrl(key: string): string {
  validateObjectKey(key);
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  const cdn = imageCdnUrl(key);
  if (cdn) return cdn;
  const base =
    env.APP_BASE_URL
        ? env.APP_BASE_URL.replace(/\/$/, "") + "/media/public"
        : env.GARAGE_S3_PUBLIC_BASE_URL;
  return base.replace(/\/$/, "") + "/" + encoded;
}
export function mediaCacheControl(key: string, privateMedia = false): string {
  if (privateMedia) return "private, no-store";
  return key.endsWith(".m3u8")
    ? "public, max-age=30, must-revalidate"
    : "public, max-age=31536000, immutable";
}
export function validateRange(range?: string): void {
  if (!range) return;
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (
    !match ||
    (!match[1] && !match[2]) ||
    (match[1] && match[2] && Number(match[1]) > Number(match[2])) ||
    (!match[1] && Number(match[2]) === 0)
  )
    throw new HttpError(416, "Unsupported byte range.");
}
