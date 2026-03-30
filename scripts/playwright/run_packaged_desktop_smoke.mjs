#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { _electron as electron } from "playwright-core";
import {
  createTempDir,
  ensureDir,
  getArgValue,
  getFreePort,
  rootDir,
  timestampSlug,
  waitForHttpOk,
  writeJson,
} from "./suite-utils.mjs";

const argv = process.argv.slice(2);
const outputDir = path.join(rootDir, "output", "playwright", `packaged-desktop-smoke-${timestampSlug()}`);
const executablePath = getArgValue(argv, "--executable") || process.env.APP_EXECUTABLE || detectPackagedExecutable();
const apiPort = await getFreePort();
const apiToken = `packaged-smoke-${Date.now()}`;
const tempRepoDir = await createTempDir("agentic-packaged-smoke-repo-");
const userDataDir = await createTempDir("agentic-packaged-smoke-userdata-");

await ensureDir(outputDir);
if (!executablePath) {
  throw new Error("Packaged executable not found. Pass --executable or set APP_EXECUTABLE.");
}

const electronApp = await electron.launch({
  executablePath,
  env: {
    ...process.env,
    CODEX_E2E: "1",
    CODEX_E2E_PICK_REPO_PATH: tempRepoDir,
    ELECTRON_USER_DATA_DIR: userDataDir,
    API_PORT: String(apiPort),
    API_TOKEN: apiToken,
  },
});

try {
  await waitForHttpOk(`http://127.0.0.1:${apiPort}/health`, 120000);
  const page = await electronApp.firstWindow();
  await page.setViewportSize({ width: 1600, height: 960 });
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("button", { name: "Projects" }).waitFor({ timeout: 120000 });
  await page.screenshot({ path: path.join(outputDir, "01-launched.png"), fullPage: true });

  await page.getByRole("button", { name: "Projects" }).click();
  await page.getByRole("button", { name: "My Projects" }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Connect New" }).click();
  await page.locator("button").filter({ hasText: /^New Project$/ }).first().waitFor({ timeout: 10000 });
  await page.locator("button").filter({ hasText: /^New Project$/ }).first().click({ force: true });
  await waitForActiveRepo(apiPort, apiToken, tempRepoDir);
  await page.screenshot({ path: path.join(outputDir, "02-project-created.png"), fullPage: true });

  await page.getByRole("button", { name: "Work" }).click();
  await page.getByRole("heading", { name: "Describe the task" }).waitFor({ timeout: 30000 });
  await page.screenshot({ path: path.join(outputDir, "03-work.png"), fullPage: true });

  await writeJson(path.join(outputDir, "summary.json"), {
    executablePath,
    apiPort,
    tempRepoDir,
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

async function waitForActiveRepo(apiPort, apiToken, sourceUri) {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const response = await fetch(`http://127.0.0.1:${apiPort}/api/v4/repos`, {
      headers: { "x-local-api-token": apiToken },
    });
    if (response.ok) {
      const payload = await response.json();
      const match = (payload.items || []).find((item) => item.sourceUri === sourceUri);
      if (match?.active) {
        return match;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Timed out waiting for the packaged app to create and activate a project.");
}
