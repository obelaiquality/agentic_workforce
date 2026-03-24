import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearStoredSecret, ensureSecretStoreKey, resolveSecretValue, setStoredSecret } from "./secretStore";

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
});
