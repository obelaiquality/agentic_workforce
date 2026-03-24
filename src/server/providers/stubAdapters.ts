import { prisma } from "../db";
import type {
  CreateSessionInput,
  LlmProviderAdapter,
  ModelRole,
  ProviderAvailability,
  ProviderErrorClass,
  ProviderSendInput,
  ProviderSendOutput,
  ProviderSession,
  ProviderStreamEvent,
  ReasoningMode,
} from "../../shared/contracts";
import { resolveOnPremQwenModelPlugin } from "./modelPlugins";
import { resolveOnPremInferenceBackend } from "./inferenceBackends";
import { PROVIDER_SECRET_NAMES, resolveSecretValue } from "../services/secretStore";

interface OpenAiLikeConfig {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  timeoutMs: number;
  temperature: number;
  maxTokens: number;
  pluginId: string | null;
  inferenceBackendId: string | null;
  reasoningMode: ReasoningMode | null;
}

type RoleScopedOnPremRuntime = Partial<OpenAiLikeConfig> & {
  enabled?: boolean;
};

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function toNumber(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function toStringOrNull(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function buildPromptMessages(messages: ProviderSendInput["messages"]) {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

function extractAssistantText(payload: Record<string, unknown>) {
  const choice = Array.isArray(payload.choices) ? payload.choices[0] : null;
  if (!choice || typeof choice !== "object" || !("message" in choice)) {
    return "";
  }

  const message = (choice as Record<string, unknown>).message;
  if (!message || typeof message !== "object") {
    return "";
  }

  const content = (message as Record<string, unknown>).content;
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (!item || typeof item !== "object") {
          return "";
        }
        const text = (item as Record<string, unknown>).text;
        return typeof text === "string" ? text : "";
      })
      .join("");
  }

  return "";
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function extractCacheHit(response: Response, body: Record<string, unknown>): boolean | null {
  const cacheHeader = response.headers.get("x-cache-hit");
  if (cacheHeader !== null) {
    return cacheHeader === "true" || cacheHeader === "1";
  }

  const tokensCached = (body as { tokens_cached?: unknown }).tokens_cached;
  if (typeof tokensCached === "number") {
    return tokensCached > 0;
  }

  return null;
}

abstract class BaseOpenAiLikeAdapter implements LlmProviderAdapter {
  abstract id: "openai-compatible" | "onprem-qwen";
  abstract label: string;
  protected abstract settingKey: string;
  protected abstract defaults: OpenAiLikeConfig;
  capabilities = {
    streaming: true,
    tools: true,
    nativeConversationState: false,
    structuredOutputs: false,
    mcpTools: false,
  } as const;

  supportsStreaming = true;
  supportsTools = true;

  async createSession(input: CreateSessionInput): Promise<ProviderSession> {
    const config = await this.resolveConfigForContext({
      modelRole: input.modelRole,
      metadata: input.metadata,
    });
    return {
      id: input.sessionId,
      provider: this.id,
      accountId: "",
      model: config.model,
      capabilities: this.capabilities,
    };
  }

  protected async resolveConfig(): Promise<OpenAiLikeConfig> {
    const row = await prisma.appSetting.findUnique({ where: { key: this.settingKey } });
    const value = (row?.value as Record<string, unknown> | null) || {};
    const secretName =
      this.id === "onprem-qwen"
        ? PROVIDER_SECRET_NAMES.onPremQwenApiKey
        : PROVIDER_SECRET_NAMES.openAiCompatibleApiKey;
    const resolvedApiKey = await resolveSecretValue(
      prisma,
      secretName,
      this.defaults.apiKey ?? "",
    );

    const baseUrl = normalizeBaseUrl(
      toStringOrNull(value.baseUrl) || this.defaults.baseUrl
    );

    const pluginId = toStringOrNull(value.pluginId) ?? this.defaults.pluginId;
    const inferenceBackendId = toStringOrNull(value.inferenceBackendId) ?? this.defaults.inferenceBackendId;

    return {
      baseUrl,
      apiKey: resolvedApiKey.value || this.defaults.apiKey,
      model: toStringOrNull(value.model) || this.defaults.model,
      timeoutMs: Math.max(5000, toNumber(value.timeoutMs, this.defaults.timeoutMs)),
      temperature: Math.min(1.5, Math.max(0, toNumber(value.temperature, this.defaults.temperature))),
      maxTokens: Math.max(64, Math.floor(toNumber(value.maxTokens, this.defaults.maxTokens))),
      pluginId,
      inferenceBackendId,
      reasoningMode: (toStringOrNull(value.reasoningMode) as ReasoningMode | null) ?? this.defaults.reasoningMode,
    };
  }

  protected async resolveConfigForContext(_context?: {
    modelRole?: ModelRole;
    metadata?: Record<string, unknown>;
  }): Promise<OpenAiLikeConfig> {
    return this.resolveConfig();
  }

  protected async buildRequestBody(input: ProviderSendInput, options?: { stream?: boolean }) {
    const config = await this.resolveConfigForContext({
      modelRole: input.modelRole,
      metadata: input.metadata,
    });
    const overrideModel = toStringOrNull(input.metadata?.model);
    const overrideTemperature = toNumber(input.metadata?.temperature, config.temperature);
    const overrideMaxTokens = Math.max(64, Math.floor(toNumber(input.metadata?.maxTokens, config.maxTokens)));
    const jsonMode = input.metadata?.jsonMode === true;
    const backend = resolveOnPremInferenceBackend(config.inferenceBackendId);
    return {
      config,
      body: {
        model: overrideModel || config.model,
        messages: buildPromptMessages(input.messages),
        temperature: overrideTemperature,
        max_tokens: overrideMaxTokens,
        stream: options?.stream ?? false,
        ...(jsonMode && backend.supportsJsonMode
          ? { response_format: { type: "json_object" } }
          : {}),
        ...(backend.id === "llama-cpp-openai" ? { cache_prompt: true } : {}),
      },
    };
  }

  async send(input: ProviderSendInput): Promise<ProviderSendOutput> {
    const { config, body } = await this.buildRequestBody(input);
    const endpoint = `${config.baseUrl}/chat/completions`;
    const response = await fetchWithTimeout(
      endpoint,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
      },
      config.timeoutMs
    );

    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`${this.id} provider error ${response.status}: ${raw}`);
    }

    const json = JSON.parse(raw) as Record<string, unknown>;
    const usage = (json.usage as Record<string, unknown> | undefined) || {};
    const text = extractAssistantText(json).trim();

    const cacheHit = extractCacheHit(response, json);

    return {
      text,
      providerResponseId: null,
      session: {
        provider: this.id,
        model: String(body.model),
      },
      usage: {
        inputTokens: toNumber(usage.prompt_tokens, 0),
        outputTokens: toNumber(usage.completion_tokens, 0),
        totalTokens: toNumber(usage.total_tokens, 0),
      },
      metadata: cacheHit !== null ? { cacheHit } : undefined,
    };
  }

  async *stream(input: ProviderSendInput): AsyncGenerator<ProviderStreamEvent> {
    const { config, body } = await this.buildRequestBody(input, { stream: true });
    const endpoint = `${config.baseUrl}/chat/completions`;

    let response: Response;
    try {
      response = await fetchWithTimeout(
        endpoint,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
          },
          body: JSON.stringify(body),
        },
        config.timeoutMs
      );
    } catch {
      // Network error — fall back to non-streaming send
      const output = await this.send(input);
      if (output.text) {
        yield { type: "token", value: output.text };
      }
      yield { type: "done", usage: output.usage };
      return;
    }

    if (!response.ok) {
      const raw = await response.text();
      throw new Error(`${this.id} provider error ${response.status}: ${raw}`);
    }

    if (!response.body) {
      // No streaming body — fall back to non-streaming send
      const output = await this.send(input);
      if (output.text) {
        yield { type: "token", value: output.text };
      }
      yield { type: "done", usage: output.usage };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let usage: ProviderSendOutput["usage"] | undefined;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(":")) continue;
          if (!trimmed.startsWith("data:")) continue;

          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") {
            yield { type: "done", usage };
            return;
          }

          try {
            const parsed = JSON.parse(data) as Record<string, unknown>;
            const choice = Array.isArray(parsed.choices) ? parsed.choices[0] : null;
            if (choice && typeof choice === "object") {
              const delta = (choice as Record<string, unknown>).delta;
              if (delta && typeof delta === "object") {
                const content = (delta as Record<string, unknown>).content;
                if (typeof content === "string" && content) {
                  yield { type: "token", value: content };
                }
              }
            }

            // Extract usage from the final chunk if present
            const chunkUsage = parsed.usage as Record<string, unknown> | undefined;
            if (chunkUsage) {
              usage = {
                inputTokens: toNumber(chunkUsage.prompt_tokens, 0),
                outputTokens: toNumber(chunkUsage.completion_tokens, 0),
                totalTokens: toNumber(chunkUsage.total_tokens, 0),
              };
            }
          } catch {
            // Skip malformed SSE data lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield { type: "done", usage };
  }

  classifyError(err: unknown): ProviderErrorClass {
    const message = err instanceof Error ? err.message : String(err);

    if (/429|quota|rate limit|too many requests/i.test(message)) {
      return "quota_exhausted";
    }
    if (/401|403|unauthorized|forbidden|auth|token/i.test(message)) {
      return "auth_required";
    }
    if (/timeout|timed out|abort/i.test(message)) {
      return "timeout";
    }
    if (/ECONNREFUSED|ENOTFOUND|unreachable|fetch failed/i.test(message)) {
      return "provider_unavailable";
    }
    return "unknown";
  }

  async estimateAvailability(accountId: string): Promise<ProviderAvailability> {
    const config = await this.resolveConfig();
    const endpoint = `${config.baseUrl}/models`;

    try {
      const response = await fetchWithTimeout(
        endpoint,
        {
          method: "GET",
          headers: {
            ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
          },
        },
        Math.min(config.timeoutMs, 10000)
      );

      if (response.ok) {
        return {
          accountId,
          state: "ready",
          nextUsableAt: null,
          confidence: 1,
        };
      }

      if (response.status === 401 || response.status === 403) {
        return {
          accountId,
          state: "auth_required",
          nextUsableAt: null,
          confidence: 0.7,
        };
      }

      return {
        accountId,
        state: "disabled",
        nextUsableAt: null,
        confidence: 0.2,
      };
    } catch {
      return {
        accountId,
        state: "disabled",
        nextUsableAt: null,
        confidence: 0,
      };
    }
  }
}

