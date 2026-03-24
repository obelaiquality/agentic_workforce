#!/usr/bin/env node
import path from "node:path";
import { spawn } from "node:child_process";
import {
  appendLog,
  createTempDir,
  ensureDir,
  getFreePort,
  rootDir,
  seedExistingRepoFixture,
  timestampSlug,
  waitForHttpOk,
  writeJson,
} from "./suite-utils.mjs";

const outputDir = path.join(rootDir, "output", "playwright", `cli-companion-smoke-${timestampSlug()}`);
const apiPort = await getFreePort();
const apiToken = `cli-smoke-${Date.now()}`;
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const tempRepoDir = await createTempDir("agentic-cli-smoke-repo-");
const apiLog = path.join(outputDir, "api.log");

await ensureDir(outputDir);
await seedExistingRepoFixture(tempRepoDir);

let apiProcess = null;

try {
  apiProcess = spawnApi();
  await waitForHttpOk(`${apiBaseUrl}/health`, 120000);

  const cliEnv = {
    API_BASE_URL: apiBaseUrl,
    API_TOKEN: apiToken,
  };

  const initialProjects = await runCli(["projects"], "CLI projects list (initial)", cliEnv);
  const connectResult = await runCli(["connect", tempRepoDir, "--name", "CLI Fixture"], "CLI connect fixture repo", cliEnv);
  const projectsAfterConnect = await runCli(["projects"], "CLI projects list (after connect)", cliEnv);

  if (!/Connected project\s+\S+/i.test(connectResult.stdout)) {
    throw new Error("CLI connect did not report a connected project id.");
  }
  if (!/CLI Fixture/i.test(projectsAfterConnect.stdout)) {
    throw new Error("CLI projects output did not include the connected fixture repo.");
  }

  await writeJson(path.join(outputDir, "summary.json"), {
    apiBaseUrl,
    tempRepoDir,
    checks: {
      initialProjects: initialProjects.stdout.trim() || "(empty)",
      connect: connectResult.stdout.trim(),
      projectsAfterConnect: projectsAfterConnect.stdout.trim(),
    },
  });
} finally {
  if (apiProcess && !apiProcess.killed) {
    apiProcess.kill("SIGTERM");
  }
}

function spawnApi() {
  const child = spawn("npx", ["tsx", "src/server/index.ts"], {
    cwd: rootDir,
    env: {
      ...process.env,
      API_PORT: String(apiPort),
      API_TOKEN: apiToken,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
  });
  child.stdout.on("data", (chunk) => {
    appendLog(apiLog, chunk);
  });
  child.stderr.on("data", (chunk) => {
    appendLog(apiLog, chunk);
  });
  return child;
}

async function runCli(args, label, env) {
  const stdoutChunks = [];
  const stderrChunks = [];

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(rootDir, "scripts", "agentic-cli.mjs"), ...args], {
      cwd: rootDir,
      env: {
        ...process.env,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => {
      stdoutChunks.push(String(chunk));
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrChunks.push(String(chunk));
      process.stderr.write(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${label} failed with exit code ${code}\n${stderrChunks.join("") || stdoutChunks.join("")}`
        )
      );
    });
  });

  return {
    stdout: stdoutChunks.join(""),
    stderr: stderrChunks.join(""),
  };
}
