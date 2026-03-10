import type { DistillTeacherRateLimitConfig } from "../../shared/contracts";

export interface TeacherUsageState {
  day: string;
  tokensUsed: number;
  requests: number;
  lastRequestAt: string | null;
  cooldownUntil: string | null;
  lastErrorClass: string | null;
  lastErrorAt: string | null;
}

export const DEFAULT_TEACHER_RATE_LIMIT: DistillTeacherRateLimitConfig = {
  maxRequestsPerMinute: 6,
  maxConcurrentTeacherJobs: 1,
  dailyTokenBudget: 120000,
  retryBackoffMs: 2500,
  maxRetries: 3,
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeTeacherRateLimit(
  input: Record<string, unknown> | null | undefined
): DistillTeacherRateLimitConfig {
  const value = input ?? {};
  const maxRequestsPerMinute =
    typeof value.maxRequestsPerMinute === "number"
      ? clamp(Math.floor(value.maxRequestsPerMinute), 1, 120)
      : DEFAULT_TEACHER_RATE_LIMIT.maxRequestsPerMinute;
  const maxConcurrentTeacherJobs =
    typeof value.maxConcurrentTeacherJobs === "number"
      ? clamp(Math.floor(value.maxConcurrentTeacherJobs), 1, 4)
      : DEFAULT_TEACHER_RATE_LIMIT.maxConcurrentTeacherJobs;
  const dailyTokenBudget =
    typeof value.dailyTokenBudget === "number"
      ? clamp(Math.floor(value.dailyTokenBudget), 1000, 10_000_000)
      : DEFAULT_TEACHER_RATE_LIMIT.dailyTokenBudget;
  const retryBackoffMs =
    typeof value.retryBackoffMs === "number"
      ? clamp(Math.floor(value.retryBackoffMs), 250, 60_000)
      : DEFAULT_TEACHER_RATE_LIMIT.retryBackoffMs;
  const maxRetries =
    typeof value.maxRetries === "number"
      ? clamp(Math.floor(value.maxRetries), 0, 8)
      : DEFAULT_TEACHER_RATE_LIMIT.maxRetries;

  return {
    maxRequestsPerMinute,
    maxConcurrentTeacherJobs,
    dailyTokenBudget,
    retryBackoffMs,
    maxRetries,
  };
}

export function getDayKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function createInitialUsageState(now = new Date()): TeacherUsageState {
  return {
    day: getDayKey(now),
    tokensUsed: 0,
    requests: 0,
    lastRequestAt: null,
    cooldownUntil: null,
    lastErrorClass: null,
    lastErrorAt: null,
  };
}

export function normalizeUsageState(input: Record<string, unknown> | null | undefined, now = new Date()): TeacherUsageState {
  const empty = createInitialUsageState(now);
  const value = input ?? {};
  const day = typeof value.day === "string" ? value.day : empty.day;
  if (day !== empty.day) {
    return empty;
  }

  return {
    day,
    tokensUsed: typeof value.tokensUsed === "number" ? Math.max(0, Math.floor(value.tokensUsed)) : 0,
    requests: typeof value.requests === "number" ? Math.max(0, Math.floor(value.requests)) : 0,
    lastRequestAt: typeof value.lastRequestAt === "string" ? value.lastRequestAt : null,
    cooldownUntil: typeof value.cooldownUntil === "string" ? value.cooldownUntil : null,
    lastErrorClass: typeof value.lastErrorClass === "string" ? value.lastErrorClass : null,
    lastErrorAt: typeof value.lastErrorAt === "string" ? value.lastErrorAt : null,
  };
}

export function computeRetryDelayMs(baseMs: number, attempt: number) {
  const exp = Math.max(0, attempt - 1);
  const jitter = Math.floor(Math.random() * 0.3 * baseMs);
  return Math.min(120_000, baseMs * 2 ** exp + jitter);
}

export function shouldRetryTeacherError(errorClass: string | undefined, attempt: number, maxRetries: number) {
  if (!errorClass || attempt > maxRetries) {
    return false;
  }
  return errorClass === "rate_limited" || errorClass === "timeout" || errorClass === "provider_unavailable";
}

export function getMinRequestIntervalMs(maxRequestsPerMinute: number) {
  return Math.ceil(60_000 / Math.max(1, maxRequestsPerMinute));
}

export function getRemainingDailyBudget(dailyTokenBudget: number, usage: TeacherUsageState) {
  return Math.max(0, dailyTokenBudget - usage.tokensUsed);
}

export function applyTeacherUsage(
  usage: TeacherUsageState,
  input: { tokens: number; errorClass?: string; now?: Date; cooldownMs?: number }
) {
  const now = input.now ?? new Date();
  usage.tokensUsed += Math.max(0, Math.floor(input.tokens));
  usage.requests += 1;
  usage.lastRequestAt = now.toISOString();
  usage.lastErrorClass = input.errorClass ?? null;
  usage.lastErrorAt = input.errorClass ? now.toISOString() : null;
  if (input.errorClass === "rate_limited") {
    const cooldownMs = Math.max(1000, input.cooldownMs ?? 30_000);
    usage.cooldownUntil = new Date(now.getTime() + cooldownMs).toISOString();
  } else {
    usage.cooldownUntil = null;
  }
}

