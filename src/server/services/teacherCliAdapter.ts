import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { BehaviorSpecV1 } from "../../shared/contracts";
import { scanAndRedactSensitiveText } from "./privacyScanner";

const execFileAsync = promisify(execFile);

interface TeacherCliOptions {
  command: string;
  model: string;
  timeoutMs: number;
}

interface TeacherOutput {
  teacherOutput: string;
  citations: string[];
  model: string;
  usedFallback: boolean;
  usage: {
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
    costUsd: number;
  };
  errorClass?: "rate_limited" | "timeout" | "auth_required" | "provider_unavailable" | "unknown";
  errorMessage?: string;
}

function buildPrompt(spec: BehaviorSpecV1, retrievalContextIds: string[]) {
  return [
    "You are a teacher model creating high-quality coding task demonstrations.",
    "Return concise actionable output following this behavior spec.",
    "Do not output hidden chain-of-thought. Include only final rationale summary and actions.",
    `SPEC_ID: ${spec.specId}`,
    `INTENT: ${spec.intent}`,
    `INPUTS: ${spec.inputs.join(" | ")}`,
    `CONSTRAINTS: ${spec.constraints.join(" | ")}`,
    `REQUIRED_TOOLS: ${spec.requiredTools.join(" | ")}`,
    `REQUIRED_CHECKS: ${spec.requiredChecks.join(" | ")}`,
    `EXPECTED_ARTIFACTS: ${spec.expectedArtifacts.join(" | ")}`,
    `RISK_CLASS: ${spec.riskClass}`,
    `RETRIEVAL_CONTEXT_IDS: ${retrievalContextIds.join(" | ") || "none"}`,
    "Output format:",
    "1) summary",
    "2) steps",
    "3) checks",
    "4) citations (if any)",
  ].join("\n");
}

function fallbackTeacherOutput(spec: BehaviorSpecV1, retrievalContextIds: string[]): TeacherOutput {
  return {
    teacherOutput: [
      `Summary: Execute ${spec.intent} with minimal safe patch scope.`,
      "Steps:",
      "- Build a short plan before edits.",
      "- Apply smallest viable change with deterministic validation.",
      "- Run targeted checks and report pass/fail.",
      "Checks:",
      `- ${spec.requiredChecks.join(", ") || "unit-tests"}`,
      "Citations:",
      `- retrieval:${retrievalContextIds[0] || "none"}`,
    ].join("\n"),
    citations: retrievalContextIds,
    model: "fallback",
    usedFallback: true,
    usage: {
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      costUsd: 0,
    },
    errorClass: "provider_unavailable",
    errorMessage: "fallback_teacher_output",
  };
}

function classifyError(message: string): TeacherOutput["errorClass"] {
  const lower = message.toLowerCase();
  if (
    lower.includes("rate limit") ||
    lower.includes("429") ||
    lower.includes("quota") ||
    lower.includes("hit your limit") ||
    lower.includes("resets")
  ) {
    return "rate_limited";
  }
  if (lower.includes("timed out") || lower.includes("timeout")) {
    return "timeout";
  }
  if (lower.includes("auth") || lower.includes("unauthorized") || lower.includes("forbidden")) {
    return "auth_required";
  }
  if (lower.includes("unavailable") || lower.includes("not found") || lower.includes("failed")) {
    return "provider_unavailable";
  }
  return "unknown";
}

function safeParseJson(raw: string) {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeTeacherText(resultText: string, fallbackText: string) {
  const trimmed = resultText.trim();
  if (!trimmed) {
    return fallbackText;
  }

  const unwrapped = trimmed.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "").trim();
  const parsed = safeParseJson(unwrapped);
  if (parsed && typeof parsed.teacherOutput === "string" && parsed.teacherOutput.trim()) {
    return parsed.teacherOutput.trim();
  }
  return trimmed;
}

function normalizeCitations(resultText: string, retrievalContextIds: string[]) {
  const trimmed = resultText.trim();
  if (!trimmed) {
    return retrievalContextIds;
  }
  const unwrapped = trimmed.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "").trim();
  const parsed = safeParseJson(unwrapped);
  if (!parsed) {
    return retrievalContextIds;
  }
  const citations = Array.isArray(parsed.citations)
    ? parsed.citations.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  return citations.length > 0 ? citations : retrievalContextIds;
}

