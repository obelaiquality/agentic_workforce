import { app, BrowserWindow, dialog, ipcMain, nativeImage, safeStorage, session, shell } from "electron";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
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

// --- Crash handlers: log and surface unexpected failures ---
process.on("uncaughtException", (error) => {
  console.error("[main] Uncaught exception:", error);
  dialog.showErrorBox("Unexpected Error", `${error.message}\n\nThe application will continue running, but you may want to restart it.`);
});

process.on("unhandledRejection", (reason) => {
  console.error("[main] Unhandled promise rejection:", reason);
});

const apiPort = Number(process.env.API_PORT || 8787);
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const apiToken = process.env.API_TOKEN || crypto.randomUUID();
const devServerUrl = process.env.VITE_DEV_SERVER_URL || "http://localhost:5173";
const defaultDatabaseUrl =
  process.env.DATABASE_URL || "postgresql://agentic:agentic@localhost:5433/agentic_workforce?schema=public";
const qwenCommand = process.env.QWEN_COMMAND || "qwen";
const secretKeyFileName = "secretbox.key.enc";

/** @type {import("node:child_process").ChildProcess | null} */
let apiProcess = null;
/** @type {Map<string, AbortController>} */
const activeStreams = new Map();

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
  let databaseHost = "127.0.0.1";
  let databasePort = "5433";

  try {
    const parsed = new URL(defaultDatabaseUrl);
    databaseHost = parsed.hostname || databaseHost;
    databasePort = parsed.port || databasePort;
  } catch {
    // Fall back to the default local Postgres target.
  }

  const modelCacheCandidates = [
    path.join(os.homedir(), ".cache", "huggingface", "hub", "models--Qwen--Qwen3.5-0.8B"),
    path.join(os.homedir(), "Library", "Caches", "huggingface", "hub", "models--Qwen--Qwen3.5-0.8B"),
  ];
  const modelCachePath = modelCacheCandidates.find((candidate) => fs.existsSync(candidate));

  // Postgres connectivity is what actually matters — Docker is just one way to run it
  const pgCheck = runCheck("node", [
    "-e",
    `require("net").createConnection({host:${JSON.stringify(databaseHost)},port:${Number(databasePort)}},()=>{process.exit(0)}).on("error",()=>{process.exit(1)})`,
  ]);
  checks.push({
    key: "postgres",
    ok: pgCheck.ok,
    message: pgCheck.ok
      ? `PostgreSQL reachable on ${databaseHost}:${databasePort}`
      : `PostgreSQL not reachable on ${databaseHost}:${databasePort}. Start it with 'npm run db:up' (Docker) or ensure your configured Postgres is running there.`,
    severity: "error",
  });

  const docker = runCheck("docker", ["info"]);
  checks.push({
    key: "docker",
    ok: docker.ok,
    message: docker.ok ? "Docker daemon is running" : `Docker unavailable: ${docker.output}. Not required if you run Postgres yourself.`,
    severity: "warning",
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

function secretKeyPath() {
  return path.join(app.getPath("userData"), secretKeyFileName);
}

function isValidSecretKey(raw) {
  if (typeof raw !== "string") {
    return false;
  }
  const trimmed = raw.trim();
  if (/^[a-f0-9]{64}$/i.test(trimmed)) {
    return true;
  }
  try {
    return Buffer.from(trimmed, "base64").length === 32;
  } catch {
    return false;
  }
}

function loadOrCreateSecretStoreKey() {
  const envOverride = process.env.APP_SECRETBOX_KEY;
  if (isValidSecretKey(envOverride)) {
    return envOverride.trim();
  }

  if (!safeStorage.isEncryptionAvailable()) {
    console.warn("safeStorage is unavailable; encrypted local secret storage will remain disabled.");
    return null;
  }

  const filePath = secretKeyPath();

  try {
    if (fs.existsSync(filePath)) {
      const encrypted = fs.readFileSync(filePath);
      const stored = safeStorage.decryptString(encrypted).trim();
      if (isValidSecretKey(stored)) {
        return stored;
      }
      console.warn("Ignoring malformed stored APP_SECRETBOX_KEY material.");
    }
  } catch (error) {
    console.warn("Failed to read encrypted secret-store key.", error);
  }

  try {
    const generated = crypto.randomBytes(32).toString("base64");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, safeStorage.encryptString(generated));
    return generated;
  } catch (error) {
    console.warn("Failed to persist encrypted secret-store key.", error);
    return null;
  }
}

function buildApiUrl(requestPath, query) {
  const url = new URL(requestPath, apiBaseUrl);
  if (query && typeof query === "object") {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") {
        continue;
      }
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

function sendStreamEvent(webContents, streamId, event, data = "") {
  if (webContents.isDestroyed()) {
    return;
  }
  webContents.send("desktop:stream-event", {
    streamId,
    event,
    data,
  });
}

async function streamSseToRenderer(webContents, streamId, response, controller) {
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    sendStreamEvent(webContents, streamId, "__error__", text || `Failed to open stream (${response.status})`);
    sendStreamEvent(webContents, streamId, "__close__");
    activeStreams.delete(streamId);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "message";
  let dataLines = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line) {
          if (dataLines.length > 0) {
            sendStreamEvent(webContents, streamId, eventName, dataLines.join("\n"));
          }
          eventName = "message";
          dataLines = [];
          continue;
        }

        if (line.startsWith("event:")) {
          eventName = line.slice(6).trim() || "message";
          continue;
        }

        if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
    }

    if (dataLines.length > 0) {
      sendStreamEvent(webContents, streamId, eventName, dataLines.join("\n"));
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      sendStreamEvent(webContents, streamId, "__error__", error instanceof Error ? error.message : "Stream failed");
    }
  } finally {
    activeStreams.delete(streamId);
    sendStreamEvent(webContents, streamId, "__close__");
  }
}

