#!/usr/bin/env node

import "dotenv/config";

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultBaseUrl =
  process.env.AGENTIC_API_BASE_URL || process.env.VITE_API_BASE_URL || process.env.API_BASE_URL || "http://127.0.0.1:8787";
const defaultToken = process.env.AGENTIC_API_TOKEN || process.env.VITE_API_TOKEN || process.env.API_TOKEN || "";

function printHelp() {
  console.log(`Agentic Workforce CLI

Usage:
  agentic-workforce projects
  agentic-workforce connect <path> [--name <display-name>] [--actor <actor>] [--bootstrap]
  agentic-workforce plan --project <project-id> --prompt <text> [--actor <actor>]
  agentic-workforce run --project <project-id> --prompt <text> [--actor <actor>] [--permission balanced|strict]
  agentic-workforce report --project <project-id> [--open]
  agentic-workforce desktop

Environment:
  AGENTIC_API_BASE_URL / VITE_API_BASE_URL / API_BASE_URL
  AGENTIC_API_TOKEN / VITE_API_TOKEN / API_TOKEN
`);
}

function fail(message, code = 1) {
  console.error(`ERROR ${message}`);
  process.exit(code);
}

function getOption(argv, name, fallback) {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    fail(`Missing value for ${name}`);
  }
  return value;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function resolveHeaders(token) {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(token ? { "x-local-api-token": token } : {}),
  };
}

async function ensureSession(baseUrl, token) {
  if (!token) return;
  const response = await fetch(`${baseUrl}/api/v1/auth/session`, {
    method: "POST",
    headers: {
      "x-local-api-token": token,
    },
  });
  if (response.ok || response.status === 204 || response.status === 404 || response.status === 405) {
    return;
  }
  if (!response.ok) {
    const text = await response.text();
    fail(text || `Failed to initialize API session (${response.status})`);
  }
}

async function apiRequest(baseUrl, token, requestPath, init = {}) {
  await ensureSession(baseUrl, token);
  const response = await fetch(`${baseUrl}${requestPath}`, {
    ...init,
    headers: {
      ...resolveHeaders(token),
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    fail(text || `API request failed with ${response.status}`, response.status >= 500 ? 1 : 2);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

function printProjects(items) {
  if (!Array.isArray(items) || items.length === 0) {
    console.log("No projects connected yet.");
    return;
  }

  for (const item of items) {
    console.log(`${item.id}  ${item.displayName}`);
    console.log(`  root: ${item.canonicalRoot || item.activeWorktreePath}`);
    console.log(`  source: ${item.sourceKind}  active: ${item.active ? "yes" : "no"}  codegraph: ${item.codeGraphStatus}`);
  }
}

function printRouteReview(payload) {
  console.log(`Ticket: ${payload.ticket.id}  ${payload.ticket.title}`);
  console.log(`Route: ${payload.route.providerId || "default"} / ${payload.route.modelRole || "default"}`);
  if (payload.contextPack?.objective) {
    console.log(`Objective: ${payload.contextPack.objective}`);
  }
  const plan = payload.contextManifest?.verificationPlan;
  if (Array.isArray(plan) && plan.length > 0) {
    console.log("Verification plan:");
    for (const item of plan) {
      console.log(`- ${item}`);
    }
  }
}

function printReport(report) {
  if (!report) {
    console.log("No report is available for this project yet.");
    return;
  }

  console.log(`Report: ${report.id}`);
  console.log(`Run: ${report.runId}`);
  console.log(`Summary: ${report.summary}`);

  const changedFiles = Array.isArray(report.changedFiles) ? report.changedFiles : [];
  const testsPassed = Array.isArray(report.testsPassed) ? report.testsPassed : [];
  const docsUpdated = Array.isArray(report.docsUpdated) ? report.docsUpdated : [];
  const evidenceUrls = Array.isArray(report.evidenceUrls) ? report.evidenceUrls : [];

  if (changedFiles.length > 0) {
    console.log("Changed files:");
    for (const file of changedFiles) {
      console.log(`- ${file}`);
    }
  }
  if (testsPassed.length > 0) {
    console.log("Tests passed:");
    for (const test of testsPassed) {
      console.log(`- ${test}`);
    }
  }
  if (docsUpdated.length > 0) {
    console.log("Docs updated:");
    for (const file of docsUpdated) {
      console.log(`- ${file}`);
    }
  }
  if (report.pullRequestUrl) {
    console.log(`Pull request: ${report.pullRequestUrl}`);
  }
  if (evidenceUrls.length > 0) {
    console.log("Evidence:");
    for (const url of evidenceUrls) {
      console.log(`- ${url}`);
    }
  }
}

async function streamConsole(baseUrl, token, projectId, signal) {
  await ensureSession(baseUrl, token);
  const response = await fetch(`${baseUrl}/api/v8/mission/console/stream?projectId=${encodeURIComponent(projectId)}`, {
    headers: {
      Accept: "text/event-stream",
      ...(token ? { "x-local-api-token": token } : {}),
    },
    signal,
  });

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    fail(text || `Unable to open mission console stream (${response.status})`);
  }

  const decoder = new TextDecoder();
  let buffer = "";

  const flushEvent = (block) => {
    const lines = block.split("\n").map((line) => line.trimEnd());
    let eventName = "message";
    const dataLines = [];
    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventName = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trim());
      }
    }

    if (dataLines.length === 0) return;
    const payload = JSON.parse(dataLines.join("\n"));
    if (eventName === "console.event") {
      const timestamp = typeof payload.createdAt === "string" ? payload.createdAt : new Date().toISOString();
      const level = typeof payload.level === "string" ? payload.level.toUpperCase() : "INFO";
      console.log(`[${timestamp}] ${level} ${payload.message}`);
    }
  };

  try {
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let separatorIndex = buffer.indexOf("\n\n");
      while (separatorIndex !== -1) {
        const block = buffer.slice(0, separatorIndex).trim();
        buffer = buffer.slice(separatorIndex + 2);
        if (block) {
          flushEvent(block);
        }
        separatorIndex = buffer.indexOf("\n\n");
      }
    }
  } catch (error) {
    if (signal.aborted) {
      return;
    }
    throw error;
  }
}

