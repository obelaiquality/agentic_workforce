import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const scanRoots = [
  "electron",
  "src",
  "scripts/playwright",
];

const rules = [
  {
    name: "legacy desktop API token bridge",
    pattern: /desktop:get-api-config/g,
    message: "Renderer token/config bridge must stay removed. Use desktop:api-request and desktop:open-stream.",
  },
  {
    name: "deprecated raw mission tool invoke route",
    pattern: /\/api\/v9\/mission\/tool\.invoke\b/g,
    message: "Raw mission tool invocation route must stay removed. Use /api/v9/mission/dependency.bootstrap or approval replay.",
  },
  {
    name: "query-string token auth",
    pattern: /searchParams\.(?:set|append)\(\s*["']token["']|\?token=|&token=/g,
    message: "Local API auth must stay header-only. Do not put tokens in URLs or search params.",
  },
  {
    name: "empty standalone API token fallback",
    pattern: /process\.env\.API_TOKEN\s*\|\|\s*["']["']/g,
    message: "Standalone API startup must fail closed when API_TOKEN is missing.",
  },
  {
    name: "local API auth bypass",
    pattern: /if\s*\(\s*!apiToken\s*\)\s*\{\s*return;\s*\}/g,
    message: "Do not bypass local API auth when the token is empty.",
  },
];

function listFiles(dirPath) {
  const results = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "dist-server") {
      continue;
    }
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFiles(fullPath));
      continue;
    }
    if (/\.(test|spec)\.[^.]+$/.test(entry.name)) {
      continue;
    }
    if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

const failures = [];

for (const relativeRoot of scanRoots) {
  const absoluteRoot = path.join(root, relativeRoot);
  if (!fs.existsSync(absoluteRoot)) {
    continue;
  }

  for (const filePath of listFiles(absoluteRoot)) {
    const content = fs.readFileSync(filePath, "utf8");
    for (const rule of rules) {
      rule.pattern.lastIndex = 0;
      if (rule.pattern.test(content)) {
        failures.push({
          filePath,
          rule,
        });
      }
    }
  }
}

if (failures.length > 0) {
  console.error("security guardrails failed:");
  for (const failure of failures) {
    console.error(`- ${path.relative(root, failure.filePath)}: ${failure.rule.name}`);
    console.error(`  ${failure.rule.message}`);
  }
  process.exit(1);
}

console.log("security guardrails passed");
