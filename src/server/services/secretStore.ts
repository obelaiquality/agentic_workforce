import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";

const SECRET_KEY_ENV = "APP_SECRETBOX_KEY";
const SECRET_KEY_FILE_ENV = "APP_SECRETBOX_KEY_FILE";
const KEY_BYTES = 32;
const IV_BYTES = 12;

export type SecretSource = "stored" | "env" | "none";

export const PROVIDER_SECRET_NAMES = {
  onPremQwenApiKey: "provider:onprem-qwen:apiKey",
  openAiCompatibleApiKey: "provider:openai-compatible:apiKey",
  openAiResponsesApiKey: "provider:openai-responses:apiKey",
  onPremRoleRuntimeApiKey(role: string) {
    return `provider:onprem-qwen:role-runtime:${role}:apiKey`;
  },
} as const;

function decodeSecretKey(input: string) {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  if (/^[a-f0-9]{64}$/i.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }

  try {
    const decoded = Buffer.from(trimmed, "base64");
    if (decoded.length === KEY_BYTES) {
      return decoded;
    }
  } catch {
    // Invalid base64, fall through.
  }

  return null;
}

function resolveStandaloneSecretKeyPath() {
  const override = process.env[SECRET_KEY_FILE_ENV]?.trim();
  if (override) {
    return override;
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "AgenticWorkforce", "secretbox.key");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "AgenticWorkforce", "secretbox.key");
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "agentic-workforce", "secretbox.key");
}

function readStandaloneSecretKey() {
  const filePath = resolveStandaloneSecretKeyPath();
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return fs.readFileSync(filePath, "utf8").trim();
  } catch {
    return null;
  }
}

