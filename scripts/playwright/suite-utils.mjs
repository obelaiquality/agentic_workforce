#!/usr/bin/env node
import fs from "node:fs";
import fsp from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function timestampSlug(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

export async function ensureDir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true });
  return dirPath;
}

export async function writeJson(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await fsp.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function getArgValue(argv, flag, fallback = undefined) {
  const index = argv.indexOf(flag);
  if (index === -1) return fallback;
  const next = argv[index + 1];
  if (!next || next.startsWith("--")) return fallback;
  return next;
}

export function hasArg(argv, flag) {
  return argv.includes(flag);
}

export function resolveRuntimePreset(defaultPreset = "default") {
  if (process.env.E2E_RUNTIME_PRESET?.trim()) {
    return process.env.E2E_RUNTIME_PRESET.trim();
  }
  if (process.env.OPENAI_API_KEY?.trim()) {
    return "openai_all";
  }
  return defaultPreset;
}

export function assertRuntimePrereqs(runtimePreset) {
  if (runtimePreset === "openai_all" && !process.env.OPENAI_API_KEY?.trim()) {
    throw new Error("OPENAI_API_KEY is required when E2E_RUNTIME_PRESET=openai_all.");
  }
}

export function appendLog(filePath, chunk) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, chunk);
}

export async function runCommandStep({
  label,
  command,
  args = [],
  cwd = rootDir,
  env = {},
  logFile = null,
}) {
  const startedAt = Date.now();
  process.stdout.write(`[suite] ${label}\n`);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      if (logFile) appendLog(logFile, chunk);
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      if (logFile) appendLog(logFile, chunk);
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code, signal) => {
      const durationMs = Date.now() - startedAt;
      if (code === 0) {
        resolve({ code, signal, durationMs });
        return;
      }
      reject(
        new Error(
          `${label} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}`
        )
      );
    });
  });
}

export async function runNodeScript(relativeScriptPath, options = {}) {
  return runCommandStep({
    ...options,
    command: process.execPath,
    args: [path.join(rootDir, relativeScriptPath), ...(options.args || [])],
  });
}

export async function runShellScript(relativeScriptPath, options = {}) {
  return runCommandStep({
    ...options,
    command: "bash",
    args: [path.join(rootDir, relativeScriptPath), ...(options.args || [])],
  });
}

export async function waitForHttpOk(url, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch {
      // Retry until deadline.
    }
    await delay(1000);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

export async function getFreePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      const port = typeof address === "object" && address ? address.port : null;
      listener.close((error) => {
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

export function findLatestOutputDir(prefix) {
  const outputRoot = path.join(rootDir, "output", "playwright");
  if (!fs.existsSync(outputRoot)) return null;
  const candidates = fs
    .readdirSync(outputRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => path.join(outputRoot, entry.name))
    .sort((left, right) => {
      const leftStat = fs.statSync(left);
      const rightStat = fs.statSync(right);
      return rightStat.mtimeMs - leftStat.mtimeMs;
    });
  return candidates[0] || null;
}

export async function createTempDir(prefix) {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function seedExistingRepoFixture(repoDir) {
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
    ),
    "utf8"
  );
  await fsp.writeFile(
    path.join(repoDir, "README.md"),
    "# Existing Local Repo\n\nThis repo is used to validate local attach and CLI smoke flows.\n",
    "utf8"
  );
  await fsp.writeFile(
    path.join(repoDir, "AGENTS.md"),
    [
      "# Repo instructions",
      "",
      "- Keep changes deterministic and small.",
      "- Add or update tests under `test/` for behavior changes.",
      "- Update `README.md` when user-facing usage changes.",
      "- Verification commands are `npm run lint`, `npm test`, and `npm run build`.",
    ].join("\n"),
    "utf8"
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
    ].join("\n"),
    "utf8"
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
    ].join("\n"),
    "utf8"
  );
  await fsp.writeFile(path.join(repoDir, "scripts/lint-check.mjs"), "process.exit(0);\n", "utf8");
  await fsp.writeFile(
    path.join(repoDir, "scripts/build-check.mjs"),
    [
      "import { formatGreeting } from '../src/index.js';",
      "if (formatGreeting('Build') !== 'Hello, Build') {",
      "  throw new Error('Build check failed');",
      "}",
    ].join("\n"),
    "utf8"
  );

  spawnSync("git", ["init", "-b", "main"], { cwd: repoDir, encoding: "utf8" });
  spawnSync("git", ["config", "user.email", "codex@example.com"], { cwd: repoDir, encoding: "utf8" });
  spawnSync("git", ["config", "user.name", "Codex"], { cwd: repoDir, encoding: "utf8" });
  spawnSync("git", ["add", "."], { cwd: repoDir, encoding: "utf8" });
  const commit = spawnSync("git", ["commit", "-m", "Initial existing repo fixture"], {
    cwd: repoDir,
    encoding: "utf8",
  });
  if (commit.status !== 0) {
    throw new Error(`Fixture commit failed: ${commit.stderr || commit.stdout}`);
  }
}

export function getDemoFrameManifest(sourceDir) {
  const manifestPath = path.join(sourceDir, "demo-manifest.json");
  if (fs.existsSync(manifestPath)) {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (Array.isArray(parsed.frames) && parsed.frames.length) {
      return parsed.frames;
    }
  }

  return [
    "01b-projects.png",
    "02-scaffold-complete.png",
    "05-followup-card-expanded.png",
    "03-codebase.png",
    "04-console.png",
  ];
}

export function ensureFfmpegInstalled() {
  const probe = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  if (probe.status !== 0) {
    throw new Error("ffmpeg is required for demo rendering.");
  }
}
