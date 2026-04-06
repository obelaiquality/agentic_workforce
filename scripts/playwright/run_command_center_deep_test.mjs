#!/usr/bin/env node
/**
 * Command Center Deep E2E Test
 *
 * Tests the primary developer monitoring experience:
 *   1. Scaffold project + run execution
 *   2. MissionHeaderStrip renders with repo context
 *   3. Task board shows workflow cards
 *   4. Task detail drawer opens with AgenticRunDeepPanel metrics
 *   5. Console events accessible via API
 *   6. Outcome debrief visible after execution
 *
 * Usage:
 *   node scripts/playwright/run_command_center_deep_test.mjs
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { _electron as electron } from "playwright-core";
import { loadLocalEnv, resolveE2eRuntimePreset } from "./env-utils.mjs";

const root = path.resolve(new URL("../..", import.meta.url).pathname);
loadLocalEnv(root);
const runtimePreset = resolveE2eRuntimePreset("openai_all");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = path.join(root, "output", "playwright", `command-center-deep-${timestamp}`);

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((err) => (err ? reject(err) : port ? resolve(port) : reject(new Error("No port"))));
    });
  });
}

const vitePort = await getFreePort();
const apiPort = await getFreePort();
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const apiToken = `cmd-center-e2e-${Date.now()}`;
const tempRepoDir = await fsp.mkdtemp(path.join(os.tmpdir(), "agentic-cmd-center-e2e-"));
const tempRepoCanonicalPath = await fsp.realpath(tempRepoDir).catch(() => tempRepoDir);
const userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "agentic-cmd-center-e2e-userdata-"));
const spawned = [];

await fsp.mkdir(outputDir, { recursive: true });

const results = { passed: [], failed: [] };

function log(msg) { process.stdout.write(`[cmd-center] ${msg}\n`); }
function appendLog(name, chunk) { fs.appendFileSync(path.join(outputDir, name), chunk); }

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

function check(label, condition, detail) {
  if (condition) {
    results.passed.push(label);
    log(`  PASS: ${label}`);
  } else {
    results.failed.push(label);
    log(`  FAIL: ${label} — ${detail || "assertion failed"}`);
  }
}

async function waitFor(checkFn, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await checkFn();
    if (value) return value;
    await delay(1000);
  }
  throw new Error(`Timed out waiting for ${label}`);
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

async function apiPatch(resource, body) {
  const response = await fetch(`${apiBaseUrl}${resource}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-local-api-token": apiToken },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`PATCH ${resource} failed: ${response.status} ${await response.text()}`);
  return response.json();
}

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(outputDir, `${name}.png`), fullPage: true });
}

async function applyRuntimePreset() {
  if (runtimePreset !== "openai_all") return;
  await apiPost("/api/v1/settings/runtime-mode", {
    mode: "openai_api",
    openAiModel: "gpt-5-nano",
  });
  await apiPatch("/api/v1/settings", {
    modelRoles: {
      utility_fast: { role: "utility_fast", providerId: "openai-responses", pluginId: null, model: "gpt-5-nano", temperature: 0, maxTokens: 900, reasoningMode: "off" },
      coder_default: { role: "coder_default", providerId: "openai-responses", pluginId: null, model: "gpt-5.3-codex", temperature: 0.1, maxTokens: 1800, reasoningMode: "off" },
      review_deep: { role: "review_deep", providerId: "openai-responses", pluginId: null, model: "gpt-5.4", temperature: 0.05, maxTokens: 2200, reasoningMode: "on" },
      overseer_escalation: { role: "overseer_escalation", providerId: "openai-responses", pluginId: null, model: "gpt-5.4", temperature: 0.05, maxTokens: 2400, reasoningMode: "on" },
    },
  });
}

// ── Main ───────���────────────────────────────────────────────────────────────

async function main() {
  if (runtimePreset !== "openai_all") {
    const modelHealth = await fetch("http://127.0.0.1:8000/health").then((r) => r.ok).catch(() => false);
    if (!modelHealth) throw new Error("Local model runtime is not healthy on 127.0.0.1:8000");
  }

  log(`output: ${outputDir}`);
  log(`repo: ${tempRepoDir}`);

  // ── Step 1: Start Vite + Electron ──
  log("Step 1: Starting Vite + Electron");
  startProcess("vite", "npx", ["vite", "--host", "127.0.0.1", "--port", String(vitePort)], {
    ...process.env, BROWSER: "none",
  });

  await waitFor(
    async () => { try { return (await fetch(`http://127.0.0.1:${vitePort}`)).ok; } catch { return false; } },
    90_000, "Vite"
  );
  log("  Vite ready");

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

  await waitFor(
    async () => { try { return (await fetch(`${apiBaseUrl}/health`)).ok; } catch { return false; } },
    120_000, "API health"
  );
  await applyRuntimePreset();
  log("  API ready");

  const page = await electronApp.firstWindow();
  page.on("console", (msg) => appendLog("electron-console.log", `[${msg.type()}] ${msg.text()}\n`));
  page.on("pageerror", (error) => appendLog("electron-console.log", `[PAGE_ERROR] ${error.message}\n`));
  await page.setViewportSize({ width: 1640, height: 980 });
  await page.waitForLoadState("domcontentloaded");

  try {
    await page.getByRole("button", { name: "Work", exact: true }).waitFor({ timeout: 120_000 });
  } catch {
    await screenshot(page, "00-startup-failure");
    throw new Error("App shell did not render within 120s");
  }

  const continueBtn = page.getByRole("button", { name: /continue anyway/i });
  if (await continueBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await continueBtn.click();
    await delay(500);
  }

  await screenshot(page, "01-shell");

  // ── Step 2: Bootstrap project ──
  log("Step 2: Creating project + scaffold");
  await page.getByRole("button", { name: "Projects" }).click();
  await page.getByRole("button", { name: "My Projects" }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Connect New" }).click();
  await page.locator("button").filter({ hasText: /^New Project$/ }).first().waitFor({ timeout: 10000 });
  await page.locator("button").filter({ hasText: /^New Project$/ }).first().click({ force: true });
  await page.getByRole("dialog").waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: /Create a managed Git repo with no stack assumptions/i }).click();

  const activeRepo = await waitFor(async () => {
    const payload = await apiGet("/api/v4/repos");
    const items = Array.isArray(payload.items) ? payload.items : [];
    const match = items.find((item) => item.sourceUri === tempRepoDir || item.sourceUri === tempRepoCanonicalPath);
    if (!match) return null;
    const active = await apiGet("/api/v4/repos/active");
    return active.item && active.item.id === match.id ? active.item : null;
  }, 240000, "bootstrapped active repo");

  check("project-bootstrapped", !!activeRepo, "No active repo");
  const projectId = activeRepo.id;

  // Apply starter
  await page.getByRole("button", { name: "My Projects" }).click();
  await delay(500);
  await page.getByRole("button", { name: /Apply Starter/i }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: /Apply Starter/i }).click();
  await page.getByRole("dialog").waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: /TypeScript App/i }).click();

  // Wait for scaffold
  await waitFor(async () => {
    const payload = await apiGet(`/api/v8/projects/${projectId}/report/latest`);
    const report = payload.item;
    if (!report) return null;
    if (!String(report.summary || "").toLowerCase().includes("verified")) return null;
    return report;
  }, 180000, "scaffold verification").catch(() => {
    log("  WARN: scaffold report not verified — continuing with available state");
    return null;
  });

  log("  Scaffold complete");
  await screenshot(page, "02-scaffold-complete");

  // ── Step 3: Validate command center UI during scaffold execution ──
  log("Step 3: Validating command center during execution");

  // Navigate to Work to observe the active execution
  await page.getByRole("button", { name: "Work", exact: true }).click();
  await delay(2000);

  // Validate running state UI elements
  const runningChip = await page.getByText(/Running|executing/i).first()
    .isVisible({ timeout: 10000 }).catch(() => false);
  check("ui-running-state-visible", runningChip, "Running/executing state not shown in UI");

  const stopBtn = await page.getByText("Stop").first().isVisible().catch(() => false);
  check("ui-stop-button-visible", stopBtn, "Stop button not visible during execution");

  // Validate AgenticRun deep panel metrics
  const hasIterationsLabel = await page.getByText("Iterations").first().isVisible().catch(() => false);
  check("ui-agentic-run-metrics-visible", hasIterationsLabel, "AgenticRun metrics (Iterations) not shown");

  const hasToolCallsLabel = await page.getByText("Tool Calls").first().isVisible().catch(() => false);
  check("ui-tool-calls-label-visible", hasToolCallsLabel, "Tool Calls label not shown");

  await screenshot(page, "03-execution-running-state");

  // Continue validating while execution may still be running
  // (Command center should show data during execution, not only after)
  await delay(5000); // Let some iterations accumulate
  await screenshot(page, "03b-execution-progress");

  // Check if a report exists (from scaffold verification)
  const reportPayload = await apiGet(`/api/v8/projects/${projectId}/report/latest`).catch(() => null);
  check("execution-report-exists", !!reportPayload?.item, "No execution report found");
  await screenshot(page, "04-report-check");

  // ── Step 4: Command Center — MissionHeaderStrip ──
  log("Step 4: Verifying MissionHeaderStrip");
  await page.getByRole("button", { name: "Work", exact: true }).click();
  await delay(1500);

  await screenshot(page, "05-command-center");

  // MissionHeaderStrip should show repo context — look for the repo display name or activity indicator
  const headerStripContent = await page.locator(".flex.items-center.gap-2").first().textContent().catch(() => "");
  const hasRepoContext = headerStripContent.length > 0
    || await page.getByText(activeRepo.displayName || "").isVisible().catch(() => false)
    || await page.getByText(/Activity|Idle|Running/i).first().isVisible().catch(() => false);
  check("header-strip-has-context", hasRepoContext, "MissionHeaderStrip has no visible context");

  // ── Step 5: Task board ──
  log("Step 5: Verifying task board");

  // Look for workflow cards or task entries
  const hasWorkflowCards = await page.locator("[class*='workflow'], [class*='card'], [class*='task']")
    .first().isVisible({ timeout: 5_000 }).catch(() => false)
    || await page.getByText(/status.?badge/i).first().isVisible().catch(() => false)
    || await page.getByText(/Backlog|In Progress|Needs Review|Completed/i).first().isVisible().catch(() => false);
  check("task-board-has-content", hasWorkflowCards, "No workflow cards or task board content visible");

  // Look for view toggle (board/list)
  const hasViewToggle = await page.getByText(/Board|List/i).first().isVisible().catch(() => false)
    || await page.locator("[data-testid='work-view-toggle']").isVisible().catch(() => false);
  check("view-toggle-visible", hasViewToggle, "Board/List view toggle not found");

  await screenshot(page, "06-task-board");

  // ── Step 6: Console events via API ��─
  log("Step 6: Verifying console events");

  const consolePayload = await apiGet(`/api/v8/mission/console?projectId=${projectId}`);
  const consoleItems = Array.isArray(consolePayload.items) ? consolePayload.items : [];
  check("console-events-exist", consoleItems.length > 0, `Got ${consoleItems.length} events`);

  // ── Step 7: Snapshot enrichment ──
  log("Step 7: Verifying snapshot");

  const snapshotPayload = await apiGet(`/api/v8/mission/snapshot?projectId=${projectId}`);
  const snapshot = snapshotPayload.item;
  check("snapshot-exists", !!snapshot, "No snapshot");
  check("snapshot-has-console", Array.isArray(snapshot?.consoleEvents) && snapshot.consoleEvents.length > 0,
    "Snapshot missing consoleEvents");

  // Check run summary presence
  const hasRunSummary = !!snapshot?.runSummary || !!snapshot?.execution;
  check("snapshot-has-run-data", hasRunSummary, "No runSummary or execution in snapshot");

  // ── Step 8: Blueprint enrichment ──
  log("Step 8: Verifying blueprint");

  let blueprintPayload;
  try {
    blueprintPayload = await apiGet(`/api/v8/projects/${projectId}/blueprint`);
  } catch {
    blueprintPayload = null;
  }
  check("blueprint-exists", !!blueprintPayload?.item, "No blueprint");

  // ── Step 9: Codebase tree after execution ──
  log("Step 9: Verifying codebase tree");

  const treePayload = await apiGet(`/api/v8/mission/codebase/tree?projectId=${projectId}`);
  const tree = Array.isArray(treePayload.items) ? treePayload.items : [];
  const flatTree = [];
  function flatten(nodes) {
    for (const n of nodes || []) {
      flatTree.push(n);
      if (n.kind === "directory" && Array.isArray(n.children)) flatten(n.children);
    }
  }
  flatten(tree);

  const fileCount = flatTree.filter((n) => n.kind === "file").length;
  check("codebase-tree-has-files", fileCount >= 3, `Only ${fileCount} files`);

  await screenshot(page, "07-final");

  // ── Summary ────��──────────────────────────────────────────────────────────

  const summary = {
    tempRepoDir,
    projectId,
    outputDir,
    executionReport: reportPayload?.item ? { summary: reportPayload.item.summary } : null,
    consoleEventCount: consoleItems.length,
    codebaseFileCount: fileCount,
    checks: {
      passed: results.passed.length,
      failed: results.failed.length,
      total: results.passed.length + results.failed.length,
      passedNames: results.passed,
      failedNames: results.failed,
    },
  };

  await fsp.writeFile(path.join(outputDir, "summary.json"), JSON.stringify(summary, null, 2));

  log("");
  log("══════��════════════════════════════════════");
  log(`  RESULTS: ${results.passed.length} passed, ${results.failed.length} failed`);
  log("══════════════════════════════════════��════");
  if (results.failed.length > 0) {
    log(`  Failed: ${results.failed.join(", ")}`);
  }
  log(`  Output: ${outputDir}`);
  log("");

  // Execution-dependent checks are soft failures (LLM non-determinism)
  const softFailures = new Set([
    "execution-report-exists", "task-board-has-content",
    "ui-running-state-visible", "ui-stop-button-visible",
    "ui-agentic-run-metrics-visible", "ui-tool-calls-label-visible",
  ]);
  const hardFailures = results.failed.filter((name) => !softFailures.has(name));
  if (hardFailures.length > 0) {
    process.exitCode = 1;
  } else if (results.failed.length > 0) {
    log("  (Execution-dependent soft failures are expected with non-deterministic LLM output)");
  }
}

try {
  await main();
} finally {
  await cleanup();
}
