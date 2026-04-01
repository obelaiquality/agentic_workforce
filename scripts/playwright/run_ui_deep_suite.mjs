#!/usr/bin/env node
/**
 * UI Deep Test Suite
 *
 * Runs all 6 UI test scripts sequentially, continuing on failure.
 * Reports aggregate results at the end.
 */
import path from "node:path";
import {
  ensureDir,
  rootDir,
  runNodeScript,
  timestampSlug,
  writeJson,
} from "./suite-utils.mjs";

const outputDir = path.join(rootDir, "output", "playwright", `ui-deep-suite-${timestampSlug()}`);
const summaryPath = path.join(outputDir, "summary.json");

await ensureDir(outputDir);

const steps = [
  { label: "UI Navigation Smoke Test", script: "scripts/playwright/run_ui_navigation_smoke.mjs" },
  { label: "Settings Deep Test", script: "scripts/playwright/run_settings_deep_test.mjs" },
  { label: "Projects Deep Test", script: "scripts/playwright/run_projects_deep_test.mjs" },
  { label: "Work Deep Test", script: "scripts/playwright/run_work_deep_test.mjs" },
  { label: "Codebase Deep Test", script: "scripts/playwright/run_codebase_deep_test.mjs" },
  { label: "Console Deep Test", script: "scripts/playwright/run_console_deep_test.mjs" },
];

const summary = { startedAt: new Date().toISOString(), steps: [] };
let anyFailed = false;

for (const step of steps) {
  const stepStartedAt = Date.now();
  try {
    await runNodeScript(step.script, {
      label: step.label,
      logFile: path.join(outputDir, `${path.basename(step.script, ".mjs")}.log`),
    });
    summary.steps.push({
      label: step.label, script: step.script, status: "passed",
      durationMs: Date.now() - stepStartedAt,
    });
  } catch (error) {
    anyFailed = true;
    summary.steps.push({
      label: step.label, script: step.script, status: "failed",
      durationMs: Date.now() - stepStartedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    process.stdout.write(`[suite] ✗ ${step.label} FAILED\n`);
  }
  await writeJson(summaryPath, summary);
}

summary.finishedAt = new Date().toISOString();
await writeJson(summaryPath, summary);

const passCount = summary.steps.filter((s) => s.status === "passed").length;
const failCount = summary.steps.filter((s) => s.status === "failed").length;
process.stdout.write(`\n[suite] Results: ${passCount} passed, ${failCount} failed (${steps.length} total)\n`);

process.exit(anyFailed ? 1 : 0);