function startApiProcess() {
  const sidecarBinaryName = process.platform === "win32" ? "agentic-sidecar.exe" : "agentic-sidecar";
  const sidecarBinaryPath = isDev
    ? ""
    : path.join(process.resourcesPath, "app.asar.unpacked", "dist-sidecar", sidecarBinaryName);
  const secretStoreKey = loadOrCreateSecretStoreKey();

  const env = {
    ...process.env,
    API_PORT: String(apiPort),
    API_TOKEN: apiToken,
    ...(secretStoreKey ? { APP_SECRETBOX_KEY: secretStoreKey } : {}),
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

function isTrustedWindowUrl(url) {
  try {
    const parsed = new URL(url);
    if (isDev) {
      return parsed.origin === new URL(devServerUrl).origin;
    }

    const appIndexUrl = pathToFileURL(path.join(projectRoot, "dist/index.html")).toString();
    return parsed.protocol === "file:" && url.startsWith(appIndexUrl.replace("index.html", ""));
  } catch {
    return false;
  }
}

function maybeOpenExternal(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      void shell.openExternal(url);
    }
  } catch {
    // Ignore malformed URLs.
  }
}

function hardenWindowNavigation(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (!isTrustedWindowUrl(url)) {
      maybeOpenExternal(url);
    }
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (isTrustedWindowUrl(url)) {
      return;
    }
    event.preventDefault();
    maybeOpenExternal(url);
  });
}

async function createMainWindow() {
  // Use the custom app icon for both the window and the macOS dock in dev mode.
  const iconPath = path.join(projectRoot, "build-resources", "icon.png");
  const iconImage = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : undefined;
  if (iconImage && process.platform === "darwin" && app.dock) {
    app.dock.setIcon(iconImage);
  }

  const window = new BrowserWindow({
    width: 1640,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: "#0a0a0c",
    icon: iconImage,
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // Keep preload IPC available for the desktop bridge.
      sandbox: false,
    },
  });

  hardenWindowNavigation(window);

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

  ipcMain.handle("desktop:api-request", async (_event, request) => {
    const method = typeof request?.method === "string" && request.method.trim() ? request.method.toUpperCase() : "GET";
    const response = await fetch(buildApiUrl(request?.path || "/", request?.query), {
      method,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-local-api-token": apiToken,
        ...(request?.headers && typeof request.headers === "object" ? request.headers : {}),
      },
      body: method === "GET" || method === "HEAD" || request?.body === undefined ? undefined : JSON.stringify(request.body),
    });

    const text = await response.text();
    const contentType = response.headers.get("content-type") || "";
    let body;
    if (text && contentType.includes("application/json")) {
      try {
        body = JSON.parse(text);
      } catch {
        body = undefined;
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      body,
      text: contentType.includes("application/json") ? undefined : text,
    };
  });

  ipcMain.handle("desktop:open-stream", async (event, request) => {
    const streamId = crypto.randomUUID();
    const controller = new AbortController();
    activeStreams.set(streamId, controller);

    void fetch(buildApiUrl(request?.path || "/", request?.query), {
      method: "GET",
      headers: {
        accept: "text/event-stream",
        "x-local-api-token": apiToken,
      },
      signal: controller.signal,
    })
      .then((response) => streamSseToRenderer(event.sender, streamId, response, controller))
      .catch((error) => {
        if (!controller.signal.aborted) {
          sendStreamEvent(event.sender, streamId, "__error__", error instanceof Error ? error.message : "Stream failed");
          sendStreamEvent(event.sender, streamId, "__close__");
        }
        activeStreams.delete(streamId);
      });

    return { streamId };
  });

  ipcMain.handle("desktop:close-stream", async (_event, streamId) => {
    const controller = activeStreams.get(streamId);
    if (controller) {
      controller.abort();
      activeStreams.delete(streamId);
    }
  });

  ipcMain.handle("desktop:open-external", async (_event, targetUrl) => {
    try {
      const parsed = new URL(targetUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { ok: false };
      }
      await shell.openExternal(parsed.toString());
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

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
  for (const controller of activeStreams.values()) {
    controller.abort();
  }
  activeStreams.clear();
  if (apiProcess) {
    apiProcess.kill("SIGTERM");
  }
});
