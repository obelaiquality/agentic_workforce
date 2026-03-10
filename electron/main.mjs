import { app, BrowserWindow, dialog, ipcMain, session } from "electron";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const isDev = !app.isPackaged;
const userDataOverride = process.env.ELECTRON_USER_DATA_DIR || process.env.CODEX_E2E_USER_DATA_DIR || "";

if (userDataOverride) {
  app.setPath("userData", userDataOverride);
}

const apiPort = Number(process.env.API_PORT || 8787);
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const apiToken = process.env.API_TOKEN || crypto.randomUUID();
const devServerUrl = process.env.VITE_DEV_SERVER_URL || "http://localhost:5173";
const defaultDatabaseUrl =
  process.env.DATABASE_URL || "postgresql://agentic:agentic@localhost:5433/agentic_workforce?schema=public";
const qwenCommand = process.env.QWEN_COMMAND || "qwen";

/** @type {import("node:child_process").ChildProcess | null} */
let apiProcess = null;

/** @type {{ checks: Array<{ key: string; ok: boolean; message: string; severity: "warning" | "error" }>; apiReady: boolean; checkedAt: string; }} */
let preflightStatus = {
  checks: [],
  apiReady: false,
  checkedAt: new Date().toISOString(),
};

function recentReposPath() {
  return path.join(app.getPath("userData"), "recent-repos.json");
}

function readRecentRepos() {
  try {
    const filePath = recentReposPath();
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item) => item && typeof item.path === "string")
      .map((item) => ({
        path: item.path,
        label: typeof item.label === "string" && item.label.trim() ? item.label : path.basename(item.path),
        lastUsedAt:
          typeof item.lastUsedAt === "string" && item.lastUsedAt.trim() ? item.lastUsedAt : new Date().toISOString(),
      }));
  } catch {
    return [];
  }
}

function writeRecentRepos(items) {
  fs.mkdirSync(path.dirname(recentReposPath()), { recursive: true });
  fs.writeFileSync(recentReposPath(), JSON.stringify(items.slice(0, 12), null, 2));
}

function rememberRecentRepoPath(repoPath, label) {
  if (!repoPath || typeof repoPath !== "string") {
    return;
  }
  const next = [
    {
      path: repoPath,
      label: typeof label === "string" && label.trim() ? label : path.basename(repoPath),
      lastUsedAt: new Date().toISOString(),
    },
    ...readRecentRepos().filter((item) => item.path !== repoPath),
  ];
  writeRecentRepos(next);
}

function enforceCsp() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:* http://localhost:* ws://localhost:*",
      "font-src 'self' data:",
      "object-src 'none'",
      "frame-ancestors 'none'",
    ].join("; ");

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [csp],
      },
    });
  });
}

function runCheck(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf-8",
    timeout: 6000,
  });

  if (result.error) {
    return {
      ok: false,
      output: result.error.message,
    };
  }

  if (result.status !== 0) {
    return {
      ok: false,
      output: (result.stderr || result.stdout || `Exit code ${result.status}`).trim(),
    };
  }

  return {
    ok: true,
    output: (result.stdout || "ok").trim(),
  };
}

function gatherPreflightChecks() {
  const checks = [];

  const modelCacheCandidates = [
    path.join(os.homedir(), ".cache", "huggingface", "hub", "models--Qwen--Qwen3.5-0.8B"),
    path.join(os.homedir(), "Library", "Caches", "huggingface", "hub", "models--Qwen--Qwen3.5-0.8B"),
  ];
  const modelCachePath = modelCacheCandidates.find((candidate) => fs.existsSync(candidate));

  const docker = runCheck("docker", ["info"]);
  checks.push({
    key: "docker",
    ok: docker.ok,
    message: docker.ok ? "Docker daemon is running" : `Docker unavailable: ${docker.output}`,
    severity: "error",
  });

  const qwen = runCheck(qwenCommand, ["--version"]);
  checks.push({
    key: "qwen_cli",
    ok: qwen.ok,
    message: qwen.ok ? `Qwen CLI found (${qwenCommand})` : `Qwen CLI missing/unreachable (${qwenCommand}): ${qwen.output}`,
    severity: "warning",
  });

  const claude = runCheck("claude", ["--version"]);
  checks.push({
    key: "claude_cli",
    ok: claude.ok,
    message: claude.ok ? "Claude CLI found for distillation teacher jobs." : `Claude CLI unavailable: ${claude.output}`,
    severity: "warning",
  });

  checks.push({
    key: "qwen_model_cache",
    ok: Boolean(modelCachePath),
    message: modelCachePath
      ? `Qwen3.5-0.8B cache found at ${modelCachePath}`
      : "Qwen3.5-0.8B cache not found yet. First run will download model weights.",
    severity: "warning",
  });

  return checks;
}

