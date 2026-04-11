import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearStoredSecret, ensureSecretStoreKey, getSecretState, getStoredSecret, hasSecretStoreKey, migrateLegacyProviderSecrets, PROVIDER_SECRET_NAMES, resolveSecretValue, setStoredSecret } from "./secretStore";

describe("secretStore standalone fallback", () => {
  const originalEnv = {
    appSecretboxKey: process.env.APP_SECRETBOX_KEY,
    appSecretboxKeyFile: process.env.APP_SECRETBOX_KEY_FILE,
    electronRunAsNode: process.env.ELECTRON_RUN_AS_NODE,
  };

  let tempDir = "";
  const storedSecrets = new Map<string, string>();
  const prisma = {
    secretRecord: {
      findUnique: vi.fn(async ({ where, select }: { where: { name: string }; select?: { name: true } }) => {
        const ciphertext = storedSecrets.get(where.name);
        if (!ciphertext) {
          return null;
        }
        if (select?.name) {
          return { name: where.name };
        }
        return { name: where.name, ciphertext };
      }),
      upsert: vi.fn(async ({ where, update, create }: { where: { name: string }; update: { ciphertext: string }; create: { ciphertext: string } }) => {
        storedSecrets.set(where.name, update?.ciphertext ?? create.ciphertext);
        return { name: where.name };
      }),
      deleteMany: vi.fn(async ({ where }: { where: { name: string } }) => {
        storedSecrets.delete(where.name);
        return { count: 1 };
      }),
    },
  };

  beforeEach(() => {
    storedSecrets.clear();
    vi.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentic-secret-store-"));
    delete process.env.APP_SECRETBOX_KEY;
    process.env.APP_SECRETBOX_KEY_FILE = path.join(tempDir, "secretbox.key");
    delete process.env.ELECTRON_RUN_AS_NODE;
  });

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    if (originalEnv.appSecretboxKey === undefined) delete process.env.APP_SECRETBOX_KEY;
    else process.env.APP_SECRETBOX_KEY = originalEnv.appSecretboxKey;
    if (originalEnv.appSecretboxKeyFile === undefined) delete process.env.APP_SECRETBOX_KEY_FILE;
    else process.env.APP_SECRETBOX_KEY_FILE = originalEnv.appSecretboxKeyFile;
    if (originalEnv.electronRunAsNode === undefined) delete process.env.ELECTRON_RUN_AS_NODE;
    else process.env.ELECTRON_RUN_AS_NODE = originalEnv.electronRunAsNode;
  });

  it("auto-provisions a local key and persists secrets in standalone mode", async () => {
    const key = ensureSecretStoreKey();
    expect(key).toBeTruthy();
    expect(process.env.APP_SECRETBOX_KEY).toBe(key);
    expect(fs.existsSync(process.env.APP_SECRETBOX_KEY_FILE!)).toBe(true);

    await setStoredSecret(prisma as never, "provider:test:apiKey", "super-secret");
    await expect(resolveSecretValue(prisma as never, "provider:test:apiKey")).resolves.toMatchObject({
      value: "super-secret",
      source: "stored",
    });

    await clearStoredSecret(prisma as never, "provider:test:apiKey");
    await expect(resolveSecretValue(prisma as never, "provider:test:apiKey")).resolves.toMatchObject({
      value: "",
      source: "none",
    });
  });

  it("stores and retrieves multiple secrets independently", async () => {
    ensureSecretStoreKey();

    await setStoredSecret(prisma as never, "secret:one", "value-one");
    await setStoredSecret(prisma as never, "secret:two", "value-two");
    await setStoredSecret(prisma as never, "secret:three", "value-three");

    await expect(resolveSecretValue(prisma as never, "secret:one")).resolves.toMatchObject({
      value: "value-one",
      source: "stored",
    });
    await expect(resolveSecretValue(prisma as never, "secret:two")).resolves.toMatchObject({
      value: "value-two",
      source: "stored",
    });
    await expect(resolveSecretValue(prisma as never, "secret:three")).resolves.toMatchObject({
      value: "value-three",
      source: "stored",
    });
  });

  it("rotates an existing secret when updated", async () => {
    ensureSecretStoreKey();

    await setStoredSecret(prisma as never, "rotatable:key", "original-value");
    await expect(resolveSecretValue(prisma as never, "rotatable:key")).resolves.toMatchObject({
      value: "original-value",
      source: "stored",
    });

    await setStoredSecret(prisma as never, "rotatable:key", "rotated-value");
    await expect(resolveSecretValue(prisma as never, "rotatable:key")).resolves.toMatchObject({
      value: "rotated-value",
      source: "stored",
    });

    expect(storedSecrets.size).toBe(1);
    expect(prisma.secretRecord.upsert).toHaveBeenCalledTimes(2);
  });

  it("returns none for non-existent secret lookups", async () => {
    ensureSecretStoreKey();

    await expect(resolveSecretValue(prisma as never, "non:existent:key")).resolves.toMatchObject({
      value: "",
      source: "none",
    });
  });

  it("deletes a specific secret without affecting others", async () => {
    ensureSecretStoreKey();

    await setStoredSecret(prisma as never, "keep:this", "keep-value");
    await setStoredSecret(prisma as never, "delete:this", "delete-value");

    await clearStoredSecret(prisma as never, "delete:this");

    await expect(resolveSecretValue(prisma as never, "keep:this")).resolves.toMatchObject({
      value: "keep-value",
      source: "stored",
    });
    await expect(resolveSecretValue(prisma as never, "delete:this")).resolves.toMatchObject({
      value: "",
      source: "none",
    });
  });

  it("prefers env values over stored secrets when both exist", async () => {
    ensureSecretStoreKey();

    await setStoredSecret(prisma as never, "overridden:key", "stored-value");

    await expect(resolveSecretValue(prisma as never, "overridden:key", "env-value")).resolves.toMatchObject({
      value: "stored-value",
      source: "stored",
    });
  });

  it("falls back to env value when no stored secret exists", async () => {
    ensureSecretStoreKey();

    await expect(resolveSecretValue(prisma as never, "env:only:key", "from-environment")).resolves.toMatchObject({
      value: "from-environment",
      source: "env",
    });
  });

  it("treats empty strings as deletions", async () => {
    ensureSecretStoreKey();

    await setStoredSecret(prisma as never, "clear:me", "initial-value");
    await expect(resolveSecretValue(prisma as never, "clear:me")).resolves.toMatchObject({
      value: "initial-value",
      source: "stored",
    });

    await setStoredSecret(prisma as never, "clear:me", "");
    await expect(resolveSecretValue(prisma as never, "clear:me")).resolves.toMatchObject({
      value: "",
      source: "none",
    });

    expect(prisma.secretRecord.deleteMany).toHaveBeenCalledWith({ where: { name: "clear:me" } });
  });

  it("trims whitespace from stored values", async () => {
    ensureSecretStoreKey();

    await setStoredSecret(prisma as never, "trimmed:key", "  padded-value  ");

    const result = await resolveSecretValue(prisma as never, "trimmed:key");
    expect(result.value).toBe("padded-value");
    expect(result.source).toBe("stored");
  });

  it("reports secret state as stored when secret exists in DB", async () => {
    ensureSecretStoreKey();

    await setStoredSecret(prisma as never, "state:stored", "some-value");

    const state = await getSecretState(prisma as never, "state:stored");
    expect(state).toMatchObject({
      hasSecret: true,
      source: "stored",
    });
  });

  it("reports secret state as env when only env value provided", async () => {
    ensureSecretStoreKey();

    const state = await getSecretState(prisma as never, "state:env", "env-provided");
    expect(state).toMatchObject({
      hasSecret: true,
      source: "env",
    });
  });

  it("reports secret state as none when neither stored nor env exists", async () => {
    ensureSecretStoreKey();

    const state = await getSecretState(prisma as never, "state:missing");
    expect(state).toMatchObject({
      hasSecret: false,
      source: "none",
    });
  });

  it("returns null from getStoredSecret when key not found", async () => {
    ensureSecretStoreKey();

    const value = await getStoredSecret(prisma as never, "missing:key");
    expect(value).toBeNull();
  });

  it("checks key availability with hasSecretStoreKey", () => {
    ensureSecretStoreKey();
    expect(hasSecretStoreKey()).toBe(true);
  });

  it("reuses existing key from file on subsequent calls", () => {
    const firstKey = ensureSecretStoreKey();
    expect(firstKey).toBeTruthy();

    delete process.env.APP_SECRETBOX_KEY;

    const secondKey = ensureSecretStoreKey();
    expect(secondKey).toBe(firstKey);
  });

  it("accepts a 64-hex-character key from env", () => {
    const hexKey = "a".repeat(64);
    process.env.APP_SECRETBOX_KEY = hexKey;
    const result = ensureSecretStoreKey();
    expect(result).toBe(hexKey);
  });

  it("returns null when ELECTRON_RUN_AS_NODE is set and no env key", () => {
    process.env.ELECTRON_RUN_AS_NODE = "1";
    delete process.env.APP_SECRETBOX_KEY;
    // Remove any standalone key file
    const keyFile = process.env.APP_SECRETBOX_KEY_FILE!;
    if (fs.existsSync(keyFile)) fs.rmSync(keyFile);
    const result = ensureSecretStoreKey();
    expect(result).toBeNull();
  });

  it("returns null from getStoredSecret when no secret key is available", async () => {
    process.env.ELECTRON_RUN_AS_NODE = "1";
    delete process.env.APP_SECRETBOX_KEY;
    const keyFile = process.env.APP_SECRETBOX_KEY_FILE!;
    if (fs.existsSync(keyFile)) fs.rmSync(keyFile);

    const value = await getStoredSecret(prisma as never, "any:key");
    expect(value).toBeNull();
  });

  it("hasSecretStoreKey returns false when no key is available", () => {
    process.env.ELECTRON_RUN_AS_NODE = "1";
    delete process.env.APP_SECRETBOX_KEY;
    const keyFile = process.env.APP_SECRETBOX_KEY_FILE!;
    if (fs.existsSync(keyFile)) fs.rmSync(keyFile);

    expect(hasSecretStoreKey()).toBe(false);
  });

  it("throws when setting a secret with no valid key", async () => {
    process.env.ELECTRON_RUN_AS_NODE = "1";
    delete process.env.APP_SECRETBOX_KEY;
    const keyFile = process.env.APP_SECRETBOX_KEY_FILE!;
    if (fs.existsSync(keyFile)) fs.rmSync(keyFile);

    await expect(
      setStoredSecret(prisma as never, "test:key", "value"),
    ).rejects.toThrow("Encrypted secret storage is unavailable");
  });

  it("decodes a base64 key from env", () => {
    const crypto = require("node:crypto");
    const buf = crypto.randomBytes(32);
    const b64 = buf.toString("base64");
    process.env.APP_SECRETBOX_KEY = b64;
    const result = ensureSecretStoreKey();
    expect(result).toBe(b64);
  });

  it("rejects an invalid (non-32-byte, non-hex) key and auto-provisions", () => {
    process.env.APP_SECRETBOX_KEY = "not-a-valid-key";
    const result = ensureSecretStoreKey();
    // It should fall through invalid key and auto-provision
    expect(result).toBeTruthy();
    // The auto-provisioned key should be different from the invalid one
    expect(result).not.toBe("not-a-valid-key");
  });

  it("reports secret state as none for empty env string", async () => {
    ensureSecretStoreKey();
    const state = await getSecretState(prisma as never, "state:empty-env", "  ");
    expect(state).toMatchObject({
      hasSecret: false,
      source: "none",
    });
  });

  it("resolveSecretValue trims env value", async () => {
    ensureSecretStoreKey();
    const result = await resolveSecretValue(prisma as never, "env:trimmed", "  padded-env  ");
    expect(result.value).toBe("padded-env");
    expect(result.source).toBe("env");
  });

  it("resolveSecretValue returns none for empty env string", async () => {
    ensureSecretStoreKey();
    const result = await resolveSecretValue(prisma as never, "env:empty", "   ");
    expect(result.value).toBe("");
    expect(result.source).toBe("none");
  });

  it("PROVIDER_SECRET_NAMES.onPremRoleRuntimeApiKey generates correct name", () => {
    expect(PROVIDER_SECRET_NAMES.onPremRoleRuntimeApiKey("coder_default")).toBe(
      "provider:onprem-qwen:role-runtime:coder_default:apiKey",
    );
    expect(PROVIDER_SECRET_NAMES.onPremRoleRuntimeApiKey("review_deep")).toBe(
      "provider:onprem-qwen:role-runtime:review_deep:apiKey",
    );
  });
});

