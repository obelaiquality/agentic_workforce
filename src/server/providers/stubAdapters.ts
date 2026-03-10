import { prisma } from "../db";
import type {
  CreateSessionInput,
  LlmProviderAdapter,
  ProviderAvailability,
  ProviderErrorClass,
  ProviderSendInput,
  ProviderSendOutput,
  ProviderSession,
  ProviderStreamEvent,
  ReasoningMode,
} from "../../shared/contracts";
import { resolveOnPremQwenModelPlugin } from "./modelPlugins";

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
    const config = await this.resolveConfig();
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

    const baseUrl = normalizeBaseUrl(
      toStringOrNull(value.baseUrl) || this.defaults.baseUrl
    );

    const apiKey = toStringOrNull(value.apiKey) ?? this.defaults.apiKey;
    const pluginId = toStringOrNull(value.pluginId) ?? this.defaults.pluginId;
    const inferenceBackendId = toStringOrNull(value.inferenceBackendId) ?? this.defaults.inferenceBackendId;

    return {
      baseUrl,
      apiKey,
      model: toStringOrNull(value.model) || this.defaults.model,
      timeoutMs: Math.max(5000, toNumber(value.timeoutMs, this.defaults.timeoutMs)),
      temperature: Math.min(1.5, Math.max(0, toNumber(value.temperature, this.defaults.temperature))),
      maxTokens: Math.max(64, Math.floor(toNumber(value.maxTokens, this.defaults.maxTokens))),
      pluginId,
      inferenceBackendId,
      reasoningMode: (toStringOrNull(value.reasoningMode) as ReasoningMode | null) ?? this.defaults.reasoningMode,
    };
  }

  protected async buildRequestBody(input: ProviderSendInput) {
    const config = await this.resolveConfig();
    const overrideModel = toStringOrNull(input.metadata?.model);
    const overrideTemperature = toNumber(input.metadata?.temperature, config.temperature);
    const overrideMaxTokens = Math.max(64, Math.floor(toNumber(input.metadata?.maxTokens, config.maxTokens)));
    return {
      config,
      body: {
        model: overrideModel || config.model,
        messages: buildPromptMessages(input.messages),
        temperature: overrideTemperature,
        max_tokens: overrideMaxTokens,
        stream: false,
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
    };
  }

  async *stream(input: ProviderSendInput): AsyncGenerator<ProviderStreamEvent> {
    const output = await this.send(input);
    const text = output.text || "";
    if (!text) {
      yield { type: "done", usage: output.usage };
      return;
    }

    const chunkSize = 56;
    for (let i = 0; i < text.length; i += chunkSize) {
      yield {
        type: "token",
        value: text.slice(i, i + chunkSize),
      };
    }

    yield {
      type: "done",
      usage: output.usage,
    };
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

  protected override async buildRequestBody(input: ProviderSendInput) {
    const config = await this.resolveConfig();
    const plugin = resolveOnPremQwenModelPlugin(config.pluginId || undefined);
    const model = toStringOrNull(input.metadata?.model) || config.model || plugin.runtimeModel;
    const temperature = Math.min(1.5, Math.max(0, toNumber(input.metadata?.temperature, config.temperature)));
    const maxTokens = Math.max(64, Math.floor(toNumber(input.metadata?.maxTokens, config.maxTokens)));
    const isQwen35Family = /qwen3\.5/i.test(model);
    const requestedReasoningMode = (toStringOrNull(input.metadata?.reasoningMode) as ReasoningMode | null) ?? config.reasoningMode ?? "off";
    const effectiveReasoningMode =
      requestedReasoningMode === "auto" ? (input.modelRole === "review_deep" ? "on" : "off") : requestedReasoningMode;

    return {
      config,
      body: {
        model,
        messages: buildPromptMessages(input.messages),
        temperature,
        max_tokens: maxTokens,
        stream: false,
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
