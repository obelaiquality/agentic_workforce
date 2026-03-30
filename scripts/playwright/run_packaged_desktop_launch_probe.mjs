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
  seedExistingRepoFixture,
  timestampSlug,
  writeJson,
} from "./suite-utils.mjs";

const argv = process.argv.slice(2);
const outputDir = path.join(rootDir, "output", "playwright", `packaged-desktop-launch-${timestampSlug()}`);
const executablePath = getArgValue(argv, "--executable") || process.env.APP_EXECUTABLE || detectPackagedExecutable();
const apiPort = Number(process.env.API_PORT || (await getFreePort()));
const apiToken = process.env.API_TOKEN?.trim() || `packaged-launch-${Date.now()}`;
const tempRepoDir = await createTempDir("agentic-packaged-launch-repo-");
await seedExistingRepoFixture(tempRepoDir);
const tempRepoCanonicalPath = fs.realpathSync(tempRepoDir);
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
    CODEX_E2E_PICK_REPO_PATH: tempRepoDir,
    ELECTRON_USER_DATA_DIR: userDataDir,
    API_PORT: String(apiPort),
    API_TOKEN: apiToken,
  },
});

try {
  const page = await electronApp.firstWindow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForLoadState("domcontentloaded");

  const preflight = await waitForPreflight(page);
  await page.screenshot({ path: path.join(outputDir, "01-shell.png"), fullPage: true });

  const projectFlow = {
    attempted: Boolean(preflight.apiReady),
    passed: false,
    reason: preflight.apiReady
      ? "Local API became ready and the packaged local-repo attach flow was exercised."
      : "Local API stayed unavailable in this environment; launch proof captured shell startup and preflight state only.",
  };

  if (preflight.apiReady) {
    await page.getByRole("button", { name: "Projects" }).waitFor({ timeout: 30000 });
    await page.getByRole("button", { name: "Projects" }).click();
    await page.getByRole("button", { name: "My Projects" }).waitFor({ timeout: 30000 });
    await page.getByRole("button", { name: "Connect New" }).click();
    await page.getByRole("button", { name: /Choose Local Repo|Opening Repo/i }).waitFor({ timeout: 10000 });
    await page.getByRole("button", { name: /Choose Local Repo|Opening Repo/i }).click();
    const activeRepo = await waitForActiveRepo(apiPort, apiToken, tempRepoDir, tempRepoCanonicalPath);
    await page.screenshot({ path: path.join(outputDir, "02-project-created.png"), fullPage: true });

    await page.getByRole("button", { name: "Work" }).click();
    await page.getByRole("heading", { name: "Describe the task" }).waitFor({ timeout: 30000 });
    await page.screenshot({ path: path.join(outputDir, "03-work.png"), fullPage: true });
    projectFlow.passed = true;
    projectFlow.reason = `Seeded local repo attached and activated (${activeRepo.displayName}).`;
    projectFlow.activeRepo = {
      id: activeRepo.id,
      displayName: activeRepo.displayName,
      sourceUri: activeRepo.sourceUri,
    };
  }

  await writeJson(path.join(outputDir, "summary.json"), {
    executablePath,
    apiPort,
    tempRepoDir,
    preflight,
    projectFlow,
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

async function waitForPreflight(page) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const preflight = await page.evaluate(async () => {
      if (!window.desktopBridge?.getPreflight) {
        return null;
      }
      return window.desktopBridge.getPreflight();
    });
    if (preflight?.checkedAt && Array.isArray(preflight.checks) && preflight.checks.length > 0) {
      return preflight;
    }
    await page.waitForTimeout(1000);
  }
  throw new Error("Timed out waiting for desktop preflight state.");
}

async function waitForActiveRepo(apiPort, apiToken, ...sourceUris) {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const [reposResponse, activeResponse] = await Promise.all([
      fetch(`http://127.0.0.1:${apiPort}/api/v4/repos`, {
        headers: { "x-local-api-token": apiToken },
      }),
      fetch(`http://127.0.0.1:${apiPort}/api/v4/repos/active`, {
        headers: { "x-local-api-token": apiToken },
      }),
    ]);
    if (reposResponse.ok && activeResponse.ok) {
      const payload = await reposResponse.json();
      const activePayload = await activeResponse.json();
      const activeRepo = activePayload?.item || null;
      const match = (payload.items || []).find((item) => sourceUris.includes(item.sourceUri));
      if (match && activeRepo?.id === match.id) {
        return activeRepo;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Timed out waiting for the packaged app to attach and activate the seeded local repo.");
}