function parseRoleScopedOnPremRuntime(value: unknown): RoleScopedOnPremRuntime | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const enabled = typeof record.enabled === "boolean" ? record.enabled : true;

  const runtime: RoleScopedOnPremRuntime = { enabled };

  if (typeof record.baseUrl === "string" && record.baseUrl.trim()) {
    runtime.baseUrl = normalizeBaseUrl(record.baseUrl);
  }
  if (typeof record.model === "string" && record.model.trim()) {
    runtime.model = record.model.trim();
  }
  if (typeof record.pluginId === "string" && record.pluginId.trim()) {
    runtime.pluginId = record.pluginId.trim();
  }
  if (typeof record.inferenceBackendId === "string" && record.inferenceBackendId.trim()) {
    runtime.inferenceBackendId = record.inferenceBackendId.trim();
  }
  if (typeof record.timeoutMs === "number" && Number.isFinite(record.timeoutMs)) {
    runtime.timeoutMs = Math.max(5000, Math.floor(record.timeoutMs));
  }
  if (typeof record.temperature === "number" && Number.isFinite(record.temperature)) {
    runtime.temperature = Math.min(1.5, Math.max(0, record.temperature));
  }
  if (typeof record.maxTokens === "number" && Number.isFinite(record.maxTokens)) {
    runtime.maxTokens = Math.max(64, Math.floor(record.maxTokens));
  }
  if (
    record.reasoningMode === "off" ||
    record.reasoningMode === "on" ||
    record.reasoningMode === "auto"
  ) {
    runtime.reasoningMode = record.reasoningMode;
  }

  return runtime;
}

