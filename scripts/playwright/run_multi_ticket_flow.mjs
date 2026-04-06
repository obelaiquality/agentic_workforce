#!/usr/bin/env node
/**
 * Multi-Ticket Project Flow E2E Test
 *
 * Battle-tests the app with a realistic developer workflow:
 *   1. Scaffold → TypeScript App starter
 *   2. Ticket 1: Add auth module (new feature)
 *   3. Ticket 2: Add dashboard that imports from auth (cross-ticket dependency)
 *   4. Ticket 3: Refactor auth to use JWT (refactoring without breaking)
 *   5. Final verification: lint + test + build on the accumulated codebase
 *
 * This tests what no other E2E script covers: iterative multi-ticket
 * execution with cross-ticket dependencies and refactoring safety.
 *
 * Usage:
 *   node scripts/playwright/run_multi_ticket_flow.mjs
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { _electron as electron } from "playwright-core";
import { loadLocalEnv, resolveE2eRuntimePreset } from "./env-utils.mjs";

const root = path.resolve(new URL("../..", import.meta.url).pathname);
loadLocalEnv(root);
const runtimePreset = resolveE2eRuntimePreset("openai_all");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = path.join(root, "output", "playwright", `multi-ticket-flow-${timestamp}`);

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
const apiToken = `multi-ticket-e2e-${Date.now()}`;
const tempRepoDir = await fsp.mkdtemp(path.join(os.tmpdir(), "agentic-multi-ticket-e2e-"));
const tempRepoCanonicalPath = await fsp.realpath(tempRepoDir).catch(() => tempRepoDir);
const userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "agentic-multi-ticket-e2e-userdata-"));
const spawned = [];

await fsp.mkdir(outputDir, { recursive: true });

const results = { passed: [], failed: [] };

function log(msg) { process.stdout.write(`[multi-ticket] ${msg}\n`); }
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
  try {
    await page.screenshot({ path: path.join(outputDir, `${name}.png`), fullPage: true });
  } catch (err) {
    log(`  WARN: screenshot ${name} failed: ${err.message}`);
  }
}

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

/**
 * Wait for execution to finish and UI to become idle,
 * then submit a ticket via UI buttons and wait for a verified report.
 */
async function executeTicket(page, projectId, objective, label, timeoutMs = 180000) {
  log(`  Submitting: ${label}`);

  // Wait for any active execution to finish (check runSummary.status — matches UI state)
  await waitFor(async () => {
    try {
      const snapshotPayload = await apiGet(`/api/v8/mission/snapshot?projectId=${projectId}`);
      const snapshot = snapshotPayload.item;
      const runStatus = snapshot?.runSummary?.status;
      const agenticStatus = snapshot?.agenticRun?.status;
      return runStatus !== "running" && agenticStatus !== "running";
    } catch { return true; }
  }, timeoutMs, `${label} — wait for idle`);
  await delay(3000); // Let UI polling catch up

  // Navigate to Work and wait for UI action button
  await page.getByRole("button", { name: "Work", exact: true }).click();
  await waitFor(async () => {
    const reviewBtn = page.getByRole("button", { name: "Review plan", exact: true });
    const runBtn = page.getByRole("button", { name: "Run task", exact: true });
    return (await reviewBtn.isVisible().catch(() => false)) || (await runBtn.isVisible().catch(() => false));
  }, 30000, `${label} — UI idle button visible`);

  // Fill the task input
  await page.locator("textarea").first().fill(objective);
  await delay(500);

  // Click through review → run
  const reviewBtn = page.getByRole("button", { name: "Review plan", exact: true });
  const runBtn = page.getByRole("button", { name: "Run task", exact: true });
  if (await reviewBtn.isVisible().catch(() => false)) {
    await reviewBtn.click();
    await runBtn.waitFor({ timeout: 60000 });
  }
  await runBtn.click();
  log(`  Execution started for ${label}`);

  // Auto-approve pending approvals while waiting for report
  const approvedApprovals = new Set();
  const beforeTimestamp = new Date().toISOString();

  const report = await waitFor(async () => {
    const snapshotPayload = await apiGet(`/api/v8/mission/snapshot?projectId=${projectId}`);
    const snapshot = snapshotPayload.item;
    const pendingApprovals = Array.isArray(snapshot?.approvals) ? snapshot.approvals : [];
    const pending = pendingApprovals.find((a) => a?.approvalId && !approvedApprovals.has(a.approvalId));
    if (pending?.approvalId) {
      approvedApprovals.add(pending.approvalId);
      await apiPost("/api/v8/mission/approval/decide", {
        approval_id: pending.approvalId,
        decision: "approved",
        decided_by: "multi-ticket-e2e",
        execute_approved_command: true,
        requeue_blocked_stage: true,
      });
      return null;
    }
    if (snapshot?.execution?.status === "failed") {
      log(`  WARN: Execution failed for ${label}`);
      return { failed: true };
    }
    const payload = await apiGet(`/api/v8/projects/${projectId}/report/latest`);
    const r = payload.item;
    if (!r) return null;
    if (new Date(r.createdAt || 0) <= new Date(beforeTimestamp)) return null;
    return r;
  }, timeoutMs, `${label} report`).catch(() => null);

  return report;
}

