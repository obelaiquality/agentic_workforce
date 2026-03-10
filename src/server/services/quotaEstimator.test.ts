import { describe, expect, it } from "vitest";
import { computeQuotaWindowMs } from "./quotaEstimator";

describe("computeQuotaWindowMs", () => {
  it("falls back to default one-hour window", () => {
    const result = computeQuotaWindowMs([]);

    expect(result.windowMs).toBe(60 * 60 * 1000);
    expect(result.confidence).toBe(0);
  });

  it("uses mean duration and raises confidence with observations", () => {
    const result = computeQuotaWindowMs([30 * 60 * 1000, 60 * 60 * 1000, 90 * 60 * 1000]);

    expect(result.windowMs).toBe(60 * 60 * 1000);
    expect(result.confidence).toBeCloseTo(0.6, 5);
  });
});