export function resolveRoleScopedOnPremConfig(
  baseConfig: OpenAiLikeConfig,
  rawRoleConfigs: unknown,
  modelRole?: ModelRole
): OpenAiLikeConfig {
  if (!modelRole || !rawRoleConfigs || typeof rawRoleConfigs !== "object") {
    return baseConfig;
  }

  const entry = (rawRoleConfigs as Record<string, unknown>)[modelRole];
  const runtime = parseRoleScopedOnPremRuntime(entry);
  if (!runtime || runtime.enabled === false) {
    return baseConfig;
  }

  return {
    ...baseConfig,
    baseUrl: runtime.baseUrl ?? baseConfig.baseUrl,
    apiKey: runtime.apiKey ?? baseConfig.apiKey,
    model: runtime.model ?? baseConfig.model,
    timeoutMs: runtime.timeoutMs ?? baseConfig.timeoutMs,
    temperature: runtime.temperature ?? baseConfig.temperature,
    maxTokens: runtime.maxTokens ?? baseConfig.maxTokens,
    pluginId: runtime.pluginId ?? baseConfig.pluginId,
    inferenceBackendId: runtime.inferenceBackendId ?? baseConfig.inferenceBackendId,
    reasoningMode: runtime.reasoningMode ?? baseConfig.reasoningMode,
  };
}

