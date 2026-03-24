import { randomUUID } from "node:crypto";

type ModelRole = "utility_fast" | "coder_default" | "review_deep" | "overseer_escalation";
type ProviderId = "qwen-cli" | "openai-compatible" | "onprem-qwen" | "openai-responses";
type PresetId = "balanced" | "deep_scope" | "build_heavy" | "custom";
type ReasoningMode = "off" | "on" | "auto";

type RoleBinding = {
  role: ModelRole;
  providerId: ProviderId;
  pluginId: string | null;
  model: string;
  temperature: number;
  maxTokens: number;
  reasoningMode?: ReasoningMode;
};

type ExecutionProfile = {
  id: string;
  name: string;
  description: string;
  preset: PresetId;
  stages: {
    scope: ModelRole;
    build: ModelRole;
    review: ModelRole;
    escalate: ModelRole;
  };
  updatedAt: string;
};

export type NormalizedExecutionProfiles = {
  activeProfileId: string;
  profiles: ExecutionProfile[];
};

function asRecord(value: unknown) {
  return (value ?? {}) as Record<string, unknown>;
}

export function hasConfiguredSecret(value: unknown, envValue?: string) {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return typeof envValue === "string" ? envValue.trim().length > 0 : false;
}

export function mergeSecretInput(input: {
  inputValue: unknown;
  clearRequested?: boolean;
  previousValue: unknown;
  envValue?: string;
}) {
  if (input.clearRequested) {
    return "";
  }
  if (typeof input.inputValue === "string" && input.inputValue.trim().length > 0) {
    return input.inputValue;
  }
  if (typeof input.previousValue === "string") {
    return input.previousValue;
  }
  return input.envValue ?? "";
}

export function defaultLocalQwenRoleBindings(): Record<ModelRole, RoleBinding> {
  return {
    utility_fast: {
      role: "utility_fast",
      providerId: "onprem-qwen",
      pluginId: "qwen3.5-0.8b",
      model: "Qwen/Qwen3.5-0.8B",
      temperature: 0.1,
      maxTokens: 900,
      reasoningMode: "off",
    },
    coder_default: {
      role: "coder_default",
      providerId: "onprem-qwen",
      pluginId: process.env.ONPREM_QWEN_PLUGIN || "qwen3.5-4b",
      model: process.env.ONPREM_QWEN_MODEL || "mlx-community/Qwen3.5-4B-4bit",
      temperature: 0.12,
      maxTokens: 1800,
      reasoningMode: "off",
    },
    review_deep: {
      role: "review_deep",
      providerId: "onprem-qwen",
      pluginId: process.env.ONPREM_QWEN_PLUGIN || "qwen3.5-4b",
      model: process.env.ONPREM_QWEN_MODEL || "mlx-community/Qwen3.5-4B-4bit",
      temperature: 0.08,
      maxTokens: 2200,
      reasoningMode: "on",
    },
    overseer_escalation: {
      role: "overseer_escalation",
      providerId: "openai-responses",
      pluginId: null,
      model: process.env.OPENAI_RESPONSES_MODEL || "gpt-5-nano",
      temperature: 0.1,
      maxTokens: 2200,
    },
  };
}

export function openAiUnifiedRoleBindings(model: string): Record<ModelRole, RoleBinding> {
  return {
    utility_fast: {
      role: "utility_fast",
      providerId: "openai-responses",
      pluginId: null,
      model,
      temperature: 0,
      maxTokens: 900,
      reasoningMode: "off",
    },
    coder_default: {
      role: "coder_default",
      providerId: "openai-responses",
      pluginId: null,
      model,
      temperature: 0.1,
      maxTokens: 1800,
      reasoningMode: "off",
    },
    review_deep: {
      role: "review_deep",
      providerId: "openai-responses",
      pluginId: null,
      model,
      temperature: 0.05,
      maxTokens: 2200,
      reasoningMode: "on",
    },
    overseer_escalation: {
      role: "overseer_escalation",
      providerId: "openai-responses",
      pluginId: null,
      model,
      temperature: 0.05,
      maxTokens: 2400,
      reasoningMode: "on",
    },
  };
}

function defaultExecutionProfiles(): NormalizedExecutionProfiles {
  const now = new Date().toISOString();
  return {
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
        updatedAt: now,
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
        updatedAt: now,
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
        updatedAt: now,
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
        updatedAt: now,
      },
    ],
  };
}

