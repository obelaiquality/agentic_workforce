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
const outputDir = path.join(root, "output", "playwright", `desktop-acceptance-${timestamp}`);
async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        if (!port) {
          reject(new Error("Failed to allocate a free port"));
          return;
        }
        resolve(port);
      });
    });
  });
}

const vitePort = await getFreePort();
const apiPort = await getFreePort();
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const apiToken = `desktop-e2e-${Date.now()}`;
const tempRepoDir = await fsp.mkdtemp(path.join(os.tmpdir(), "agentic-desktop-e2e-repo-"));
const tempRepoCanonicalPath = await fsp.realpath(tempRepoDir).catch(() => tempRepoDir);
const userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "agentic-desktop-e2e-userdata-"));
const spawned = [];

await fsp.mkdir(outputDir, { recursive: true });

function log(message) {
  process.stdout.write(`${message}\n`);
}

function appendLog(fileName, chunk) {
  fs.appendFileSync(path.join(outputDir, fileName), chunk);
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
    if (!child.killed) {
      child.kill("SIGTERM");
    }
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
    if (value) {
      return value;
    }
    await delay(1000);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function waitForHttp(url, timeoutMs) {
  return waitFor(
    async () => {
      try {
        const response = await fetch(url);
        return response.ok;
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
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
  return String(value || "")
    .replace(/\\/g, "/")
    .toLowerCase();
}

async function main() {
  const modelHealth = await fetch("http://127.0.0.1:8000/health").then((response) => response.ok).catch(() => false);
  assert(modelHealth, "Local model runtime is not healthy on 127.0.0.1:8000");

  log(`output: ${outputDir}`);
  log(`repo: ${tempRepoDir}`);

  const vite = startProcess(
    "vite",
    "npx",
    ["vite", "--host", "127.0.0.1", "--port", String(vitePort)],
    {
      ...process.env,
      BROWSER: "none",
    }
  );

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

  await page.getByRole("button", { name: "Projects" }).click();
  await page.getByRole("heading", { name: "Connect Repo" }).waitFor({ timeout: 30000 });
  await page.screenshot({ path: path.join(outputDir, "01b-projects.png"), fullPage: true });

  await page.locator("button").filter({ hasText: /^New Project$/ }).first().click({ force: true });

  const activeRepo = await waitFor(
    async () => {
      const payload = await apiGet("/api/v4/repos");
      const items = Array.isArray(payload.items) ? payload.items : [];
      const match = items.find(
        (item) => item.sourceUri === tempRepoDir || item.sourceUri === tempRepoCanonicalPath
      );
      if (!match) return null;
      const active = await apiGet("/api/v4/repos/active");
      return active.item && active.item.id === match.id ? active.item : null;
    },
    240000,
    "bootstrapped active repo"
  );

  const managedWorktree = path.join(activeRepo.managedWorktreeRoot, "active");

  let scaffoldReport = await waitFor(
    async () => {
      const payload = await apiGet(`/api/v8/projects/${activeRepo.id}/report/latest`);
      const report = payload.item;
      if (!report) return null;
      if (!Array.isArray(report.testsPassed) || report.testsPassed.length < 3) return null;
      if (!String(report.summary || "").toLowerCase().includes("verified")) return null;
      return report;
    },
    120000,
    "scaffold verification report"
  ).catch(() => null);

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

    scaffoldReport = await waitFor(
      async () => {
        const payload = await apiGet(`/api/v8/projects/${activeRepo.id}/report/latest`);
        const report = payload.item;
        if (!report) return null;
        return Array.isArray(report.testsPassed) && report.testsPassed.length >= 3 ? report : null;
      },
      120000,
      "scaffold verification report after direct verification"
    );
  }

  await page.screenshot({ path: path.join(outputDir, "02-scaffold-complete.png"), fullPage: true });

  const codeTreePayload = await apiGet(`/api/v8/mission/codebase/tree?projectId=${activeRepo.id}`);
  const codeTree = Array.isArray(codeTreePayload.items) ? codeTreePayload.items : [];
  const scaffoldSourcePath =
    flattenTree(codeTree).find((item) => item.kind === "file" && item.path === "src/App.tsx")?.path ||
    flattenTree(codeTree).find((item) => item.kind === "file" && item.path === "README.md")?.path ||
    flattenTree(codeTree).find((item) => item.kind === "file")?.path;
  assert(scaffoldSourcePath, "No scaffold source file found in codebase tree");
  const scaffoldSourceName = path.basename(scaffoldSourcePath);
  const scaffoldSource = await apiGet(
    `/api/v8/mission/codebase/file?projectId=${activeRepo.id}&path=${encodeURIComponent(scaffoldSourcePath)}`
  );
  assert(scaffoldSource.item?.content && !String(scaffoldSource.item.content).includes("Source not loaded"), "Scaffold source file content was not loaded");

  await page.getByRole("button", { name: "Codebase" }).click();
  await page.getByText(scaffoldSourceName, { exact: true }).waitFor({ timeout: 30000 });
  await page.getByText(scaffoldSourceName, { exact: true }).click();
  await page.getByText(String(scaffoldSource.item.content).split("\n")[0].slice(0, 60), { exact: false }).waitFor({ timeout: 30000 });
  await page.screenshot({ path: path.join(outputDir, "03-codebase.png"), fullPage: true });

  const consolePayload = await apiGet(`/api/v8/mission/console?projectId=${activeRepo.id}`);
  const consoleItems = Array.isArray(consolePayload.items) ? consolePayload.items : [];
  const verificationEvent =
    consoleItems.find((item) => String(item.message || "").toLowerCase().includes("verification passed")) ||
    consoleItems.find((item) => item.category === "verification") ||
    consoleItems[0];
  assert(verificationEvent, "No console events available for scaffold run");

  await page.getByRole("button", { name: "Console" }).click();
  await page.getByText(String(verificationEvent.message).slice(0, 80), { exact: false }).waitFor({ timeout: 30000 });
  await page.screenshot({ path: path.join(outputDir, "04-console.png"), fullPage: true });

  await page.getByRole("button", { name: "Live State" }).click();
  const objective = "Add a status badge component to the app and test it. Update any docs if needed.";
  await page.getByPlaceholder("Describe what should change in this repo. Example: add CSV export to the client list and verify the tests.").fill(objective);
  await page.getByRole("button", { name: "Execute" }).click();

  let followupReport = await waitFor(
    async () => {
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
      if (
        !changedFiles.some((item) => {
          const normalized = normalizePathForMatch(item);
          return normalized.endsWith("statusbadge.tsx") || normalized.endsWith("status-badge.tsx");
        })
      ) {
        return null;
      }
      if (!String(report.summary || "").toLowerCase().includes("verified")) return null;
      return report;
    },
    120000,
    "follow-up verification report"
  ).catch(() => null);

  if (!followupReport) {
    const latestAttempt = await apiGet(`/api/v8/mission/snapshot?projectId=${activeRepo.id}`);
    const activeRunId = latestAttempt?.item?.execution?.activeRunId;
    assert(activeRunId, "No active follow-up run found for direct verification fallback");

    await apiPost("/api/v5/commands/execution.verify", {
      actor: "desktop-acceptance",
      run_id: activeRunId,
      repo_id: activeRepo.id,
      worktree_path: managedWorktree,
      commands: ["npm run lint", "npm test", "npm run build"],
      docs_required: ["README.md", "AGENTS.md"],
      full_suite_run: true,
    });

    followupReport = await waitFor(
      async () => {
        const payload = await apiGet(`/api/v8/projects/${activeRepo.id}/report/latest`);
        const report = payload.item;
        if (!report) return null;
        const changedFiles = Array.isArray(report.changedFiles) ? report.changedFiles : [];
        return changedFiles.some((item) => {
          const normalized = normalizePathForMatch(item);
          return normalized.endsWith("statusbadge.tsx") || normalized.endsWith("status-badge.tsx");
        })
          ? report
          : null;
      },
      30000,
      "follow-up verification report after direct verification"
    );
  }

  const updatedTreePayload = await apiGet(`/api/v8/mission/codebase/tree?projectId=${activeRepo.id}`);
  const updatedTree = Array.isArray(updatedTreePayload.items) ? updatedTreePayload.items : [];
  const statusBadgePath =
    flattenTree(updatedTree).find((item) => item.kind === "file" && /status-?badge\.tsx$/i.test(item.path))?.path ||
    "src/components/StatusBadge.tsx";
  const statusBadgeSource = await apiGet(
    `/api/v8/mission/codebase/file?projectId=${activeRepo.id}&path=${encodeURIComponent(statusBadgePath)}`
  );
  assert(
    String(statusBadgeSource.item?.content || "").toLowerCase().includes("statusbadge") ||
      String(statusBadgeSource.item?.content || "").toLowerCase().includes("status badge"),
    "StatusBadge source payload was not loaded from the managed worktree"
  );

  await page.getByRole("button", { name: "Codebase" }).click();
  await page.getByText(path.basename(statusBadgePath)).waitFor({ timeout: 30000 });
  await page.getByText(path.basename(statusBadgePath)).click();
  await page.screenshot({ path: path.join(outputDir, "05-followup-codebase.png"), fullPage: true });

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
    tempRepoDir,
    userDataDir,
    activeRepo: {
      id: activeRepo.id,
      displayName: activeRepo.displayName,
      managedWorktreeRoot: activeRepo.managedWorktreeRoot,
    },
    scaffoldReport,
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
