import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  hasConfiguredSecret,
  mergeSecretInput,
  defaultLocalQwenRoleBindings,
  openAiUnifiedRoleBindings,
  normalizeExecutionProfiles,
  resolveExecutionProfile,
  buildExecutionProfileSnapshot,
  inferRuntimeMode,
  type NormalizedExecutionProfiles,
} from "./runtimeConfig";

// Mock randomUUID to make tests deterministic
vi.mock("node:crypto", () => ({
  randomUUID: vi.fn(() => "test-uuid-123"),
}));

describe("hasConfiguredSecret", () => {
  it("returns true when value is a non-empty string", () => {
    expect(hasConfiguredSecret("api-key-123")).toBe(true);
    expect(hasConfiguredSecret("  token  ")).toBe(true);
  });

  it("returns false when value is an empty string", () => {
    expect(hasConfiguredSecret("")).toBe(false);
    expect(hasConfiguredSecret("   ")).toBe(false);
  });

  it("returns false when value is not a string and no envValue", () => {
    expect(hasConfiguredSecret(null)).toBe(false);
    expect(hasConfiguredSecret(undefined)).toBe(false);
    expect(hasConfiguredSecret(123)).toBe(false);
    expect(hasConfiguredSecret({})).toBe(false);
  });

  it("falls back to envValue when value is not a string", () => {
    expect(hasConfiguredSecret(null, "env-key")).toBe(true);
    expect(hasConfiguredSecret(undefined, "env-key")).toBe(true);
    expect(hasConfiguredSecret({}, "  env-token  ")).toBe(true);
  });

  it("returns false when both value and envValue are empty", () => {
    expect(hasConfiguredSecret("", "")).toBe(false);
    expect(hasConfiguredSecret(null, "   ")).toBe(false);
  });
});

describe("mergeSecretInput", () => {
  it("returns empty string when clearRequested is true", () => {
    const result = mergeSecretInput({
      inputValue: "new-key",
      clearRequested: true,
      previousValue: "old-key",
      envValue: "env-key",
    });
    expect(result).toBe("");
  });

  it("returns inputValue when it is a non-empty string", () => {
    const result = mergeSecretInput({
      inputValue: "new-key",
      previousValue: "old-key",
      envValue: "env-key",
    });
    expect(result).toBe("new-key");
  });

  it("trims and validates inputValue", () => {
    const result = mergeSecretInput({
      inputValue: "  new-key  ",
      previousValue: "old-key",
    });
    expect(result).toBe("  new-key  ");
  });

  it("falls back to previousValue when inputValue is empty", () => {
    const result = mergeSecretInput({
      inputValue: "",
      previousValue: "old-key",
      envValue: "env-key",
    });
    expect(result).toBe("old-key");
  });

  it("falls back to envValue when inputValue and previousValue are absent", () => {
    const result = mergeSecretInput({
      inputValue: null,
      previousValue: null,
      envValue: "env-key",
    });
    expect(result).toBe("env-key");
  });

  it("returns empty string when all values are absent", () => {
    const result = mergeSecretInput({
      inputValue: null,
      previousValue: null,
    });
    expect(result).toBe("");
  });

  it("ignores whitespace-only inputValue", () => {
    const result = mergeSecretInput({
      inputValue: "   ",
      previousValue: "old-key",
    });
    expect(result).toBe("old-key");
  });
});

