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
