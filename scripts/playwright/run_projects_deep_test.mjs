#!/usr/bin/env node
/**
 * Projects Deep Test
 *
 * Tests project tabs, blank project creation, and project card rendering.
 * Creates a blank project during test.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { _electron as electron } from "playwright-core";
import { loadLocalEnv } from "./env-utils.mjs";

const root = path.resolve(new URL("../..", import.meta.url).pathname);
loadLocalEnv(root);
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = path.join(root, "output", "playwright", `projects-deep-test-${timestamp}`);
const tempRepoDir = await fsp.mkdtemp(path.join(os.tmpdir(), "agentic-projects-deep-"));

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
const apiToken = `projects-deep-${Date.now()}`;
const userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "agentic-projects-deep-"));
const spawned = [];
let passed = 0;
let failed = 0;

await fsp.mkdir(outputDir, { recursive: true });

function log(msg) { process.stdout.write(`${msg}\n`); }
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

function assert(condition, label) {
  if (condition) {
    passed++;
    log(`  ✓ ${label}`);
  } else {
    failed++;
    log(`  ✗ FAIL: ${label}`);
  }
}

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(outputDir, `${name}.png`), fullPage: true });
}

// ── Launch ──────────────────────────────────────────────────────────────────

log("\n┌─ Projects Deep Test");
log(`│  Output: ${outputDir}`);
log(`│  Temp repo: ${tempRepoDir}\n`);

startProcess("vite", "npx", ["vite", "--host", "127.0.0.1", "--port", String(vitePort)], {
  ...process.env, BROWSER: "none",
});

log("│  Waiting for Vite dev server...");
const viteDeadline = Date.now() + 60_000;
while (Date.now() < viteDeadline) {
  try { const r = await fetch(`http://127.0.0.1:${vitePort}`); if (r.ok) break; } catch {}
  await delay(500);
}

log("│  Launching Electron...");
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
    NODE_ENV: "development",
  },
});
spawned.push({ kill: (sig) => electronApp.close().catch(() => {}), killed: false });

const page = await electronApp.firstWindow();
await page.setViewportSize({ width: 1640, height: 980 });
await page.waitForLoadState("domcontentloaded");

log("│  Waiting for app shell...");
try {
  await page.getByRole("button", { name: "Work", exact: true }).waitFor({ timeout: 120_000 });
} catch (err) {
  await screenshot(page, "00-startup-failure");
  log("│  ✗ App shell did not render within 120s");
  await cleanup();
  process.exit(1);
}

// Dismiss preflight gate if it appears
try {
  const continueBtn = page.getByRole("button", { name: /continue anyway/i });
  if (await continueBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    log("│  Dismissing preflight gate...");
    await continueBtn.click();
    await delay(500);
  }
} catch {}

// ── Test 1: Navigate to Projects ────────────────────────────────────────────

log("\n├─ 1. Navigate to Projects");
await page.locator('[data-testid="sidebar-projects"]').click();
await delay(500);
await screenshot(page, "01-projects-landing");

// ── Test 2: Projects tabs visible ───────────────────────────────────────────

log("\n├─ 2. Projects tabs structure");
assert(await page.locator('[data-testid="projects-tab-my-projects"]').isVisible(), "projects-tab-my-projects visible");
assert(await page.locator('[data-testid="projects-tab-connect-new"]').isVisible(), "projects-tab-connect-new visible");

// ── Test 3: Navigate to Connect New ─────────────────────────────────────────

log("\n├─ 3. Navigate to Connect New");
await page.locator('[data-testid="projects-tab-connect-new"]').click();
await delay(500);
await screenshot(page, "02-projects-connect-new");

// ── Test 4: New project button visible ──────────────────────────────────────

log("\n├─ 4. New project button");
const newProjectButton = await page.locator('[data-testid="projects-new-project"]').isVisible().catch(() => false);
assert(newProjectButton, "projects-new-project button visible");

// ── Test 5: Click new project button ────────────────────────────────────────

log("\n├─ 5. Open new project dialog");
await page.locator('[data-testid="projects-new-project"]').click();
await delay(1000);
await screenshot(page, "03-projects-dialog");

// ── Test 6: Dialog visible ──────────────────────────────────────────────────

log("\n├─ 6. New project dialog content");
const dialogText = await page.getByText("Create a new project").isVisible().catch(() => false);
const blankProjectText = await page.getByText("BLANK PROJECT").isVisible().catch(() => false);
assert(dialogText || blankProjectText, "Dialog shows new project content");

// ── Test 7: Create blank project ────────────────────────────────────────────

log("\n├─ 7. Create blank project");
try {
  // The blank project card has "Create a managed Git repo" as heading
  const blankCard = page.getByText("Create a managed Git repo").first();
  await blankCard.click({ timeout: 5_000 });
  await delay(3000);
} catch {
  // Fallback: try clicking the BLANK PROJECT section itself
  try {
    await page.getByText("BLANK PROJECT").first().click({ timeout: 5_000 });
    await delay(3000);
  } catch {
    log("  (Could not click blank project button)");
  }
}
await screenshot(page, "04-projects-bootstrapping");

// ── Test 8: Wait for project bootstrap ──────────────────────────────────────

log("\n├─ 8. Wait for project bootstrap");
const bootstrapDeadline = Date.now() + 60_000;
let projectCardVisible = false;
while (Date.now() < bootstrapDeadline) {
  // Try clicking My Projects tab to check for project card
  await page.locator('[data-testid="projects-tab-my-projects"]').click({ force: true }).catch(() => {});
  await delay(2000);
  projectCardVisible = await page.locator('[data-testid="projects-active-project"]').isVisible().catch(() => false);
  if (!projectCardVisible) {
    // Fallback: look for any project-related content
    projectCardVisible = await page.getByText(/Go to Work/i).first().isVisible().catch(() => false);
  }
  if (projectCardVisible) break;
}
assert(projectCardVisible, "Project card appears after bootstrap");
await screenshot(page, "05-projects-my-projects");

// ── Test 9: Go to Work button visible ───────────────────────────────────────

log("\n├─ 9. Go to Work button");
const goToWorkButton = await page.locator('[data-testid="projects-go-to-work"]').isVisible().catch(() => false);
const goToWorkText = await page.getByText(/Go to Work/i).first().isVisible().catch(() => false);
assert(goToWorkButton || goToWorkText, "Go to Work button visible");
await screenshot(page, "06-projects-final");

// ── Cleanup ─────────────────────────────────────────────────────────────────

log(`\n└─ Results: ${passed} passed, ${failed} failed (${passed + failed} total)`);

const summary = { passed, failed, total: passed + failed, timestamp, outputDir, tempRepoDir };
await fsp.writeFile(path.join(outputDir, "summary.json"), JSON.stringify(summary, null, 2));

await cleanup();
process.exit(failed > 0 ? 1 : 0);
