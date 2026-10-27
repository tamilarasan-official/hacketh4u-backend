import { createHash } from "node:crypto";
import { HttpError } from "../utils/http-error";
interface AdmissionConnection {
  status: string;
  eval(script: string, numberOfKeys: number, ...args: (string | number)[]): Promise<unknown>;
}
const script = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],120) end; return n";
export async function consumeAdmission(client: AdmissionConnection, scope: string, identity: string, limit: number, now = Date.now()) {
  if (client.status !== "ready") throw new HttpError(503, "Request admission temporarily unavailable.");
  try {
    const digest = createHash("sha256").update(identity).digest("hex");
    const count = Number(await client.eval(script, 1, `admission:v2:${scope}:${digest}:${Math.floor(now / 60000)}`));
    return { allowed: count <= limit, retryAfter: Math.max(1, Math.ceil((60000 - now % 60000) / 1000)) };
  } catch { throw new HttpError(503, "Request admission temporarily unavailable."); }
}
