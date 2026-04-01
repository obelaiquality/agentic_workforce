#!/usr/bin/env node
/**
 * Settings Deep Test
 *
 * Tests all settings panels, view toggles, and accordions.
 * No project connection needed.
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
const outputDir = path.join(root, "output", "playwright", `settings-deep-test-${timestamp}`);

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
const apiToken = `settings-deep-${Date.now()}`;
const userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "agentic-settings-deep-"));
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

log("\n┌─ Settings Deep Test");
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

// ── Test 1: Navigate to Settings ────────────────────────────────────────────

log("\n├─ 1. Navigate to Settings");
await page.locator('[data-testid="sidebar-settings"]').click();
await delay(500);
await screenshot(page, "01-settings-landing");

// ── Test 2: Settings view structure ─────────────────────────────────────────

log("\n├─ 2. Settings view essentials");
assert(await page.locator('[data-testid="settings-view-essentials"]').isVisible().catch(() => false), "settings-view-essentials visible");
assert(await page.locator('[data-testid="settings-view-advanced"]').isVisible().catch(() => false), "settings-view-advanced visible");
const rtMode = await page.locator('[data-testid="settings-runtime-mode"]').isVisible().catch(() => false) || await page.getByText("Runtime Mode").first().isVisible().catch(() => false);
assert(rtMode, "Runtime Mode panel visible");
const apiKeys = await page.locator('[data-testid="settings-api-keys"]').isVisible().catch(() => false) || await page.getByText("API Keys").first().isVisible().catch(() => false);
assert(apiKeys, "API Keys panel visible");
const activeProfile = await page.locator('[data-testid="settings-active-profile"]').isVisible().catch(() => false) || await page.getByText("Active Profile").first().isVisible().catch(() => false);
assert(activeProfile, "Active Profile panel visible");
await screenshot(page, "02-settings-essentials-detail");

// ── Test 3: Switch to Advanced ──────────────────────────────────────────────

log("\n├─ 3. Switch to Advanced view");
await page.locator('[data-testid="settings-view-advanced"]').click({ force: true });
await delay(1000);
await screenshot(page, "03-settings-advanced");

// ── Test 4: Advanced content visible ────────────────────────────────────────

log("\n├─ 4. Advanced content renders");
const executionProfilesText = await page.getByText("Execution Profiles").first().isVisible().catch(() => false);
const profilesText = await page.getByText(/balanced|deep.scope|build.heavy/i).first().isVisible().catch(() => false);
assert(executionProfilesText || profilesText, "Advanced view shows profiles content");

// ── Test 5: Switch back to Essentials ───────────────────────────────────────

log("\n├─ 5. Switch back to Essentials");
await page.locator('[data-testid="settings-view-essentials"]').click({ force: true });
await delay(1000);
const runtimeModeVisible = await page.locator('[data-testid="settings-runtime-mode"]').isVisible().catch(() => false) || await page.getByText("Runtime Mode").first().isVisible().catch(() => false);
assert(runtimeModeVisible, "Runtime mode panel visible after switching back");
await screenshot(page, "04-settings-essentials-return");

// ── Cleanup ─────────────────────────────────────────────────────────────────

log(`\n└─ Results: ${passed} passed, ${failed} failed (${passed + failed} total)`);

const summary = { passed, failed, total: passed + failed, timestamp, outputDir };
await fsp.writeFile(path.join(outputDir, "summary.json"), JSON.stringify(summary, null, 2));

await cleanup();
process.exit(failed > 0 ? 1 : 0);
