#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const requiredFiles = [
  "LICENSE",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "SECURITY.md",
  "SUPPORT.md",
  "CHANGELOG.md",
  "docs/release-notes-template.md",
  "docs/sbom.production.cdx.json",
  ".nvmrc",
  ".env.example",
  ".env.advanced.example",
  ".github/pull_request_template.md",
  ".github/ISSUE_TEMPLATE/config.yml",
  ".github/workflows/ci.yml",
  ".github/workflows/desktop-release.yml",
  "build-resources/icon.icns",
  "build-resources/icon.ico",
  "build-resources/icon.png",
];

const publicDocs = [
  "README.md",
  "CONTRIBUTING.md",
  "docs/install.md",
  "docs/onboarding.md",
  "docs/troubleshooting.md",
];

const staleStringChecks = [
  {
    needle: "@figma/my-make-file",
    files: ["package.json", "README.md", "ATTRIBUTIONS.md"],
    message: "Remove stale package branding '@figma/my-make-file'.",
  },
  {
    needle: "Next-Gen Agentic Coding",
    files: ["package.json", "README.md", "ATTRIBUTIONS.md"],
    message: "Remove stale prototype branding 'Next-Gen Agentic Coding'.",
  },
  {
    needle: "This Figma Make file",
    files: ["ATTRIBUTIONS.md", "README.md"],
    message: "Replace stale 'This Figma Make file' wording in public docs.",
  },
];

function logPass(message) {
  console.log(`PASS ${message}`);
}

function logFail(message) {
  console.error(`FAIL ${message}`);
}

async function exists(relativePath) {
  try {
    await fs.access(path.join(rootDir, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function readFile(relativePath) {
  return fs.readFile(path.join(rootDir, relativePath), "utf8");
}

async function listMarkdownFiles(relativePath) {
  const target = path.join(rootDir, relativePath);
  const entries = await fs.readdir(target, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const childRelative = path.posix.join(relativePath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listMarkdownFiles(childRelative)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(childRelative);
    }
  }
  return files;
}

function collectMatches(content, pattern) {
  const matches = [];
  let match;
  while ((match = pattern.exec(content)) !== null) {
    matches.push({ index: match.index, value: match[0] });
  }
  return matches;
}

async function main() {
  let hasFailures = false;

  for (const relativePath of requiredFiles) {
    if (await exists(relativePath)) {
      logPass(`${relativePath} exists`);
    } else {
      hasFailures = true;
      logFail(`Missing required OSS launch file: ${relativePath}`);
    }
  }

  const packageJson = JSON.parse(await readFile("package.json"));
  if (packageJson.private === false) {
    logPass("package.json is public-ready (`private: false`)");
  } else {
    hasFailures = true;
    logFail("package.json must set `private` to false for a public OSS release.");
  }

  if (packageJson.license === "MIT") {
    logPass("package.json license is MIT");
  } else {
    hasFailures = true;
    logFail("package.json should declare the MIT license.");
  }

  if (typeof packageJson.bin?.["agentic-workforce"] === "string") {
    logPass("package.json exposes the CLI binary");
  } else {
    hasFailures = true;
    logFail("package.json is missing the `agentic-workforce` CLI binary.");
  }

  if (packageJson.scripts?.prepublishOnly === "node scripts/prevent-npm-publish.mjs") {
    logPass("package.json blocks accidental npm publication");
  } else {
    hasFailures = true;
    logFail("package.json must block accidental npm publication from the repo root.");
  }

  const publishedFiles = Array.isArray(packageJson.files) ? packageJson.files : [];
  if (publishedFiles.length > 0 && !publishedFiles.includes(".github/workflows/ci.yml")) {
    logPass("package.json keeps a narrow npm files allowlist");
  } else {
    hasFailures = true;
    logFail("package.json should define a narrow npm `files` allowlist.");
  }

  const envExample = await readFile(".env.example");
  if (/^DISTILL_/m.test(envExample)) {
    hasFailures = true;
    logFail(".env.example must stay limited to launch-facing settings and not expose DISTILL_* entries.");
  } else {
    logPass(".env.example excludes DISTILL_* launch-invisible settings");
  }

  for (const check of staleStringChecks) {
    for (const relativePath of check.files) {
      if (!(await exists(relativePath))) {
        continue;
      }
      const content = await readFile(relativePath);
      if (content.includes(check.needle)) {
        hasFailures = true;
        logFail(`${check.message} Found in ${relativePath}.`);
      }
    }
  }

  const publicMarkdown = [...publicDocs];
  if (await exists("docs")) {
    publicMarkdown.push(...(await listMarkdownFiles("docs")));
  }

  const docsToInspect = Array.from(new Set(publicMarkdown.filter((item) => !item.includes("/runbooks/benchmarks.md"))));
  for (const relativePath of docsToInspect) {
    if (!(await exists(relativePath))) {
      continue;
    }
    const content = await readFile(relativePath);
    const userPathMatches = collectMatches(content, /\/Users\/[^\s)]+/g);
    if (userPathMatches.length > 0) {
      hasFailures = true;
      logFail(`${relativePath} contains hardcoded local filesystem paths.`);
    }
  }

  for (const relativePath of ["README.md", "docs/install.md", "docs/onboarding.md", "docs/troubleshooting.md"]) {
    if (!(await exists(relativePath))) {
      continue;
    }
    const content = (await readFile(relativePath)).toLowerCase();
    if (content.includes("distillation") || content.includes("distill ")) {
      hasFailures = true;
      logFail(`${relativePath} should keep distillation out of the public launch path.`);
    } else {
      logPass(`${relativePath} keeps distillation out of the launch-facing flow`);
    }
  }

  const readme = await readFile("README.md");
  const requiredReadmeLinks = [
    "docs/install.md",
    "docs/onboarding.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "SUPPORT.md",
    "CHANGELOG.md",
    "LICENSE",
  ];
  for (const target of requiredReadmeLinks) {
    if (readme.includes(`](${target})`)) {
      logPass(`README links ${target}`);
    } else {
      hasFailures = true;
      logFail(`README must link ${target}.`);
    }
  }

  if (hasFailures) {
    process.exitCode = 1;
    return;
  }

  console.log("Workspace launch lint passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
