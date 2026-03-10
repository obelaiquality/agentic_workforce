import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const targetDir = path.join(root, "dist-sidecar");
const cargoManifest = path.join(root, "rust/sidecar/Cargo.toml");
const isWin = process.platform === "win32";
const binaryName = isWin ? "agentic-sidecar.exe" : "agentic-sidecar";

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: isWin,
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

run("cargo", ["build", "--release", "--manifest-path", cargoManifest]);

const source = path.join(root, "rust/sidecar/target/release", binaryName);
if (!fs.existsSync(source)) {
  console.error(`sidecar binary not found: ${source}`);
  process.exit(1);
}

fs.mkdirSync(targetDir, { recursive: true });
const destination = path.join(targetDir, binaryName);
fs.copyFileSync(source, destination);
if (!isWin) {
  fs.chmodSync(destination, 0o755);
}

console.log(`Copied sidecar binary to ${destination}`);