// ── Main ────────────────────────────────────────────────────────────────────

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

  // ── Step 2: Bootstrap + Scaffold ──
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
  const managedWorktree = path.join(activeRepo.managedWorktreeRoot, "active");

  // Apply starter
  await page.getByRole("button", { name: "My Projects" }).click();
  await delay(500);
  await page.getByRole("button", { name: /Apply Starter/i }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: /Apply Starter/i }).click();
  await page.getByRole("dialog").waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: /TypeScript App/i }).click();

  const scaffoldReport = await waitFor(async () => {
    const payload = await apiGet(`/api/v8/projects/${projectId}/report/latest`);
    const report = payload.item;
    if (!report) return null;
    if (!Array.isArray(report.testsPassed) || report.testsPassed.length < 3) return null;
    if (!String(report.summary || "").toLowerCase().includes("verified")) return null;
    return report;
  }, 180000, "scaffold report").catch(() => null);

  check("scaffold-verified", !!scaffoldReport, "Scaffold did not produce verified report");
  log("  Scaffold complete — waiting for execution to fully finish");

  // Wait for scaffold execution to truly finish (runSummary.status must not be "running")
  await waitFor(async () => {
    try {
      const snapshotPayload = await apiGet(`/api/v8/mission/snapshot?projectId=${projectId}`);
      const snapshot = snapshotPayload.item;
      return snapshot?.runSummary?.status !== "running" && snapshot?.agenticRun?.status !== "running";
    } catch { return true; }
  }, 300000, "scaffold execution to fully finish");
  await delay(5000); // Let UI polling catch up

  await screenshot(page, "02-scaffold");

  // Record baseline console count
  const baselineConsole = await apiGet(`/api/v8/mission/console?projectId=${projectId}`);
  const baselineConsoleCount = Array.isArray(baselineConsole.items) ? baselineConsole.items.length : 0;

  // ── Ticket 1: Auth Module ──
  log("Ticket 1: Auth module");
  const ticket1Report = await executeTicket(
    page, projectId,
    "Add a user authentication module at src/auth/authService.ts with login and logout functions. Export both as named exports. Add tests at src/auth/authService.test.ts. Update docs if needed.",
    "Auth Module",
    120000,
  );

  check("ticket1-report-exists", !!ticket1Report && !ticket1Report.failed, "No verified report for auth module");

  // Verify auth files in codebase tree
  const ticket1Tree = await apiGet(`/api/v8/mission/codebase/tree?projectId=${projectId}`);
  const ticket1Flat = flattenTree(ticket1Tree.items || []);
  const authFile = ticket1Flat.find((n) => n.kind === "file" && /auth/i.test(n.path));
  check("ticket1-auth-file-exists", !!authFile, "No auth file in codebase tree");

  if (authFile) {
    const authSource = await apiGet(
      `/api/v8/mission/codebase/file?projectId=${projectId}&path=${encodeURIComponent(authFile.path)}`
    );
    const authContent = String(authSource.item?.content || "").toLowerCase();
    check("ticket1-auth-has-login", /login/.test(authContent), "auth file missing login function");
    check("ticket1-auth-has-logout", /logout/.test(authContent), "auth file missing logout function");
  }

  // Console events should have grown
  const ticket1Console = await apiGet(`/api/v8/mission/console?projectId=${projectId}`);
  const ticket1ConsoleCount = Array.isArray(ticket1Console.items) ? ticket1Console.items.length : 0;
  check("ticket1-console-grew", ticket1ConsoleCount > baselineConsoleCount,
    `Console: ${ticket1ConsoleCount} (was ${baselineConsoleCount})`);

  await screenshot(page, "03-ticket1-auth");

  // Independent recheck
  const lint1 = spawnSync("npm", ["run", "lint"], { cwd: managedWorktree, encoding: "utf8", timeout: 30000 });
  const test1 = spawnSync("npm", ["test"], { cwd: managedWorktree, encoding: "utf8", timeout: 60000 });
  const build1 = spawnSync("npm", ["run", "build"], { cwd: managedWorktree, encoding: "utf8", timeout: 60000 });
  appendLog("recheck-ticket1.log", `lint: ${lint1.status}\n${lint1.stdout}\n${lint1.stderr}\ntest: ${test1.status}\n${test1.stdout}\n${test1.stderr}\nbuild: ${build1.status}\n${build1.stdout}\n${build1.stderr}\n`);
  check("ticket1-lint-passes", lint1.status === 0, `exit ${lint1.status}`);
  check("ticket1-test-passes", test1.status === 0, `exit ${test1.status}`);
  check("ticket1-build-passes", build1.status === 0, `exit ${build1.status}`);

  // ── Ticket 2: Dashboard with cross-ticket dependency ──
  log("Ticket 2: Dashboard (cross-ticket dependency)");
  const ticket2Report = await executeTicket(
    page, projectId,
    "Add a Dashboard component at src/components/Dashboard.tsx that imports from the auth module (src/auth/authService) and displays whether the user is logged in. Add tests. Update docs if needed.",
    "Dashboard",
    120000,
  );

  check("ticket2-report-exists", !!ticket2Report && !ticket2Report.failed, "No verified report for dashboard");

  // Verify dashboard file exists
  const ticket2Tree = await apiGet(`/api/v8/mission/codebase/tree?projectId=${projectId}`);
  const ticket2Flat = flattenTree(ticket2Tree.items || []);
  const dashboardFile = ticket2Flat.find((n) => n.kind === "file" && /dashboard/i.test(n.path));
  check("ticket2-dashboard-exists", !!dashboardFile, "No dashboard file in codebase tree");

  // CRITICAL: Verify cross-ticket dependency — dashboard imports from auth
  if (dashboardFile) {
    const dashSource = await apiGet(
      `/api/v8/mission/codebase/file?projectId=${projectId}&path=${encodeURIComponent(dashboardFile.path)}`
    );
    const dashContent = String(dashSource.item?.content || "");
    check("ticket2-imports-auth", /import.*from.*auth/i.test(dashContent),
      "Dashboard does not import from auth module");
  }

  // Console events should have grown again
  const ticket2Console = await apiGet(`/api/v8/mission/console?projectId=${projectId}`);
  const ticket2ConsoleCount = Array.isArray(ticket2Console.items) ? ticket2Console.items.length : 0;
  check("ticket2-console-grew", ticket2ConsoleCount > ticket1ConsoleCount,
    `Console: ${ticket2ConsoleCount} (was ${ticket1ConsoleCount})`);

  await screenshot(page, "04-ticket2-dashboard");

  // Independent recheck
  const lint2 = spawnSync("npm", ["run", "lint"], { cwd: managedWorktree, encoding: "utf8", timeout: 30000 });
  const test2 = spawnSync("npm", ["test"], { cwd: managedWorktree, encoding: "utf8", timeout: 60000 });
  const build2 = spawnSync("npm", ["run", "build"], { cwd: managedWorktree, encoding: "utf8", timeout: 60000 });
  appendLog("recheck-ticket2.log", `lint: ${lint2.status}\n${lint2.stdout}\n${lint2.stderr}\ntest: ${test2.status}\n${test2.stdout}\n${test2.stderr}\nbuild: ${build2.status}\n${build2.stdout}\n${build2.stderr}\n`);
  check("ticket2-lint-passes", lint2.status === 0, `exit ${lint2.status}`);
  check("ticket2-test-passes", test2.status === 0, `exit ${test2.status}`);
  check("ticket2-build-passes", build2.status === 0, `exit ${build2.status}`);

  // ── Ticket 3: Refactor auth without breaking ──
  log("Ticket 3: Refactor auth to JWT (safety test)");
  const ticket3Report = await executeTicket(
    page, projectId,
    "Refactor src/auth/authService.ts to use JWT tokens instead of session state. Keep the exact same exported API surface (login and logout functions) so existing consumers like Dashboard still work. Update tests to verify JWT usage. Make sure lint, tests, and build still pass.",
    "JWT Refactor",
    120000,
  );

  check("ticket3-report-exists", !!ticket3Report && !ticket3Report.failed, "No verified report for JWT refactor");

  // Verify auth now mentions JWT
  const ticket3Tree = await apiGet(`/api/v8/mission/codebase/tree?projectId=${projectId}`);
  const ticket3Flat = flattenTree(ticket3Tree.items || []);
  const authFileAfter = ticket3Flat.find((n) => n.kind === "file" && /auth.*service/i.test(n.path));
  if (authFileAfter) {
    const authSourceAfter = await apiGet(
      `/api/v8/mission/codebase/file?projectId=${projectId}&path=${encodeURIComponent(authFileAfter.path)}`
    );
    const authContentAfter = String(authSourceAfter.item?.content || "").toLowerCase();
    check("ticket3-auth-has-jwt", /jwt|token|jsonwebtoken/.test(authContentAfter),
      "Auth module does not reference JWT after refactor");
  }

  // Verify dashboard still exists and imports from auth
  const dashboardAfter = ticket3Flat.find((n) => n.kind === "file" && /dashboard/i.test(n.path));
  check("ticket3-dashboard-still-exists", !!dashboardAfter, "Dashboard was deleted during refactor");

  if (dashboardAfter) {
    const dashSourceAfter = await apiGet(
      `/api/v8/mission/codebase/file?projectId=${projectId}&path=${encodeURIComponent(dashboardAfter.path)}`
    );
    const dashContentAfter = String(dashSourceAfter.item?.content || "");
    check("ticket3-dashboard-still-imports-auth", /import.*from.*auth/i.test(dashContentAfter),
      "Dashboard no longer imports from auth after refactor");
  }

  await screenshot(page, "05-ticket3-refactor");

  // ── Final independent verification ──
  log("Final verification: lint + test + build on accumulated codebase");
  const lintFinal = spawnSync("npm", ["run", "lint"], { cwd: managedWorktree, encoding: "utf8", timeout: 30000 });
  const testFinal = spawnSync("npm", ["test"], { cwd: managedWorktree, encoding: "utf8", timeout: 60000 });
  const buildFinal = spawnSync("npm", ["run", "build"], { cwd: managedWorktree, encoding: "utf8", timeout: 60000 });
  appendLog("recheck-final.log", `lint: ${lintFinal.status}\n${lintFinal.stdout}\n${lintFinal.stderr}\ntest: ${testFinal.status}\n${testFinal.stdout}\n${testFinal.stderr}\nbuild: ${buildFinal.status}\n${buildFinal.stdout}\n${buildFinal.stderr}\n`);
  check("final-lint-passes", lintFinal.status === 0, `exit ${lintFinal.status}`);
  check("final-test-passes", testFinal.status === 0, `exit ${testFinal.status}`);
  check("final-build-passes", buildFinal.status === 0, `exit ${buildFinal.status}`);

  // Blueprint should exist and be enriched
  let blueprint;
  try {
    blueprint = await apiGet(`/api/v8/projects/${projectId}/blueprint`);
  } catch { blueprint = null; }
  check("final-blueprint-exists", !!blueprint?.item, "No blueprint after 3 tickets");

  // Final codebase file count should have grown significantly
  const finalFileCount = ticket3Flat.filter((n) => n.kind === "file").length;
  check("final-codebase-file-count", finalFileCount >= 6, `Only ${finalFileCount} files after 3 tickets`);

  await screenshot(page, "06-final");

  // ── Summary ───────────────────────────────────────────────────────────────

  const summary = {
    tempRepoDir,
    projectId,
    outputDir,
    tickets: [
      { label: "Auth Module", report: ticket1Report ? { summary: ticket1Report.summary } : null },
      { label: "Dashboard", report: ticket2Report ? { summary: ticket2Report.summary } : null },
      { label: "JWT Refactor", report: ticket3Report ? { summary: ticket3Report.summary } : null },
    ],
    finalVerification: { lint: lintFinal.status, test: testFinal.status, build: buildFinal.status },
    codebaseFileCount: finalFileCount,
    consoleEventCounts: { baseline: baselineConsoleCount, ticket1: ticket1ConsoleCount, ticket2: ticket2ConsoleCount },
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
  log("═══════════════════════════════════════════");
  log(`  RESULTS: ${results.passed.length} passed, ${results.failed.length} failed`);
  log("═══════════════════════════════════════════");
  if (results.failed.length > 0) {
    log(`  Failed: ${results.failed.join(", ")}`);
  }
  log(`  Output: ${outputDir}`);
  log("");

  // Ticket execution assertions are soft failures (LLM non-determinism)
  const softFailures = new Set([
    "ticket1-report-exists", "ticket2-report-exists", "ticket3-report-exists",
    "ticket1-auth-file-exists", "ticket1-auth-has-login", "ticket1-auth-has-logout",
    "ticket2-dashboard-exists", "ticket2-imports-auth",
    "ticket3-auth-has-jwt", "ticket3-dashboard-still-exists", "ticket3-dashboard-still-imports-auth",
  ]);
  const hardFailures = results.failed.filter((name) => !softFailures.has(name));
  if (hardFailures.length > 0) {
    process.exitCode = 1;
  } else if (results.failed.length > 0) {
    log("  (LLM-dependent soft failures — agent may produce different structures)");
  }
}

try {
  await main();
} finally {
  await cleanup();
}