describe("defaultLocalQwenRoleBindings", () => {
  beforeEach(() => {
    delete process.env.ONPREM_QWEN_PLUGIN;
    delete process.env.ONPREM_QWEN_MODEL;
    delete process.env.OPENAI_RESPONSES_MODEL;
  });

  it("returns default role bindings for all model roles", () => {
    const bindings = defaultLocalQwenRoleBindings();
    expect(bindings).toHaveProperty("utility_fast");
    expect(bindings).toHaveProperty("coder_default");
    expect(bindings).toHaveProperty("review_deep");
    expect(bindings).toHaveProperty("overseer_escalation");
  });

  it("configures utility_fast with onprem-qwen and 0.8B model", () => {
    const bindings = defaultLocalQwenRoleBindings();
    expect(bindings.utility_fast).toEqual({
      role: "utility_fast",
      providerId: "onprem-qwen",
      pluginId: "qwen3.5-0.8b",
      model: "Qwen/Qwen3.5-0.8B",
      temperature: 0.1,
      maxTokens: 900,
      reasoningMode: "off",
    });
  });

  it("configures coder_default with default 4B model", () => {
    const bindings = defaultLocalQwenRoleBindings();
    expect(bindings.coder_default).toMatchObject({
      role: "coder_default",
      providerId: "onprem-qwen",
      pluginId: "qwen3.5-4b",
      model: "mlx-community/Qwen3.5-4B-4bit",
      temperature: 0.12,
      maxTokens: 1800,
      reasoningMode: "off",
    });
  });

  it("respects ONPREM_QWEN_PLUGIN and ONPREM_QWEN_MODEL env vars", () => {
    process.env.ONPREM_QWEN_PLUGIN = "custom-plugin";
    process.env.ONPREM_QWEN_MODEL = "custom-model";

    const bindings = defaultLocalQwenRoleBindings();
    expect(bindings.coder_default.pluginId).toBe("custom-plugin");
    expect(bindings.coder_default.model).toBe("custom-model");
    expect(bindings.review_deep.pluginId).toBe("custom-plugin");
    expect(bindings.review_deep.model).toBe("custom-model");
  });

  it("configures review_deep with reasoning mode on", () => {
    const bindings = defaultLocalQwenRoleBindings();
    expect(bindings.review_deep.reasoningMode).toBe("on");
    expect(bindings.review_deep.temperature).toBe(0.08);
  });

  it("configures overseer_escalation with openai-responses provider", () => {
    const bindings = defaultLocalQwenRoleBindings();
    expect(bindings.overseer_escalation).toEqual({
      role: "overseer_escalation",
      providerId: "openai-responses",
      pluginId: null,
      model: "gpt-5-nano",
      temperature: 0.1,
      maxTokens: 2200,
    });
  });

  it("respects OPENAI_RESPONSES_MODEL env var for overseer", () => {
    process.env.OPENAI_RESPONSES_MODEL = "gpt-6-mega";

    const bindings = defaultLocalQwenRoleBindings();
    expect(bindings.overseer_escalation.model).toBe("gpt-6-mega");
  });
});

describe("openAiUnifiedRoleBindings", () => {
  it("returns openai-responses bindings for all roles", () => {
    const bindings = openAiUnifiedRoleBindings("gpt-5-turbo");
    expect(Object.values(bindings).every((b) => b.providerId === "openai-responses")).toBe(true);
  });

  it("uses the provided model for all roles", () => {
    const bindings = openAiUnifiedRoleBindings("claude-sonnet-5");
    expect(Object.values(bindings).every((b) => b.model === "claude-sonnet-5")).toBe(true);
  });

  it("configures utility_fast with minimal temperature", () => {
    const bindings = openAiUnifiedRoleBindings("gpt-5");
    expect(bindings.utility_fast.temperature).toBe(0);
    expect(bindings.utility_fast.reasoningMode).toBe("off");
  });

  it("configures review_deep and overseer with reasoning mode on", () => {
    const bindings = openAiUnifiedRoleBindings("gpt-5");
    expect(bindings.review_deep.reasoningMode).toBe("on");
    expect(bindings.overseer_escalation.reasoningMode).toBe("on");
  });

  it("sets pluginId to null for all roles", () => {
    const bindings = openAiUnifiedRoleBindings("gpt-5");
    expect(Object.values(bindings).every((b) => b.pluginId === null)).toBe(true);
  });

  it("allocates higher maxTokens to overseer_escalation", () => {
    const bindings = openAiUnifiedRoleBindings("gpt-5");
    expect(bindings.overseer_escalation.maxTokens).toBe(2400);
    expect(bindings.overseer_escalation.maxTokens).toBeGreaterThan(bindings.coder_default.maxTokens);
  });
});

