/**
 * Unit tests for db.ts
 * Tests prisma export and initDatabase behavior.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockConnect,
  mockUpsert,
  mockFindUnique,
  mockEnsureSecretStoreKey,
  mockMigrateLegacyProviderSecrets,
} = vi.hoisted(() => ({
  mockConnect: vi.fn().mockResolvedValue(undefined),
  mockUpsert: vi.fn().mockResolvedValue({}),
  mockFindUnique: vi.fn().mockResolvedValue(null),
  mockEnsureSecretStoreKey: vi.fn(),
  mockMigrateLegacyProviderSecrets: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@prisma/client", () => ({
  default: {
    PrismaClient: vi.fn().mockImplementation(() => ({
      $connect: mockConnect,
      appSetting: {
        upsert: mockUpsert,
        findUnique: mockFindUnique,
      },
    })),
  },
}));

vi.mock("./services/secretStore", () => ({
  ensureSecretStoreKey: mockEnsureSecretStoreKey,
  migrateLegacyProviderSecrets: mockMigrateLegacyProviderSecrets,
}));

import { prisma, initDatabase } from "./db";

describe("db module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports prisma as a defined object", () => {
    expect(prisma).toBeDefined();
    expect(typeof prisma.$connect).toBe("function");
  });

  it("prisma has appSetting model with upsert and findUnique", () => {
    expect(typeof prisma.appSetting.upsert).toBe("function");
    expect(typeof prisma.appSetting.findUnique).toBe("function");
  });
});

describe("initDatabase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls $connect", async () => {
    await initDatabase();

    expect(mockConnect).toHaveBeenCalledOnce();
  });

  it("calls ensureSecretStoreKey before connecting", async () => {
    await initDatabase();

    expect(mockEnsureSecretStoreKey).toHaveBeenCalledOnce();
  });

  it("calls upsert for default settings (multiple times)", async () => {
    await initDatabase();

    // initDatabase upserts 13 default app settings
    expect(mockUpsert.mock.calls.length).toBeGreaterThanOrEqual(13);

    // Verify some of the expected settings keys are upserted
    const upsertedKeys = mockUpsert.mock.calls.map(
      (call) => call[0]?.where?.key,
    );
    expect(upsertedKeys).toContain("active_provider");
    expect(upsertedKeys).toContain("active_repo");
    expect(upsertedKeys).toContain("safety_policy");
    expect(upsertedKeys).toContain("onprem_qwen_config");
    expect(upsertedKeys).toContain("model_role_bindings");
    expect(upsertedKeys).toContain("parallel_runtime_config");
    expect(upsertedKeys).toContain("github_app_config");
    expect(upsertedKeys).toContain("runtime_profiles");
    expect(upsertedKeys).toContain("execution_profiles");
    expect(upsertedKeys).toContain("benchmark_rubric");
    expect(upsertedKeys).toContain("distill_config");
  });

  it("calls migrateLegacyProviderSecrets", async () => {
    await initDatabase();

    expect(mockMigrateLegacyProviderSecrets).toHaveBeenCalledOnce();
    expect(mockMigrateLegacyProviderSecrets).toHaveBeenCalledWith(prisma);
  });

  it("calls rolloutQwen35FourBDefaults via findUnique for onprem_qwen_config", async () => {
    await initDatabase();

    // rolloutQwen35FourBDefaults reads onprem_qwen_config and model_role_bindings
    const findUniqueKeys = mockFindUnique.mock.calls.map(
      (call) => call[0]?.where?.key,
    );
    expect(findUniqueKeys).toContain("onprem_qwen_config");
    expect(findUniqueKeys).toContain("model_role_bindings");
  });
});

describe("rolloutQwen35FourBDefaults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rolls forward when onprem_qwen_config has no pluginId/model (fresh install)", async () => {
    mockFindUnique.mockImplementation(({ where }: any) => {
      if (where.key === "onprem_qwen_config") {
        return { value: {} };
      }
      if (where.key === "model_role_bindings") {
        return { value: {} };
      }
      return null;
    });

    await initDatabase();

    // Should upsert onprem_qwen_config with new defaults
    const onpremUpserts = mockUpsert.mock.calls.filter(
      (c) => c[0]?.where?.key === "onprem_qwen_config",
    );
    // One from initDatabase setup + one from rollout
    expect(onpremUpserts.length).toBeGreaterThanOrEqual(2);
    const rolloutCall = onpremUpserts[onpremUpserts.length - 1];
    expect(rolloutCall[0].update.value.pluginId).toBe("qwen3.5-4b");
    expect(rolloutCall[0].update.value.model).toBe("mlx-community/Qwen3.5-4B-4bit");
  });

  it("rolls forward when onprem_qwen_config has legacy pluginId and model", async () => {
    mockFindUnique.mockImplementation(({ where }: any) => {
      if (where.key === "onprem_qwen_config") {
        return {
          value: {
            pluginId: "qwen2.5-coder-3b",
            model: "Qwen/Qwen2.5-Coder-3B-Instruct",
          },
        };
      }
      if (where.key === "model_role_bindings") {
        return { value: {} };
      }
      return null;
    });

    await initDatabase();

    const onpremUpserts = mockUpsert.mock.calls.filter(
      (c) => c[0]?.where?.key === "onprem_qwen_config",
    );
    const rolloutCall = onpremUpserts[onpremUpserts.length - 1];
    expect(rolloutCall[0].update.value.pluginId).toBe("qwen3.5-4b");
    expect(rolloutCall[0].update.value.model).toBe("mlx-community/Qwen3.5-4B-4bit");
  });

  it("adds reasoningMode when onprem has custom pluginId/model but no reasoningMode", async () => {
    mockFindUnique.mockImplementation(({ where }: any) => {
      if (where.key === "onprem_qwen_config") {
        return {
          value: {
            pluginId: "custom-plugin",
            model: "custom/model",
          },
        };
      }
      if (where.key === "model_role_bindings") {
        return { value: {} };
      }
      return null;
    });

    await initDatabase();

    const onpremUpserts = mockUpsert.mock.calls.filter(
      (c) => c[0]?.where?.key === "onprem_qwen_config",
    );
    const rolloutCall = onpremUpserts[onpremUpserts.length - 1];
    // Should set reasoningMode while preserving existing pluginId/model
    expect(rolloutCall[0].update.value.reasoningMode).toBe("off");
    expect(rolloutCall[0].update.value.pluginId).toBe("custom-plugin");
    expect(rolloutCall[0].update.value.model).toBe("custom/model");
  });

  it("skips onprem update when pluginId/model are custom AND reasoningMode is set", async () => {
    mockFindUnique.mockImplementation(({ where }: any) => {
      if (where.key === "onprem_qwen_config") {
        return {
          value: {
            pluginId: "custom-plugin",
            model: "custom/model",
            reasoningMode: "on",
          },
        };
      }
      if (where.key === "model_role_bindings") {
        return { value: {} };
      }
      return null;
    });

    await initDatabase();

    // The onprem_qwen_config upserts should be ONLY from initDatabase (setup),
    // not from rollout
    const onpremUpserts = mockUpsert.mock.calls.filter(
      (c) => c[0]?.where?.key === "onprem_qwen_config",
    );
    // Only the initial setup upsert, no rollout upsert
    expect(onpremUpserts.length).toBe(1);
  });

  it("rolls forward model_role_bindings when coder_default uses legacy onprem values", async () => {
    mockFindUnique.mockImplementation(({ where }: any) => {
      if (where.key === "onprem_qwen_config") {
        return { value: { pluginId: "custom-plugin", model: "custom/model", reasoningMode: "on" } };
      }
      if (where.key === "model_role_bindings") {
        return {
          value: {
            coder_default: {
              role: "coder_default",
              providerId: "onprem-qwen",
              pluginId: "qwen2.5-coder-3b",
              model: "Qwen/Qwen2.5-Coder-3B-Instruct",
            },
            review_deep: {
              role: "review_deep",
              providerId: "onprem-qwen",
              pluginId: "qwen2.5-coder-3b",
              model: "Qwen/Qwen2.5-Coder-3B-Instruct",
            },
          },
        };
      }
      return null;
    });

    await initDatabase();

    const roleUpserts = mockUpsert.mock.calls.filter(
      (c) => c[0]?.where?.key === "model_role_bindings",
    );
    // Last upsert should be from rollout (roleChanged = true)
    const lastRoleUpsert = roleUpserts[roleUpserts.length - 1];
    expect(lastRoleUpsert[0].update.value.coder_default.pluginId).toBe("qwen3.5-4b");
    expect(lastRoleUpsert[0].update.value.coder_default.reasoningMode).toBe("off");
    expect(lastRoleUpsert[0].update.value.review_deep.pluginId).toBe("qwen3.5-4b");
    expect(lastRoleUpsert[0].update.value.review_deep.reasoningMode).toBe("on");
  });

  it("skips role rollforward when providerId is not onprem-qwen", async () => {
    mockFindUnique.mockImplementation(({ where }: any) => {
      if (where.key === "onprem_qwen_config") {
        return { value: { pluginId: "custom-plugin", model: "custom/model", reasoningMode: "on" } };
      }
      if (where.key === "model_role_bindings") {
        return {
          value: {
            coder_default: {
              role: "coder_default",
              providerId: "openai-responses",
              pluginId: "some-plugin",
              model: "gpt-4o",
              reasoningMode: "off",
            },
            review_deep: {
              role: "review_deep",
              providerId: "openai-responses",
              pluginId: "some-plugin",
              model: "gpt-4o",
              reasoningMode: "on",
            },
            utility_fast: {
              role: "utility_fast",
              providerId: "openai-responses",
              pluginId: "some-plugin",
              model: "gpt-4o",
              reasoningMode: "off",
            },
          },
        };
      }
      return null;
    });

    await initDatabase();

    const roleUpserts = mockUpsert.mock.calls.filter(
      (c) => c[0]?.where?.key === "model_role_bindings",
    );
    // Should only have the initial setup upsert, not a rollout one
    expect(roleUpserts.length).toBe(1);
  });

  it("adds reasoningMode to role bindings that lack it and use onprem-qwen", async () => {
    mockFindUnique.mockImplementation(({ where }: any) => {
      if (where.key === "onprem_qwen_config") {
        return { value: { pluginId: "custom-plugin", model: "custom/model", reasoningMode: "on" } };
      }
      if (where.key === "model_role_bindings") {
        return {
          value: {
            utility_fast: {
              role: "utility_fast",
              providerId: "onprem-qwen",
              pluginId: "qwen3.5-0.8b",
              model: "Qwen/Qwen3.5-0.8B",
              // No reasoningMode
            },
            coder_default: {
              role: "coder_default",
              providerId: "onprem-qwen",
              pluginId: "qwen3.5-4b",
              model: "mlx-community/Qwen3.5-4B-4bit",
              // No reasoningMode — but pluginId is not legacy, so first loop skips
            },
          },
        };
      }
      return null;
    });

    await initDatabase();

    const roleUpserts = mockUpsert.mock.calls.filter(
      (c) => c[0]?.where?.key === "model_role_bindings",
    );
    const lastRoleUpsert = roleUpserts[roleUpserts.length - 1];
    // utility_fast should get reasoningMode "off"
    expect(lastRoleUpsert[0].update.value.utility_fast.reasoningMode).toBe("off");
    // coder_default should get reasoningMode "off"
    expect(lastRoleUpsert[0].update.value.coder_default.reasoningMode).toBe("off");
  });

  it("skips reasoningMode injection for roles that already have it", async () => {
    mockFindUnique.mockImplementation(({ where }: any) => {
      if (where.key === "onprem_qwen_config") {
        return { value: { pluginId: "custom-plugin", model: "custom/model", reasoningMode: "on" } };
      }
      if (where.key === "model_role_bindings") {
        return {
          value: {
            utility_fast: {
              role: "utility_fast",
              providerId: "onprem-qwen",
              pluginId: "qwen3.5-0.8b",
              model: "Qwen/Qwen3.5-0.8B",
              reasoningMode: "off", // already set
            },
            coder_default: {
              role: "coder_default",
              providerId: "onprem-qwen",
              pluginId: "qwen3.5-4b",
              model: "mlx-community/Qwen3.5-4B-4bit",
              reasoningMode: "off", // already set
            },
            review_deep: {
              role: "review_deep",
              providerId: "onprem-qwen",
              pluginId: "qwen3.5-4b",
              model: "mlx-community/Qwen3.5-4B-4bit",
              reasoningMode: "on", // already set
            },
          },
        };
      }
      return null;
    });

    await initDatabase();

    const roleUpserts = mockUpsert.mock.calls.filter(
      (c) => c[0]?.where?.key === "model_role_bindings",
    );
    // Only the initial setup upsert — no rollout needed since all have reasoningMode
    expect(roleUpserts.length).toBe(1);
  });

  it("handles null onprem_qwen_config record (no row in DB)", async () => {
    mockFindUnique.mockImplementation(({ where }: any) => {
      if (where.key === "onprem_qwen_config") {
        return null; // No row at all
      }
      if (where.key === "model_role_bindings") {
        return null;
      }
      return null;
    });

    await initDatabase();

    // Should roll forward since currentPluginId and currentModel are both empty
    const onpremUpserts = mockUpsert.mock.calls.filter(
      (c) => c[0]?.where?.key === "onprem_qwen_config",
    );
    const rolloutCall = onpremUpserts[onpremUpserts.length - 1];
    expect(rolloutCall[0].update.value.pluginId).toBe("qwen3.5-4b");
    expect(rolloutCall[0].update.value.model).toBe("mlx-community/Qwen3.5-4B-4bit");
  });

  it("rolls forward role bindings with empty pluginId and model", async () => {
    mockFindUnique.mockImplementation(({ where }: any) => {
      if (where.key === "onprem_qwen_config") {
        return { value: { pluginId: "custom", model: "custom/m", reasoningMode: "on" } };
      }
      if (where.key === "model_role_bindings") {
        return {
          value: {
            coder_default: {
              role: "coder_default",
              providerId: "onprem-qwen",
              // pluginId and model missing — should roll forward
            },
          },
        };
      }
      return null;
    });

    await initDatabase();

    const roleUpserts = mockUpsert.mock.calls.filter(
      (c) => c[0]?.where?.key === "model_role_bindings",
    );
    const lastRoleUpsert = roleUpserts[roleUpserts.length - 1];
    expect(lastRoleUpsert[0].update.value.coder_default.pluginId).toBe("qwen3.5-4b");
    expect(lastRoleUpsert[0].update.value.coder_default.model).toBe("mlx-community/Qwen3.5-4B-4bit");
  });

  it("sets review_deep reasoningMode to on during second-loop injection", async () => {
    mockFindUnique.mockImplementation(({ where }: any) => {
      if (where.key === "onprem_qwen_config") {
        return { value: { pluginId: "custom", model: "custom/m", reasoningMode: "on" } };
      }
      if (where.key === "model_role_bindings") {
        return {
          value: {
            review_deep: {
              role: "review_deep",
              providerId: "onprem-qwen",
              pluginId: "qwen3.5-4b",
              model: "mlx-community/Qwen3.5-4B-4bit",
              // No reasoningMode — second loop should inject "on"
            },
          },
        };
      }
      return null;
    });

    await initDatabase();

    const roleUpserts = mockUpsert.mock.calls.filter(
      (c) => c[0]?.where?.key === "model_role_bindings",
    );
    const lastRoleUpsert = roleUpserts[roleUpserts.length - 1];
    expect(lastRoleUpsert[0].update.value.review_deep.reasoningMode).toBe("on");
  });

  it("handles onprem_qwen_config.value with non-string pluginId and model", async () => {
    mockFindUnique.mockImplementation(({ where }: any) => {
      if (where.key === "onprem_qwen_config") {
        return {
          value: {
            pluginId: 123, // non-string
            model: null,   // non-string
          },
        };
      }
      if (where.key === "model_role_bindings") {
        return { value: {} };
      }
      return null;
    });

    await initDatabase();

    // Should treat non-string values as empty — roll forward
    const onpremUpserts = mockUpsert.mock.calls.filter(
      (c) => c[0]?.where?.key === "onprem_qwen_config",
    );
    const rolloutCall = onpremUpserts[onpremUpserts.length - 1];
    expect(rolloutCall[0].update.value.pluginId).toBe("qwen3.5-4b");
  });
});
