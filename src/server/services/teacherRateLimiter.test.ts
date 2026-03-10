import { describe, expect, it, vi } from "vitest";
import {
  applyTeacherUsage,
  computeRetryDelayMs,
  createInitialUsageState,
  getRemainingDailyBudget,
  normalizeTeacherRateLimit,
  normalizeUsageState,
  shouldRetryTeacherError,
} from "./teacherRateLimiter";

describe("teacher rate limiter", () => {
  it("normalizes config with safe bounds", () => {
    const normalized = normalizeTeacherRateLimit({
      maxRequestsPerMinute: 0,
      maxConcurrentTeacherJobs: 99,
      dailyTokenBudget: 1,
      retryBackoffMs: 10,
      maxRetries: 99,
    });

    expect(normalized.maxRequestsPerMinute).toBe(1);
    expect(normalized.maxConcurrentTeacherJobs).toBe(4);
    expect(normalized.dailyTokenBudget).toBe(1000);
    expect(normalized.retryBackoffMs).toBe(250);
    expect(normalized.maxRetries).toBe(8);
  });

  it("resets usage when day changes", () => {
    const usage = normalizeUsageState(
      {
        day: "2001-01-01",
        tokensUsed: 100,
        requests: 12,
      },
      new Date("2026-03-07T10:00:00Z")
    );
    expect(usage.tokensUsed).toBe(0);
    expect(usage.requests).toBe(0);
  });

  it("computes retry policy and daily budget", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.1);
    expect(shouldRetryTeacherError("rate_limited", 1, 3)).toBe(true);
    expect(shouldRetryTeacherError("auth_required", 1, 3)).toBe(false);
    expect(shouldRetryTeacherError("timeout", 4, 3)).toBe(false);
    expect(computeRetryDelayMs(1000, 2)).toBeGreaterThan(2000);
    randomSpy.mockRestore();

    const usage = createInitialUsageState(new Date("2026-03-07T10:00:00Z"));
    applyTeacherUsage(usage, { tokens: 5000, errorClass: "rate_limited", now: new Date("2026-03-07T10:01:00Z") });
    expect(getRemainingDailyBudget(6000, usage)).toBe(1000);
    expect(usage.cooldownUntil).not.toBeNull();
  });
});
