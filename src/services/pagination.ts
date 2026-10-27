import { HttpError } from "../utils/http-error";
export function pageOptions(limit: unknown, cursor: unknown) {
  const size = limit === undefined ? 25 : Number(limit);
  if (!Number.isInteger(size) || size < 1 || size > 100)
    throw new HttpError(400, "limit must be 1-100");
  if (
    cursor !== undefined &&
    (typeof cursor !== "string" || !/^[A-Za-z0-9_-]{1,1500}$/.test(cursor))
  )
    throw new HttpError(400, "Invalid cursor");
  return { size, cursor: cursor as string | undefined };
}