describe("normalizeExecutionProfiles", () => {
  it("returns default profiles when value is empty object", () => {
    const result = normalizeExecutionProfiles({});
    expect(result.profiles).toHaveLength(4);
    expect(result.profiles.map((p) => p.id)).toContain("balanced");
    expect(result.profiles.map((p) => p.id)).toContain("deep_scope");
    expect(result.profiles.map((p) => p.id)).toContain("build_heavy");
    expect(result.profiles.map((p) => p.id)).toContain("custom");
  });

  it("returns default profiles when value is null", () => {
    const result = normalizeExecutionProfiles(null);
    expect(result.activeProfileId).toBe("balanced");
    expect(result.profiles).toHaveLength(4);
  });

  it("normalizes valid profile data", () => {
    const input = {
      activeProfileId: "deep_scope",
      profiles: [
        {
          id: "deep_scope",
          name: "Deep Scope",
          description: "Custom deep scope",
          preset: "deep_scope",
          stages: {
            scope: "review_deep",
            build: "coder_default",
            review: "review_deep",
            escalate: "overseer_escalation",
          },
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ],
    };

    const result = normalizeExecutionProfiles(input);
    expect(result.activeProfileId).toBe("deep_scope");
    expect(result.profiles[0].id).toBe("deep_scope");
    expect(result.profiles[0].stages.scope).toBe("review_deep");
  });

  it("generates UUID for missing profile id", () => {
    const input = {
      profiles: [
        {
          name: "Test Profile",
          description: "Test",
          preset: "custom",
          stages: {
            scope: "utility_fast",
            build: "coder_default",
            review: "review_deep",
            escalate: "overseer_escalation",
          },
        },
      ],
    };

    const result = normalizeExecutionProfiles(input);
    expect(result.profiles[0].id).toBe("test-uuid-123");
  });

  it("falls back to defaults for invalid stage values", () => {
    const input = {
      profiles: [
        {
          id: "test",
          name: "Test",
          stages: {
            scope: "invalid_role",
            build: "invalid_role",
            review: "invalid_role",
            escalate: "invalid_role",
          },
        },
      ],
    };

    const result = normalizeExecutionProfiles(input);
    expect(result.profiles[0].stages.scope).toBe("utility_fast");
    expect(result.profiles[0].stages.build).toBe("coder_default");
    expect(result.profiles[0].stages.review).toBe("review_deep");
    expect(result.profiles[0].stages.escalate).toBe("overseer_escalation");
  });

  it("falls back to custom preset for invalid preset values", () => {
    const input = {
      profiles: [
        {
          id: "test",
          name: "Test",
          preset: "invalid_preset",
          stages: {
            scope: "utility_fast",
            build: "coder_default",
            review: "review_deep",
            escalate: "overseer_escalation",
          },
        },
      ],
    };

    const result = normalizeExecutionProfiles(input);
    expect(result.profiles[0].preset).toBe("custom");
  });

  it("falls back to first profile when activeProfileId is invalid", () => {
    const input = {
      activeProfileId: "nonexistent",
      profiles: [
        {
          id: "valid",
          name: "Valid",
          preset: "balanced",
          stages: {
            scope: "utility_fast",
            build: "coder_default",
            review: "review_deep",
            escalate: "overseer_escalation",
          },
        },
      ],
    };

    const result = normalizeExecutionProfiles(input);
    expect(result.activeProfileId).toBe("valid");
  });

  it("normalizes profiles with missing stages by using defaults", () => {
    const input = {
      profiles: [
        {
          id: "valid",
          name: "Valid",
          stages: {
            scope: "utility_fast",
            build: "coder_default",
            review: "review_deep",
            escalate: "overseer_escalation",
          },
        },
        {
          id: "incomplete",
          name: "Incomplete",
          stages: null,
        },
      ],
    };

    const result = normalizeExecutionProfiles(input);
    expect(result.profiles).toHaveLength(2);
    expect(result.profiles[0].id).toBe("valid");
    expect(result.profiles[1].id).toBe("incomplete");
    // Incomplete profile gets default stage values
    expect(result.profiles[1].stages.scope).toBe("utility_fast");
    expect(result.profiles[1].stages.build).toBe("coder_default");
    expect(result.profiles[1].stages.review).toBe("review_deep");
    expect(result.profiles[1].stages.escalate).toBe("overseer_escalation");
  });

  it("generates current timestamp for missing updatedAt", () => {
    const beforeTest = new Date().toISOString();
    const input = {
      profiles: [
        {
          id: "test",
          name: "Test",
          stages: {
            scope: "utility_fast",
            build: "coder_default",
            review: "review_deep",
            escalate: "overseer_escalation",
          },
        },
      ],
    };

    const result = normalizeExecutionProfiles(input);
    const afterTest = new Date().toISOString();

    expect(result.profiles[0].updatedAt).toBeDefined();
    expect(result.profiles[0].updatedAt >= beforeTest).toBe(true);
    expect(result.profiles[0].updatedAt <= afterTest).toBe(true);
  });
});

describe("resolveExecutionProfile", () => {
  const roleBindings = defaultLocalQwenRoleBindings();
  const executionProfiles: NormalizedExecutionProfiles = {
    activeProfileId: "balanced",
    profiles: [
      {
        id: "balanced",
        name: "Balanced",
        description: "Balanced profile",
        preset: "balanced",
        stages: {
          scope: "utility_fast",
          build: "coder_default",
          review: "review_deep",
          escalate: "overseer_escalation",
        },
        updatedAt: "2026-01-01T00:00:00Z",
      },
      {
        id: "deep_scope",
        name: "Deep Scope",
        description: "Deep scope profile",
        preset: "deep_scope",
        stages: {
          scope: "review_deep",
          build: "coder_default",
          review: "review_deep",
          escalate: "overseer_escalation",
        },
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ],
  };

  it("uses selectedProfileId when valid", () => {
    const result = resolveExecutionProfile({
      executionProfiles,
      selectedProfileId: "deep_scope",
      roleBindings,
    });

    expect(result.profileId).toBe("deep_scope");
    expect(result.profileName).toBe("Deep Scope");
  });

  it("falls back to ticketProfileId when selectedProfileId is invalid", () => {
    const result = resolveExecutionProfile({
      executionProfiles,
      selectedProfileId: "invalid",
      ticketProfileId: "deep_scope",
      roleBindings,
    });

    expect(result.profileId).toBe("deep_scope");
  });

  it("falls back to projectProfileId when both selectedProfileId and ticketProfileId are invalid", () => {
    const result = resolveExecutionProfile({
      executionProfiles,
      selectedProfileId: "invalid",
      ticketProfileId: "invalid",
      projectProfileId: "deep_scope",
      roleBindings,
    });

    expect(result.profileId).toBe("deep_scope");
  });

  it("falls back to activeProfileId when all specific profiles are invalid", () => {
    const result = resolveExecutionProfile({
      executionProfiles,
      selectedProfileId: "invalid",
      ticketProfileId: "invalid",
      projectProfileId: "invalid",
      roleBindings,
    });

    expect(result.profileId).toBe("balanced");
  });

  it("resolves role bindings for each stage", () => {
    const result = resolveExecutionProfile({
      executionProfiles,
      selectedProfileId: "balanced",
      roleBindings,
    });

    expect(result.stages.scope).toEqual(roleBindings.utility_fast);
    expect(result.stages.build).toEqual(roleBindings.coder_default);
    expect(result.stages.review).toEqual(roleBindings.review_deep);
    expect(result.stages.escalate).toEqual(roleBindings.overseer_escalation);
  });

  it("includes profileStages in the result", () => {
    const result = resolveExecutionProfile({
      executionProfiles,
      selectedProfileId: "deep_scope",
      roleBindings,
    });

    expect(result.profileStages).toEqual({
      scope: "review_deep",
      build: "coder_default",
      review: "review_deep",
      escalate: "overseer_escalation",
    });
  });

  it("falls back to first profile when active profile is not found", () => {
    const customProfiles: NormalizedExecutionProfiles = {
      activeProfileId: "nonexistent",
      profiles: executionProfiles.profiles,
    };

    const result = resolveExecutionProfile({
      executionProfiles: customProfiles,
      roleBindings,
    });

    expect(result.profileId).toBe("balanced");
  });
});

describe("buildExecutionProfileSnapshot", () => {
  it("builds a snapshot from resolved profile", () => {
    const roleBindings = defaultLocalQwenRoleBindings();
    const executionProfiles = normalizeExecutionProfiles({});
    const resolved = resolveExecutionProfile({
      executionProfiles,
      selectedProfileId: "balanced",
      roleBindings,
    });

    const snapshot = buildExecutionProfileSnapshot(resolved);

    expect(snapshot.profileId).toBe("balanced");
    expect(snapshot.profileName).toBe("Balanced");
    expect(snapshot.stages).toHaveLength(4);
  });

  it("includes stage, role, providerId, model, and reasoningMode for each stage", () => {
    const roleBindings = defaultLocalQwenRoleBindings();
    const executionProfiles = normalizeExecutionProfiles({});
    const resolved = resolveExecutionProfile({
      executionProfiles,
      selectedProfileId: "balanced",
      roleBindings,
    });

    const snapshot = buildExecutionProfileSnapshot(resolved);

    expect(snapshot.stages[0]).toMatchObject({
      stage: expect.any(String),
      role: expect.any(String),
      providerId: expect.any(String),
      model: expect.any(String),
    });
  });

  it("maps all stage types correctly", () => {
    const roleBindings = defaultLocalQwenRoleBindings();
    const executionProfiles = normalizeExecutionProfiles({});
    const resolved = resolveExecutionProfile({
      executionProfiles,
      selectedProfileId: "balanced",
      roleBindings,
    });

    const snapshot = buildExecutionProfileSnapshot(resolved);
    const stageNames = snapshot.stages.map((s) => s.stage);

    expect(stageNames).toContain("scope");
    expect(stageNames).toContain("build");
    expect(stageNames).toContain("review");
    expect(stageNames).toContain("escalate");
  });

  it("includes reasoningMode when present", () => {
    const roleBindings = defaultLocalQwenRoleBindings();
    const executionProfiles = normalizeExecutionProfiles({});
    const resolved = resolveExecutionProfile({
      executionProfiles,
      selectedProfileId: "balanced",
      roleBindings,
    });

    const snapshot = buildExecutionProfileSnapshot(resolved);
    const reviewStage = snapshot.stages.find((s) => s.stage === "review");

    expect(reviewStage?.reasoningMode).toBe("on");
  });
});

describe("inferRuntimeMode", () => {
  it("returns openai_api when all roles use openai-responses", () => {
    const modelRoles = {
      utility_fast: { providerId: "openai-responses" },
      coder_default: { providerId: "openai-responses" },
      review_deep: { providerId: "openai-responses" },
      overseer_escalation: { providerId: "openai-responses" },
    };

    const result = inferRuntimeMode("openai-responses", modelRoles);
    expect(result).toBe("openai_api");
  });

  it("returns local_qwen when activeProvider is not openai-responses", () => {
    const modelRoles = {
      utility_fast: { providerId: "openai-responses" },
      coder_default: { providerId: "openai-responses" },
      review_deep: { providerId: "openai-responses" },
      overseer_escalation: { providerId: "openai-responses" },
    };

    const result = inferRuntimeMode("onprem-qwen", modelRoles);
    expect(result).toBe("local_qwen");
  });

  it("returns local_qwen when some roles use different providers", () => {
    const modelRoles = {
      utility_fast: { providerId: "onprem-qwen" },
      coder_default: { providerId: "openai-responses" },
      review_deep: { providerId: "openai-responses" },
      overseer_escalation: { providerId: "openai-responses" },
    };

    const result = inferRuntimeMode("openai-responses", modelRoles);
    expect(result).toBe("local_qwen");
  });

  it("returns local_qwen when all roles use onprem-qwen", () => {
    const modelRoles = {
      utility_fast: { providerId: "onprem-qwen" },
      coder_default: { providerId: "onprem-qwen" },
      review_deep: { providerId: "onprem-qwen" },
      overseer_escalation: { providerId: "onprem-qwen" },
    };

    const result = inferRuntimeMode("onprem-qwen", modelRoles);
    expect(result).toBe("local_qwen");
  });

  it("handles missing providerId gracefully", () => {
    const modelRoles = {
      utility_fast: {},
      coder_default: { providerId: "openai-responses" },
      review_deep: { providerId: "openai-responses" },
      overseer_escalation: { providerId: "openai-responses" },
    };

    const result = inferRuntimeMode("openai-responses", modelRoles);
    expect(result).toBe("local_qwen");
  });

  it("returns local_qwen when modelRoles is empty", () => {
    const result = inferRuntimeMode("openai-responses", {});
    expect(result).toBe("local_qwen");
  });
});
