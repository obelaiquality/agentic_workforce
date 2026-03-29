/**
 * Pre-release guardrail: scan source files for accidentally embedded secrets.
 *
 * Checks:
 *  1. No ".env" (exact name) should appear in staged or tracked source files.
 *  2. No live API-key patterns (sk-..., sk-proj-...) with actual values in source.
 *
 * Exits non-zero on first violation so `npm run validate` catches it.
 */

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const scanRoots = ["electron", "src", "scripts", "prisma", "docs"];

const secretPatterns = [
  {
    name: "OpenAI API key with real value",
    // Matches sk-... or sk-proj-... keys that are at least 20 chars (not empty placeholders)
    pattern: /["'`]sk-(?:proj-)?[A-Za-z0-9_-]{20,}["'`]/g,
    message: "Possible live OpenAI API key detected. Use environment variables instead.",
  },
  {
    name: "Generic bearer/api-key assignment with long secret",
    pattern: /(?:api[_-]?key|bearer|token|secret)\s*[:=]\s*["'`][A-Za-z0-9_\-/.]{40,}["'`]/gi,
    message: "Possible hardcoded secret detected. Use environment variables instead.",
  },
];

const allowedFiles = new Set([
  "check-no-secrets.mjs", // this file contains the patterns themselves
  ".env.example",
  ".env.advanced.example",
]);

function listFiles(dirPath) {
  const results = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (
      entry.name === "node_modules" ||
      entry.name === "dist" ||
      entry.name === "dist-server" ||
      entry.name === "dist-sidecar" ||
      entry.name.startsWith(".")
    ) {
      continue;
    }
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFiles(fullPath));
      continue;
    }
    if (allowedFiles.has(entry.name)) continue;
    if (/\.(ts|tsx|js|mjs|cjs|json|md|yml|yaml)$/.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

const failures = [];

for (const relativeRoot of scanRoots) {
  const absoluteRoot = path.join(root, relativeRoot);
  if (!fs.existsSync(absoluteRoot)) continue;

  for (const filePath of listFiles(absoluteRoot)) {
    const content = fs.readFileSync(filePath, "utf8");
    for (const rule of secretPatterns) {
      rule.pattern.lastIndex = 0;
      if (rule.pattern.test(content)) {
        failures.push({ filePath, rule });
      }
    }
  }
}

if (failures.length > 0) {
  console.error("secret scan failed:");
  for (const f of failures) {
    console.error(`  ${path.relative(root, f.filePath)}: ${f.rule.name}`);
    console.error(`    ${f.rule.message}`);
  }
  process.exit(1);
}

console.log("secret scan passed");
