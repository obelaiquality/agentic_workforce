import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearStoredSecret, ensureSecretStoreKey, getSecretState, getStoredSecret, hasSecretStoreKey, resolveSecretValue, setStoredSecret } from "./secretStore";

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
});
