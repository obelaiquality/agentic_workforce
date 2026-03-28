#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { _electron as electron } from "playwright-core";
import { createTempDir, ensureDir, getArgValue, rootDir, timestampSlug, writeJson } from "./suite-utils.mjs";

const argv = process.argv.slice(2);
const outputDir = path.join(rootDir, "output", "playwright", `packaged-desktop-launch-${timestampSlug()}`);
const executablePath = getArgValue(argv, "--executable") || process.env.APP_EXECUTABLE || detectPackagedExecutable();
const userDataDir = await createTempDir("agentic-packaged-launch-userdata-");

await ensureDir(outputDir);
if (!executablePath) {
  throw new Error("Packaged executable not found. Pass --executable or set APP_EXECUTABLE.");
}

const electronApp = await electron.launch({
  executablePath,
  env: {
    ...process.env,
    CODEX_E2E: "1",
    ELECTRON_USER_DATA_DIR: userDataDir,
  },
});

try {
  const page = await electronApp.firstWindow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(5000);
  await page.screenshot({ path: path.join(outputDir, "01-launched.png"), fullPage: true });

  await writeJson(path.join(outputDir, "summary.json"), {
    executablePath,
    status: "passed",
  });
} finally {
  await electronApp.close();
}

function detectPackagedExecutable() {
  const candidates = [
    path.join(rootDir, "release", "linux-unpacked", "agentic-workforce"),
    path.join(rootDir, "release", "linux-unpacked", "Agentic Workforce"),
    path.join(rootDir, "release", "mac", "Agentic Workforce.app", "Contents", "MacOS", "Agentic Workforce"),
    path.join(rootDir, "release", "mac-arm64", "Agentic Workforce.app", "Contents", "MacOS", "Agentic Workforce"),
    path.join(rootDir, "release", "mac-x64", "Agentic Workforce.app", "Contents", "MacOS", "Agentic Workforce"),
    path.join(rootDir, "release", "win-unpacked", "Agentic Workforce.exe"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}
