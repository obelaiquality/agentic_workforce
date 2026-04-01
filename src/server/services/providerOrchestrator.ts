import type {
  LlmProviderAdapter,
  ModelRole,
  ModelRoleBinding,
  ProviderDescriptor,
  ProviderId,
  ProviderSendInput,
  ProviderSession,
} from "../../shared/contracts";
import { prisma } from "../db";
import { publishEvent } from "../eventBus";
import { ProviderFactory } from "../providers/factory";
import { estimateNextUsableAt } from "./quotaEstimator";
import { emergencyCompact, type CompactionMessage } from "./contextCompactionService";
import { ModelInferenceError, shortErrorStack } from "../errors";
import {
  createDetectorState,
  recordObservation,
  detectBreak,
  resetBaseline,
  markCompaction,
  type CacheBreakDetectorState,
} from "./promptCacheBreakDetector";

/** Query source classification for retry behavior. */
export type QuerySource = "execution" | "verification" | "context_building" | "reporting";

/** Foreground sources retry on capacity errors; background sources bail immediately. */
const FOREGROUND_SOURCES = new Set<QuerySource>(["execution", "verification", "context_building"]);

const BASE_RETRY_DELAY_MS = 500;
const MAX_RETRIES = 3;

export function isContextOverflowError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes("prompt_too_long") ||
      msg.includes("context_length_exceeded") ||
      msg.includes("maximum context length") ||
      msg.includes("context window") ||
      msg.includes("too many tokens")
    );
  }
  return false;
}

export function isTransientCapacityError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes("rate_limit") ||
      msg.includes("429") ||
      msg.includes("529") ||
      msg.includes("overloaded") ||
      msg.includes("capacity")
    );
  }
  return false;
}

export function isStaleConnectionError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message;
    return msg.includes("ECONNRESET") || msg.includes("EPIPE") || msg.includes("socket hang up");
  }
  return false;
}