async function openTarget(target) {
  const command =
    process.platform === "darwin"
      ? ["open", target]
      : process.platform === "win32"
      ? ["cmd", "/c", "start", "", target]
      : ["xdg-open", target];

  await new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), {
      stdio: "ignore",
      detached: true,
    });
    child.on("error", reject);
    child.unref();
    resolve();
  });
}

async function commandProjects(baseUrl, token) {
  const response = await apiRequest(baseUrl, token, "/api/v5/projects");
  printProjects(response.items);
}

async function commandConnect(baseUrl, token, argv) {
  const sourcePath = argv[1];
  if (!sourcePath || sourcePath.startsWith("--")) {
    fail("connect requires an absolute or relative repository path.");
  }

  const actor = getOption(argv, "--actor", "cli");
  const displayName = getOption(argv, "--name", undefined);
  const bootstrap = hasFlag(argv, "--bootstrap");
  const starter = getOption(argv, "--starter", undefined);
  const absolutePath = path.resolve(process.cwd(), sourcePath);

  try {
    const stat = await fs.stat(absolutePath);
    if (!stat.isDirectory()) {
      fail(`Path is not a directory: ${absolutePath}`);
    }
  } catch {
    fail(`Path does not exist: ${absolutePath}`);
  }

  const response = await apiRequest(baseUrl, token, "/api/v8/projects/connect/local", {
    method: "POST",
    body: JSON.stringify({
      actor,
      source_path: absolutePath,
      display_name: displayName,
    }),
  });

  if (response.bootstrapRequired) {
    if (!bootstrap) {
      console.log(`The folder is empty and needs project setup: ${response.folderPath}`);
      console.log("Re-run with `--bootstrap` to create a blank managed repo, or add `--starter neutral_baseline|typescript_vite_react`.");
      return;
    }

    const bootstrapped = await apiRequest(baseUrl, token, "/api/v8/projects/bootstrap/empty", {
      method: "POST",
      body: JSON.stringify({
        actor,
        folderPath: response.folderPath,
        displayName,
        starterId: starter || null,
        initializeGit: true,
      }),
    });

    if (starter) {
      await apiRequest(baseUrl, token, `/api/v8/projects/${bootstrapped.project.id}/scaffold/execute`, {
        method: "POST",
        body: JSON.stringify({
          actor,
          starterId: starter,
        }),
      });
    }

    console.log(`Bootstrapped project ${bootstrapped.project.id} (${bootstrapped.project.displayName})`);
    console.log(`Root: ${bootstrapped.project.canonicalRoot || absolutePath}`);
    return;
  }

  console.log(`Connected project ${response.project.id} (${response.project.displayName})`);
  console.log(`Root: ${response.project.canonicalRoot || absolutePath}`);
}

