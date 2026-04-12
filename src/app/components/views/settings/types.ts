export type SettingsView = "essentials" | "advanced" | "diagnostics";
export type ModelRoleKey = "utility_fast" | "coder_default" | "review_deep" | "overseer_escalation";
export type LocalRuntimeRoleKey = "utility_fast" | "coder_default" | "review_deep";
export type ExecutionProfileStageKey = "scope" | "build" | "review" | "escalate";

export const ROLE_ORDER: ModelRoleKey[] = ["utility_fast", "coder_default", "review_deep", "overseer_escalation"];
export const EXECUTION_PROFILE_STAGE_ORDER: ExecutionProfileStageKey[] = ["scope", "build", "review", "escalate"];
export const ROLE_LABELS: Record<ModelRoleKey, string> = {
  utility_fast: "Fast",
  coder_default: "Build",
  review_deep: "Review",
  overseer_escalation: "Escalate",
};

export const DEFAULT_EXECUTION_PROFILES = {
  activeProfileId: "balanced",
  profiles: [
    {
      id: "balanced",
      name: "Balanced",
      description: "Fast scoping, standard build, deep review, escalate only when needed.",
      preset: "balanced",
      stages: {
        scope: "utility_fast",
        build: "coder_default",
        review: "review_deep",
        escalate: "overseer_escalation",
      },
      updatedAt: new Date(0).toISOString(),
    },
    {
      id: "deep_scope",
      name: "Deep Scope",
      description: "Use deeper reasoning while scoping before standard implementation.",
      preset: "deep_scope",
      stages: {
        scope: "review_deep",
        build: "coder_default",
        review: "review_deep",
        escalate: "overseer_escalation",
      },
      updatedAt: new Date(0).toISOString(),
    },
    {
      id: "build_heavy",
      name: "Build Heavy",
      description: "Favor deeper reasoning during implementation and review.",
      preset: "build_heavy",
      stages: {
        scope: "utility_fast",
        build: "review_deep",
        review: "review_deep",
        escalate: "overseer_escalation",
      },
      updatedAt: new Date(0).toISOString(),
    },
    {
      id: "custom",
      name: "Custom",
      description: "Editable lifecycle profile for project-specific overrides.",
      preset: "custom",
      stages: {
        scope: "utility_fast",
        build: "coder_default",
        review: "review_deep",
        escalate: "overseer_escalation",
      },
      updatedAt: new Date(0).toISOString(),
    },
  ],
} as const;

export const LOCAL_RUNTIME_ROLES: LocalRuntimeRoleKey[] = ["utility_fast", "coder_default", "review_deep"];

export function pickFirstAvailable(preferred: string[], available: string[], fallback: string) {
  for (const model of preferred) {
    if (available.includes(model)) return model;
  }
  return fallback;
}

export function recommendedOpenAiRoleBindings(
  availableModels: string[],
  fallbackModel: string
): Record<ModelRoleKey, { role: ModelRoleKey; providerId: "openai-responses"; pluginId: null; model: string; temperature: number; maxTokens: number; reasoningMode: "off" | "on" }> {
  const fastModel = pickFirstAvailable(
    ["gpt-5-nano", "gpt-5.1-nano", "gpt-4.1-nano", "gpt-4o-mini"],
    availableModels,
    fallbackModel
  );
  const buildModel = pickFirstAvailable(
    ["gpt-5.3-codex", "gpt-5.2-codex", "gpt-5.1-codex", "gpt-5-codex", "gpt-5.1-codex-mini", "gpt-5-mini"],
    availableModels,
    fastModel
  );
  const reviewModel = pickFirstAvailable(
    ["gpt-5.4", "gpt-5.2", "gpt-5.1", "gpt-5", "gpt-5-mini"],
    availableModels,
    buildModel
  );
  const escalateModel = pickFirstAvailable(
    ["gpt-5.4", "gpt-5.2", "gpt-5.1", "gpt-5", "gpt-5.4-pro", "gpt-5.2-pro", "gpt-5-pro"],
    availableModels,
    reviewModel
  );

  return {
    utility_fast: {
      role: "utility_fast",
      providerId: "openai-responses",
      pluginId: null,
      model: fastModel,
      temperature: 0,
      maxTokens: 900,
      reasoningMode: "off",
    },
    coder_default: {
      role: "coder_default",
      providerId: "openai-responses",
      pluginId: null,
      model: buildModel,
      temperature: 0.1,
      maxTokens: 1800,
      reasoningMode: "off",
    },
    review_deep: {
      role: "review_deep",
      providerId: "openai-responses",
      pluginId: null,
      model: reviewModel,
      temperature: 0.05,
      maxTokens: 2200,
      reasoningMode: "on",
    },
    overseer_escalation: {
      role: "overseer_escalation",
      providerId: "openai-responses",
      pluginId: null,
      model: escalateModel,
      temperature: 0.05,
      maxTokens: 2400,
      reasoningMode: "on",
    },
  };
}

