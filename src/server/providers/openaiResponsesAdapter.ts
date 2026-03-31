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
} from "../../shared/contracts";
import { PROVIDER_SECRET_NAMES, resolveSecretValue } from "../services/secretStore";

interface OpenAiResponsesConfig {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  timeoutMs: number;
  reasoningEffort: "low" | "medium" | "high";
}

function reasoningEffortForRole(modelRole: ProviderSendInput["modelRole"]): OpenAiResponsesConfig["reasoningEffort"] {
  switch (modelRole) {
    case "utility_fast":
      return "low";
    case "coder_default":
      return "low";
    case "review_deep":
      return "medium";
    case "overseer_escalation":
      return "high";
    default:
      return "medium";
  }
}

function toStringOrNull(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
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

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function buildTranscript(messages: ProviderSendInput["messages"]) {
  return messages
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join("\n\n");
}

function extractResponseText(payload: Record<string, unknown>) {
  const outputText = payload.output_text;
  if (typeof outputText === "string" && outputText.trim()) {
    return outputText;
  }

  const output = Array.isArray(payload.output) ? payload.output : [];
  const chunks: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const itemRecord = item as Record<string, unknown>;
    const content = Array.isArray(itemRecord.content) ? itemRecord.content : [];
    for (const contentItem of content) {
      if (!contentItem || typeof contentItem !== "object") {
        continue;
      }
      const contentRecord = contentItem as Record<string, unknown>;
      if (typeof contentRecord.text === "string") {
        chunks.push(contentRecord.text);
        continue;
      }
      if (contentRecord.text && typeof contentRecord.text === "object") {
        const nested = contentRecord.text as Record<string, unknown>;
        if (typeof nested.value === "string") {
          chunks.push(nested.value);
        }
      }
    }
  }

  return chunks.join("").trim();
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readSseStream(response: Response, onEvent: (event: Record<string, unknown>) => void) {
  if (!response.body) {
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";

    for (const part of parts) {
      const lines = part
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const dataLines = lines.filter((line) => line.startsWith("data:"));
      for (const line of dataLines) {
        const raw = line.slice(5).trim();
        if (!raw || raw === "[DONE]") {
          continue;
        }
        try {
          onEvent(JSON.parse(raw) as Record<string, unknown>);
        } catch {
          // Ignore malformed chunks and continue parsing the stream.
        }
      }
    }
  }
}

export class OpenAiResponsesAdapter implements LlmProviderAdapter {
  id = "openai-responses" as const;
  label = "OpenAI Responses";
  capabilities = {
    streaming: true,
    tools: true,
    nativeConversationState: true,
    structuredOutputs: true,
    mcpTools: true,
  } as const;
  supportsStreaming = true;
  supportsTools = true;

  private async resolveConfig(): Promise<OpenAiResponsesConfig> {
    const row = await prisma.appSetting.findUnique({ where: { key: "openai_responses_config" } });
    const value = (row?.value as Record<string, unknown> | null) || {};
    const resolvedApiKey = await resolveSecretValue(
      prisma,
      PROVIDER_SECRET_NAMES.openAiResponsesApiKey,
      process.env.OPENAI_API_KEY,
    );

    return {
      baseUrl: normalizeBaseUrl(toStringOrNull(value.baseUrl) || process.env.OPENAI_RESPONSES_BASE_URL || "https://api.openai.com/v1"),
      apiKey: resolvedApiKey.value || toStringOrNull(process.env.OPENAI_API_KEY),
      model: toStringOrNull(value.model) || process.env.OPENAI_RESPONSES_MODEL || "gpt-5-nano",
      timeoutMs: Math.max(5000, toNumber(value.timeoutMs, Number(process.env.OPENAI_RESPONSES_TIMEOUT_MS || 120000))),
      reasoningEffort: ((toStringOrNull(value.reasoningEffort) || process.env.OPENAI_RESPONSES_REASONING_EFFORT || "medium") as OpenAiResponsesConfig["reasoningEffort"]),
    };
  }

  async createSession(input: CreateSessionInput): Promise<ProviderSession> {
    const config = await this.resolveConfig();
    return {
      id: input.sessionId,
      provider: this.id,
      accountId: "openai-api",
      model: config.model,
      previousResponseId: null,
      capabilities: this.capabilities,
      metadata: input.metadata,
    };
  }

  private async buildRequest(input: ProviderSendInput, stream: boolean) {
    const config = await this.resolveConfig();
    if (!config.apiKey) {
      throw new Error("OpenAI Responses API key is not configured");
    }

    const metadata = (input.metadata || {}) as Record<string, unknown>;
    const systemMessages = input.messages.filter((message) => message.role === "system").map((message) => message.content.trim()).filter(Boolean);
    const conversation = input.messages.filter((message) => message.role !== "system");
    const previousResponseId = toStringOrNull(metadata.previousResponseId);
    const model = toStringOrNull(metadata.model) || config.model;
    const reasoningEffort =
      (toStringOrNull(metadata.reasoningEffort) as OpenAiResponsesConfig["reasoningEffort"] | null) ||
      reasoningEffortForRole(input.modelRole) ||
      config.reasoningEffort;

    return {
      config,
      body: {
        model,
        input: buildTranscript(conversation),
        instructions: systemMessages.length ? systemMessages.join("\n\n") : undefined,
        previous_response_id: previousResponseId || undefined,
        reasoning: {
          effort: reasoningEffort,
        },
        stream,
      },
    };
  }

  async send(input: ProviderSendInput): Promise<ProviderSendOutput> {
    const { config, body } = await this.buildRequest(input, false);
    const response = await fetchWithTimeout(
      `${config.baseUrl}/responses`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
      },
      config.timeoutMs
    );

    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`openai-responses provider error ${response.status}: ${raw}`);
    }

    const json = JSON.parse(raw) as Record<string, unknown>;
    const usage = (json.usage as Record<string, unknown> | undefined) || {};
    const text = extractResponseText(json);
    const responseId = typeof json.id === "string" ? json.id : null;

    return {
      text,
      providerResponseId: responseId,
      session: {
        provider: this.id,
        model: typeof body.model === "string" ? body.model : config.model,
        previousResponseId: responseId,
      },
      metadata: {
        responseId,
      },
      usage: {
        inputTokens: toNumber(usage.input_tokens, 0),
        outputTokens: toNumber(usage.output_tokens, 0),
        totalTokens: toNumber(usage.total_tokens, 0),
      },
    };
  }

  async *stream(input: ProviderSendInput): AsyncGenerator<ProviderStreamEvent> {
    const { config, body } = await this.buildRequest(input, true);
    const response = await fetchWithTimeout(
      `${config.baseUrl}/responses`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
      },
      config.timeoutMs
    );

    if (!response.ok) {
      const raw = await response.text();
      throw new Error(`openai-responses provider error ${response.status}: ${raw}`);
    }

    if (!response.body) {
      const output = await this.send(input);
      if (output.session) {
        yield { type: "session", session: output.session };
      }
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
    let responseId: string | null = null;
    let fallbackText = "";
    let emittedTokens = false;

    // Per-chunk timeout to detect stalled streams
    const chunkTimeoutMs = Math.max(config.timeoutMs, 60000);
    const readWithTimeout = async () => {
      return Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          setTimeout(
            () => reject(new Error(`Stream stalled: no data received for ${chunkTimeoutMs}ms`)),
            chunkTimeoutMs,
          );
        }),
      ]);
    };

    try {
    while (true) {
      const { done, value } = await readWithTimeout();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";

      for (const part of parts) {
        const lines = part
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);

        const dataLines = lines.filter((line) => line.startsWith("data:"));
        for (const line of dataLines) {
          const raw = line.slice(5).trim();
          if (!raw || raw === "[DONE]") {
            continue;
          }

          let event: Record<string, unknown>;
          try {
            event = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            continue;
          }

          const type = typeof event.type === "string" ? event.type : "";
          const responsePayload =
            event.response && typeof event.response === "object"
              ? (event.response as Record<string, unknown>)
              : null;

          if (responsePayload && typeof responsePayload.id === "string") {
            responseId = responsePayload.id;
          }

          if ((type.includes("output_text.delta") || type.endsWith("delta")) && typeof event.delta === "string") {
            emittedTokens = true;
            yield { type: "token", value: event.delta };
            continue;
          }

          if (!emittedTokens && responsePayload) {
            const extracted = extractResponseText(responsePayload);
            if (extracted) {
              fallbackText = extracted;
            }
          }

          if ((type.includes("completed") || type.includes("done")) && responsePayload) {
            const usagePayload = (responsePayload.usage as Record<string, unknown> | undefined) || {};
            usage = {
              inputTokens: toNumber(usagePayload.input_tokens, 0),
              outputTokens: toNumber(usagePayload.output_tokens, 0),
              totalTokens: toNumber(usagePayload.total_tokens, 0),
            };
          }
        }
      }
    }

    } finally {
      reader.releaseLock();
    }

    if (!emittedTokens && fallbackText) {
      yield { type: "token", value: fallbackText };
    }

    if (responseId) {
      yield {
        type: "session",
        session: {
          provider: "openai-responses",
          model: typeof body.model === "string" ? body.model : config.model,
          previousResponseId: responseId,
        },
      };
    }

    yield {
      type: "done",
      usage,
    };
  }

  classifyError(err: unknown): ProviderErrorClass {
    const message = err instanceof Error ? err.message : String(err);

    if (/401|403|unauthorized|forbidden|invalid api key|auth/i.test(message)) {
      return "auth_required";
    }
    if (/429|rate limit|quota|insufficient_quota|too many requests/i.test(message)) {
      return "rate_limited";
    }
    if (/timeout|timed out|abort/i.test(message)) {
      return "timeout";
    }
    if (/5\d\d|fetch failed|ECONNREFUSED|ENOTFOUND|unreachable/i.test(message)) {
      return "provider_unavailable";
    }
    return "unknown";
  }

  async estimateAvailability(accountId: string): Promise<ProviderAvailability> {
    const config = await this.resolveConfig();
    if (!config.apiKey) {
      return {
        accountId,
        state: "auth_required",
        nextUsableAt: null,
        confidence: 1,
      };
    }

    try {
      const response = await fetchWithTimeout(
        `${config.baseUrl}/models`,
        {
          method: "GET",
          headers: {
            authorization: `Bearer ${config.apiKey}`,
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
          confidence: 0.8,
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
