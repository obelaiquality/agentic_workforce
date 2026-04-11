import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../db", () => ({
  prisma: {
    providerAccountEvent: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

import { computeQuotaWindowMs, estimateNextUsableAt } from "./quotaEstimator";
import { prisma } from "../db";

const mockPrisma = vi.mocked(prisma);

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

  it("caps confidence at 1 when 5+ observations provided", () => {
    const durations = [10000, 20000, 30000, 40000, 50000, 60000];
    const result = computeQuotaWindowMs(durations);
    expect(result.confidence).toBe(1);
  });

  it("handles single observation", () => {
    const result = computeQuotaWindowMs([120000]);
    expect(result.windowMs).toBe(120000);
    expect(result.confidence).toBeCloseTo(0.2, 5);
  });
});

describe("estimateNextUsableAt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns default window when no events exist", async () => {
    mockPrisma.providerAccountEvent.findMany.mockResolvedValue([]);
    const from = new Date("2025-01-01T00:00:00Z");
    const result = await estimateNextUsableAt("account-1", from);

    expect(result.nextUsableAt.getTime()).toBe(from.getTime() + 60 * 60 * 1000);
    expect(result.confidence).toBe(0);
  });

  it("computes window from exhausted/recovered event pairs", async () => {
    const exhaustedAt = new Date("2025-01-01T00:00:00Z");
    const recoveredAt = new Date("2025-01-01T00:30:00Z"); // 30 minutes later

    mockPrisma.providerAccountEvent.findMany.mockResolvedValue([
      { id: "1", accountId: "acc-1", type: "account.exhausted", createdAt: exhaustedAt, payload: {} },
      { id: "2", accountId: "acc-1", type: "account.recovered", createdAt: recoveredAt, payload: {} },
    ] as any);

    const from = new Date("2025-01-01T01:00:00Z");
    const result = await estimateNextUsableAt("acc-1", from);

    expect(result.nextUsableAt.getTime()).toBe(from.getTime() + 30 * 60 * 1000);
    expect(result.confidence).toBeCloseTo(0.2, 5);
  });

  it("handles multiple exhausted/recovered cycles", async () => {
    const events = [
      { id: "1", accountId: "acc-1", type: "account.exhausted", createdAt: new Date("2025-01-01T00:00:00Z"), payload: {} },
      { id: "2", accountId: "acc-1", type: "account.recovered", createdAt: new Date("2025-01-01T01:00:00Z"), payload: {} },
      { id: "3", accountId: "acc-1", type: "account.exhausted", createdAt: new Date("2025-01-01T02:00:00Z"), payload: {} },
      { id: "4", accountId: "acc-1", type: "account.recovered", createdAt: new Date("2025-01-01T02:30:00Z"), payload: {} },
    ];

    mockPrisma.providerAccountEvent.findMany.mockResolvedValue(events as any);

    const from = new Date("2025-01-01T03:00:00Z");
    const result = await estimateNextUsableAt("acc-1", from);

    // Average: (60 + 30) / 2 = 45 minutes
    expect(result.nextUsableAt.getTime()).toBe(from.getTime() + 45 * 60 * 1000);
    expect(result.confidence).toBeCloseTo(0.4, 5);
  });

  it("ignores recovered events without preceding exhausted", async () => {
    mockPrisma.providerAccountEvent.findMany.mockResolvedValue([
      { id: "1", accountId: "acc-1", type: "account.recovered", createdAt: new Date("2025-01-01T00:30:00Z"), payload: {} },
    ] as any);

    const from = new Date("2025-01-01T01:00:00Z");
    const result = await estimateNextUsableAt("acc-1", from);

    // No valid pairs, falls back to default
    expect(result.nextUsableAt.getTime()).toBe(from.getTime() + 60 * 60 * 1000);
    expect(result.confidence).toBe(0);
  });

  it("handles trailing exhausted without recovery", async () => {
    mockPrisma.providerAccountEvent.findMany.mockResolvedValue([
      { id: "1", accountId: "acc-1", type: "account.exhausted", createdAt: new Date("2025-01-01T00:00:00Z"), payload: {} },
      { id: "2", accountId: "acc-1", type: "account.recovered", createdAt: new Date("2025-01-01T01:00:00Z"), payload: {} },
      { id: "3", accountId: "acc-1", type: "account.exhausted", createdAt: new Date("2025-01-01T02:00:00Z"), payload: {} },
      // No recovery for the last exhausted
    ] as any);

    const from = new Date("2025-01-01T03:00:00Z");
    const result = await estimateNextUsableAt("acc-1", from);

    // Only one completed pair (60 minutes)
    expect(result.nextUsableAt.getTime()).toBe(from.getTime() + 60 * 60 * 1000);
    expect(result.confidence).toBeCloseTo(0.2, 5);
  });

  it("uses current date as default for from parameter", async () => {
    mockPrisma.providerAccountEvent.findMany.mockResolvedValue([]);
    const before = Date.now();
    const result = await estimateNextUsableAt("acc-1");
    const after = Date.now();

    // nextUsableAt should be roughly 1 hour from now
    expect(result.nextUsableAt.getTime()).toBeGreaterThanOrEqual(before + 60 * 60 * 1000);
    expect(result.nextUsableAt.getTime()).toBeLessThanOrEqual(after + 60 * 60 * 1000);
  });
});
