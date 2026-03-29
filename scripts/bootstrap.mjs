import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const envPath = path.join(root, ".env");
const envExamplePath = path.join(root, ".env.example");

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    cwd: root,
    shell: process.platform === "win32",
    ...options,
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function tryRun(cmd, args, label) {
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    cwd: root,
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    console.warn(`[skip] ${label} failed (exit ${result.status}). Continuing without it.`);
    return false;
  }
  return true;
}

function checkPort(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
    socket.once("error", () => { socket.destroy(); resolve(false); });
    socket.connect(port, host);
  });
}

if (!fs.existsSync(envPath) && fs.existsSync(envExamplePath)) {
  fs.copyFileSync(envExamplePath, envPath);
  console.log("Created .env from .env.example");
}

console.log("Running preflight doctor checks...");
run("node", ["scripts/doctor.mjs", "--strict"]);

const pgReachable = await checkPort("127.0.0.1", 5433);
if (pgReachable) {
  console.log("PostgreSQL already reachable on 127.0.0.1:5433, skipping Docker.");
} else {
  console.log("PostgreSQL not reachable. Starting via Docker...");
  run("docker", ["compose", "up", "-d", "postgres"]);
}

console.log("Applying Prisma migrations...");
run("npx", ["prisma", "migrate", "deploy"]);

console.log("Generating Prisma client...");
run("npx", ["prisma", "generate"]);

console.log("Building Rust sidecar binary...");
if (!tryRun("npm", ["run", "build:sidecar"], "Sidecar build")) {
  console.log("  The desktop app can still run without the sidecar.");
  console.log("  Install Rust from https://rustup.rs to build it.");
}

console.log("Bootstrap complete. Launching desktop app now...");
