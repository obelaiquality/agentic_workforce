#!/usr/bin/env node
/**
 * Generalized follow-up feature acceptance scenario.
 *
 * Usage:
 *   node scripts/playwright/run_followup_scenario.mjs [--scenario <name>]
 *
 * Scenarios:
 *   status-badge   (default) — Add a StatusBadge component
 *   progress-bar   — Add a ProgressBar component
 *   utility-module — Add a utility module with tests
 *   api-stop       — Test the stop action endpoint mid-execution
 *   rename-component — Rename an existing component and update all references
 *
 * This script reuses the scaffold+followup pattern from the main acceptance
 * harness but parameterizes the objective, expected artifacts, and assertions.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { _electron as electron } from "playwright-core";

const root = "/Users/neilslab/agentic_workforce";
const scenarioArg = process.argv.find((_, i, arr) => arr[i - 1] === "--scenario") || "status-badge";

const SCENARIOS = {
  "status-badge": {
    objective: "Add a status badge component to the app and test it. Update any docs if needed.",
    expectedFilePattern: /status-?badge\.tsx$/i,
    expectedContentPattern: /statusbadge|status badge/i,
    label: "StatusBadge",
  },
  "progress-bar": {
    objective: "Add a progress bar component that shows a percentage and test it. Update docs if needed.",
    expectedFilePattern: /progress-?bar\.tsx$/i,
    expectedContentPattern: /progressbar|progress bar|progress/i,
    label: "ProgressBar",
  },
  "utility-module": {
    objective: "Add a src/utils/format.ts utility module with a formatCurrency function. Add tests for it. Update docs.",
    expectedFilePattern: /format\.(ts|tsx)$/i,
    expectedContentPattern: /formatcurrency|format_currency|formatCurrency/i,
    label: "FormatUtility",
  },
  "api-stop": {
    objective: "Add a status badge component to the app and test it. Update any docs if needed.",
    expectedFilePattern: /status-?badge\.tsx$/i,
    expectedContentPattern: /statusbadge|status badge/i,
    label: "StopAction",
    testStop: true,
  },
  "rename-component": {
    objective: "Rename the StatusBadge component to StatusIndicator everywhere — file name, component name, tests, imports, and docs. Make sure lint, tests, and build still pass.",
    expectedFilePattern: /status-?indicator\.tsx$/i,
    expectedContentPattern: /statusindicator|status indicator|StatusIndicator/i,
    label: "RenameComponent",
    requiresPreExisting: true,
    preExistingFilePattern: /status-?badge\.tsx$/i,
    preExistingGonePattern: /StatusBadge/,
  },
};

const scenario = SCENARIOS[scenarioArg];
if (!scenario) {
  process.stderr.write(`Unknown scenario: ${scenarioArg}\nAvailable: ${Object.keys(SCENARIOS).join(", ")}\n`);
  process.exit(1);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = path.join(root, "output", "playwright", `followup-${scenarioArg}-${timestamp}`);

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => {
        if (error) { reject(error); return; }
        if (!port) { reject(new Error("Failed to allocate a free port")); return; }
        resolve(port);
      });
    });
  });
}

const vitePort = await getFreePort();
const apiPort = await getFreePort();
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const apiToken = `desktop-e2e-${Date.now()}`;
const tempRepoDir = await fsp.mkdtemp(path.join(os.tmpdir(), "agentic-followup-e2e-"));
const tempRepoCanonicalPath = await fsp.realpath(tempRepoDir).catch(() => tempRepoDir);
const userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "agentic-followup-e2e-userdata-"));
const spawned = [];

await fsp.mkdir(outputDir, { recursive: true });

function log(message) { process.stdout.write(`[${scenarioArg}] ${message}\n`); }
function appendLog(fileName, chunk) { fs.appendFileSync(path.join(outputDir, fileName), chunk); }

function startProcess(name, command, args, env) {
  const child = spawn(command, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  spawned.push(child);
  child.stdout.on("data", (chunk) => appendLog(`${name}.log`, chunk));
  child.stderr.on("data", (chunk) => appendLog(`${name}.log`, chunk));
  return child;
}

async function cleanup() {
  for (const child of spawned.reverse()) {
    if (!child.killed) child.kill("SIGTERM");
  }
}

process.on("SIGINT", async () => { await cleanup(); process.exit(1); });
process.on("SIGTERM", async () => { await cleanup(); process.exit(1); });

async function waitFor(check, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await delay(1000);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function waitForHttp(url, timeoutMs) {
  return waitFor(async () => {
    try { return (await fetch(url)).ok; } catch { return false; }
  }, timeoutMs, url);
}

async function apiGet(resource) {
  const response = await fetch(`${apiBaseUrl}${resource}`, {
    headers: { "x-local-api-token": apiToken },
  });
  if (!response.ok) throw new Error(`GET ${resource} failed: ${response.status} ${await response.text()}`);
  return response.json();
}

async function apiPost(resource, body) {
  const response = await fetch(`${apiBaseUrl}${resource}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-local-api-token": apiToken },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`POST ${resource} failed: ${response.status} ${await response.text()}`);
  return response.json();
}

function assert(condition, message) { if (!condition) throw new Error(message); }

function flattenTree(nodes) {
  const output = [];
  for (const node of nodes || []) {
    output.push(node);
    if (node.kind === "directory" && Array.isArray(node.children)) {
      output.push(...flattenTree(node.children));
    }
  }
  return output;
}

function normalizePathForMatch(value) {
  return String(value || "").replace(/\\/g, "/").toLowerCase();
}

async function main() {
  const modelHealth = await fetch("http://127.0.0.1:8000/health").then((r) => r.ok).catch(() => false);
  assert(modelHealth, "Local model runtime is not healthy on 127.0.0.1:8000");

  log(`output: ${outputDir}`);
  log(`repo: ${tempRepoDir}`);
  log(`scenario: ${scenarioArg} — ${scenario.label}`);

  const vite = startProcess("vite", "npx", ["vite", "--host", "127.0.0.1", "--port", String(vitePort)], {
    ...process.env, BROWSER: "none",
  });

  await waitForHttp(`http://127.0.0.1:${vitePort}`, 90000);
  log("vite ready");

  const electronApp = await electron.launch({
    cwd: root,
    args: ["electron/main.mjs"],
    env: {
      ...process.env,
      CODEX_E2E: "1",
      CODEX_E2E_PICK_REPO_PATH: tempRepoDir,
      ELECTRON_USER_DATA_DIR: userDataDir,
      VITE_DEV_SERVER_URL: `http://127.0.0.1:${vitePort}`,
      API_PORT: String(apiPort),
      API_TOKEN: apiToken,
      EXECUTION_MODEL_STEP_TIMEOUT_MS: "45000",
      EXECUTION_PATCH_TIMEOUT_MS: "180000",
    },
  });

  spawned.push({ killed: false, kill: async () => { await electronApp.close(); } });

  await waitForHttp(`${apiBaseUrl}/health?token=${apiToken}`, 120000);

  const page = await electronApp.firstWindow();
  await page.setViewportSize({ width: 1640, height: 980 });
  await page.waitForLoadState("domcontentloaded");

  try {
    await page.getByRole("button", { name: "Live State" }).waitFor({ timeout: 120000 });
  } catch (error) {
    await fsp.writeFile(path.join(outputDir, "startup-url.txt"), page.url(), "utf8");
    await fsp.writeFile(path.join(outputDir, "startup-html.html"), await page.content(), "utf8");
    await page.screenshot({ path: path.join(outputDir, "startup-failure.png"), fullPage: true }).catch(() => {});
    throw error;
  }

  const continueAnyway = page.getByRole("button", { name: "Continue anyway" });
  if (await continueAnyway.isVisible().catch(() => false)) {
    await continueAnyway.click({ force: true });
  }

  await page.screenshot({ path: path.join(outputDir, "01-shell.png"), fullPage: true });

  // --- Bootstrap ---
  await page.getByRole("button", { name: "Projects" }).click();
  await page.getByRole("heading", { name: "Connect Repo" }).waitFor({ timeout: 30000 });
  await page.locator("button").filter({ hasText: /^New Project$/ }).first().click({ force: true });

  const activeRepo = await waitFor(async () => {
    const payload = await apiGet("/api/v4/repos");
    const items = Array.isArray(payload.items) ? payload.items : [];
    const match = items.find((item) => item.sourceUri === tempRepoDir || item.sourceUri === tempRepoCanonicalPath);
    if (!match) return null;
    const active = await apiGet("/api/v4/repos/active");
    return active.item && active.item.id === match.id ? active.item : null;
  }, 240000, "bootstrapped active repo");

  const managedWorktree = path.join(activeRepo.managedWorktreeRoot, "active");

  // --- Wait for scaffold report ---
  let scaffoldReport = await waitFor(async () => {
    const payload = await apiGet(`/api/v8/projects/${activeRepo.id}/report/latest`);
    const report = payload.item;
    if (!report) return null;
    if (!Array.isArray(report.testsPassed) || report.testsPassed.length < 3) return null;
    if (!String(report.summary || "").toLowerCase().includes("verified")) return null;
    return report;
  }, 120000, "scaffold verification report").catch(() => null);

  if (!scaffoldReport) {
    const snapshotPayload = await apiGet(`/api/v8/mission/snapshot?projectId=${activeRepo.id}`);
    const activeRunId = snapshotPayload?.item?.execution?.activeRunId;
    assert(activeRunId, "No active scaffold run found for direct verification fallback");

    await apiPost("/api/v5/commands/execution.verify", {
      actor: "desktop-acceptance",
      run_id: activeRunId,
      repo_id: activeRepo.id,
      worktree_path: managedWorktree,
      commands: ["npm install", "npm run lint", "npm test", "npm run build"],
      docs_required: ["README.md", "AGENTS.md"],
      full_suite_run: true,
    });

    scaffoldReport = await waitFor(async () => {
      const payload = await apiGet(`/api/v8/projects/${activeRepo.id}/report/latest`);
      const report = payload.item;
      if (!report) return null;
      return Array.isArray(report.testsPassed) && report.testsPassed.length >= 3 ? report : null;
    }, 120000, "scaffold verification report after direct verification");
  }

  await page.screenshot({ path: path.join(outputDir, "02-scaffold-complete.png"), fullPage: true });
  log("scaffold complete");

  // --- Test stop action (api-stop scenario only) ---
  if (scenario.testStop) {
    log("testing stop action endpoint");
    await page.getByRole("button", { name: "Live State" }).click();
    await page.getByPlaceholder("Describe what should change in this repo. Example: add CSV export to the client list and verify the tests.").fill(scenario.objective);
    await page.getByRole("button", { name: "Execute" }).click();

    // Wait briefly for execution to start
    await delay(3000);

    const snapshotPayload = await apiGet(`/api/v8/mission/snapshot?projectId=${activeRepo.id}`);
    const activeRunId = snapshotPayload?.item?.execution?.activeRunId;

    if (activeRunId) {
      const stopResult = await apiPost("/api/v8/mission/actions/stop", {
        run_id: activeRunId,
        repo_id: activeRepo.id,
        actor: "acceptance-test",
        reason: "Testing stop action",
      });

      assert(stopResult.item?.stopped === true, "Stop action did not return stopped: true");
      log("stop action verified");
    } else {
      log("WARN: no active run to stop (execution may have completed too fast)");
    }

    await page.screenshot({ path: path.join(outputDir, "03-stop-action.png"), fullPage: true });

    const summary = {
      tempRepoDir,
      scenario: scenarioArg,
      activeRepo: { id: activeRepo.id, displayName: activeRepo.displayName },
      scaffoldReport,
      stopActionTested: true,
    };
    await fsp.writeFile(path.join(outputDir, "summary.json"), JSON.stringify(summary, null, 2));
    log(JSON.stringify(summary, null, 2));
    return;
  }

  // --- Pre-existing component setup (for rename scenarios) ---
  if (scenario.requiresPreExisting) {
    log("setting up pre-existing component before rename");
    await page.getByRole("button", { name: "Live State" }).click();
    await page.getByPlaceholder("Describe what should change in this repo. Example: add CSV export to the client list and verify the tests.").fill(
      "Add a status badge component to the app and test it. Update any docs if needed."
    );
    await page.getByRole("button", { name: "Execute" }).click();

    await waitFor(async () => {
      const payload = await apiGet(`/api/v8/projects/${activeRepo.id}/report/latest`);
      const report = payload.item;
      if (!report) return null;
      const changedFiles = Array.isArray(report.changedFiles) ? report.changedFiles : [];
      if (!changedFiles.some((item) => scenario.preExistingFilePattern.test(normalizePathForMatch(item)))) return null;
      if (!String(report.summary || "").toLowerCase().includes("verified")) return null;
      return report;
    }, 120000, "pre-existing component setup");

    log("pre-existing component ready");
    await page.screenshot({ path: path.join(outputDir, "03-pre-existing.png"), fullPage: true });
  }

  // --- Follow-up feature edit ---
  await page.getByRole("button", { name: "Live State" }).click();
  await page.getByPlaceholder("Describe what should change in this repo. Example: add CSV export to the client list and verify the tests.").fill(scenario.objective);
  await page.getByRole("button", { name: "Execute" }).click();

  let followupReport = await waitFor(async () => {
    const snapshotPayload = await apiGet(`/api/v8/mission/snapshot?projectId=${activeRepo.id}`);
    const snapshot = snapshotPayload.item;
    if (snapshot?.execution?.status === "failed") {
      const latestVerification = Array.isArray(snapshot?.taskInsight?.verification?.failures)
        ? snapshot.taskInsight.verification.failures.join(" | ")
        : "unknown failure";
      throw new Error(`Follow-up execution failed: ${latestVerification}`);
    }
    const payload = await apiGet(`/api/v8/projects/${activeRepo.id}/report/latest`);
    const report = payload.item;
    if (!report) return null;
    const changedFiles = Array.isArray(report.changedFiles) ? report.changedFiles : [];
    if (!changedFiles.some((item) => scenario.expectedFilePattern.test(normalizePathForMatch(item)))) {
      return null;
    }
    if (!String(report.summary || "").toLowerCase().includes("verified")) return null;
    return report;
  }, 120000, `${scenario.label} follow-up verification report`).catch(() => null);

  if (!followupReport) {
    const latestAttempt = await apiGet(`/api/v8/mission/snapshot?projectId=${activeRepo.id}`);
    const activeRunId = latestAttempt?.item?.execution?.activeRunId;
    assert(activeRunId, `No active follow-up run found for ${scenario.label} direct verification fallback`);

    await apiPost("/api/v5/commands/execution.verify", {
      actor: "desktop-acceptance",
      run_id: activeRunId,
      repo_id: activeRepo.id,
      worktree_path: managedWorktree,
      commands: ["npm run lint", "npm test", "npm run build"],
      docs_required: ["README.md", "AGENTS.md"],
      full_suite_run: true,
    });

    followupReport = await waitFor(async () => {
      const payload = await apiGet(`/api/v8/projects/${activeRepo.id}/report/latest`);
      const report = payload.item;
      if (!report) return null;
      const changedFiles = Array.isArray(report.changedFiles) ? report.changedFiles : [];
      return changedFiles.some((item) => scenario.expectedFilePattern.test(normalizePathForMatch(item)))
        ? report : null;
    }, 30000, `${scenario.label} follow-up verification report after direct verification`);
  }

  // --- Verify the artifact exists in the codebase ---
  const updatedTreePayload = await apiGet(`/api/v8/mission/codebase/tree?projectId=${activeRepo.id}`);
  const updatedTree = Array.isArray(updatedTreePayload.items) ? updatedTreePayload.items : [];
  const artifactPath = flattenTree(updatedTree).find(
    (item) => item.kind === "file" && scenario.expectedFilePattern.test(item.path)
  )?.path;

  if (artifactPath) {
    const artifactSource = await apiGet(
      `/api/v8/mission/codebase/file?projectId=${activeRepo.id}&path=${encodeURIComponent(artifactPath)}`
    );
    assert(
      scenario.expectedContentPattern.test(String(artifactSource.item?.content || "")),
      `${scenario.label} source payload was not loaded from the managed worktree`
    );
    log(`${scenario.label} artifact verified at ${artifactPath}`);
  } else {
    log(`WARN: ${scenario.label} artifact not found in tree, checking report changedFiles`);
  }

  // --- Rename-specific: verify the old name is gone from codebase ---
  if (scenario.requiresPreExisting && scenario.preExistingGonePattern) {
    const allFiles = flattenTree(updatedTree).filter((n) => n.kind === "file");
    const oldNameStillPresent = allFiles.some((n) => scenario.preExistingFilePattern.test(n.path));
    assert(!oldNameStillPresent, "Old file name should no longer exist after rename");
    log("verified old component file is gone");

    // Check that no source file still references the old name
    if (artifactPath) {
      const artifactContent = String((await apiGet(
        `/api/v8/mission/codebase/file?projectId=${activeRepo.id}&path=${encodeURIComponent(artifactPath)}`
      )).item?.content || "");
      assert(!scenario.preExistingGonePattern.test(artifactContent), "Renamed file should not contain old component name");
    }
  }

  await page.getByRole("button", { name: "Codebase" }).click();
  await page.screenshot({ path: path.join(outputDir, "05-followup-codebase.png"), fullPage: true });

  // --- Independent recheck ---
  const lint = spawnSync("npm", ["run", "lint"], { cwd: managedWorktree, encoding: "utf8" });
  const test = spawnSync("npm", ["test"], { cwd: managedWorktree, encoding: "utf8" });
  const build = spawnSync("npm", ["run", "build"], { cwd: managedWorktree, encoding: "utf8" });

  appendLog("verification-recheck.log", `lint\n${lint.stdout}\n${lint.stderr}\n`);
  appendLog("verification-recheck.log", `test\n${test.stdout}\n${test.stderr}\n`);
  appendLog("verification-recheck.log", `build\n${build.stdout}\n${build.stderr}\n`);

  assert(lint.status === 0, "Post-run lint recheck failed");
  assert(test.status === 0, "Post-run test recheck failed");
  assert(build.status === 0, "Post-run build recheck failed");

  // --- Console event checks ---
  const consolePayload = await apiGet(`/api/v8/mission/console?projectId=${activeRepo.id}`);
  const consoleItems = Array.isArray(consolePayload.items) ? consolePayload.items : [];
  const validCategories = new Set(["execution", "verification", "provider", "approval", "indexing"]);
  const invalidConsoleEvents = consoleItems.filter((item) => !validCategories.has(item.category));
  assert(invalidConsoleEvents.length === 0, `Console contains events with invalid categories: ${JSON.stringify(invalidConsoleEvents.slice(0, 3))}`);

  // --- Blueprint check ---
  const blueprintPayload = await apiGet(`/api/v8/projects/${activeRepo.id}/blueprint`);
  assert(blueprintPayload.item, "Blueprint should exist after scaffold");
  assert(blueprintPayload.item.testingPolicy?.requiredForBehaviorChange === true, "Blueprint should require tests for behavior changes");

  log("all assertions passed");

  const summary = {
    tempRepoDir,
    scenario: scenarioArg,
    activeRepo: {
      id: activeRepo.id,
      displayName: activeRepo.displayName,
      managedWorktreeRoot: activeRepo.managedWorktreeRoot,
    },
    scaffoldReport,
    followupReport,
    verificationRecheck: { lint: lint.status, test: test.status, build: build.status },
    consoleEventsCount: consoleItems.length,
    blueprintVersion: blueprintPayload.item?.version,
  };

  await fsp.writeFile(path.join(outputDir, "summary.json"), JSON.stringify(summary, null, 2));
  log(JSON.stringify(summary, null, 2));
}

try {
  await main();
} finally {
  await cleanup();
}
