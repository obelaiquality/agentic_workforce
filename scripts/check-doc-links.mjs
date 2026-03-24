import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const markdownFiles = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".local" || entry.name === "dist" || entry.name === "release") {
      continue;
    }
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(absolute);
      continue;
    }
    if (/\.md$/i.test(entry.name)) {
      markdownFiles.push(absolute);
    }
  }
}

function normalizeTarget(fromFile, target) {
  const withoutAnchor = target.split("#")[0];
  if (!withoutAnchor || /^(https?:|mailto:)/i.test(withoutAnchor)) {
    return null;
  }
  return path.resolve(path.dirname(fromFile), withoutAnchor);
}

walk(root);

const missing = [];
for (const file of markdownFiles) {
  const content = fs.readFileSync(file, "utf8");
  const matches = content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g);
  for (const match of matches) {
    const target = match[1].trim();
    const normalized = normalizeTarget(file, target);
    if (!normalized) continue;
    if (!fs.existsSync(normalized)) {
      missing.push(`${path.relative(root, file)} -> ${target}`);
    }
  }
}

if (missing.length) {
  console.error("Broken documentation links detected:");
  for (const item of missing) {
    console.error(`- ${item}`);
  }
  process.exit(1);
}

console.log(`Documentation link check passed for ${markdownFiles.length} markdown files.`);