export function normalizeExecutionProfiles(value: unknown): NormalizedExecutionProfiles {
  const fallback = defaultExecutionProfiles();
  const record = asRecord(value);
  const profiles = Array.isArray(record.profiles)
    ? record.profiles
        .map((item) => {
          const row = asRecord(item);
          const stages = asRecord(row.stages);
          return {
            id: typeof row.id === "string" && row.id.trim() ? row.id : randomUUID(),
            name: typeof row.name === "string" && row.name.trim() ? row.name : "Custom",
            description:
              typeof row.description === "string" && row.description.trim()
                ? row.description
                : "Editable lifecycle profile.",
            preset:
              row.preset === "balanced" || row.preset === "deep_scope" || row.preset === "build_heavy" || row.preset === "custom"
                ? row.preset
                : "custom",
            stages: {
              scope:
                stages.scope === "utility_fast" || stages.scope === "coder_default" || stages.scope === "review_deep" || stages.scope === "overseer_escalation"
                  ? stages.scope
                  : "utility_fast",
              build:
                stages.build === "utility_fast" || stages.build === "coder_default" || stages.build === "review_deep" || stages.build === "overseer_escalation"
                  ? stages.build
                  : "coder_default",
              review:
                stages.review === "utility_fast" || stages.review === "coder_default" || stages.review === "review_deep" || stages.review === "overseer_escalation"
                  ? stages.review
                  : "review_deep",
              escalate:
                stages.escalate === "utility_fast" || stages.escalate === "coder_default" || stages.escalate === "review_deep" || stages.escalate === "overseer_escalation"
                  ? stages.escalate
                  : "overseer_escalation",
            },
            updatedAt: typeof row.updatedAt === "string" && row.updatedAt.trim() ? row.updatedAt : new Date().toISOString(),
          };
        })
        .filter((item): item is ExecutionProfile => Boolean(item.id))
    : fallback.profiles;

  const activeProfileId =
    typeof record.activeProfileId === "string" && profiles.some((item) => item.id === record.activeProfileId)
      ? record.activeProfileId
      : profiles[0]?.id || fallback.activeProfileId;

  return {
    activeProfileId,
    profiles: profiles.length ? profiles : fallback.profiles,
  };
}

export function resolveExecutionProfile(input: {
  executionProfiles: NormalizedExecutionProfiles;
  selectedProfileId?: string | null;
  ticketProfileId?: string | null;
  projectProfileId?: string | null;
  roleBindings: Record<ModelRole, RoleBinding>;
}) {
  const profileId =
    input.selectedProfileId && input.executionProfiles.profiles.some((item) => item.id === input.selectedProfileId)
      ? input.selectedProfileId
      : input.ticketProfileId && input.executionProfiles.profiles.some((item) => item.id === input.ticketProfileId)
        ? input.ticketProfileId
        : input.projectProfileId && input.executionProfiles.profiles.some((item) => item.id === input.projectProfileId)
          ? input.projectProfileId
          : input.executionProfiles.activeProfileId;
  const profile =
    input.executionProfiles.profiles.find((item) => item.id === profileId) || input.executionProfiles.profiles[0];
  return {
    profileId: profile.id,
    profileName: profile.name,
    profileStages: profile.stages,
    stages: {
      scope: input.roleBindings[profile.stages.scope],
      build: input.roleBindings[profile.stages.build],
      review: input.roleBindings[profile.stages.review],
      escalate: input.roleBindings[profile.stages.escalate],
    },
  };
}

export function buildExecutionProfileSnapshot(profile: ReturnType<typeof resolveExecutionProfile>) {
  return {
    profileId: profile.profileId,
    profileName: profile.profileName,
    stages: (Object.entries(profile.stages) as Array<
      [keyof typeof profile.stages, (typeof profile.stages)[keyof typeof profile.stages]]
    >).map(([stage, binding]) => ({
      stage,
      role: binding.role,
      providerId: binding.providerId,
      model: binding.model,
      reasoningMode: binding.reasoningMode,
    })),
  };
}

export function inferRuntimeMode(activeProvider: string, modelRolesValue: Record<string, unknown>) {
  const roles = ["utility_fast", "coder_default", "review_deep", "overseer_escalation"] as const;
  const allOpenAi = roles.every((role) => {
    const value = modelRolesValue[role];
    return value && typeof value === "object" && (value as { providerId?: unknown }).providerId === "openai-responses";
  });

  if (activeProvider === "openai-responses" && allOpenAi) {
    return "openai_api" as const;
  }

  return "local_qwen" as const;
}
