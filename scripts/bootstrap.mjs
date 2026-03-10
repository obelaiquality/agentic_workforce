import fs from "node:fs";
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

if (!fs.existsSync(envPath) && fs.existsSync(envExamplePath)) {
  fs.copyFileSync(envExamplePath, envPath);
  console.log("Created .env from .env.example");
}

console.log("Running preflight doctor checks...");
run("node", ["scripts/doctor.mjs", "--strict"]);

console.log("Starting local PostgreSQL via Docker...");
run("docker", ["compose", "up", "-d", "postgres"]);

console.log("Pushing Prisma schema...");
run("npx", ["prisma", "db", "push"]);

console.log("Generating Prisma client...");
run("npx", ["prisma", "generate"]);

console.log("Building Rust sidecar binary...");
run("npm", ["run", "build:sidecar"]);

console.log("Bootstrap complete. Launching desktop app now...");
