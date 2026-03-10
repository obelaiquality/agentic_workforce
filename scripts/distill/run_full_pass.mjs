#!/usr/bin/env node
import process from "node:process";

const apiBaseUrl = process.env.API_BASE_URL || `http://127.0.0.1:${process.env.API_PORT || "8787"}`;
const apiToken = process.env.API_TOKEN || "";

function parseList(value, fallback) {
  const source = value && value.trim() ? value : fallback;
  return source
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const args = new Set(process.argv.slice(2));
const prepareOnly = args.has("--prepare-only");
const skipPromote = args.has("--skip-promote");
const actor = process.env.DISTILL_ACTOR || "user";
const datasetIdOverride = process.env.DISTILL_FULL_PASS_DATASET_ID || "";

const sampleCount = Number(process.env.DISTILL_FULL_PASS_SAMPLE_COUNT || 30);
const retrievalIds = parseList(
  process.env.DISTILL_FULL_PASS_RETRIEVAL_IDS || "",
  "knowledge-001,knowledge-002"
);
const modelList = parseList(
  process.env.DISTILL_FULL_PASS_MODELS || "",
  "Qwen/Qwen3.5-0.8B,Qwen/Qwen3.5-4B"
);
const stages = parseList(process.env.DISTILL_FULL_PASS_STAGES || "", "sft,orpo,tool_rl");
const minApprovedRatio = Number(process.env.DISTILL_FULL_PASS_MIN_APPROVED_RATIO || 0.6);
const baselineModel = process.env.DISTILL_FULL_PASS_BASELINE_MODEL || "Qwen/Qwen3.5-4B";

async function api(path, init = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(apiToken ? { "x-local-api-token": apiToken } : {}),
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${path} failed (${response.status}): ${text}`);
  }
  return response.json();
}

function log(message, extra) {
  if (extra !== undefined) {
    process.stdout.write(`${message} ${JSON.stringify(extra)}\n`);
    return;
  }
  process.stdout.write(`${message}\n`);
}

async function ensureReadiness() {
  const readiness = await api("/api/v2/distill/readiness");
  if (!readiness.ready) {
    log("Distill readiness has blockers.", {
      blockers: readiness.blockers,
      warnings: readiness.warnings,
    });
    for (const check of readiness.checks) {
      const level = check.ok ? "OK" : check.severity === "error" ? "ERR" : "WARN";
      log(`[${level}] ${check.key}: ${check.message}`);
    }
    throw new Error("Distill readiness blockers must be cleared before full pass.");
  }
  log("Distill readiness is clean.");
  return readiness;
}

async function generateAndReviewDataset() {
  if (datasetIdOverride) {
    const reviewed = await api(`/api/v2/distill/datasets/${datasetIdOverride}`);
    const sampleTotal = Number(reviewed.dataset.sampleCount || 0);
    const approved = Number(reviewed.dataset.approvedCount || 0);
    const ratio = sampleTotal > 0 ? approved / sampleTotal : 0;
    if (ratio < minApprovedRatio) {
      throw new Error(
        `Approved ratio below threshold (${approved}/${sampleTotal}=${ratio.toFixed(2)} < ${minApprovedRatio.toFixed(2)}).`
      );
    }
    log("Using existing dataset for full pass.", {
      datasetId: datasetIdOverride,
      sampleTotal,
      approved,
      approvedRatio: Number(ratio.toFixed(3)),
    });
    return { datasetId: datasetIdOverride, sampleTotal, approved, approvedRatio: ratio };
  }

  const title = `Full Distill Pass ${new Date().toISOString().slice(0, 19)}`;
  const generated = await api("/api/v2/commands/distill.dataset.generate", {
    method: "POST",
    body: JSON.stringify({
      actor,
      title,
      sample_count: sampleCount,
      retrieval_context_ids: retrievalIds,
    }),
  });

  const datasetId = generated?.dataset?.id;
  if (!datasetId) {
    throw new Error("Dataset generation did not return dataset id.");
  }

  const dataset = await api(`/api/v2/distill/datasets/${datasetId}`);
  const decisions = (dataset.examples || [])
    .filter((example) => example.reviewerDecision === "pending" && example.privacySafe)
    .map((example) => ({
      example_id: example.id,
      decision: "approved",
    }));

  if (decisions.length > 0) {
    await api("/api/v2/commands/distill.dataset.review", {
      method: "POST",
      body: JSON.stringify({
        actor,
        dataset_id: datasetId,
        decisions,
      }),
    });
  }

  const reviewed = await api(`/api/v2/distill/datasets/${datasetId}`);
  const sampleTotal = Number(reviewed.dataset.sampleCount || 0);
  const approved = Number(reviewed.dataset.approvedCount || 0);
  const ratio = sampleTotal > 0 ? approved / sampleTotal : 0;

  if (ratio < minApprovedRatio) {
    throw new Error(
      `Approved ratio below threshold (${approved}/${sampleTotal}=${ratio.toFixed(2)} < ${minApprovedRatio.toFixed(2)}).`
    );
  }

  log("Dataset ready for training.", {
    datasetId,
    sampleTotal,
    approved,
    approvedRatio: Number(ratio.toFixed(3)),
  });
  return { datasetId, sampleTotal, approved, approvedRatio: ratio };
}

async function runTrainingLadder(datasetId) {
  const runResults = [];
  for (const modelId of modelList) {
    for (const stage of stages) {
      log("Starting train stage.", { modelId, stage, datasetId });
      const train = await api("/api/v2/commands/distill.train.start", {
        method: "POST",
        body: JSON.stringify({
          actor,
          dataset_id: datasetId,
          stage,
          student_model_id: modelId,
        }),
      });

      const run = train?.run;
      if (!run?.id) {
        throw new Error(`Training stage ${stage} did not return run id.`);
      }
      if (run.status !== "completed") {
        throw new Error(`Training stage ${stage} failed for ${modelId} (status=${run.status}, reason=${run.reasonCode || "n/a"}).`);
      }

      const evalResult = await api("/api/v2/commands/distill.eval.run", {
        method: "POST",
        body: JSON.stringify({
          actor,
          run_id: run.id,
          baseline_model_id: baselineModel,
        }),
      });

      runResults.push({
        modelId,
        stage,
        runId: run.id,
        evalId: evalResult?.eval?.id || null,
        evalPass: Boolean(evalResult?.eval?.pass),
      });
    }
  }
  return runResults;
}

async function maybePromote(runResults) {
  if (skipPromote || runResults.length === 0) {
    return null;
  }

  const promotedCandidate = [...runResults].reverse().find((result) => result.evalPass);
  if (!promotedCandidate) {
    throw new Error("No passing eval run available for promotion.");
  }

  const promotion = await api("/api/v2/commands/distill.model.promote", {
    method: "POST",
    body: JSON.stringify({
      actor,
      run_id: promotedCandidate.runId,
    }),
  });

  return {
    runId: promotedCandidate.runId,
    modelId: promotion?.promotedModelId || null,
  };
}

async function main() {
  const readiness = await ensureReadiness();
  const dataset = await generateAndReviewDataset();
  if (prepareOnly) {
    log("Prepare-only mode complete.");
    process.stdout.write(
      `${JSON.stringify(
        {
          mode: "prepare_only",
          readiness,
          dataset,
        },
        null,
        2
      )}\n`
    );
    return;
  }

  const runs = await runTrainingLadder(dataset.datasetId);
  const promotion = await maybePromote(runs);
  process.stdout.write(
    `${JSON.stringify(
      {
        mode: "full_pass",
        readiness,
        dataset,
        runs,
        promotion,
      },
      null,
      2
    )}\n`
  );
}

main().catch((error) => {
  process.stderr.write(`full distill pass failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
