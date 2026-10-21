import { describe, expect, it } from "vitest";
import { allocateMinor, eligibility } from "../../apps/server/src/domain.ts";

describe("return policy", () => {
  it("accepts the exact UTC deadline and rejects one millisecond later or future deliveries", () => {
    const delivery = "2026-09-01T12:00:00.000Z";
    expect(eligibility(delivery, "2026-10-01T12:00:00.000Z").eligible).toBe(true);
    expect(eligibility(delivery, "2026-10-01T12:00:00.001Z").eligible).toBe(false);
    expect(eligibility(delivery, "2026-09-01T11:59:59.999Z").eligible).toBe(false);
  });
  it("allocates every minor unit once, including discount remainders", () => {
    expect(allocateMinor(101, 3)).toEqual([34, 34, 33]);
    expect(allocateMinor(0, 2)).toEqual([0, 0]);
    expect(() => allocateMinor(100.5, 2)).toThrow();
    expect(() => allocateMinor(100, 0)).toThrow();
    expect(() => allocateMinor(Number.MAX_SAFE_INTEGER + 1, 2)).toThrow();
  });
});
