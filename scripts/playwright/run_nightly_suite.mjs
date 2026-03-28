#!/usr/bin/env node
import path from "node:path";
import {
  ensureDir,
  resolveRuntimePreset,
  rootDir,
  runNodeScript,
  runShellScript,
  timestampSlug,
  writeJson,
} from "./suite-utils.mjs";

const runtimePreset = resolveRuntimePreset("openai_all");
const outputDir = path.join(rootDir, "output", "playwright", `nightly-suite-${timestampSlug()}`);
const summaryPath = path.join(outputDir, "summary.json");

await ensureDir(outputDir);

const steps = [
  {
    label: "CLI companion smoke",
    kind: "node",
    script: "scripts/playwright/run_cli_companion_smoke.mjs",
    enabled: true,
  },
  {
    label: "Follow-up scenario: progress bar",
    kind: "node",
    script: "scripts/playwright/run_followup_scenario.mjs",
    args: ["--scenario", "progress-bar"],
    retries: 1,
    enabled: Boolean(process.env.OPENAI_API_KEY?.trim()),
    skipReason: "OPENAI_API_KEY is not configured for nightly OpenAI-backed follow-up scenarios.",
  },
  {
    label: "Follow-up scenario: utility module",
    kind: "node",
    script: "scripts/playwright/run_followup_scenario.mjs",
    args: ["--scenario", "utility-module"],
    retries: 1,
    enabled: Boolean(process.env.OPENAI_API_KEY?.trim()),
    skipReason: "OPENAI_API_KEY is not configured for nightly OpenAI-backed follow-up scenarios.",
  },
  {
    label: "Follow-up scenario: rename component",
    kind: "node",
    script: "scripts/playwright/run_followup_scenario.mjs",
    args: ["--scenario", "rename-component"],
    retries: 1,
    enabled: Boolean(process.env.OPENAI_API_KEY?.trim()),
    skipReason: "OPENAI_API_KEY is not configured for nightly OpenAI-backed follow-up scenarios.",
  },
  {
    label: "Follow-up scenario: stop action",
    kind: "node",
    script: "scripts/playwright/run_followup_scenario.mjs",
    args: ["--scenario", "api-stop"],
    retries: 1,
    enabled: Boolean(process.env.OPENAI_API_KEY?.trim()),
    skipReason: "OPENAI_API_KEY is not configured for nightly OpenAI-backed follow-up scenarios.",
  },
  {
    label: "Browser preview critical failover",
    kind: "shell",
    script: "scripts/playwright/run_e2e_critical_failover.sh",
    enabled: process.env.ENABLE_LOCAL_FAILOVER_E2E === "1",
    skipReason: "Set ENABLE_LOCAL_FAILOVER_E2E=1 when a local runtime and teacher CLI are available.",
  },
];

const summary = {
  runtimePreset,
  startedAt: new Date().toISOString(),
  steps: [],
};

for (const step of steps) {
  if (!step.enabled) {
    summary.steps.push({
      label: step.label,
      script: step.script,
      status: "skipped",
      reason: step.skipReason || "step disabled",
    });
    continue;
  }

  const stepStartedAt = Date.now();
  const maxAttempts = (step.retries ?? 0) + 1;
  let attempt = 0;
  let lastError = null;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      if (step.kind === "shell") {
        await runShellScript(step.script, {
          label: maxAttempts > 1 ? `${step.label} (attempt ${attempt}/${maxAttempts})` : step.label,
          env: {
            E2E_RUNTIME_PRESET: runtimePreset,
          },
          logFile: path.join(outputDir, `${path.basename(step.script)}.log`),
        });
      } else {
        await runNodeScript(step.script, {
          label: maxAttempts > 1 ? `${step.label} (attempt ${attempt}/${maxAttempts})` : step.label,
          args: step.args || [],
          env: {
            E2E_RUNTIME_PRESET: runtimePreset,
          },
          logFile: path.join(outputDir, `${path.basename(step.script, ".mjs")}.log`),
        });
      }
      summary.steps.push({
        label: step.label,
        script: step.script,
        status: "passed",
        durationMs: Date.now() - stepStartedAt,
        attempts: attempt,
      });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) {
        summary.steps.push({
          label: step.label,
          script: step.script,
          status: "failed",
          durationMs: Date.now() - stepStartedAt,
          attempts: attempt,
          error: error instanceof Error ? error.message : String(error),
        });
        await writeJson(summaryPath, {
          ...summary,
          finishedAt: new Date().toISOString(),
        });
        throw error;
      }
    }
  }

  if (lastError) {
    await writeJson(summaryPath, {
      ...summary,
      finishedAt: new Date().toISOString(),
    });
    throw lastError;
  }
}

await writeJson(summaryPath, {
  ...summary,
  finishedAt: new Date().toISOString(),
});