export function recommendedHybridRoleBindings(
  availableModels: string[],
  fallbackOpenAiModel: string,
  localPluginId: string,
  localModel: string
): Record<ModelRoleKey, { role: ModelRoleKey; providerId: "onprem-qwen" | "openai-responses"; pluginId: string | null; model: string; temperature: number; maxTokens: number; reasoningMode: "off" | "on" }> {
  const openAiBindings = recommendedOpenAiRoleBindings(availableModels, fallbackOpenAiModel);
  return {
    utility_fast: {
      role: "utility_fast",
      providerId: "onprem-qwen",
      pluginId: localPluginId,
      model: localModel,
      temperature: 0.1,
      maxTokens: 900,
      reasoningMode: "off",
    },
    coder_default: openAiBindings.coder_default,
    review_deep: openAiBindings.review_deep,
    overseer_escalation: openAiBindings.overseer_escalation,
  };
}

export function groupOpenAiModels(
  models: Array<{ id: string; created: number | null; ownedBy: string | null }>
) {
  const groups = new Map<string, Array<{ id: string; created: number | null; ownedBy: string | null }>>();

  const classify = (modelId: string) => {
    if (/^gpt-5(?:[.-].*codex.*|.*codex.*)$/i.test(modelId)) return "GPT-5 Codex";
    if (/^gpt-5/i.test(modelId)) return "GPT-5";
    if (/^gpt-4\.1/i.test(modelId)) return "GPT-4.1";
    if (/^gpt-4o/i.test(modelId)) return "GPT-4o";
    if (/^o\d|^o[1-9]|^o3|^o4/i.test(modelId)) return "O-Series";
    return "Other";
  };

  for (const model of models) {
    const label = classify(model.id);
    if (!groups.has(label)) {
      groups.set(label, []);
    }
    groups.get(label)!.push(model);
  }

  const order = ["GPT-5 Codex", "GPT-5", "GPT-4.1", "GPT-4o", "O-Series", "Other"];
  return order
    .filter((label) => groups.has(label))
    .map((label) => ({
      label,
      items: groups.get(label)!.slice().sort((left, right) => left.id.localeCompare(right.id)),
    }));
}

export function suggestSiblingLocalBaseUrl(baseUrl: string, fallbackPort: number) {
  try {
    const parsed = new URL(baseUrl);
    const port = Number(parsed.port || "8000");
    parsed.port = String(Number.isFinite(port) ? port + 1 : fallbackPort);
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return `http://127.0.0.1:${fallbackPort}/v1`;
  }
}

export function providerSecretStatus(hasApiKey: boolean, apiKeySource?: "stored" | "env" | "none") {
  if (!hasApiKey) {
    return "not configured";
  }
  return apiKeySource === "env" ? "env provided" : "saved";
}

export function stripRoleRuntimeSecretState(runtime: Record<string, unknown>) {
  const { hasApiKey: _hasApiKey, apiKeySource: _apiKeySource, ...rest } = runtime;
  return rest;
}

export function toMcpServerIdCandidate(input: string) {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "mcp-server";
}