async function commandPlan(baseUrl, token, argv) {
  const projectId = getOption(argv, "--project");
  const prompt = getOption(argv, "--prompt");
  const actor = getOption(argv, "--actor", "cli");

  const response = await apiRequest(baseUrl, token, "/api/v8/mission/overseer/route.review", {
    method: "POST",
    body: JSON.stringify({
      actor,
      project_id: projectId,
      prompt,
    }),
  });

  printRouteReview(response);
}

async function commandRun(baseUrl, token, argv) {
  const projectId = getOption(argv, "--project");
  const prompt = getOption(argv, "--prompt");
  const actor = getOption(argv, "--actor", "cli");
  const permissionMode = getOption(argv, "--permission", undefined);
  if (permissionMode && !["balanced", "strict"].includes(permissionMode)) {
    fail("`--permission` must be one of: balanced, strict.", 2);
  }
  const streamController = new AbortController();
  const streamPromise = streamConsole(baseUrl, token, projectId, streamController.signal).catch((error) => {
    if (!streamController.signal.aborted) {
      console.error(`WARN mission console stream ended unexpectedly: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  try {
    const response = await apiRequest(baseUrl, token, "/api/v9/mission/execute", {
      method: "POST",
      body: JSON.stringify({
        actor,
        project_id: projectId,
        prompt,
        ...(permissionMode ? { permission_mode: permissionMode } : {}),
      }),
    });

    await new Promise((resolve) => setTimeout(resolve, 800));
    console.log(`Run complete: ${response.runId}`);
    if (response.shareReport?.summary) {
      console.log(`Summary: ${response.shareReport.summary}`);
    }
  } finally {
    streamController.abort();
    await streamPromise;
  }
}

async function commandReport(baseUrl, token, argv) {
  const projectId = getOption(argv, "--project");
  const shouldOpen = hasFlag(argv, "--open");
  const response = await apiRequest(baseUrl, token, `/api/v8/projects/${encodeURIComponent(projectId)}/report/latest`);
  printReport(response.item);

  if (shouldOpen && response.item) {
    const target = response.item.pullRequestUrl || response.item.evidenceUrls?.[0];
    if (!target) {
      fail("No shareable URL is available for this report.", 2);
    }
    await openTarget(target);
  }
}

async function commandDesktop() {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(command, ["run", "start:desktop"], {
    cwd: rootDir,
    stdio: "inherit",
  });
  await new Promise((resolve, reject) => {
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Desktop launcher exited with status ${code}`));
    });
    child.on("error", reject);
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  const baseUrl = getOption(argv, "--api-base-url", defaultBaseUrl);
  const token = getOption(argv, "--api-token", defaultToken);

  switch (command) {
    case "projects":
      await commandProjects(baseUrl, token);
      return;
    case "connect":
      await commandConnect(baseUrl, token, argv);
      return;
    case "plan":
      await commandPlan(baseUrl, token, argv);
      return;
    case "run":
      await commandRun(baseUrl, token, argv);
      return;
    case "report":
      await commandReport(baseUrl, token, argv);
      return;
    case "desktop":
      await commandDesktop();
      return;
    default:
      printHelp();
      fail(`Unknown command: ${command}`, 2);
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
