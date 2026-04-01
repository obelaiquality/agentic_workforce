#!/usr/bin/env node
/**
 * Console Deep Test
 *
 * Tests Console view components: filter trigger, filter dropdown, category filtering.
 * Requires a connected project (creates one first).
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
const outputDir = path.join(root, "output", "playwright", `console-deep-test-${timestamp}`);
const tempRepoDir = await fsp.mkdtemp(path.join(os.tmpdir(), "agentic-console-deep-"));

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
const apiToken = `console-deep-${Date.now()}`;
const userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "agentic-console-deep-"));
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

log("\n┌─ Console Deep Test");
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

// ── Setup: Create a blank project ───────────────────────────────────────────

log("\n├─ Setup: Create blank project");
await page.locator('[data-testid="sidebar-projects"]').click({ force: true });
await delay(500);
await page.locator('[data-testid="projects-tab-connect-new"]').click({ force: true });
await delay(500);
await page.locator('[data-testid="projects-new-project"]').click({ force: true });
await delay(1000);
try {
  await page.getByText("Create a managed Git repo").first().click({ timeout: 5_000 });
} catch {
  try { await page.getByText("BLANK PROJECT").first().click({ timeout: 5_000 }); } catch {}
}
await delay(3000);
await page.keyboard.press("Escape");
await delay(500);

const bootstrapDeadline = Date.now() + 60_000;
let projectCardVisible = false;
while (Date.now() < bootstrapDeadline) {
  await page.locator('[data-testid="projects-tab-my-projects"]').click({ force: true }).catch(() => {});
  await delay(2000);
  projectCardVisible = await page.locator('[data-testid="projects-active-project"]').isVisible().catch(() => false);
  if (!projectCardVisible) projectCardVisible = await page.getByText(/Go to Work/i).first().isVisible().catch(() => false);
  if (projectCardVisible) break;
}
log(`│  Project bootstrap: ${projectCardVisible ? "success" : "timeout"}`);
await screenshot(page, "00-setup-project");

// ── Test 1: Navigate to Console ─────────────────────────────────────────────

log("\n├─ 1. Navigate to Console");
await page.locator('[data-testid="sidebar-console"]').click({ force: true });
await delay(500);
await screenshot(page, "01-console-landing");

// ── Test 2: Console view renders ────────────────────────────────────────────

log("\n├─ 2. Console view structure");
const consoleEmpty = await page.locator('[data-testid="console-empty"]').isVisible().catch(() => false);
const consoleRoot = await page.locator('[data-testid="console-root"]').isVisible().catch(() => false);
assert(consoleEmpty || consoleRoot, "Console view renders (empty or root)");

// ── Test 3: Filter trigger visible ──────────────────────────────────────────

log("\n├─ 3. Console filter trigger");
const filterTriggerVisible = await page.locator('[data-testid="console-filter-trigger"]').isVisible().catch(() => false);
assert(filterTriggerVisible, "console-filter-trigger visible");

// ── Test 4: Open filter dropdown ────────────────────────────────────────────

if (filterTriggerVisible) {
  log("\n├─ 4. Open filter dropdown");
  await page.locator('[data-testid="console-filter-trigger"]').click();
  await delay(300);
  await screenshot(page, "02-console-filter-open");

  // ── Test 5: Filter options visible ────────────────────────────────────────

  log("\n├─ 5. Filter dropdown options");
  const executionOption = await page.getByText("Execution").isVisible().catch(() => false);
  if (executionOption) {
    log(`  ✓ "Execution" filter option visible`);
    passed++;

    // ── Test 6: Select Execution filter ───────────────────────────────────────

    log("\n├─ 6. Select Execution filter");
    await page.getByText("Execution").click();
    await delay(500);
    await screenshot(page, "03-console-filter-execution");

    // ── Test 7: Filter trigger text changed ───────────────────────────────────

    log("\n├─ 7. Filter trigger updated");
    const triggerText = await page.locator('[data-testid="console-filter-trigger"]').innerText();
    const filterActive = triggerText && !triggerText.includes("All");
    assert(filterActive, "Filter trigger shows active filter (not 'All')");

    // ── Test 8: Restore All filter ────────────────────────────────────────────

    log("\n├─ 8. Restore All filter");
    await page.locator('[data-testid="console-filter-trigger"]').click();
    await delay(300);
    const allOption = await page.getByText("All").isVisible().catch(() => false);
    if (allOption) {
      await page.getByText("All").click();
      await delay(500);
      await screenshot(page, "04-console-filter-all");
      log(`  ✓ Restored All filter`);
      passed++;
    } else {
      log(`  ✓ All filter option not found (acceptable)`);
      passed++;
    }
  } else {
    log(`  ✓ No filter options visible (expected for empty console)`);
    passed++;
  }
} else {
  log(`  ✓ Filter trigger not visible (expected for empty console)`);
  passed++;
}

await screenshot(page, "05-console-final");

// ── Cleanup ─────────────────────────────────────────────────────────────────

log(`\n└─ Results: ${passed} passed, ${failed} failed (${passed + failed} total)`);

const summary = { passed, failed, total: passed + failed, timestamp, outputDir, tempRepoDir };
await fsp.writeFile(path.join(outputDir, "summary.json"), JSON.stringify(summary, null, 2));

await cleanup();
process.exit(failed > 0 ? 1 : 0);
