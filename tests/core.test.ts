import { describe, it, expect } from "vitest";
import {
  validateRange,
  validateObjectKey,
  assertOwner,
  mediaCacheControl,
  buildPublicMediaUrl,
} from "../src/services/media-url.service";
import { signPlayback, verifyPlayback } from "../src/services/playback.service";
import { priceCourses } from "../src/services/pricing.service";
import { resourceUsage, SustainedAlerts } from "../src/services/host-metrics";
import { pageOptions } from "../src/services/pagination";
const secret = "local-test-secret-with-at-least-32-characters";
describe("media boundaries", () => {
  it.each(["bytes=0-100", "bytes=100-", "bytes=-500"])(
    "accepts valid range %s",
    (r) => expect(() => validateRange(r)).not.toThrow(),
  );
  it.each(["bytes=9-1", "bytes=-0", "bytes=1-2,3-4", "bytes=-", "items=1-2"])(
    "rejects invalid range %s",
    (r) => expect(() => validateRange(r)).toThrow(),
  );
  it.each([
    "../secret",
    "videos/a/../b",
    "/videos/a",
    "videos\\a",
    "videos/a?x=1",
  ])("rejects ambiguous keys %s", (k) =>
    expect(() => validateObjectKey(k)).toThrow(),
  );
  it("checks ownership before mutations", () => {
    expect(() => assertOwner("videos/raw/other/file", "u")).toThrow();
    expect(() => assertOwner("videos/raw/u/file", "u")).not.toThrow();
    expect(() => assertOwner("user-profiles/u/a", "u")).not.toThrow();
  });
  it("uses revalidation for manifests and never publicly caches protected content", () => {
    expect(mediaCacheControl("a.m3u8")).toContain("must-revalidate");
    expect(mediaCacheControl("a.ts", true)).toBe("private, no-store");
    expect(buildPublicMediaUrl("images/u/a b")).toContain("a%20b");
  });
});
describe("playback scope", () => {
  const claims = {
    uid: "u",
    courseId: "c",
    key: "videos/hls/u/v",
    prefix: true,
    exp: 2000,
  };
  it("allows only the signed video subtree", () => {
    const token = signPlayback(claims, secret);
    expect(
      verifyPlayback(token, "videos/hls/u/v/480p/1.ts", secret, 1000000).uid,
    ).toBe("u");
    expect(() =>
      verifyPlayback(token, "videos/hls/u/other/1.ts", secret, 1000000),
    ).toThrow();
  });
  it("rejects expiration and tampering", () => {
    const token = signPlayback(claims, secret);
    expect(() =>
      verifyPlayback(token, "videos/hls/u/v/a.ts", secret, 2000000),
    ).toThrow();
    expect(() =>
      verifyPlayback(token + "x", "videos/hls/u/v/a.ts", secret, 1000000),
    ).toThrow();
  });
  it("raw file sessions cannot access sibling objects", () => {
    const t = signPlayback(
      { ...claims, key: "videos/raw/u/x.mp4", prefix: false },
      secret,
    );
    expect(() =>
      verifyPlayback(t, "videos/raw/u/x.mp4/other", secret, 0),
    ).toThrow();
  });
});
describe("authoritative pricing", () => {
  const courses = [
    {
      id: "a",
      data: { price: 100, gstPercentage: 18, subscriptionPeriod: 30 },
    },
    { id: "b", data: { price: 200, gstPercentage: 0 } },
  ];
  it("calculates in paise using stored fields", () =>
    expect(priceCourses(courses).amount).toBe(31800));
  it("limits course-specific discounts and preserves proportional cart tax", () =>
    expect(
      priceCourses(courses, {
        isActive: true,
        discountPercentage: 100,
        courseId: "a",
      }).amount,
    ).toBe(21200));
  it("rejects expired, malformed and unrelated coupons", () => {
    expect(() =>
      priceCourses(courses, { isActive: true, discountPercentage: 120 }),
    ).toThrow();
    expect(() =>
      priceCourses(courses, {
        isActive: true,
        discountPercentage: 10,
        validUntil: { toMillis: () => 0 },
      }),
    ).toThrow();
    expect(() =>
      priceCourses(courses, {
        isActive: true,
        discountPercentage: 10,
        courseId: "c",
      }),
    ).toThrow();
  });
  it("rejects duplicated courses and invalid stored prices", () => {
    expect(() => priceCourses([courses[0], courses[0]])).toThrow();
    expect(() => priceCourses([{ id: "a", data: { price: -1 } }])).toThrow();
  });
});
describe("resource and pagination logic", () => {
  it("derives CPU from counter deltas and memory from available memory", () =>
    expect(
      resourceUsage(
        { cpu: [0, 0, 0, 0, 0, 0, 0, 0], total: 100, available: 80 },
        { cpu: [25, 0, 0, 75, 0, 0, 0, 0], total: 100, available: 80 },
      ),
    ).toEqual({ cpu: 25, memory: 19.999999999999996 }));
  it("alerts only after sustained pressure and signals recovery", () => {
    const a = new SustainedAlerts(3);
    expect(a.update("cpu", true)).toBeNull();
    expect(a.update("cpu", true)).toBeNull();
    expect(a.update("cpu", true)).toBe("alert");
    expect(a.update("cpu", true)).toBeNull();
    expect(a.update("cpu", false)).toBe("recovery");
  });
  it("allows delivery retry after failed alert", () => {
    const a = new SustainedAlerts(1);
    expect(a.update("x", true)).toBe("alert");
    a.retry("x");
    expect(a.update("x", true)).toBe("alert");
  });
  it("bounds page sizes and rejects malformed cursors", () => {
    expect(pageOptions(undefined, undefined).size).toBe(25);
    expect(() => pageOptions(101, undefined)).toThrow();
    expect(() => pageOptions(10, "../other")).toThrow();
  });
});
