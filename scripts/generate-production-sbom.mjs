#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const outputArg = args.find((arg) => !arg.startsWith("--")) || "docs/sbom.production.cdx.json";
const outputPath = path.resolve(process.cwd(), outputArg);

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
let rawSbom;
try {
  rawSbom = execFileSync(npmCommand, ["sbom", "--omit=dev", "--sbom-format", "cyclonedx"], {
    cwd: rootDir,
    encoding: "utf8",
  });
} catch (err) {
  // npm 11+ exits non-zero on peer dep warnings; use stdout if available
  if (err.stdout && err.stdout.trim().startsWith("{")) {
    rawSbom = err.stdout;
  } else {
    throw err;
  }
}
const parsed = JSON.parse(rawSbom);

delete parsed.serialNumber;
if (parsed.metadata && typeof parsed.metadata === "object") {
  delete parsed.metadata.timestamp;
  delete parsed.metadata.tools;
}

const rendered = `${JSON.stringify(parsed, null, 2)}\n`;

if (checkOnly) {
  if (!fs.existsSync(outputPath)) {
    throw new Error(`Checked-in SBOM is missing at ${outputPath}. Run npm run sbom:prod.`);
  }
  const current = fs.readFileSync(outputPath, "utf8");
  if (current !== rendered) {
    throw new Error(`Checked-in SBOM at ${outputPath} is out of date. Run npm run sbom:prod.`);
  }
  process.stdout.write(`SBOM is up to date at ${outputPath}\n`);
  process.exit(0);
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, rendered, "utf8");
process.stdout.write(`Wrote production SBOM to ${outputPath}\n`);