function startApiProcess() {
  const sidecarBinaryName = process.platform === "win32" ? "agentic-sidecar.exe" : "agentic-sidecar";
  const sidecarBinaryPath = isDev
    ? ""
    : path.join(process.resourcesPath, "app.asar.unpacked", "dist-sidecar", sidecarBinaryName);

  const env = {
    ...process.env,
    API_PORT: String(apiPort),
    API_TOKEN: apiToken,
    DATABASE_URL: defaultDatabaseUrl,
    ELECTRON_RUN_AS_NODE: "1",
    APP_PACKAGED: isDev ? "false" : "true",
    APP_ROOT: isDev ? projectRoot : app.getAppPath(),
    RUST_SIDECAR_MANIFEST: path.join(projectRoot, "rust/sidecar/Cargo.toml"),
    ...(sidecarBinaryPath ? { RUST_SIDECAR_BIN: sidecarBinaryPath } : {}),
  };

  const apiEntry = isDev
    ? path.join(projectRoot, "src/server/index.ts")
    : path.join(app.getAppPath(), "dist-server/index.js");
  const args = isDev ? ["--import", "tsx", apiEntry] : [apiEntry];

  apiProcess = spawn(process.execPath, args, {
    cwd: isDev ? projectRoot : app.getPath("userData"),
    env,
    stdio: "inherit",
  });

  apiProcess.on("exit", () => {
    apiProcess = null;
  });
}

async function waitForApi(maxRetries = 60, delayMs = 250) {
  for (let i = 0; i < maxRetries; i += 1) {
    try {
      const response = await fetch(`${apiBaseUrl}/health`, {
        headers: apiToken ? { "x-local-api-token": apiToken } : undefined,
      });
      if (response.ok) {
        return true;
      }
    } catch {
      // no-op
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

async function createMainWindow() {
  const window = new BrowserWindow({
    width: 1640,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: "#0a0a0c",
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    await window.loadURL(devServerUrl);
    if (process.env.CODEX_E2E !== "1") {
      window.webContents.openDevTools({ mode: "detach" });
    }
  } else {
    await window.loadFile(path.join(projectRoot, "dist/index.html"));
  }
}

app.whenReady().then(async () => {
  enforceCsp();

  preflightStatus = {
    ...preflightStatus,
    checks: gatherPreflightChecks(),
    checkedAt: new Date().toISOString(),
  };

  startApiProcess();
  const apiReady = await waitForApi();

  preflightStatus = {
    ...preflightStatus,
    apiReady,
    checkedAt: new Date().toISOString(),
    checks: [
      ...preflightStatus.checks,
      {
        key: "local_api",
        ok: apiReady,
        message: apiReady
          ? `Local API reachable at ${apiBaseUrl}`
          : "Local API is unavailable. Ensure Docker + Postgres are running and database is initialized.",
        severity: "error",
      },
    ],
  };

  ipcMain.handle("desktop:get-api-config", async () => ({
    baseUrl: apiBaseUrl,
    token: apiToken,
    apiReady,
  }));

  ipcMain.handle("desktop:get-preflight", async () => preflightStatus);
  ipcMain.handle("desktop:pick-repo-directory", async () => {
    if (process.env.CODEX_E2E_PICK_REPO_PATH) {
      return {
        canceled: false,
        path: process.env.CODEX_E2E_PICK_REPO_PATH,
      };
    }
    const result = await dialog.showOpenDialog({
      title: "Choose a local Git repository",
      properties: ["openDirectory"],
      buttonLabel: "Choose Repo",
    });
    if (result.canceled || !result.filePaths[0]) {
      return { canceled: true };
    }
    return {
      canceled: false,
      path: result.filePaths[0],
    };
  });
  ipcMain.handle("desktop:list-recent-repos", async () => readRecentRepos());
  ipcMain.handle("desktop:remember-repo-path", async (_event, payload) => {
    rememberRecentRepoPath(payload?.path, payload?.label);
  });

  await createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (apiProcess) {
    apiProcess.kill("SIGTERM");
  }
});