export class OpenAiCompatibleAdapter extends BaseOpenAiLikeAdapter {
  id = "openai-compatible" as const;
  label = "OpenAI-Compatible";
  protected settingKey = "openai_compatible_config";
  protected defaults: OpenAiLikeConfig = {
    baseUrl: normalizeBaseUrl(process.env.OPENAI_COMPAT_BASE_URL || "http://127.0.0.1:11434/v1"),
    apiKey: toStringOrNull(process.env.OPENAI_COMPAT_API_KEY),
    model: process.env.OPENAI_COMPAT_MODEL || "gpt-4o-mini",
    timeoutMs: toNumber(process.env.OPENAI_COMPAT_TIMEOUT_MS, 120000),
    temperature: 0.2,
    maxTokens: 1800,
    pluginId: null,
    inferenceBackendId: null,
    reasoningMode: null,
  };
}

export class OnPremQwenAdapter extends BaseOpenAiLikeAdapter {
  id = "onprem-qwen" as const;
  label = "On-Prem Qwen";
  protected settingKey = "onprem_qwen_config";
  protected defaults: OpenAiLikeConfig = {
    baseUrl: normalizeBaseUrl(process.env.ONPREM_QWEN_BASE_URL || "http://127.0.0.1:8000/v1"),
    apiKey: toStringOrNull(process.env.ONPREM_QWEN_API_KEY),
    model: process.env.ONPREM_QWEN_MODEL || "mlx-community/Qwen3.5-4B-4bit",
    timeoutMs: toNumber(process.env.ONPREM_QWEN_TIMEOUT_MS, 120000),
    temperature: 0.15,
    maxTokens: 1600,
    pluginId: process.env.ONPREM_QWEN_PLUGIN || "qwen3.5-4b",
    inferenceBackendId: process.env.ONPREM_QWEN_INFERENCE_BACKEND || "mlx-lm",
    reasoningMode: ((process.env.ONPREM_QWEN_REASONING_MODE || "off") as ReasoningMode),
  };

  protected override async resolveConfigForContext(context?: {
    modelRole?: ModelRole;
    metadata?: Record<string, unknown>;
  }): Promise<OpenAiLikeConfig> {
    const baseConfig = await super.resolveConfig();
    const row = await prisma.appSetting.findUnique({
      where: { key: "onprem_qwen_role_runtime_configs" },
    });
    const scopedConfig = resolveRoleScopedOnPremConfig(baseConfig, row?.value ?? {}, context?.modelRole);
    if (!context?.modelRole) {
      return scopedConfig;
    }
    const runtimeSecret = await resolveSecretValue(
      prisma,
      PROVIDER_SECRET_NAMES.onPremRoleRuntimeApiKey(context.modelRole),
    );
    return {
      ...scopedConfig,
      apiKey: runtimeSecret.value || scopedConfig.apiKey,
    };
  }

  protected override async buildRequestBody(input: ProviderSendInput, options?: { stream?: boolean }) {
    const config = await this.resolveConfigForContext({
      modelRole: input.modelRole,
      metadata: input.metadata,
    });
    const plugin = resolveOnPremQwenModelPlugin(config.pluginId || undefined);
    const model = toStringOrNull(input.metadata?.model) || config.model || plugin.runtimeModel;
    const temperature = Math.min(1.5, Math.max(0, toNumber(input.metadata?.temperature, config.temperature)));
    const maxTokens = Math.max(64, Math.floor(toNumber(input.metadata?.maxTokens, config.maxTokens)));
    const isQwen35Family = /qwen3\.5/i.test(model);
    const requestedReasoningMode = (toStringOrNull(input.metadata?.reasoningMode) as ReasoningMode | null) ?? config.reasoningMode ?? "off";
    const effectiveReasoningMode =
      requestedReasoningMode === "auto" ? (input.modelRole === "review_deep" ? "on" : "off") : requestedReasoningMode;
    const jsonMode = input.metadata?.jsonMode === true;
    const backend = resolveOnPremInferenceBackend(config.inferenceBackendId);

    return {
      config,
      body: {
        model,
        messages: buildPromptMessages(input.messages),
        temperature,
        max_tokens: maxTokens,
        stream: options?.stream ?? false,
        ...(isQwen35Family
          ? effectiveReasoningMode === "on"
            ? {
                chat_template_kwargs: {
                  enable_thinking: true,
                },
              }
            : {
                chat_template_kwargs: {
                  enable_thinking: false,
                },
                top_k: 20,
              }
          : {}),
        ...(jsonMode && backend.supportsJsonMode
          ? { response_format: { type: "json_object" } }
          : {}),
        ...(backend.id === "llama-cpp-openai" ? { cache_prompt: true } : {}),
        metadata: {
          plugin_id: plugin.id,
          hf_repo: plugin.hfRepo,
          inference_backend_id: config.inferenceBackendId,
          reasoning_mode: effectiveReasoningMode,
        },
      },
    };
  }
}
