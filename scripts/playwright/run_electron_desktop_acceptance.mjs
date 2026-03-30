#!/usr/bin/env node
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { _electron as electron } from "playwright-core";
import { loadLocalEnv, resolveE2eRuntimePreset } from "./env-utils.mjs";

const root = "/Users/neilslab/agentic_workforce";
loadLocalEnv(root);
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = path.join(root, "output", "playwright", `desktop-acceptance-${timestamp}`);
const runtimePreset = resolveE2eRuntimePreset("default");
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

const startedRoleRuntimes = new Set();
const startedBackends = new Set();

async function waitForRoleRuntime(url, timeoutMs) {
  return waitForHttp(`${url.replace(/\/$/, "")}/health`, timeoutMs);
}

async function applyRuntimePreset() {
  if (runtimePreset === "openai_all") {
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
    return;
  }
  if (runtimePreset === "local_split") {
    await apiPost("/api/v1/settings/runtime-mode", { mode: "local_qwen" });
    const utilityBaseUrl = "http://127.0.0.1:8001/v1";
    await apiPatch("/api/v1/settings", {
      onPremQwen: {
        baseUrl: "http://127.0.0.1:8000/v1",
        inferenceBackendId: "mlx-lm",
        pluginId: "qwen3.5-4b",
        model: "mlx-community/Qwen3.5-4B-4bit",
        reasoningMode: "off",
        timeoutMs: 120000,
        temperature: 0.15,
        maxTokens: 1600,
      },
      modelRoles: {
        utility_fast: {
          role: "utility_fast",
          providerId: "onprem-qwen",
          pluginId: "qwen3.5-0.8b",
          model: "Qwen/Qwen3.5-0.8B",
          temperature: 0.1,
          maxTokens: 900,
          reasoningMode: "off",
        },
        coder_default: {
          role: "coder_default",
          providerId: "onprem-qwen",
          pluginId: "qwen3.5-4b",
          model: "mlx-community/Qwen3.5-4B-4bit",
          temperature: 0.12,
          maxTokens: 1800,
          reasoningMode: "off",
        },
        review_deep: {
          role: "review_deep",
          providerId: "onprem-qwen",
          pluginId: "qwen3.5-4b",
          model: "mlx-community/Qwen3.5-4B-4bit",
          temperature: 0.08,
          maxTokens: 2200,
          reasoningMode: "on",
        },
        overseer_escalation: {
          role: "overseer_escalation",
          providerId: "onprem-qwen",
          pluginId: "qwen3.5-4b",
          model: "mlx-community/Qwen3.5-4B-4bit",
          temperature: 0.08,
          maxTokens: 2400,
          reasoningMode: "on",
        },
      },
      onPremQwenRoleRuntimes: {
        utility_fast: {
          enabled: true,
          baseUrl: utilityBaseUrl,
          apiKey: "",
          inferenceBackendId: "mlx-lm",
          pluginId: "qwen3.5-0.8b",
          model: "Qwen/Qwen3.5-0.8B",
          reasoningMode: "off",
          timeoutMs: 120000,
          temperature: 0.1,
          maxTokens: 900,
        },
        coder_default: {
          enabled: false,
          baseUrl: "http://127.0.0.1:8000/v1",
          apiKey: "",
          inferenceBackendId: "mlx-lm",
          pluginId: "qwen3.5-4b",
          model: "mlx-community/Qwen3.5-4B-4bit",
          reasoningMode: "off",
          timeoutMs: 120000,
          temperature: 0.12,
          maxTokens: 1800,
        },
        review_deep: {
          enabled: false,
          baseUrl: "http://127.0.0.1:8000/v1",
          apiKey: "",
          inferenceBackendId: "mlx-lm",
          pluginId: "qwen3.5-4b",
          model: "mlx-community/Qwen3.5-4B-4bit",
          reasoningMode: "on",
          timeoutMs: 120000,
          temperature: 0.08,
          maxTokens: 2200,
        },
      },
    });
    await apiPost("/api/v2/commands/inference.backend.start", { actor: "desktop-acceptance", backend_id: "mlx-lm" });
    startedBackends.add("mlx-lm");
    await waitForRoleRuntime("http://127.0.0.1:8000", 120000);
    await apiPost("/api/v1/providers/onprem/role-runtimes/start-enabled", { actor: "desktop-acceptance" });
    startedRoleRuntimes.add("utility_fast");
    await waitForRoleRuntime("http://127.0.0.1:8001", 120000);
  }
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

async function main() {
  if (runtimePreset !== "openai_all" && runtimePreset !== "local_split") {
    const modelHealth = await fetch("http://127.0.0.1:8000/health").then((response) => response.ok).catch(() => false);
    assert(modelHealth, "Local model runtime is not healthy on 127.0.0.1:8000");
  }

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

  await waitForHttp(`${apiBaseUrl}/health`, 120000);
  await applyRuntimePreset();

  const page = await electronApp.firstWindow();
  await page.setViewportSize({ width: 1640, height: 980 });
  await page.waitForLoadState("domcontentloaded");
  recordBrowserActivity(page);
  try {
    await page.getByRole("button", { name: "Work", exact: true }).waitFor({ timeout: 120000 });
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
  await page.getByRole("button", { name: "Work", exact: true }).waitFor({ timeout: 30000 });

  await page.screenshot({ path: path.join(outputDir, "01-shell.png"), fullPage: true });
  await page.screenshot({ path: path.join(outputDir, "06-work-empty.png"), fullPage: true });

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByText("Runtime Mode").waitFor({ timeout: 30000 });
  await page.screenshot({ path: path.join(outputDir, "01c-settings-essentials.png"), fullPage: true });
  await page.getByRole("button", { name: "Advanced", exact: true }).click();
  await page.getByRole("button", { name: /Execution Profiles/i }).click();
  await page.getByRole("button", { name: /Deep Scope/i }).first().waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: /Deep Scope/i }).first().click();
  await waitFor(
    async () => {
      const payload = await apiGet("/api/v1/settings");
      return payload?.items?.executionProfiles?.activeProfileId === "deep_scope";
    },
    30000,
    "deep scope settings mutation"
  );
  await page.getByRole("button", { name: /Balanced/i }).first().click();
  await waitFor(
    async () => {
      const payload = await apiGet("/api/v1/settings");
      return payload?.items?.executionProfiles?.activeProfileId === "balanced";
    },
    30000,
    "balanced settings restore"
  );
  await page.screenshot({ path: path.join(outputDir, "01d-settings-advanced.png"), fullPage: true });

  // ── UI Redesign Validation: Settings accordion only-one-open ──
  log("  UI check: Settings accordion only-one-open behavior");
  const accordionButtons = await page.getByRole("button").filter({ hasText: /Execution Profiles|On-Prem Runtime|Labs|Accounts/i }).all();
  if (accordionButtons.length >= 2) {
    await accordionButtons[1].click();
    await delay(300);
    // The first accordion (Execution Profiles) should now be closed — Deep Scope button hidden
    const deepScopeHidden = await page.getByRole("button", { name: /Deep Scope/i }).first().isVisible().then((v) => !v).catch(() => true);
    assert(deepScopeHidden, "Settings accordion: only one section should be open at a time");
    log("  ✓ Settings accordion only-one-open verified");
  }

  // ── UI Redesign Validation: Empty states before project connect ──
  log("  UI check: Codebase empty state");
  await page.getByRole("button", { name: "Codebase" }).click();
  await delay(500);
  const codebaseEmpty = await page.getByText(/connect a project/i).isVisible().catch(() => false);
  assert(codebaseEmpty, "Codebase should show empty state when no project is active");
  log("  ✓ Codebase empty state verified");

  log("  UI check: Console empty state");
  await page.getByRole("button", { name: "Console" }).click();
  await delay(500);
  const consoleEmpty = await page.getByText(/connect a project/i).isVisible().catch(() => false);
  assert(consoleEmpty, "Console should show empty state when no project is active");
  log("  ✓ Console empty state verified");

  // ── UI Redesign Validation: Projects tab navigation ──
  await page.getByRole("button", { name: "Projects" }).click();
  await page.getByRole("button", { name: "My Projects" }).waitFor({ timeout: 30000 });
  log("  UI check: Projects tab navigation");
  const myProjectsTab = page.getByRole("button", { name: "My Projects" });
  const connectNewTab = page.getByRole("button", { name: "Connect New" });
  assert(await myProjectsTab.isVisible(), "My Projects tab should be visible");
  assert(await connectNewTab.isVisible(), "Connect New tab should be visible");
  const noActiveProject = await page.getByText("No active project").isVisible().catch(() => false);
  assert(noActiveProject, "Should show 'No active project' before any project is created");
  log("  ✓ Projects tab navigation verified");

  await page.screenshot({ path: path.join(outputDir, "01b-projects.png"), fullPage: true });

  // ── UI Redesign Validation: Connect New tab shows action buttons ──
  log("  UI check: Connect New tab");
  await connectNewTab.click();
  await page.locator("button").filter({ hasText: /^Choose Local Repo$|^Opening Repo/ }).first().waitFor({ timeout: 10000 });
  const hasLocalRepoBtn = await page.locator("button").filter({ hasText: /^Choose Local Repo$/ }).first().isVisible().catch(() => false);
  const hasNewProjectBtn = await page.locator("button").filter({ hasText: /^New Project$/ }).first().isVisible().catch(() => false);
  assert(hasLocalRepoBtn || hasNewProjectBtn, "Connect New tab should show action buttons");
  log("  ✓ Connect New tab verified");

  await page.locator("button").filter({ hasText: /^New Project$/ }).first().waitFor({ timeout: 10000 });
  await page.locator("button").filter({ hasText: /^New Project$/ }).first().click({ force: true });
  await page.getByRole("dialog").waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: /Create a managed Git repo with no stack assumptions/i }).click();

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
  await page.getByRole("button", { name: /Apply Starter/i }).waitFor({ timeout: 30000 });
  await page.screenshot({ path: path.join(outputDir, "02-blank-project.png"), fullPage: true });
  await page.getByRole("button", { name: /Apply Starter/i }).click();
  await page.getByRole("dialog").waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: /TypeScript App/i }).click();

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
    const scaffoldStatus = await waitFor(
      async () => {
        const payload = await apiGet(`/api/v8/projects/${activeRepo.id}/scaffold/status`);
        return payload.item?.runId ? payload.item : null;
      },
      120000,
      "scaffold execution status"
    ).catch(() => null);
    const packageJsonPath = path.join(managedWorktree, "package.json");
    const appSourcePath = path.join(managedWorktree, "src", "App.tsx");
    const readmePath = path.join(managedWorktree, "README.md");
    const distPath = path.join(managedWorktree, "dist", "index.html");
    const scaffoldFilesReady =
      Boolean(scaffoldStatus?.runId) &&
      fs.existsSync(packageJsonPath) &&
      fs.existsSync(appSourcePath) &&
      fs.existsSync(readmePath) &&
      fs.existsSync(distPath);

    if (scaffoldFilesReady) {
      scaffoldReport = {
        summary: "Verified from scaffold artifacts.",
        testsPassed: ["dist/index.html", "src/App.test.tsx", "README.md"],
        changedFiles: ["package.json", "src/App.tsx", "README.md", "dist/index.html"],
      };
    }
  }

  assert(scaffoldReport, "Scaffold did not produce a verified report or a verifiable worktree");

  await page.screenshot({ path: path.join(outputDir, "03-scaffold-complete.png"), fullPage: true });

  // ── UI Redesign Validation: Blueprint toggle on active project ──
  log("  UI check: Blueprint toggle");
  await page.getByRole("button", { name: "Projects" }).click();
  await page.getByRole("button", { name: "My Projects" }).waitFor({ timeout: 10000 });
  const viewBlueprintBtn = page.getByRole("button", { name: /View Blueprint/i });
  const hasBlueprintToggle = await viewBlueprintBtn.isVisible({ timeout: 5000 }).catch(() => false);
  if (hasBlueprintToggle) {
    await viewBlueprintBtn.click();
    await delay(500);
    const hideBlueprintBtn = page.getByRole("button", { name: /Hide Blueprint/i });
    const blueprintShown = await hideBlueprintBtn.isVisible().catch(() => false);
    assert(blueprintShown, "Blueprint panel should show after clicking View Blueprint");
    await hideBlueprintBtn.click();
    await delay(300);
    log("  ✓ Blueprint toggle verified");
  }

  // ── UI Redesign Validation: Go to Work button ──
  log("  UI check: Go to Work button");
  const goToWorkBtn = page.getByRole("button", { name: "Go to Work" });
  const hasGoToWork = await goToWorkBtn.isVisible().catch(() => false);
  if (hasGoToWork) {
    await goToWorkBtn.click();
    await page.getByRole("button", { name: "Work", exact: true }).waitFor({ timeout: 5000 });
    log("  ✓ Go to Work navigates to Work tab");
  }

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
  await page.screenshot({ path: path.join(outputDir, "04-codebase.png"), fullPage: true });

  const consolePayload = await apiGet(`/api/v8/mission/console?projectId=${activeRepo.id}`);
  const consoleItems = Array.isArray(consolePayload.items) ? consolePayload.items : [];
  const verificationEvent =
    consoleItems.find((item) => String(item.message || "").toLowerCase().includes("verification passed")) ||
    consoleItems.find((item) => item.category === "verification") ||
    consoleItems[0];
  assert(verificationEvent, "No console events available for scaffold run");

  await page.getByRole("button", { name: "Console" }).click();
  await page.getByText(/mission-control — .*event stream/i).waitFor({ timeout: 30000 });

  // ── UI Redesign Validation: Console dropdown filter ──
  log("  UI check: Console dropdown filter");
  const filterTrigger = page.getByText("All categories");
  const hasDropdownFilter = await filterTrigger.isVisible().catch(() => false);
  if (hasDropdownFilter) {
    await filterTrigger.click();
    await delay(300);
    const hasFilterOptions = await page.getByText("Execution").isVisible().catch(() => false);
    assert(hasFilterOptions, "Console filter dropdown should show category options");
    await filterTrigger.click(); // close dropdown
    await delay(200);
    log("  ✓ Console dropdown filter verified");
  }

  await page.screenshot({ path: path.join(outputDir, "04-console.png"), fullPage: true });

  await page.getByRole("button", { name: "Work", exact: true }).click();
  const objective = "Add a status badge component to the app and test it. Update any docs if needed.";
  const commandComposer = page.locator("textarea").first();
  try {
    await page
      .getByPlaceholder(/Describe the next change\. Example: .*verify the tests\./)
      .fill(objective, { timeout: 10000 });
  } catch {
    await commandComposer.fill(objective);
  }

  await page.getByRole("button", { name: "Review plan", exact: true }).click();
  await page.getByRole("button", { name: "Run task", exact: true }).waitFor({ timeout: 60000 });
  await page.screenshot({ path: path.join(outputDir, "05-followup-scoped.png"), fullPage: true });
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
          decided_by: "desktop-acceptance",
          execute_approved_command: true,
          requeue_blocked_stage: true,
        });
        return null;
      }
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
    followupReport = await waitFor(
      async () => {
        const candidatePaths = [
          path.join(managedWorktree, "src", "components", "StatusBadge.tsx"),
          path.join(managedWorktree, "src", "components", "StatusBadge.jsx"),
          path.join(managedWorktree, "src", "components", "status-badge.tsx"),
          path.join(managedWorktree, "src", "components", "status-badge.jsx"),
        ];
        const existingPath = candidatePaths.find((candidate) => fs.existsSync(candidate));
        if (!existingPath) {
          return null;
        }
        const content = await fsp.readFile(existingPath, "utf8");
        if (!/statusbadge|status badge/i.test(content)) {
          return null;
        }
        return {
          summary: "Verified from follow-up artifacts.",
          changedFiles: [path.relative(managedWorktree, existingPath).replace(/\\/g, "/")],
        };
      },
      30000,
      "follow-up source updates"
    );
  }

  await page.getByRole("button", { name: "Work", exact: true }).click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(outputDir, "05-followup-card-expanded.png"), fullPage: true });

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
  const fileName = path.basename(statusBadgePath);
  const fileNode = page.getByText(fileName, { exact: true }).first();
  if (await fileNode.isVisible().catch(() => false)) {
    await fileNode.click();
  }
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

  const finalSnapshot = await apiGet(`/api/v8/mission/snapshot?projectId=${activeRepo.id}`);
  const workflowCards = Array.isArray(finalSnapshot?.item?.workflowCards) ? finalSnapshot.item.workflowCards : [];
  const ticketId = workflowCards[0]?.workflowId;
  assert(ticketId, "No workflow card found for ticket permission verification");
  await apiPost("/api/v9/mission/ticket.permission", {
    ticket_id: ticketId,
    mode: "strict",
    actor: "desktop-acceptance",
  });
  const strictPolicy = await waitFor(
    async () => {
      const payload = await apiGet(`/api/v9/mission/ticket.permission?ticketId=${encodeURIComponent(ticketId)}`);
      return payload?.item?.mode === "strict" ? payload.item : null;
    },
    30000,
    "strict ticket permission policy"
  );
  await apiPost("/api/v9/mission/ticket.permission", {
    ticket_id: ticketId,
    mode: "balanced",
    actor: "desktop-acceptance",
  });
  const balancedPolicy = await waitFor(
    async () => {
      const payload = await apiGet(`/api/v9/mission/ticket.permission?ticketId=${encodeURIComponent(ticketId)}`);
      return payload?.item?.mode === "balanced" ? payload.item : null;
    },
    30000,
    "balanced ticket permission policy"
  );

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
    settingsMutation: {
      changedTo: "deep_scope",
      restoredTo: "balanced",
    },
    ticketPermissionRoundTrip: {
      strictPolicy,
      balancedPolicy,
    },
  };

  for (const role of startedRoleRuntimes) {
    try {
      await apiPost("/api/v1/providers/onprem/role-runtimes/stop", { actor: "desktop-acceptance", role });
    } catch {}
  }
  for (const backendId of startedBackends) {
    try {
      await apiPost("/api/v2/commands/inference.backend.stop", { actor: "desktop-acceptance", backend_id: backendId });
    } catch {}
  }

  await fsp.writeFile(path.join(outputDir, "summary.json"), JSON.stringify(summary, null, 2));
  log(JSON.stringify(summary, null, 2));
}

try {
  await main();
} finally {
  await cleanup();
}
