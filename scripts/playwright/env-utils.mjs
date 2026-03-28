#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

export function loadLocalEnv(rootDir) {
  const merged = {};

  for (const name of [".env", ".env.local"]) {
    const filePath = path.join(rootDir, name);
    if (!fs.existsSync(filePath)) continue;
    Object.assign(merged, dotenv.parse(fs.readFileSync(filePath, "utf8")));
  }

  for (const [key, value] of Object.entries(merged)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  return merged;
}

export function resolveE2eRuntimePreset(defaultPreset = "default") {
  return process.env.E2E_RUNTIME_PRESET?.trim() || defaultPreset;
}