function writeStandaloneSecretKey(value: string) {
  const filePath = resolveStandaloneSecretKeyPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${value}\n`, { encoding: "utf8", mode: 0o600 });
}

export function ensureSecretStoreKey() {
  const fromEnv = decodeSecretKey(process.env[SECRET_KEY_ENV] || "");
  if (fromEnv) {
    return process.env[SECRET_KEY_ENV]!.trim();
  }

  if (process.env.ELECTRON_RUN_AS_NODE === "1") {
    return null;
  }

  const stored = readStandaloneSecretKey();
  const decodedStored = stored ? decodeSecretKey(stored) : null;
  if (decodedStored) {
    process.env[SECRET_KEY_ENV] = stored!.trim();
    return process.env[SECRET_KEY_ENV]!;
  }

  const generated = crypto.randomBytes(KEY_BYTES).toString("base64");
  writeStandaloneSecretKey(generated);
  process.env[SECRET_KEY_ENV] = generated;
  return generated;
}

function loadSecretKey() {
  const raw = process.env[SECRET_KEY_ENV] || ensureSecretStoreKey() || "";
  if (!raw) {
    return null;
  }
  return decodeSecretKey(raw);
}

function requireSecretKey() {
  const key = loadSecretKey();
  if (!key) {
    throw new Error(
      "Encrypted secret storage is unavailable because APP_SECRETBOX_KEY is not configured as a 32-byte base64 or hex value."
    );
  }
  return key;
}

function encryptValue(value: string, key: Buffer) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    v: 1,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: ciphertext.toString("base64"),
  });
}

function decryptValue(payload: string, key: Buffer) {
  const parsed = JSON.parse(payload) as { v?: number; iv?: string; tag?: string; data?: string };
  if (parsed.v !== 1 || !parsed.iv || !parsed.tag || !parsed.data) {
    throw new Error("Secret payload is malformed.");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(parsed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(parsed.data, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

export function hasSecretStoreKey() {
  return Boolean(loadSecretKey());
}

export async function getStoredSecret(prisma: PrismaClient, name: string) {
  const key = loadSecretKey();
  if (!key) {
    return null;
  }
  const row = await prisma.secretRecord.findUnique({ where: { name } });
  if (!row) {
    return null;
  }
  return decryptValue(row.ciphertext, key);
}

export async function getSecretState(prisma: PrismaClient, name: string, envValue?: string | null) {
  const stored = await prisma.secretRecord.findUnique({
    where: { name },
    select: { name: true },
  });
  if (stored) {
    return {
      hasSecret: true,
      source: "stored" as const,
    };
  }
  if (typeof envValue === "string" && envValue.trim()) {
    return {
      hasSecret: true,
      source: "env" as const,
    };
  }
  return {
    hasSecret: false,
    source: "none" as const,
  };
}

export async function resolveSecretValue(prisma: PrismaClient, name: string, envValue?: string | null) {
  const stored = await getStoredSecret(prisma, name);
  if (typeof stored === "string" && stored.trim()) {
    return {
      value: stored,
      source: "stored" as SecretSource,
    };
  }
  if (typeof envValue === "string" && envValue.trim()) {
    return {
      value: envValue.trim(),
      source: "env" as SecretSource,
    };
  }
  return {
    value: "",
    source: "none" as SecretSource,
  };
}

export async function setStoredSecret(prisma: PrismaClient, name: string, value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    await clearStoredSecret(prisma, name);
    return;
  }
  const key = requireSecretKey();
  await prisma.secretRecord.upsert({
    where: { name },
    update: { ciphertext: encryptValue(trimmed, key) },
    create: {
      name,
      ciphertext: encryptValue(trimmed, key),
    },
  });
}

export async function clearStoredSecret(prisma: PrismaClient, name: string) {
  await prisma.secretRecord.deleteMany({
    where: { name },
  });
}

function omitKey(value: unknown, keyToOmit: string) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
  delete record[keyToOmit];
  return record;
}

export async function migrateLegacyProviderSecrets(prisma: PrismaClient) {
  if (!hasSecretStoreKey()) {
    return false;
  }

  const migrateFlatSetting = async (settingKey: string, fieldName: string, secretName: string) => {
    const row = await prisma.appSetting.findUnique({ where: { key: settingKey } });
    const value = row?.value as Record<string, unknown> | null;
    if (!value || typeof value[fieldName] !== "string" || !(value[fieldName] as string).trim()) {
      return;
    }
    await setStoredSecret(prisma, secretName, value[fieldName] as string);
    await prisma.appSetting.update({
      where: { key: settingKey },
      data: {
        value: omitKey(value, fieldName),
      },
    });
  };

  await migrateFlatSetting("onprem_qwen_config", "apiKey", PROVIDER_SECRET_NAMES.onPremQwenApiKey);
  await migrateFlatSetting("openai_compatible_config", "apiKey", PROVIDER_SECRET_NAMES.openAiCompatibleApiKey);
  await migrateFlatSetting("openai_responses_config", "apiKey", PROVIDER_SECRET_NAMES.openAiResponsesApiKey);

  const roleRuntimeRow = await prisma.appSetting.findUnique({
    where: { key: "onprem_qwen_role_runtime_configs" },
  });
  const runtimes = roleRuntimeRow?.value as Record<string, Record<string, unknown>> | null;
  if (runtimes && typeof runtimes === "object" && !Array.isArray(runtimes)) {
    let changed = false;
    const next = { ...runtimes };
    for (const [role, rawValue] of Object.entries(runtimes)) {
      const runtime = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) ? { ...rawValue } : {};
      if (typeof runtime.apiKey !== "string" || !runtime.apiKey.trim()) {
        continue;
      }
      await setStoredSecret(prisma, PROVIDER_SECRET_NAMES.onPremRoleRuntimeApiKey(role), runtime.apiKey);
      delete runtime.apiKey;
      next[role] = runtime;
      changed = true;
    }
    if (changed) {
      await prisma.appSetting.update({
        where: { key: "onprem_qwen_role_runtime_configs" },
        data: { value: next },
      });
    }
  }

  return true;
}
