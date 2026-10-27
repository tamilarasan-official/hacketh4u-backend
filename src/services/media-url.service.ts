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
export function buildPublicMediaUrl(key: string): string {
  validateObjectKey(key);
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  const base =
    !key.startsWith("videos/") && performance.PUBLIC_MEDIA_BASE_URL
      ? performance.PUBLIC_MEDIA_BASE_URL
      : env.APP_BASE_URL
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