describe("secretStore migrateLegacyProviderSecrets", () => {
  const originalEnv = {
    appSecretboxKey: process.env.APP_SECRETBOX_KEY,
    appSecretboxKeyFile: process.env.APP_SECRETBOX_KEY_FILE,
    electronRunAsNode: process.env.ELECTRON_RUN_AS_NODE,
  };

  let tempDir = "";

  const storedSecrets = new Map<string, string>();
  const appSettings = new Map<string, { key: string; value: Record<string, unknown> }>();

  const prisma = {
    secretRecord: {
      findUnique: vi.fn(async ({ where, select }: { where: { name: string }; select?: { name: true } }) => {
        const ciphertext = storedSecrets.get(where.name);
        if (!ciphertext) return null;
        if (select?.name) return { name: where.name };
        return { name: where.name, ciphertext };
      }),
      upsert: vi.fn(async ({ where, update, create }: { where: { name: string }; update: { ciphertext: string }; create: { ciphertext: string } }) => {
        storedSecrets.set(where.name, update?.ciphertext ?? create.ciphertext);
        return { name: where.name };
      }),
      deleteMany: vi.fn(async ({ where }: { where: { name: string } }) => {
        storedSecrets.delete(where.name);
        return { count: 1 };
      }),
    },
    appSetting: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => {
        return appSettings.get(where.key) || null;
      }),
      update: vi.fn(async ({ where, data }: { where: { key: string }; data: { value: unknown } }) => {
        const existing = appSettings.get(where.key);
        if (existing) {
          appSettings.set(where.key, { ...existing, value: data.value as Record<string, unknown> });
        }
        return { key: where.key };
      }),
    },
  };

  beforeEach(() => {
    storedSecrets.clear();
    appSettings.clear();
    vi.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentic-secret-migrate-"));
    delete process.env.APP_SECRETBOX_KEY;
    process.env.APP_SECRETBOX_KEY_FILE = path.join(tempDir, "secretbox.key");
    delete process.env.ELECTRON_RUN_AS_NODE;
  });

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    if (originalEnv.appSecretboxKey === undefined) delete process.env.APP_SECRETBOX_KEY;
    else process.env.APP_SECRETBOX_KEY = originalEnv.appSecretboxKey;
    if (originalEnv.appSecretboxKeyFile === undefined) delete process.env.APP_SECRETBOX_KEY_FILE;
    else process.env.APP_SECRETBOX_KEY_FILE = originalEnv.appSecretboxKeyFile;
    if (originalEnv.electronRunAsNode === undefined) delete process.env.ELECTRON_RUN_AS_NODE;
    else process.env.ELECTRON_RUN_AS_NODE = originalEnv.electronRunAsNode;
  });

  it("returns false when no secret key is available", async () => {
    process.env.ELECTRON_RUN_AS_NODE = "1";
    delete process.env.APP_SECRETBOX_KEY;
    const keyFile = process.env.APP_SECRETBOX_KEY_FILE!;
    if (fs.existsSync(keyFile)) fs.rmSync(keyFile);

    const { migrateLegacyProviderSecrets } = await import("./secretStore");
    const result = await migrateLegacyProviderSecrets(prisma as never);
    expect(result).toBe(false);
  });

  it("migrates flat provider settings and removes apiKey from config", async () => {
    ensureSecretStoreKey();

    appSettings.set("onprem_qwen_config", {
      key: "onprem_qwen_config",
      value: { apiKey: "qwen-secret", baseUrl: "http://localhost:8080" },
    });
    appSettings.set("openai_compatible_config", {
      key: "openai_compatible_config",
      value: { apiKey: "compat-secret", model: "gpt-4" },
    });
    appSettings.set("openai_responses_config", {
      key: "openai_responses_config",
      value: { apiKey: "responses-secret" },
    });

    const { migrateLegacyProviderSecrets } = await import("./secretStore");
    const result = await migrateLegacyProviderSecrets(prisma as never);
    expect(result).toBe(true);

    // apiKey should be stored as encrypted secrets
    expect(prisma.secretRecord.upsert).toHaveBeenCalledTimes(3);

    // appSetting should be updated to remove apiKey field
    expect(prisma.appSetting.update).toHaveBeenCalledTimes(3);

    // Check that apiKey was removed from the updated settings
    const qwenUpdate = prisma.appSetting.update.mock.calls.find(
      (c: any[]) => c[0].where.key === "onprem_qwen_config",
    );
    expect(qwenUpdate).toBeTruthy();
    expect((qwenUpdate![0] as any).data.value).not.toHaveProperty("apiKey");
    expect((qwenUpdate![0] as any).data.value).toHaveProperty("baseUrl", "http://localhost:8080");
  });

  it("migrates role runtime apiKeys and updates configs", async () => {
    ensureSecretStoreKey();

    appSettings.set("onprem_qwen_role_runtime_configs", {
      key: "onprem_qwen_role_runtime_configs",
      value: {
        coder_default: { apiKey: "coder-key", model: "qwen-4b" },
        review_deep: { apiKey: "review-key", model: "qwen-7b" },
        utility_fast: { model: "qwen-0.8b" }, // no apiKey
      },
    });

    const { migrateLegacyProviderSecrets } = await import("./secretStore");
    const result = await migrateLegacyProviderSecrets(prisma as never);
    expect(result).toBe(true);

    // Should have stored 2 secrets (coder_default + review_deep, not utility_fast)
    expect(prisma.secretRecord.upsert).toHaveBeenCalledTimes(2);

    // Should have updated the role runtime configs
    const runtimeUpdate = prisma.appSetting.update.mock.calls.find(
      (c: any[]) => c[0].where.key === "onprem_qwen_role_runtime_configs",
    );
    expect(runtimeUpdate).toBeTruthy();
  });

  it("skips migration when flat setting has no apiKey", async () => {
    ensureSecretStoreKey();

    appSettings.set("onprem_qwen_config", {
      key: "onprem_qwen_config",
      value: { baseUrl: "http://localhost:8080" }, // no apiKey
    });

    const { migrateLegacyProviderSecrets } = await import("./secretStore");
    const result = await migrateLegacyProviderSecrets(prisma as never);
    expect(result).toBe(true);

    expect(prisma.secretRecord.upsert).not.toHaveBeenCalled();
    expect(prisma.appSetting.update).not.toHaveBeenCalled();
  });

  it("skips migration when flat setting has empty apiKey", async () => {
    ensureSecretStoreKey();

    appSettings.set("onprem_qwen_config", {
      key: "onprem_qwen_config",
      value: { apiKey: "  ", baseUrl: "http://localhost:8080" },
    });

    const { migrateLegacyProviderSecrets } = await import("./secretStore");
    const result = await migrateLegacyProviderSecrets(prisma as never);
    expect(result).toBe(true);

    expect(prisma.secretRecord.upsert).not.toHaveBeenCalled();
  });

  it("handles role runtimes with non-object values gracefully", async () => {
    ensureSecretStoreKey();

    appSettings.set("onprem_qwen_role_runtime_configs", {
      key: "onprem_qwen_role_runtime_configs",
      value: {
        coder_default: "not-an-object" as unknown as Record<string, unknown>,
        review_deep: null as unknown as Record<string, unknown>,
      },
    });

    const { migrateLegacyProviderSecrets } = await import("./secretStore");
    const result = await migrateLegacyProviderSecrets(prisma as never);
    expect(result).toBe(true);

    expect(prisma.secretRecord.upsert).not.toHaveBeenCalled();
  });

  it("throws on malformed ciphertext during getStoredSecret", async () => {
    ensureSecretStoreKey();

    // Store a malformed payload directly (missing required fields)
    storedSecrets.set("malformed:key", JSON.stringify({ v: 2 }));

    await expect(getStoredSecret(prisma as never, "malformed:key")).rejects.toThrow("malformed");
  });

  it("throws on ciphertext with missing iv field", async () => {
    ensureSecretStoreKey();

    storedSecrets.set("bad:iv", JSON.stringify({ v: 1, tag: "abc", data: "def" }));

    await expect(getStoredSecret(prisma as never, "bad:iv")).rejects.toThrow("malformed");
  });

  it("handles role runtimes that are an array (not object)", async () => {
    ensureSecretStoreKey();

    appSettings.set("onprem_qwen_role_runtime_configs", {
      key: "onprem_qwen_role_runtime_configs",
      value: [1, 2, 3] as unknown as Record<string, Record<string, unknown>>,
    });

    const { migrateLegacyProviderSecrets } = await import("./secretStore");
    const result = await migrateLegacyProviderSecrets(prisma as never);
    expect(result).toBe(true);

    // Should not attempt to iterate over array entries as role runtimes
    expect(prisma.secretRecord.upsert).not.toHaveBeenCalled();
  });
});