export async function generateTeacherExample(
  spec: BehaviorSpecV1,
  retrievalContextIds: string[],
  options: TeacherCliOptions
): Promise<TeacherOutput> {
  const prompt = buildPrompt(spec, retrievalContextIds);
  const scan = scanAndRedactSensitiveText(prompt);
  const safePrompt = scan.redacted;

  try {
    const { stdout } = await execFileAsync(
      options.command,
      [
        "-p",
        "--output-format",
        "json",
        "--model",
        options.model,
        safePrompt,
      ],
      {
        timeout: Math.max(5000, options.timeoutMs),
        maxBuffer: 2 * 1024 * 1024,
      }
    );

    const parsed = JSON.parse(stdout.trim()) as {
      is_error?: unknown;
      result?: unknown;
      structured_output?: {
        teacherOutput?: unknown;
        citations?: unknown;
      };
      usage?: {
        input_tokens?: unknown;
        output_tokens?: unknown;
        cache_read_input_tokens?: unknown;
        cache_creation_input_tokens?: unknown;
      };
      total_cost_usd?: unknown;
    };
    const fallback = fallbackTeacherOutput(spec, retrievalContextIds);
    const structured = parsed.structured_output || {};
    const resultText = typeof parsed.result === "string" ? parsed.result : "";

    const teacherOutput =
      typeof structured.teacherOutput === "string" && structured.teacherOutput.trim()
        ? structured.teacherOutput.trim()
        : normalizeTeacherText(resultText, fallback.teacherOutput);

    const citations = Array.isArray(structured.citations)
      ? structured.citations.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : normalizeCitations(resultText, retrievalContextIds);
    const inputTokens = typeof parsed.usage?.input_tokens === "number" ? parsed.usage.input_tokens : 0;
    const outputTokens = typeof parsed.usage?.output_tokens === "number" ? parsed.usage.output_tokens : 0;
    const cacheReadInputTokens =
      typeof parsed.usage?.cache_read_input_tokens === "number" ? parsed.usage.cache_read_input_tokens : 0;
    const cacheCreationInputTokens =
      typeof parsed.usage?.cache_creation_input_tokens === "number" ? parsed.usage.cache_creation_input_tokens : 0;
    const costUsd = typeof parsed.total_cost_usd === "number" ? parsed.total_cost_usd : 0;
    const rawError = Boolean(parsed.is_error);
    if (rawError) {
      const errorText = typeof parsed.result === "string" ? parsed.result : "Teacher request failed";
      return {
        ...fallback,
        errorClass: classifyError(errorText),
        errorMessage: errorText,
      };
    }

    return {
      teacherOutput,
      citations,
      model: options.model,
      usedFallback: false,
      usage: {
        totalTokens: inputTokens + outputTokens + cacheReadInputTokens + cacheCreationInputTokens,
        inputTokens,
        outputTokens,
        cacheReadInputTokens,
        cacheCreationInputTokens,
        costUsd,
      },
    };
  } catch (error) {
    const fallback = fallbackTeacherOutput(spec, retrievalContextIds);
    let timeoutLike = false;
    const message = (() => {
      if (error && typeof error === "object") {
        const e = error as {
          message?: unknown;
          stderr?: unknown;
          stdout?: unknown;
          killed?: unknown;
          signal?: unknown;
          code?: unknown;
        };
        timeoutLike = Boolean(e.killed) || e.signal === "SIGTERM" || e.code === "ETIMEDOUT" || e.code === 143;
        const parts: string[] = [];
        if (typeof e.message === "string" && e.message.trim()) parts.push(e.message.trim());
        if (typeof e.stderr === "string" && e.stderr.trim()) parts.push(e.stderr.trim());
        if (typeof e.stdout === "string" && e.stdout.trim()) parts.push(e.stdout.trim());
        if (parts.length > 0) return parts.join("\n");
      }
      return error instanceof Error ? error.message : String(error);
    })();
    return {
      ...fallback,
      errorClass: timeoutLike ? "timeout" : classifyError(message),
      errorMessage: message,
    };
  }
}
