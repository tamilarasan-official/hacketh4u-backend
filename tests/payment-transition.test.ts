import { it, expect } from "vitest";
import { completePayment } from "../src/services/payment-transition";
// Serial transaction harness records atomic writes; emulator verification is separate.
function database(fail = false) {
  const records = new Map<string, any>([
    [
      "payments/p",
      {
        paymentStatus: "pending",
        userId: "u",
        courses: [{ courseId: "c", subscriptionPeriod: 30 }],
      },
    ],
  ]);
  let chain = Promise.resolve();
  let batches = 0;
  const doc = (key: string) => ({ key });
  const snap = (r: any) => ({
    exists: records.has(r.key),
    data: () => records.get(r.key),
  });
  const db: any = {
    collection: (name: string) => ({
      doc: (id: string) => doc(name + "/" + id),
    }),
    runTransaction: (fn: any) => {
      const work = chain.then(async () => {
        const writes: Array<[any, any]> = [];
        const tx = {
          get: async (r: any) => snap(r),
          getAll: async (...rs: any[]) => rs.map(snap),
          update: (r: any, d: any) => writes.push([r, d]),
          set: (r: any, d: any) => writes.push([r, d]),
        };
        await fn(tx);
        if (fail) throw new Error("commit failed");
        if (writes.length) batches++;
        for (const [r, d] of writes)
          records.set(r.key, { ...records.get(r.key), ...d });
      });
      chain = work.catch(() => {});
      return work;
    },
  };
  return { db, records, batches: () => batches };
}
it("concurrent callbacks grant access and increment counts in one transaction only", async () => {
  const d = database();
  await Promise.all(
    Array.from({ length: 10 }, () => completePayment(d.db, "p", "provider")),
  );
  expect(d.batches()).toBe(1);
  expect(d.records.get("payments/p").paymentStatus).toBe("completed");
  expect(d.records.get("entitlements/u_c").status).toBe("active");
});
it("commit failure cannot leave a completed payment without access", async () => {
  const d = database(true);
  await expect(completePayment(d.db, "p", "provider")).rejects.toThrow(
    "commit failed",
  );
  expect(d.records.get("payments/p").paymentStatus).toBe("pending");
  expect(d.records.has("entitlements/u_c")).toBe(false);
});
