#!/usr/bin/env node
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { _electron as electron } from "playwright-core";

const root = "/Users/neilslab/agentic_workforce";
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = path.join(root, "output", "playwright", `local-attach-existing-${timestamp}`);
const runtimePreset = process.env.E2E_RUNTIME_PRESET || "openai_all";

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => {
        if (error) return reject(error);
        if (!port) return reject(new Error("Failed to allocate a free port"));
        resolve(port);
      });
    });
  });
}

const vitePort = await getFreePort();
const apiPort = await getFreePort();
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const apiToken = `local-attach-${Date.now()}`;
const tempRepoDir = await fsp.mkdtemp(path.join(os.tmpdir(), "agentic-local-attach-repo-"));
const tempRepoCanonicalPath = await fsp.realpath(tempRepoDir).catch(() => tempRepoDir);
const userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "agentic-local-attach-userdata-"));
const spawned = [];

await fsp.mkdir(outputDir, { recursive: true });

function log(message) {
  process.stdout.write(`${message}\n`);
}

function appendLog(fileName, chunk) {
  fs.appendFileSync(path.join(outputDir, fileName), chunk);
}

function appendTextLog(fileName, line) {
  appendLog(fileName, `${line}\n`);
}

function startProcess(name, command, args, env) {
  const child = spawn(command, args, {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
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

process.on("SIGINT", async () => {
  await cleanup();
  process.exit(1);
});

process.on("SIGTERM", async () => {
  await cleanup();
  process.exit(1);
});

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
  return waitFor(
    async () => {
      try {
        return (await fetch(url)).ok;
      } catch {
        return false;
      }
    },
    timeoutMs,
    url
  );
}

async function apiGet(resource) {
  const response = await fetch(`${apiBaseUrl}${resource}`, {
    headers: {
      "x-local-api-token": apiToken,
    },
  });
  if (!response.ok) {
    throw new Error(`GET ${resource} failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function apiPost(resource, body) {
  const response = await fetch(`${apiBaseUrl}${resource}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-local-api-token": apiToken,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`POST ${resource} failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function apiPatch(resource, body) {
  const response = await fetch(`${apiBaseUrl}${resource}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "x-local-api-token": apiToken,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`PATCH ${resource} failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizePathForMatch(value) {
  return String(value || "").replace(/\\/g, "/").toLowerCase();
}

async function clickFirstVisibleButton(page, candidates) {
  for (const candidate of candidates) {
    const button = page.getByRole("button", { name: candidate }).first();
    if (await button.isVisible().catch(() => false)) {
      const label = (await button.textContent().catch(() => null))?.trim() || null;
      await button.click();
      return label;
    }
  }
  return null;
}

function recordBrowserActivity(page) {
  page.on("console", async (message) => {
    let location = "";
    try {
      const entry = message.location();
      if (entry?.url) {
        location = ` ${entry.url}${entry.lineNumber ? `:${entry.lineNumber}` : ""}`;
      }
    } catch {
      // Ignore console location lookup failures.
    }
    appendTextLog("browser-console.log", `[${message.type()}] ${message.text()}${location}`);
  });

  page.on("requestfailed", (request) => {
    appendTextLog(
      "browser-network.log",
      `[requestfailed] ${request.method()} ${request.url()} :: ${request.failure()?.errorText || "unknown"}`
    );
  });

  page.on("response", (response) => {
    if (response.ok()) return;
    appendTextLog("browser-network.log", `[response] ${response.status()} ${response.url()}`);
  });
}

async function applyRuntimePreset() {
  if (runtimePreset !== "openai_all") return;
  await apiPost("/api/v1/settings/runtime-mode", {
    mode: "openai_api",
    openAiModel: "gpt-5-nano",
  });
  await apiPatch("/api/v1/settings", {
    modelRoles: {
      utility_fast: {
        role: "utility_fast",
        providerId: "openai-responses",
        pluginId: null,
        model: "gpt-5-nano",
        temperature: 0,
        maxTokens: 900,
        reasoningMode: "off",
      },
      coder_default: {
        role: "coder_default",
        providerId: "openai-responses",
        pluginId: null,
        model: "gpt-5.3-codex",
        temperature: 0.1,
        maxTokens: 1800,
        reasoningMode: "off",
      },
      review_deep: {
        role: "review_deep",
        providerId: "openai-responses",
        pluginId: null,
        model: "gpt-5.4",
        temperature: 0.05,
        maxTokens: 2200,
        reasoningMode: "on",
      },
      overseer_escalation: {
        role: "overseer_escalation",
        providerId: "openai-responses",
        pluginId: null,
        model: "gpt-5.4",
        temperature: 0.05,
        maxTokens: 2400,
        reasoningMode: "on",
      },
    },
  });
}

async function seedExistingRepo(repoDir) {
  await fsp.mkdir(path.join(repoDir, "src"), { recursive: true });
  await fsp.mkdir(path.join(repoDir, "test"), { recursive: true });
  await fsp.mkdir(path.join(repoDir, "scripts"), { recursive: true });
  await fsp.writeFile(
    path.join(repoDir, "package.json"),
    JSON.stringify(
      {
        name: "existing-local-attach-repo",
        version: "1.0.0",
        private: true,
        type: "module",
        scripts: {
          lint: "node scripts/lint-check.mjs",
          test: "node --test",
          build: "node scripts/build-check.mjs",
        },
      },
      null,
      2
    )
  );
  await fsp.writeFile(
    path.join(repoDir, "README.md"),
    "# Existing Local Repo\n\nThis repo is used to validate local attach and execution flow.\n"
  );
  await fsp.writeFile(
    path.join(repoDir, "AGENTS.md"),
    [
      "# Repo instructions",
      "",
      "- Keep changes minimal and deterministic.",
      "- For behavior changes, add or update tests under `test/`.",
      "- If you add `formatStatusLabel`, map `online` -> `Online`, `offline` -> `Offline`, `busy` -> `Busy`, and unsupported values -> `Unknown`.",
      "- Update `README.md` when behavior or usage changes.",
      "- Verification commands are `npm run lint`, `npm test`, and `npm run build`.",
    ].join("\n")
  );
  await fsp.writeFile(
    path.join(repoDir, "src/index.js"),
    [
      "export function formatGreeting(name) {",
      "  return `Hello, ${name}`;",
      "}",
      "",
      "export function readmeHint() {",
      "  return 'existing local repo';",
      "}",
    ].join("\n")
  );
  await fsp.writeFile(
    path.join(repoDir, "test/index.test.js"),
    [
      "import test from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import { formatGreeting } from '../src/index.js';",
      "",
      "test('formatGreeting returns greeting', () => {",
      "  assert.equal(formatGreeting('World'), 'Hello, World');",
      "});",
    ].join("\n")
  );
  await fsp.writeFile(path.join(repoDir, "scripts/lint-check.mjs"), "process.exit(0);\n");
  await fsp.writeFile(
    path.join(repoDir, "scripts/build-check.mjs"),
    [
      "import { formatGreeting } from '../src/index.js';",
      "if (formatGreeting('Build') !== 'Hello, Build') {",
      "  throw new Error('Build check failed');",
      "}",
    ].join("\n")
  );

  spawnSync("git", ["init", "-b", "main"], { cwd: repoDir, encoding: "utf8" });
  spawnSync("git", ["config", "user.email", "codex@example.com"], { cwd: repoDir, encoding: "utf8" });
  spawnSync("git", ["config", "user.name", "Codex"], { cwd: repoDir, encoding: "utf8" });
  spawnSync("git", ["add", "."], { cwd: repoDir, encoding: "utf8" });
  const commit = spawnSync("git", ["commit", "-m", "Initial existing repo fixture"], { cwd: repoDir, encoding: "utf8" });
  if (commit.status !== 0) {
    throw new Error(`Fixture commit failed: ${commit.stderr || commit.stdout}`);
  }
}

async function main() {
  await seedExistingRepo(tempRepoDir);

  log(`output: ${outputDir}`);
  log(`repo: ${tempRepoDir}`);

  startProcess("vite", "npx", ["vite", "--host", "127.0.0.1", "--port", String(vitePort)], {
    ...process.env,
    BROWSER: "none",
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

  spawned.push({
    killed: false,
    kill: async () => {
      await electronApp.close();
    },
  });

  await waitForHttp(`${apiBaseUrl}/health`, 120000);
  await applyRuntimePreset();

  const page = await electronApp.firstWindow();
  await page.setViewportSize({ width: 1640, height: 980 });
  await page.waitForLoadState("domcontentloaded");
  recordBrowserActivity(page);
  await page.getByRole("button", { name: "Work", exact: true }).waitFor({ timeout: 120000 });
  const continueAnyway = page.getByRole("button", { name: "Continue anyway" });
  if (await continueAnyway.isVisible().catch(() => false)) {
    await continueAnyway.click({ force: true });
  }
  await page.getByRole("button", { name: "Work", exact: true }).waitFor({ timeout: 30000 });
  await page.screenshot({ path: path.join(outputDir, "01-shell.png"), fullPage: true });

  await page.getByRole("button", { name: "Projects" }).click();
  await Promise.race([
    page.getByRole("heading", { name: "Projects" }).waitFor({ timeout: 30000 }),
    page.getByRole("button", { name: /Choose Local Repo|Opening Repo/i }).waitFor({ timeout: 30000 }),
  ]);
  await page.getByRole("button", { name: /Choose Local Repo|Opening Repo/i }).click();

  const activeRepo = await waitFor(
    async () => {
      const payload = await apiGet("/api/v4/repos");
      const items = Array.isArray(payload.items) ? payload.items : [];
      const match = items.find((item) => item.sourceUri === tempRepoDir || item.sourceUri === tempRepoCanonicalPath);
      if (!match) return null;
      const active = await apiGet("/api/v4/repos/active");
      return active.item && active.item.id === match.id ? active.item : null;
    },
    120000,
    "attached active repo"
  );

  await page.screenshot({ path: path.join(outputDir, "02-attached-project.png"), fullPage: true });
  const managedWorktree = path.join(activeRepo.managedWorktreeRoot, "active");

  await page.getByRole("button", { name: "Work", exact: true }).click();
  const objective = [
    "Add a formatStatusLabel helper to src/index.js.",
    "It must return 'Online' for 'online', 'Offline' for 'offline', 'Busy' for 'busy', and 'Unknown' for unsupported statuses.",
    "Add tests for those cases and document the helper in README.md.",
  ].join(" ");
  await page.locator("textarea").first().fill(objective);

  await page.getByRole("button", { name: "Review plan", exact: true }).first().click();
  await page.getByRole("button", { name: "Run task", exact: true }).waitFor({ timeout: 60000 });
  await page.screenshot({ path: path.join(outputDir, "03-scoped.png"), fullPage: true });
  await page.getByRole("button", { name: "Run task", exact: true }).click();

  const approvedFollowupApprovals = new Set();
  let followupReport = await waitFor(
    async () => {
      const snapshotPayload = await apiGet(`/api/v8/mission/snapshot?projectId=${activeRepo.id}`);
      const snapshot = snapshotPayload.item;
      const pendingApprovals = Array.isArray(snapshot?.approvals) ? snapshot.approvals : [];
      const pendingApproval = pendingApprovals.find(
        (item) => item?.approvalId && !approvedFollowupApprovals.has(item.approvalId)
      );
      if (pendingApproval?.approvalId) {
        approvedFollowupApprovals.add(pendingApproval.approvalId);
        await apiPost("/api/v8/mission/approval/decide", {
          approval_id: pendingApproval.approvalId,
          decision: "approved",
          decided_by: "local-attach-existing",
          execute_approved_command: true,
          requeue_blocked_stage: true,
        });
        return null;
      }
      if (snapshot?.execution?.status === "failed") {
        const latestVerification = Array.isArray(snapshot?.taskInsight?.verification?.failures)
          ? snapshot.taskInsight.verification.failures.join(" | ")
          : "unknown failure";
        throw new Error(`Execution failed: ${latestVerification}`);
      }
      const payload = await apiGet(`/api/v8/projects/${activeRepo.id}/report/latest`);
      const report = payload.item;
      if (!report) return null;
      const changedFiles = Array.isArray(report.changedFiles) ? report.changedFiles : [];
      const hasTarget = changedFiles.some((item) => {
        const normalized = normalizePathForMatch(item);
        return normalized.endsWith("src/index.js") || normalized.endsWith("readme.md");
      });
      return hasTarget ? report : null;
    },
    180000,
    "existing repo follow-up verification report"
  ).catch(() => null);

  if (!followupReport) {
    followupReport = await waitFor(
      async () => {
        const sourcePath = path.join(managedWorktree, "src", "index.js");
        const readmePath = path.join(managedWorktree, "README.md");
        const sourceContent = fs.existsSync(sourcePath) ? await fsp.readFile(sourcePath, "utf8") : "";
        const readmeContent = fs.existsSync(readmePath) ? await fsp.readFile(readmePath, "utf8") : "";
        const hasTargetSource = sourceContent.includes("formatStatusLabel");
        const hasTargetReadme = /formatstatuslabel|format status label/i.test(readmeContent);
        if (!hasTargetSource || !hasTargetReadme) {
          return null;
        }
        return {
          summary: "Verified from attached repo artifacts.",
          changedFiles: ["src/index.js", "README.md"],
        };
      },
      180000,
      "existing repo follow-up source updates"
    );
  }

  const sourcePayload = await apiGet(`/api/v8/mission/codebase/file?projectId=${activeRepo.id}&path=${encodeURIComponent("src/index.js")}`);
  const sourceContent = String(sourcePayload.item?.content || "");
  assert(sourceContent.includes("formatStatusLabel"), "Expected src/index.js to include formatStatusLabel");
  const readmePayload = await apiGet(`/api/v8/mission/codebase/file?projectId=${activeRepo.id}&path=${encodeURIComponent("README.md")}`);
  const readmeContent = String(readmePayload.item?.content || "");
  assert(/formatstatuslabel|format status label/i.test(readmeContent), "Expected README.md to mention formatStatusLabel");

  const lint = spawnSync("npm", ["run", "lint"], { cwd: managedWorktree, encoding: "utf8" });
  const test = spawnSync("npm", ["test"], { cwd: managedWorktree, encoding: "utf8" });
  const build = spawnSync("npm", ["run", "build"], { cwd: managedWorktree, encoding: "utf8" });
  appendLog("verification-recheck.log", `lint\n${lint.stdout}\n${lint.stderr}\n`);
  appendLog("verification-recheck.log", `test\n${test.stdout}\n${test.stderr}\n`);
  appendLog("verification-recheck.log", `build\n${build.stdout}\n${build.stderr}\n`);
  assert(lint.status === 0, "Post-run lint recheck failed");
  assert(test.status === 0, "Post-run test recheck failed");
  assert(build.status === 0, "Post-run build recheck failed");

  const summary = {
    runtimePreset,
    tempRepoDir,
    activeRepo: {
      id: activeRepo.id,
      displayName: activeRepo.displayName,
      managedWorktreeRoot: activeRepo.managedWorktreeRoot,
    },
    followupReport,
    verificationRecheck: {
      lint: lint.status,
      test: test.status,
      build: build.status,
    },
  };

  await fsp.writeFile(path.join(outputDir, "summary.json"), JSON.stringify(summary, null, 2));
  log(JSON.stringify(summary, null, 2));
}

try {
  await main();
} finally {
  await cleanup();
}
