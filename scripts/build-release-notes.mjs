#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const outputArg = args.find((arg) => !arg.startsWith("--"));

const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
const changelog = fs.readFileSync(path.join(rootDir, "CHANGELOG.md"), "utf8");
const template = fs.readFileSync(path.join(rootDir, "docs", "release-notes-template.md"), "utf8");

const version = packageJson.version;
const changelogSection = extractChangelogSection(changelog, version);
if (!changelogSection) {
  throw new Error(`CHANGELOG.md is missing a section for version ${version}.`);
}

const releaseDate = changelogSection.date || new Date().toISOString().slice(0, 10);
const templateBodyStart = template.indexOf("## Prerequisites");
if (templateBodyStart === -1) {
  throw new Error("docs/release-notes-template.md must contain a '## Prerequisites' section.");
}

const notes = [
  `# Agentic Workforce v${version}`,
  "",
  `Release date: ${releaseDate}`,
  "",
  "## Highlights",
  "",
  changelogSection.body.trim(),
  "",
  template.slice(templateBodyStart).trim(),
  "",
].join("\n");

assertNoPlaceholders(notes);

if (checkOnly) {
  process.stdout.write(`Release notes validated for v${version}\n`);
  process.exit(0);
}

const outputPath = outputArg
  ? path.resolve(process.cwd(), outputArg)
  : path.join(rootDir, "output", `release-notes-v${version}.md`);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, notes, "utf8");
process.stdout.write(`Wrote release notes to ${outputPath}\n`);

function extractChangelogSection(markdown, targetVersion) {
  const headingPattern = /^## \[([^\]]+)\](?: - (\d{4}-\d{2}-\d{2}))?\s*$/gm;
  const matches = [...markdown.matchAll(headingPattern)];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    if (match[1] !== targetVersion) {
      continue;
    }
    const start = match.index + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : markdown.length;
    return {
      date: match[2] || "",
      body: markdown.slice(start, end).trim(),
    };
  }

  return null;
}

function assertNoPlaceholders(markdown) {
  const placeholderPatterns = [
    /\bTBD\b/i,
    /\bTODO\b/i,
    /\bplaceholder\b/i,
    /\bIssue\s+\d+\b/i,
    /^- Operating system requirements:\s*$/m,
    /^- Runtime prerequisites:\s*$/m,
    /^- Database prerequisites:\s*$/m,
    /^- Additional local tooling, if any:\s*$/m,
    /^- macOS:\s*$/m,
    /^- Windows:\s*$/m,
    /^- Linux:\s*$/m,
    /^- OpenAI-backed path:\s*$/m,
    /^- Local-runtime path:\s*$/m,
    /^- Browser preview:\s*$/m,
    /^- CLI companion:\s*$/m,
    /^- Breaking changes:\s*$/m,
    /^- Config changes:\s*$/m,
    /^- Migration or cleanup steps:\s*$/m,
  ];

  for (const pattern of placeholderPatterns) {
    if (pattern.test(markdown)) {
      throw new Error(`Generated release notes still contain unresolved placeholder content: ${pattern}`);
    }
  }
}
