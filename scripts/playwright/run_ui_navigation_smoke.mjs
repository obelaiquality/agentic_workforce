#!/usr/bin/env node
/**
 * UI Navigation Smoke Test
 *
 * Verifies all 5 sidebar sections render their expected content.
 * No project connection needed, no model dependency.
 * Pure UI rendering validation with screenshot artifacts.
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
const outputDir = path.join(root, "output", "playwright", `ui-navigation-smoke-${timestamp}`);

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
const apiToken = `ui-nav-smoke-${Date.now()}`;
const userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "agentic-ui-nav-smoke-"));
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

log("\n┌─ UI Navigation Smoke Test");
log(`│  Output: ${outputDir}\n`);

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

// Record browser errors for debugging
page.on("console", (msg) => {
  if (msg.type() === "error") appendLog("browser-console.log", `[${msg.type()}] ${msg.text()}\n`);
});
page.on("pageerror", (err) => {
  appendLog("browser-console.log", `[pageerror] ${err.message}\n`);
});

// Wait for the shell to render (Work button appears in sidebar)
log("│  Waiting for app shell...");
try {
  await page.getByRole("button", { name: "Work", exact: true }).waitFor({ timeout: 120_000 });
} catch (err) {
  await screenshot(page, "00-startup-failure");
  log("│  ✗ App shell did not render within 120s");
  await cleanup();
  process.exit(1);
}

// Dismiss preflight gate if it appears (blocks all interaction)
try {
  const continueBtn = page.getByRole("button", { name: /continue anyway/i });
  if (await continueBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    log("│  Dismissing preflight gate...");
    await continueBtn.click();
    await delay(500);
  }
} catch {
  // No preflight gate — continue
}

// ── Test 1: Shell renders ───────────────────────────────────────────────────

log("\n├─ 1. Shell structure");
assert(await page.locator('[data-testid="app-root"]').isVisible(), "app-root visible");
assert(await page.locator('[data-testid="app-header"]').isVisible(), "app-header visible");
assert(await page.locator('[data-testid="app-sidebar"]').isVisible(), "app-sidebar visible");
assert(await page.locator('[data-testid="sidebar-live"]').isVisible(), "sidebar-live (Work) button visible");
assert(await page.locator('[data-testid="sidebar-codebase"]').isVisible(), "sidebar-codebase button visible");
assert(await page.locator('[data-testid="sidebar-console"]').isVisible(), "sidebar-console button visible");
assert(await page.locator('[data-testid="sidebar-projects"]').isVisible(), "sidebar-projects button visible");
assert(await page.locator('[data-testid="sidebar-settings"]').isVisible(), "sidebar-settings button visible");
await screenshot(page, "01-shell");

// ── Test 2: Work view (default) ─────────────────────────────────────────────

log("\n├─ 2. Work view (default)");
const workEmpty = await page.locator('[data-testid="work-empty-state"]').isVisible().catch(() => false);
const workCommand = await page.locator('[data-testid="work-task-input"]').isVisible().catch(() => false);
const workBoard = await page.locator('[data-testid="work-task-board"]').isVisible().catch(() => false);
assert(workEmpty || workCommand || workBoard, "Work view renders (empty state, composer, or board)");
await screenshot(page, "02-work");

// Helper: click sidebar with force and delay
async function clickSidebar(testId) {
  await page.locator(`[data-testid="${testId}"]`).click({ force: true, timeout: 10_000 });
  await delay(1000);
}

// ── Test 3: Navigate to Codebase ────────────────────────────────────────────

log("\n├─ 3. Codebase view (empty state)");
try {
  await clickSidebar("sidebar-codebase");
  const cbEmpty = await page.locator('[data-testid="codebase-empty"]').isVisible().catch(() => false);
  const cbRoot = await page.locator('[data-testid="codebase-root"]').isVisible().catch(() => false);
  const cbText = await page.getByText("No project connected").first().isVisible().catch(() => false);
  assert(cbEmpty || cbRoot || cbText, "Codebase view renders (empty or root)");
} catch (err) {
  assert(false, `Codebase view navigation (${err.message.slice(0, 60)})`);
}
await screenshot(page, "03-codebase-empty");

// ── Test 4: Navigate to Console ─────────────────────────────────────────────

log("\n├─ 4. Console view (empty state)");
try {
  await clickSidebar("sidebar-console");
  const conEmpty = await page.locator('[data-testid="console-empty"]').isVisible().catch(() => false);
  const conRoot = await page.locator('[data-testid="console-root"]').isVisible().catch(() => false);
  const conText = await page.getByText("No project connected").first().isVisible().catch(() => false);
  assert(conEmpty || conRoot || conText, "Console view renders (empty or root)");
} catch (err) {
  assert(false, `Console view navigation (${err.message.slice(0, 60)})`);
}
await screenshot(page, "04-console-empty");

// ── Test 5: Navigate to Projects ────────────────────────────────────────────

log("\n├─ 5. Projects view");
try {
  await clickSidebar("sidebar-projects");
  const myProjects = await page.locator('[data-testid="projects-tab-my-projects"]').isVisible().catch(() => false);
  const connectNew = await page.locator('[data-testid="projects-tab-connect-new"]').isVisible().catch(() => false);
  const projText = await page.getByText("My Projects").first().isVisible().catch(() => false);
  assert(myProjects || projText, "My Projects tab visible");
  assert(connectNew, "Connect New tab visible");
} catch (err) {
  assert(false, `Projects view navigation (${err.message.slice(0, 60)})`);
}
await screenshot(page, "05-projects");

// ── Test 6: Navigate to Settings ────────────────────────────────────────────

log("\n├─ 6. Settings view");
try {
  await clickSidebar("sidebar-settings");
  const essentials = await page.locator('[data-testid="settings-view-essentials"]').isVisible().catch(() => false);
  const advanced = await page.locator('[data-testid="settings-view-advanced"]').isVisible().catch(() => false);
  assert(essentials, "Essentials toggle visible");
  assert(advanced, "Advanced toggle visible");
  const runtimeMode = await page.locator('[data-testid="settings-runtime-mode"]').isVisible().catch(() => false);
  const runtimeText = await page.getByText("Runtime Mode").first().isVisible().catch(() => false);
  assert(runtimeMode || runtimeText, "Runtime Mode panel visible");
} catch (err) {
  assert(false, `Settings view navigation (${err.message.slice(0, 60)})`);
}
await screenshot(page, "06-settings");

// ── Test 7: Navigate back to Work ───────────────────────────────────────────

log("\n├─ 7. Navigate back to Work");
try {
  await clickSidebar("sidebar-live");
  const workBackEmpty = await page.locator('[data-testid="work-empty-state"]').isVisible().catch(() => false);
  const workBackCommand = await page.locator('[data-testid="work-task-input"]').isVisible().catch(() => false);
  const workBackBoard = await page.locator('[data-testid="work-task-board"]').isVisible().catch(() => false);
  assert(workBackEmpty || workBackCommand || workBackBoard, "Work view renders after round-trip");
} catch (err) {
  assert(false, `Work round-trip (${err.message.slice(0, 60)})`);
}
await screenshot(page, "07-work-roundtrip");

// ── Test 8: Header status badge ─────────────────────────────────────────────

log("\n├─ 8. Header status badge");
const statusBadge = await page.locator('[data-testid="app-header-status"]').isVisible().catch(() => false);
assert(statusBadge, "Header status badge visible");

// ── Test 9: Quick settings dropdown ─────────────────────────────────────────

log("\n├─ 9. Quick settings dropdown");
try {
  await page.locator('[data-testid="app-quick-settings-trigger"]').click({ force: true, timeout: 10_000 });
  await delay(500);
  const openEssentials = await page.getByText("Open Essentials").isVisible().catch(() => false);
  const openAdvanced = await page.getByText("Open Advanced").isVisible().catch(() => false);
  assert(openEssentials, "Quick settings → Open Essentials visible");
  assert(openAdvanced, "Quick settings → Open Advanced visible");
} catch (err) {
  assert(false, `Quick settings dropdown (${err.message.slice(0, 60)})`);
}
await screenshot(page, "08-quick-settings");

// ── Test 10: Quick settings → Essentials ────────────────────────────────────

log("\n├─ 10. Quick settings → Essentials navigation");
try {
  await page.getByText("Open Essentials").click({ timeout: 5_000 });
  await delay(500);
  const settingsAfterNav = await page.locator('[data-testid="settings-view-essentials"]').isVisible().catch(() => false);
  assert(settingsAfterNav, "Navigated to Settings/Essentials");
} catch (err) {
  assert(false, `Quick settings navigation (${err.message.slice(0, 60)})`);
}
await screenshot(page, "09-settings-via-quick");

// ── Cleanup ─────────────────────────────────────────────────────────────────

log(`\n└─ Results: ${passed} passed, ${failed} failed (${passed + failed} total)`);

const summary = { passed, failed, total: passed + failed, timestamp, outputDir };
await fsp.writeFile(path.join(outputDir, "summary.json"), JSON.stringify(summary, null, 2));

await cleanup();
process.exit(failed > 0 ? 1 : 0);
