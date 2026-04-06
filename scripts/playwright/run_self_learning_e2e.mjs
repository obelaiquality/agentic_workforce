#!/usr/bin/env node
/**
 * Self-Learning Loop E2E Test
 *
 * Validates the full feedback loop:
 *   1. Scaffold a project (needed for valid projectId / worktree)
 *   2. Seed learnings via API
 *   3. Boost confidence via repeated posts (exercises merge logic)
 *   4. Trigger dream cycle (consolidation)
 *   5. Verify principles created
 *   6. Verify stats endpoint
 *   7. Verify suggested skills endpoint
 *   8. Verify Learnings UI renders in Settings → Advanced → Labs
 *
 * Usage:
 *   node scripts/playwright/run_self_learning_e2e.mjs
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
const outputDir = path.join(root, "output", "playwright", `self-learning-e2e-${timestamp}`);

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
const apiToken = `self-learning-e2e-${Date.now()}`;
const tempRepoDir = await fsp.mkdtemp(path.join(os.tmpdir(), "agentic-self-learning-e2e-"));
const tempRepoCanonicalPath = await fsp.realpath(tempRepoDir).catch(() => tempRepoDir);
const userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "agentic-self-learning-e2e-userdata-"));
const spawned = [];

await fsp.mkdir(outputDir, { recursive: true });

const results = { passed: [], failed: [] };

function log(msg) { process.stdout.write(`[self-learning] ${msg}\n`); }
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

async function apiDelete(resource) {
  const response = await fetch(`${apiBaseUrl}${resource}`, {
    method: "DELETE",
    headers: { "x-local-api-token": apiToken },
  });
  return { status: response.status, ok: response.ok };
}

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(outputDir, `${name}.png`), fullPage: true });
}

// ── Launch ──────────────────────────────────────────────────────────────────

async function main() {
  log(`output: ${outputDir}`);
  log(`repo: ${tempRepoDir}`);

  // ── Step 1: Start Vite + Electron ──
  log("Step 1: Starting Vite + Electron");
  startProcess("vite", "npx", ["vite", "--host", "127.0.0.1", "--port", String(vitePort)], {
    ...process.env, BROWSER: "none",
  });

  const viteDeadline = Date.now() + 90_000;
  while (Date.now() < viteDeadline) {
    try { const r = await fetch(`http://127.0.0.1:${vitePort}`); if (r.ok) break; } catch {}
    await delay(500);
  }
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

  // ── Step 2: Bootstrap project (needed for valid projectId) ──
  log("Step 2: Creating project");
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
  log(`  Project ID: ${projectId}`);

  await screenshot(page, "02-project-created");

  // ── Step 3: Seed learnings via API ──
  // Create 4 learnings with shared relatedTools so they group together.
  // Each starts at confidence 0.3 — we re-post twice more to reach 0.5.
  log("Step 3: Seeding learnings via API");

  const seedLearnings = [
    {
      category: "pattern",
      summary: "Always export utility functions with named exports for tree-shaking",
      detail: "Named exports improve tree-shaking and IDE auto-import support. Verified across multiple utility modules.",
      relatedTools: ["write_file", "read_file"],
      relatedFiles: ["src/utils/format.ts"],
    },
    {
      category: "pattern",
      summary: "Add comprehensive tests alongside utility functions with named exports",
      detail: "Every utility module should have a co-located test file. Reduces regression risk on refactors.",
      relatedTools: ["write_file", "read_file"],
      relatedFiles: ["src/utils/format.test.ts"],
    },
    {
      category: "antipattern",
      summary: "Avoid default exports in utility modules — they break refactoring",
      detail: "Default exports make rename-refactors harder and degrade IDE support.",
      relatedTools: ["write_file", "read_file"],
      relatedFiles: ["src/utils/"],
    },
    {
      category: "preference",
      summary: "Prefer guard clauses with early returns over nested conditionals in utilities",
      detail: "Guard clauses improve readability and reduce cyclomatic complexity in utility functions.",
      relatedTools: ["write_file"],
      relatedFiles: ["src/utils/"],
    },
  ];

  // Post each learning 3× to boost confidence from 0.3 → 0.5
  for (const seed of seedLearnings) {
    for (let i = 0; i < 3; i++) {
      await apiPost("/api/learnings", {
        projectId,
        category: seed.category,
        summary: seed.summary,
        detail: seed.detail,
        source: "user_feedback",
        relatedFiles: seed.relatedFiles,
        relatedTools: seed.relatedTools,
      });
    }
  }

  // ── Step 4: Verify learnings exist ──
  log("Step 4: Verifying learnings via API");

  const learningsPayload = await apiGet(`/api/learnings?projectId=${projectId}`);
  const learningsItems = learningsPayload.items || [];
  check("learnings-count-gte-4", learningsItems.length >= 4, `Got ${learningsItems.length} (expected >= 4)`);

  // Verify confidence was boosted (each had 3 posts → 0.3 + 0.1 + 0.1 = 0.5)
  const highConfidence = learningsItems.filter((l) => l.confidence >= 0.5);
  check("learnings-confidence-boosted", highConfidence.length >= 4,
    `Only ${highConfidence.length} learnings with confidence >= 0.5`);

  // Verify all have the right fields
  const sampleLearning = learningsItems[0];
  check("learning-has-id", !!sampleLearning?.id, "Missing id");
  check("learning-has-category", !!sampleLearning?.category, "Missing category");
  check("learning-has-summary", !!sampleLearning?.summary, "Missing summary");
  check("learning-has-confidence", typeof sampleLearning?.confidence === "number", "Missing confidence");
  check("learning-has-occurrences", sampleLearning?.occurrences >= 3, `occurrences: ${sampleLearning?.occurrences}`);

  await screenshot(page, "03-learnings-seeded");

  // ── Step 5: Trigger dream cycle (consolidation) ──
  log("Step 5: Triggering dream cycle");

  const dreamResult = await apiPost("/api/learnings/dream/trigger", { projectId });
  check("dream-trigger-ok", dreamResult.ok === true, `Response: ${JSON.stringify(dreamResult)}`);
  check("dream-principles-created", dreamResult.principlesCreated >= 1,
    `principlesCreated: ${dreamResult.principlesCreated}`);

  // ── Step 6: Verify consolidation — principles ──
  log("Step 6: Verifying principles");

  const principlesPayload = await apiGet(`/api/learnings/principles?projectId=${projectId}`);
  const principles = principlesPayload.items || [];
  check("principles-exist", principles.length >= 1, `Got ${principles.length} principles`);

  if (principles.length > 0) {
    const p = principles[0];
    check("principle-has-id", !!p.id, "Missing id");
    check("principle-has-text", !!p.principle, "Missing principle text");
    check("principle-has-reasoning", !!p.reasoning, "Missing reasoning");
    check("principle-has-derivedFrom", Array.isArray(p.derivedFrom) && p.derivedFrom.length >= 2,
      `derivedFrom: ${JSON.stringify(p.derivedFrom)}`);
  }

  // ── Step 7: Verify stats endpoint ──
  log("Step 7: Verifying dream stats");

  const stats = await apiGet(`/api/learnings/dream/stats?projectId=${projectId}`);
  check("stats-learnings-count", stats.learningsCount >= 4, `learningsCount: ${stats.learningsCount}`);
  check("stats-principles-count", stats.principlesCount >= 1, `principlesCount: ${stats.principlesCount}`);

  // ── Step 8: Verify suggested skills endpoint ──
  log("Step 8: Verifying suggested skills endpoint");

  const suggestedPayload = await apiGet(`/api/learnings/skills/suggested?projectId=${projectId}`);
  check("suggested-skills-endpoint-ok", Array.isArray(suggestedPayload.items),
    "skills/suggested did not return items array");
  // Suggested skills may be empty if synthesis thresholds not met — that's acceptable

  // ── Step 9: Verify learnings CRUD (update + delete) ──
  log("Step 9: Verifying learnings update and delete");

  if (learningsItems.length > 0) {
    const testId = learningsItems[learningsItems.length - 1].id;

    // Delete
    const delResult = await apiDelete(`/api/learnings/${testId}?projectId=${projectId}`);
    check("learning-delete-ok", delResult.ok, `DELETE status: ${delResult.status}`);

    // Verify count decreased
    const afterDelete = await apiGet(`/api/learnings?projectId=${projectId}`);
    check("learning-count-decreased", (afterDelete.items || []).length === learningsItems.length - 1,
      `Expected ${learningsItems.length - 1}, got ${(afterDelete.items || []).length}`);
  }

  // ── Step 10: Verify UI — Learnings Lab ──
  log("Step 10: Verifying Learnings UI");

  // Navigate to Settings
  await page.locator('[data-testid="sidebar-settings"]').click();
  await delay(500);

  // Switch to Advanced view
  await page.locator('[data-testid="settings-view-advanced"]').click({ force: true });
  await delay(1000);

  // Enable Labs mode (required for Learnings panel)
  const labsCheckbox = page.getByLabel("Show Labs");
  const labsEnabled = await labsCheckbox.isChecked().catch(() => false);
  if (!labsEnabled) {
    await labsCheckbox.check({ force: true });
    await delay(500);
  }

  await screenshot(page, "04-settings-advanced");

  // Open the Labs accordion section
  const labsSection = page.getByText("Labs & Experimental");
  if (await labsSection.isVisible().catch(() => false)) {
    await labsSection.click({ force: true });
    await delay(500);
  }

  // Scroll down to find the Learnings Lab button
  await page.evaluate(() => {
    const scrollable = document.querySelector('[class*="overflow-y"]') || document.documentElement;
    scrollable.scrollTop = scrollable.scrollHeight;
  });
  await delay(1000);

  // Find and click "Open Learnings Lab" button
  const learningsLabBtn = page.getByRole("button", { name: /Open Learnings Lab/i });
  const labBtnVisible = await learningsLabBtn.isVisible({ timeout: 5_000 }).catch(() => false)
    || await learningsLabBtn.scrollIntoViewIfNeeded().then(() => learningsLabBtn.isVisible()).catch(() => false);
  check("learnings-lab-button-visible", labBtnVisible, "Open Learnings Lab button not found");

  if (labBtnVisible) {
    await learningsLabBtn.click();
    await delay(1500);

    await screenshot(page, "05-learnings-view");

    // Verify LearningsView content
    const hasDreamCycleText = await page.getByText(/Dream Cycle/i).first().isVisible({ timeout: 5_000 }).catch(() => false);
    check("ui-dream-cycle-section", hasDreamCycleText, "Dream Cycle section not visible");

    const hasLearningsText = await page.getByText(/Learnings/i).first().isVisible().catch(() => false);
    check("ui-learnings-section", hasLearningsText, "Learnings section not visible");

    // Look for principle or consolidated content
    const hasPrincipleText = await page.getByText(/Principle|Consolidated/i).first().isVisible().catch(() => false)
      || await page.getByText(/Prefer|Avoid/i).first().isVisible().catch(() => false);
    check("ui-principles-visible", hasPrincipleText, "Principles content not visible");

    await screenshot(page, "06-learnings-view-detail");
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  const summary = {
    tempRepoDir,
    projectId,
    outputDir,
    learnings: { seeded: seedLearnings.length, afterBoost: learningsItems.length },
    principles: principles.length,
    stats,
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

  if (results.failed.length > 0) {
    process.exitCode = 1;
  }
}

try {
  await main();
} finally {
  await cleanup();
}