/** Exponential backoff with jitter to avoid thundering herd. */
export function retryDelayMs(attempt: number): number {
  const exponential = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
  const jitter = Math.random() * BASE_RETRY_DELAY_MS;
  return Math.min(exponential + jitter, 30000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Enforces the blueprint's escalation policy before allowing `overseer_escalation`.
 * Returns the effective model role — may downgrade to `review_deep` if policy forbids escalation.
 */
export function applyEscalationPolicy(
  requestedRole: ModelRole,
  escalationPolicy: "manual" | "high_risk_only" | "auto" | undefined,
  riskLevel?: "low" | "medium" | "high",
): ModelRole {
  if (requestedRole !== "overseer_escalation") {
    return requestedRole;
  }

  const policy = escalationPolicy ?? "high_risk_only";

  if (policy === "auto") {
    return "overseer_escalation";
  }

  if (policy === "high_risk_only" && riskLevel === "high") {
    return "overseer_escalation";
  }

  // "manual" always blocks auto-escalation; "high_risk_only" blocks when risk isn't high
  return "review_deep";
}

interface StreamResult {
  text: string;
  accountId: string;
  providerId: ProviderId;
  session?: Partial<ProviderSession>;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

export class ProviderOrchestrator {
  private cacheBreakState: CacheBreakDetectorState = createDetectorState();

  constructor(private readonly factory: ProviderFactory) {}

  getProviderAdapter(providerId: ProviderId) {
    return this.factory.resolve(providerId);
  }

  async checkProviderHealth(providerId: ProviderId) {
    if (providerId === "qwen-cli") {
      const enabled = await prisma.providerAccount.count({
        where: {
          providerId: "qwen-cli",
          enabled: true,
        },
      });
      return {
        ok: enabled > 0,
        reason: enabled > 0 ? "provider health check passed" : "No enabled Qwen CLI account profile is configured.",
      };
    }

    const adapter = this.factory.resolve(providerId);
    const availability = await adapter.estimateAvailability("health-check");
    return {
      ok: availability.state === "ready",
      reason:
        availability.state === "ready"
          ? "provider health check passed"
          : `Provider reported state '${availability.state}'`,
    };
  }

  async listProviders(): Promise<{ activeProvider: ProviderId; providers: ProviderDescriptor[] }> {
    const activeProvider = await this.getActiveProvider();

    const providers = this.factory.list().map((adapter) => ({
      id: adapter.id,
      label: adapter.label,
      supportsStreaming: adapter.supportsStreaming,
      supportsTools: adapter.supportsTools,
      enabled: true,
      kind: adapter.id === "openai-responses" ? "cloud" : "local",
      capabilities: adapter.capabilities,
    }));

    return {
      activeProvider,
      providers,
    };
  }

  async getActiveProvider(): Promise<ProviderId> {
    const value = await prisma.appSetting.findUnique({ where: { key: "active_provider" } });
    const provider = typeof value?.value === "string" ? (value.value as ProviderId) : "onprem-qwen";
    return provider;
  }

  async setActiveProvider(providerId: ProviderId) {
    this.factory.resolve(providerId);

    await prisma.appSetting.upsert({
      where: { key: "active_provider" },
      update: { value: providerId },
      create: { key: "active_provider", value: providerId },
    });

    await prisma.auditEvent.create({
      data: {
        actor: "user",
        eventType: "provider.switched",
        payload: { providerId },
      },
    });
  }

  async getModelRoleBindings(): Promise<Record<ModelRole, ModelRoleBinding>> {
    const row = await prisma.appSetting.findUnique({ where: { key: "model_role_bindings" } });
    const value = (row?.value as Record<string, unknown> | null) || {};

    return {
      utility_fast: (value.utility_fast as ModelRoleBinding) ?? {
        role: "utility_fast",
        providerId: "onprem-qwen",
        pluginId: "qwen3.5-0.8b",
        model: "Qwen/Qwen3.5-0.8B",
        temperature: 0.1,
        maxTokens: 900,
        reasoningMode: "off",
      },
      coder_default: (value.coder_default as ModelRoleBinding) ?? {
        role: "coder_default",
        providerId: "onprem-qwen",
        pluginId: "qwen3.5-4b",
        model: "mlx-community/Qwen3.5-4B-4bit",
        temperature: 0.12,
        maxTokens: 1800,
        reasoningMode: "off",
      },
      review_deep: (value.review_deep as ModelRoleBinding) ?? {
        role: "review_deep",
        providerId: "onprem-qwen",
        pluginId: "qwen3.5-4b",
        model: "mlx-community/Qwen3.5-4B-4bit",
        temperature: 0.08,
        maxTokens: 2200,
        reasoningMode: "on",
      },
      overseer_escalation: (value.overseer_escalation as ModelRoleBinding) ?? {
        role: "overseer_escalation",
        providerId: "openai-responses",
        pluginId: null,
        model: "gpt-5-nano",
        temperature: 0.1,
        maxTokens: 2200,
      },
    };
  }

  async getModelRoleBinding(role: ModelRole) {
    const bindings = await this.getModelRoleBindings();
    return bindings[role];
  }

  async listQwenAccounts() {
    const now = new Date();

    await prisma.providerAccount.updateMany({
      where: {
        providerId: "qwen-cli",
        state: "cooldown",
        cooldownUntil: {
          lte: now,
        },
      },
      data: {
        state: "ready",
      },
    });

    return prisma.providerAccount.findMany({
      where: { providerId: "qwen-cli" },
      orderBy: [{ enabled: "desc" }, { updatedAt: "desc" }],
    });
  }

  async createQwenAccount(input: { label: string; profilePath: string; keychainRef?: string }) {
    const account = await prisma.providerAccount.create({
      data: {
        providerId: "qwen-cli",
        label: input.label,
        profilePath: input.profilePath,
        keychainRef: input.keychainRef,
      },
    });

    await prisma.providerAccountEvent.create({
      data: {
        accountId: account.id,
        type: "account.created",
        payload: { profilePath: account.profilePath },
      },
    });

    return account;
  }

  async updateQwenAccount(
    accountId: string,
    patch: Partial<{ label: string; profilePath: string; enabled: boolean; state: "ready" | "cooldown" | "auth_required" | "disabled" }>
  ) {
    const nextState = patch.enabled === false ? "disabled" : patch.state;

    const account = await prisma.providerAccount.update({
      where: { id: accountId },
      data: {
        label: patch.label,
        profilePath: patch.profilePath,
        enabled: patch.enabled,
        state: nextState,
      },
    });

    await prisma.providerAccountEvent.create({
      data: {
        accountId: account.id,
        type: "account.updated",
        payload: patch,
      },
    });

    return account;
  }

  async markQwenAccountReauthed(accountId: string) {
    const account = await prisma.providerAccount.update({
      where: { id: accountId },
      data: {
        state: "ready",
        enabled: true,
        cooldownUntil: null,
      },
    });

    await prisma.providerAccountEvent.create({
      data: {
        accountId: account.id,
        type: "account.reauthed",
        payload: {},
      },
    });

    publishEvent("global", "account.recovered", { accountId: account.id, reason: "manual_reauth" });

    return account;
  }

  async getQwenQuotaOverview() {
    const accounts = await this.listQwenAccounts();

    return accounts.map((account) => ({
      id: account.id,
      label: account.label,
      state: account.enabled ? account.state : "disabled",
      cooldownUntil: account.cooldownUntil?.toISOString() ?? null,
      quotaNextUsableAt: account.quotaNextUsableAt?.toISOString() ?? null,
      quotaEtaConfidence: account.quotaEtaConfidence,
      lastQuotaErrorAt: account.lastQuotaErrorAt?.toISOString() ?? null,
      lastUsedAt: account.lastUsedAt?.toISOString() ?? null,
    }));
  }

  private async ensureOpenAiBudget(providerId: ProviderId) {
    if (providerId !== "openai-responses") {
      return;
    }

    const configRow = await prisma.appSetting.findUnique({ where: { key: "openai_responses_config" } });
    const config = (configRow?.value as Record<string, unknown> | null) || {};
    const dailyBudgetUsd = typeof config.dailyBudgetUsd === "number" ? config.dailyBudgetUsd : 25;
    const budget = await prisma.providerBudgetProjection.findFirst({
      where: { providerId: "openai-responses" },
    });
    if (budget?.cooldownUntil && budget.cooldownUntil.getTime() > Date.now()) {
      throw new Error(`OpenAI Responses provider is cooling down until ${budget.cooldownUntil.toISOString()}`);
    }
    if (dailyBudgetUsd > 0 && (budget?.usedUsd ?? 0) >= dailyBudgetUsd) {
      throw new Error("OpenAI Responses daily budget exhausted");
    }
  }

  private async recordProviderUsage(
    providerId: ProviderId,
    usage: StreamResult["usage"],
    metadata: Record<string, unknown> = {}
  ) {
    if (providerId !== "openai-responses") {
      return;
    }

    const current = await prisma.providerBudgetProjection.findFirst({
      where: { providerId: "openai-responses" },
    });
    const configRow = await prisma.appSetting.findUnique({ where: { key: "openai_responses_config" } });
    const config = (configRow?.value as Record<string, unknown> | null) || {};
    const dailyBudgetUsd = typeof config.dailyBudgetUsd === "number" ? config.dailyBudgetUsd : 25;
    const estimatedUsd =
      typeof metadata.estimatedUsd === "number" && Number.isFinite(metadata.estimatedUsd)
        ? metadata.estimatedUsd
        : 0;

    const usedUsd = (current?.usedUsd ?? 0) + estimatedUsd;
    const requestCount = (current?.requestCount ?? 0) + 1;
    const cooldownUntil =
      dailyBudgetUsd > 0 && usedUsd >= dailyBudgetUsd ? new Date(Date.now() + 60 * 60 * 1000) : current?.cooldownUntil ?? null;

    await prisma.providerBudgetProjection.upsert({
      where: { providerId: "openai-responses" },
      update: {
        usedUsd,
        dailyBudgetUsd,
        requestCount,
        cooldownUntil,
        metadata: {
          ...(current?.metadata as Record<string, unknown> | undefined),
          ...metadata,
          usage,
          lastRequestAt: new Date().toISOString(),
        },
      },
      create: {
        providerId: "openai-responses",
        usedUsd,
        dailyBudgetUsd,
        requestCount,
        cooldownUntil,
        metadata: {
          ...metadata,
          usage,
          lastRequestAt: new Date().toISOString(),
        },
      },
    });

    publishEvent("global", "provider.escalated", {
      providerId,
      usage,
      ...metadata,
    });
  }

  async streamChat(
    sessionId: string,
    messages: ProviderSendInput["messages"],
    onToken: (token: string) => void,
    options?: {
      providerId?: ProviderId;
      modelRole?: ModelRole;
      metadata?: Record<string, unknown>;
    }
  ): Promise<StreamResult> {
    const roleBinding = options?.modelRole ? await this.getModelRoleBinding(options.modelRole) : null;
    const providerId = options?.providerId || roleBinding?.providerId || (await this.getActiveProvider());
    const adapter = this.factory.resolve(providerId);

    await this.ensureOpenAiBudget(providerId);

    if (providerId !== "qwen-cli") {
      const outputEvents = adapter.stream({
        sessionId,
        accountId: "",
        messages,
        modelRole: options?.modelRole,
        metadata: {
          ...(roleBinding
            ? {
                model: roleBinding.model,
                temperature: roleBinding.temperature,
                maxTokens: roleBinding.maxTokens,
                reasoningMode: roleBinding.reasoningMode,
              }
            : {}),
          ...(options?.metadata || {}),
        },
      });
      const chunks: string[] = [];
      let session: Partial<ProviderSession> | undefined;
      let usage: StreamResult["usage"];

      for await (const event of outputEvents) {
        if (event.type === "token") {
          chunks.push(event.value);
          onToken(event.value);
        }
        if (event.type === "session") {
          session = {
            ...session,
            ...event.session,
          };
        }
        if (event.type === "done") {
          usage = event.usage;
        }
      }

      const text = chunks.join("").trim();
      await this.recordProviderUsage(providerId, usage, {
        sessionId,
        modelRole: options?.modelRole || null,
        previousResponseId: session?.previousResponseId || null,
      });

      // Record cache observation for break detection
      if (usage) {
        const cacheReadTokens = (usage as Record<string, unknown>).cacheReadInputTokens as number | undefined;
        if (cacheReadTokens !== undefined) {
          recordObservation(this.cacheBreakState, cacheReadTokens);
          const breakEvent = detectBreak(this.cacheBreakState, cacheReadTokens);
          if (breakEvent) {
            publishEvent("global", "cache.break.detected", breakEvent);
          }
        }
      }

      return {
        text,
        accountId: "",
        providerId,
        session,
        usage,
      };
    }

    const attemptedAccounts = new Set<string>();
    let retryFromAccountId: string | null = null;

    while (true) {
      const account = await this.pickNextQwenAccount(attemptedAccounts);
      if (!account) {
        throw new Error("No ready Qwen CLI account is available. Re-authenticate or wait for cooldown reset.");
      }

      if (retryFromAccountId && retryFromAccountId !== account.id) {
        await prisma.providerAccountEvent.create({
          data: {
            accountId: retryFromAccountId,
            type: "account.switched",
            payload: {
              fromAccountId: retryFromAccountId,
              toAccountId: account.id,
              sessionId,
            },
          },
        });

        publishEvent("global", "account.switched", {
          providerId,
          sessionId,
          fromAccountId: retryFromAccountId,
          toAccountId: account.id,
        });
        publishEvent(`session:${sessionId}`, "account.switched", {
          providerId,
          sessionId,
          fromAccountId: retryFromAccountId,
          toAccountId: account.id,
        });
      }

      attemptedAccounts.add(account.id);

      try {
        const stream = (adapter as LlmProviderAdapter).stream({
          sessionId,
          accountId: account.id,
          messages,
        });

        const attemptChunks: string[] = [];

        for await (const event of stream) {
          if (event.type === "token") {
            attemptChunks.push(event.value);
          }
        }

        const rawText = attemptChunks.join("");
        const text = rawText.trim();

        if (rawText) {
          onToken(rawText);
        }

        await prisma.providerUsageSample.create({
          data: {
            accountId: account.id,
            inputTokens: Math.max(1, Math.ceil(messages.map((m) => m.content.length).join("").length / 4)),
            outputTokens: Math.max(1, Math.ceil(text.length / 4)),
            totalTokens: Math.max(1, Math.ceil((text.length + messages.map((m) => m.content.length).join("").length) / 4)),
          },
        });

        const recovered = account.state === "cooldown" || account.state === "auth_required";

        await prisma.providerAccount.update({
          where: { id: account.id },
          data: {
            state: "ready",
            cooldownUntil: null,
            lastUsedAt: new Date(),
          },
        });

        if (recovered) {
          await prisma.providerAccountEvent.create({
            data: {
              accountId: account.id,
              type: "account.recovered",
              payload: { reason: "successful_call" },
            },
          });
          publishEvent("global", "account.recovered", { accountId: account.id, reason: "successful_call" });
        }

        return {
          text,
          accountId: account.id,
          providerId,
          usage: {
            inputTokens: Math.max(1, Math.ceil(messages.map((m) => m.content.length).join("").length / 4)),
            outputTokens: Math.max(1, Math.ceil(text.length / 4)),
            totalTokens: Math.max(1, Math.ceil((text.length + messages.map((m) => m.content.length).join("").length) / 4)),
          },
        };
      } catch (error) {
        const classified = adapter.classifyError(error);

        if (classified === "quota_exhausted" || classified === "rate_limited") {
          const estimate = await estimateNextUsableAt(account.id, new Date());

          await prisma.providerAccount.update({
            where: { id: account.id },
            data: {
              state: "cooldown",
              cooldownUntil: estimate.nextUsableAt,
              quotaNextUsableAt: estimate.nextUsableAt,
              quotaEtaConfidence: estimate.confidence,
              lastQuotaErrorAt: new Date(),
            },
          });

          await prisma.providerAccountEvent.createMany({
            data: [
              {
                accountId: account.id,
                type: "account.exhausted",
                payload: { classified },
              },
              {
                accountId: account.id,
                type: "quota.eta.updated",
                payload: {
                  nextUsableAt: estimate.nextUsableAt.toISOString(),
                  confidence: estimate.confidence,
                },
              },
            ],
          });

          await prisma.providerUsageSample.create({
            data: {
              accountId: account.id,
              errorClass: classified,
            },
          });

          publishEvent("global", "account.exhausted", {
            accountId: account.id,
            providerId,
            reason: classified,
          });

          publishEvent("global", "quota.eta.updated", {
            accountId: account.id,
            nextUsableAt: estimate.nextUsableAt.toISOString(),
            confidence: estimate.confidence,
          });

          retryFromAccountId = account.id;
          continue;
        }

        if (classified === "auth_required") {
          await prisma.providerAccount.update({
            where: { id: account.id },
            data: {
              state: "auth_required",
            },
          });

          await prisma.providerAccountEvent.create({
            data: {
              accountId: account.id,
              type: "account.auth_required",
              payload: {},
            },
          });

          retryFromAccountId = account.id;
          continue;
        }

        throw error;
      }
    }
  }

  /**
   * streamChat with retry logic, source classification, and reactive compaction.
   *
   * - Foreground sources (execution, verification, context_building) retry on
   *   transient capacity errors with exponential backoff + jitter.
   * - Background sources (reporting) bail immediately on capacity errors.
   * - Context overflow errors trigger emergency compaction and a single retry.
   * - Stale connection errors (ECONNRESET/EPIPE) get one retry.
   * - After MAX_RETRIES, falls back to overseer_escalation if available.
   */
  async streamChatWithRetry(
    sessionId: string,
    messages: ProviderSendInput["messages"],
    onToken: (token: string) => void,
    options?: {
      providerId?: ProviderId;
      modelRole?: ModelRole;
      metadata?: Record<string, unknown>;
      querySource?: QuerySource;
      maxContextTokens?: number;
    },
  ): Promise<StreamResult> {
    const source = options?.querySource ?? "execution";
    const isForeground = FOREGROUND_SOURCES.has(source);
    let lastError: unknown;
    let staleRetried = false;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this.streamChat(sessionId, messages, onToken, options);
      } catch (error) {
        lastError = error;

        // Context overflow → emergency compact and retry once
        if (isContextOverflowError(error) && options?.maxContextTokens) {
          const compactionMessages: CompactionMessage[] = messages.map((m) => ({
            role: m.role as "system" | "user" | "assistant",
            content: m.content,
          }));
          const compacted = emergencyCompact(compactionMessages, options.maxContextTokens);
          const compactedMessages = compacted.messages.map((m) => ({
            role: m.role,
            content: m.content,
          }));

          publishEvent("global", "compaction.reactive", {
            sessionId,
            tokensBefore: compacted.tokensBefore,
            tokensAfter: compacted.tokensAfter,
            stage: compacted.stage,
          });

          markCompaction(this.cacheBreakState);

          try {
            const result = await this.streamChat(sessionId, compactedMessages, onToken, options);
            resetBaseline(this.cacheBreakState);
            return result;
          } catch (retryError) {
            lastError = retryError;
            break;
          }
        }

        // Stale connection → single retry without delay
        if (isStaleConnectionError(error) && !staleRetried) {
          staleRetried = true;
          continue;
        }

        // Transient capacity → retry with backoff (foreground only)
        if (isTransientCapacityError(error)) {
          if (!isForeground) break;
          if (attempt < MAX_RETRIES) {
            await sleep(retryDelayMs(attempt));
            continue;
          }
        }

        // Non-retriable error
        break;
      }
    }

    // Fallback: try overseer_escalation if we're not already using it
    if (options?.modelRole !== "overseer_escalation") {
      try {
        publishEvent("global", "provider.fallback", {
          sessionId,
          originalRole: options?.modelRole ?? null,
          reason: lastError instanceof Error ? lastError.message : "max_retries",
        });
        return await this.streamChat(sessionId, messages, onToken, {
          ...options,
          modelRole: "overseer_escalation",
        });
      } catch (e) {
        publishEvent("global", "provider.fallback.failed", { sessionId, error: String(e) });
      }
    }

    const providerId = options?.providerId ?? "unknown";
    const errorMsg = lastError instanceof Error ? lastError.message : String(lastError);
    throw new ModelInferenceError(
      `Inference failed after retries: ${errorMsg}`,
      providerId,
      options?.modelRole,
    );
  }

  private async pickNextQwenAccount(exclude: Set<string>) {
    const now = new Date();

    await prisma.providerAccount.updateMany({
      where: {
        providerId: "qwen-cli",
        state: "cooldown",
        cooldownUntil: {
          lte: now,
        },
      },
      data: {
        state: "ready",
        cooldownUntil: null,
      },
    });

    return prisma.providerAccount.findFirst({
      where: {
        id: {
          notIn: Array.from(exclude),
        },
        providerId: "qwen-cli",
        enabled: true,
        state: "ready",
      },
      orderBy: [{ lastUsedAt: "asc" }, { updatedAt: "asc" }],
    });
  }
}
