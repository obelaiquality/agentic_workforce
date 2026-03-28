#!/usr/bin/env node

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

async function listFiles(rootDir, currentDir = rootDir) {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(rootDir, absolutePath)));
      continue;
    }
    if (entry.isFile()) {
      files.push(path.relative(rootDir, absolutePath));
    }
  }

  return files.sort();
}

async function sha256ForFile(absolutePath) {
  const data = await fs.readFile(absolutePath);
  return createHash("sha256").update(data).digest("hex");
}

async function main() {
  const rootDir = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(process.cwd(), "release-bundle");
  const outputPath = process.argv[3]
    ? path.resolve(process.argv[3])
    : path.resolve(rootDir, "SHA256SUMS.txt");

  const files = await listFiles(rootDir);
  const filtered = files.filter((relativePath) => relativePath !== path.relative(rootDir, outputPath));

  if (filtered.length === 0) {
    throw new Error(`No files found under ${rootDir}`);
  }

  const lines = [];
  for (const relativePath of filtered) {
    const absolutePath = path.join(rootDir, relativePath);
    const digest = await sha256ForFile(absolutePath);
    lines.push(`${digest}  ${relativePath}`);
  }

  await fs.writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");
  process.stdout.write(`Wrote ${filtered.length} checksums to ${outputPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
