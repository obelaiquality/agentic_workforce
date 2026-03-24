#!/usr/bin/env node
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  assertRuntimePrereqs,
  ensureDir,
  findLatestOutputDir,
  resolveRuntimePreset,
  rootDir,
  runNodeScript,
  timestampSlug,
} from "./suite-utils.mjs";

const runtimePreset = resolveRuntimePreset("openai_all");
assertRuntimePrereqs(runtimePreset);

const outputDir = path.join(rootDir, "output", "playwright", `demo-capture-${timestampSlug()}`);
await ensureDir(outputDir);

await runNodeScript("scripts/playwright/run_electron_desktop_acceptance.mjs", {
  label: "demo capture: desktop acceptance",
  env: {
    E2E_RUNTIME_PRESET: runtimePreset,
  },
  logFile: path.join(outputDir, "desktop-acceptance.log"),
});

const latestAcceptanceDir = findLatestOutputDir("desktop-acceptance-");
if (!latestAcceptanceDir) {
  throw new Error("Unable to find the latest desktop acceptance output for demo capture.");
}

const manifest = {
  runtimePreset,
  capturedAt: new Date().toISOString(),
  sourceDir: latestAcceptanceDir,
  frames: [
    "01b-projects.png",
    "02-scaffold-complete.png",
    "05-followup-card-expanded.png",
    "03-codebase.png",
    "04-console.png",
  ].filter((fileName) => fs.existsSync(path.join(latestAcceptanceDir, fileName))),
};

await fsp.writeFile(
  path.join(latestAcceptanceDir, "demo-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8"
);
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
