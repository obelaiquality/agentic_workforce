import path from "node:path";
import fs from "node:fs";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { SidecarClient } from "./client";

const sidecarAddress = process.env.RUST_SIDECAR_ADDR || "127.0.0.1:50051";

let sidecarProcess: ChildProcessWithoutNullStreams | null = null;
let sidecarClient: SidecarClient | null = null;

function isDevRuntime() {
  return process.env.APP_PACKAGED !== "true";
}

function getProjectRoot() {
  return process.env.APP_ROOT || process.cwd();
}

function getSidecarWorkingDirectory() {
  const appRoot = getProjectRoot();
  return appRoot.includes(".asar") ? path.dirname(appRoot) : appRoot;
}

function resolveSidecarBinary() {
  if (process.env.RUST_SIDECAR_BIN) {
    return process.env.RUST_SIDECAR_BIN;
  }

  const binaryName = process.platform === "win32" ? "agentic-sidecar.exe" : "agentic-sidecar";
  const appRoot = getProjectRoot();
  const releaseBinary = path.resolve(appRoot, "rust/sidecar/target/release", binaryName);
  const distBinary = path.resolve(appRoot, "dist-sidecar", binaryName);

  // Prefer the original Cargo release target while running from a source checkout.
  // In this environment we observed the copied dist-sidecar binary hanging before bind,
  // while the release-target binary started reliably.
  if (!appRoot.includes(".asar") && fs.existsSync(releaseBinary)) {
    return releaseBinary;
  }

  if (appRoot.includes(".asar")) {
    const unpackedRoot = appRoot.replace(".asar", ".asar.unpacked");
    return path.resolve(unpackedRoot, "dist-sidecar", binaryName);
  }

  return distBinary;
}

function sanitizeSidecarDatabaseUrl(input: string | undefined) {
  const fallback = "postgresql://agentic:agentic@localhost:5433/agentic_workforce";
  const value = input && input.trim().length > 0 ? input.trim() : fallback;
  const [base] = value.split("?");
  return base || fallback;
}

function startSidecarProcess() {
  if (sidecarProcess) {
    return;
  }

  const isDev = isDevRuntime();
  const isWin = process.platform === "win32";
  const appRoot = getProjectRoot();
  const workingDirectory = getSidecarWorkingDirectory();
  const binary = resolveSidecarBinary();

  if (isDev) {
    const manifest = process.env.RUST_SIDECAR_MANIFEST || path.resolve(appRoot, "rust/sidecar/Cargo.toml");
    sidecarProcess = spawn("cargo", ["run", "--manifest-path", manifest], {
      cwd: workingDirectory,
      env: {
        ...process.env,
        RUST_SIDECAR_ADDR: sidecarAddress,
        DATABASE_URL: sanitizeSidecarDatabaseUrl(process.env.DATABASE_URL),
        WORKSPACE_ROOT: workingDirectory,
      },
      stdio: "pipe",
      shell: isWin,
    });
  } else {
    if (!fs.existsSync(binary)) {
      throw new Error(`Rust sidecar binary not found at ${binary}`);
    }
    sidecarProcess = spawn(binary, [], {
      cwd: workingDirectory,
      env: {
        ...process.env,
        RUST_SIDECAR_ADDR: sidecarAddress,
        DATABASE_URL: sanitizeSidecarDatabaseUrl(process.env.DATABASE_URL),
        WORKSPACE_ROOT: workingDirectory,
      },
      stdio: "pipe",
      shell: false,
    });
  }

  sidecarProcess.stdout.on("data", (chunk) => {
    // Keep sidecar logs visible in API process output.
    process.stdout.write(`[sidecar] ${chunk}`);
  });
  sidecarProcess.stderr.on("data", (chunk) => {
    process.stderr.write(`[sidecar] ${chunk}`);
  });
  sidecarProcess.on("error", (error) => {
    process.stderr.write(`[sidecar] failed to start: ${error.message}\n`);
    sidecarProcess = null;
  });

  sidecarProcess.on("exit", () => {
    sidecarProcess = null;
  });
}

async function waitForSidecarReady(client: SidecarClient, retries = 60) {
  for (let i = 0; i < retries; i += 1) {
    try {
      await client.heartbeat({
        agent_id: "node-api",
        status: "starting",
        summary: "boot handshake",
      });
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  return false;
}

export async function getSidecarClient() {
  if (sidecarClient) {
    return sidecarClient;
  }

  const autostart = process.env.RUST_SIDECAR_AUTOSTART !== "false";
  sidecarClient = new SidecarClient(sidecarAddress);
  let ready = await waitForSidecarReady(sidecarClient, 4);
  if (!ready && autostart) {
    startSidecarProcess();
    ready = await waitForSidecarReady(sidecarClient, 80);
  }

  if (!ready) {
    sidecarClient.close();
    sidecarClient = null;
    throw new Error(`Rust sidecar is not reachable at ${sidecarAddress}`);
  }

  return sidecarClient;
}

export function stopSidecarProcess() {
  sidecarClient?.close();
  sidecarClient = null;

  if (sidecarProcess) {
    sidecarProcess.kill("SIGTERM");
    sidecarProcess = null;
  }
}
