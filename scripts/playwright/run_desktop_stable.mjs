#!/usr/bin/env node
import path from "node:path";
import {
  assertRuntimePrereqs,
  ensureDir,
  resolveRuntimePreset,
  rootDir,
  runNodeScript,
  timestampSlug,
  writeJson,
} from "./suite-utils.mjs";

const runtimePreset = resolveRuntimePreset("default");
const outputDir = path.join(rootDir, "output", "playwright", `desktop-stable-${timestampSlug()}`);
const summaryPath = path.join(outputDir, "summary.json");

await ensureDir(outputDir);
assertRuntimePrereqs(runtimePreset);

const steps = [
  {
    label: "desktop acceptance: new project and follow-up flow",
    script: "scripts/playwright/run_electron_desktop_acceptance.mjs",
  },
  {
    label: "desktop acceptance: attach existing repo flow",
    script: "scripts/playwright/run_local_attach_existing_repo.mjs",
  },
];

const summary = {
  runtimePreset,
  startedAt: new Date().toISOString(),
  steps: [],
};

try {
  for (const step of steps) {
    const stepStartedAt = Date.now();
    await runNodeScript(step.script, {
      label: step.label,
      env: {
        E2E_RUNTIME_PRESET: runtimePreset,
      },
      logFile: path.join(outputDir, `${path.basename(step.script, ".mjs")}.log`),
    });
    summary.steps.push({
      label: step.label,
      script: step.script,
      status: "passed",
      durationMs: Date.now() - stepStartedAt,
    });
    await writeJson(summaryPath, summary);
  }
  summary.finishedAt = new Date().toISOString();
  await writeJson(summaryPath, summary);
} catch (error) {
  summary.finishedAt = new Date().toISOString();
  summary.steps.push({
    label: steps[summary.steps.length]?.label || "unknown",
    script: steps[summary.steps.length]?.script || "unknown",
    status: "failed",
    error: error instanceof Error ? error.message : String(error),
  });
  await writeJson(summaryPath, summary);
  throw error;
}
