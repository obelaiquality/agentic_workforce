import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  generateDistillDatasetV2,
  getChampionVsChallengerV3,
  getDistillDatasetV2,
  getDistillEvalV2,
  getDistillQuotaV2,
  getDistillReadinessV2,
  getDistillRunV2,
  getDistillRunLogsV2,
  listDistillModelsV2,
  listRecentCommandsV2,
  promoteDistillModelV2,
  registerChallengeV3,
  reviewDistillDatasetV2,
  reviewChallengeV3,
  runDistillEvalV2,
  startDistillTrainingV2,
} from "../../lib/apiClient";
import { Chip, Panel, PanelHeader } from "../UI";

export function DistillLabView() {
  const queryClient = useQueryClient();
  const [datasetTitle, setDatasetTitle] = useState("V3 Behavior-Spec Batch");
  const [sampleCount, setSampleCount] = useState(24);
  const [retrievalIdsRaw, setRetrievalIdsRaw] = useState("knowledge-001,knowledge-002");
  const [studentModelId, setStudentModelId] = useState("Qwen/Qwen3.5-4B");
  const [stage, setStage] = useState<"sft" | "orpo" | "tool_rl">("sft");
  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [selectedRunId, setSelectedRunId] = useState("");
  const [selectedEvalId, setSelectedEvalId] = useState("");
  const [baselineModelId, setBaselineModelId] = useState("Qwen/Qwen3.5-4B");

  const commandsQuery = useQuery({
    queryKey: ["commands-v2"],
    queryFn: () => listRecentCommandsV2(250),
    refetchInterval: 5000,
  });

  const datasetQuery = useQuery({
    queryKey: ["distill-dataset", selectedDatasetId],
    enabled: Boolean(selectedDatasetId),
    queryFn: () => getDistillDatasetV2(selectedDatasetId),
    refetchInterval: 7000,
  });

  const runQuery = useQuery({
    queryKey: ["distill-run", selectedRunId],
    enabled: Boolean(selectedRunId),
    queryFn: () => getDistillRunV2(selectedRunId),
    refetchInterval: 7000,
  });

  const runLogsQuery = useQuery({
    queryKey: ["distill-run-logs", selectedRunId],
    enabled: Boolean(selectedRunId),
    queryFn: () => getDistillRunLogsV2(selectedRunId),
    refetchInterval: 5000,
  });

  const evalQuery = useQuery({
    queryKey: ["distill-eval", selectedEvalId],
    enabled: Boolean(selectedEvalId),
    queryFn: () => getDistillEvalV2(selectedEvalId),
    refetchInterval: 7000,
  });

  const modelsQuery = useQuery({
    queryKey: ["distill-models"],
    queryFn: listDistillModelsV2,
    refetchInterval: 10000,
  });

  const quotaQuery = useQuery({
    queryKey: ["distill-quota"],
    queryFn: getDistillQuotaV2,
    refetchInterval: 7000,
  });

  const readinessQuery = useQuery({
    queryKey: ["distill-readiness"],
    queryFn: getDistillReadinessV2,
    refetchInterval: 15000,
  });

  const challengerQuery = useQuery({
    queryKey: ["champion-vs-challenger-v3"],
    queryFn: getChampionVsChallengerV3,
    refetchInterval: 10000,
  });

  const recentIds = useMemo(() => {
    const datasetIds = new Set<string>();
    const runIds = new Set<string>();
    const evalIds = new Set<string>();

    for (const row of commandsQuery.data?.items ?? []) {
      if (row.command_type === "distill.dataset.generate" && typeof row.result?.dataset === "object" && row.result?.dataset) {
        const id = (row.result.dataset as Record<string, unknown>).id;
        if (typeof id === "string") datasetIds.add(id);
      }
      if (row.command_type === "distill.train.start") {
        const run = row.result?.run as Record<string, unknown> | undefined;
        if (typeof run?.id === "string") runIds.add(run.id);
      }
      if (row.command_type === "distill.eval.run") {
        const evalItem = row.result?.eval as Record<string, unknown> | undefined;
        if (typeof evalItem?.id === "string") evalIds.add(evalItem.id);
      }
    }

    return {
      datasetIds: Array.from(datasetIds),
      runIds: Array.from(runIds),
      evalIds: Array.from(evalIds),
    };
  }, [commandsQuery.data?.items]);

  const generateMutation = useMutation({
    mutationFn: () =>
      generateDistillDatasetV2({
        actor: "user",
        title: datasetTitle,
        sample_count: sampleCount,
        retrieval_context_ids: retrievalIdsRaw
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      }),
    onSuccess: (data) => {
      if (data.dataset?.id) {
        setSelectedDatasetId(data.dataset.id);
      }
      queryClient.invalidateQueries({ queryKey: ["commands-v2"] });
    },
  });

  const approveAllMutation = useMutation({
    mutationFn: async () => {
      const dataset = datasetQuery.data;
      if (!dataset?.examples?.length) {
        throw new Error("No examples loaded");
      }
      const decisions = dataset.examples
        .filter((example) => example.reviewerDecision === "pending" && example.privacySafe)
        .map((example) => ({
          example_id: example.id,
          decision: "approved" as const,
        }));

      if (!decisions.length) {
        return;
      }

      return reviewDistillDatasetV2({
        actor: "user",
        dataset_id: selectedDatasetId,
        decisions,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["distill-dataset", selectedDatasetId] });
    },
  });

  const trainMutation = useMutation({
    mutationFn: () =>
      startDistillTrainingV2({
        actor: "user",
        dataset_id: selectedDatasetId,
        stage,
        student_model_id: studentModelId,
      }),
    onSuccess: (data) => {
      setSelectedRunId(data.run.id);
      queryClient.invalidateQueries({ queryKey: ["commands-v2"] });
      queryClient.invalidateQueries({ queryKey: ["distill-models"] });
      queryClient.invalidateQueries({ queryKey: ["distill-run-logs", data.run.id] });
    },
  });

  const evalMutation = useMutation({
    mutationFn: () =>
      runDistillEvalV2({
        actor: "user",
        run_id: selectedRunId,
        baseline_model_id: baselineModelId.trim() || undefined,
      }),
    onSuccess: (data) => {
      setSelectedEvalId(data.eval.id);
      queryClient.invalidateQueries({ queryKey: ["commands-v2"] });
    },
  });

  const promoteMutation = useMutation({
    mutationFn: () =>
      promoteDistillModelV2({
        actor: "user",
        run_id: selectedRunId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["distill-run", selectedRunId] });
      queryClient.invalidateQueries({ queryKey: ["distill-models"] });
    },
  });

  const registerChallengeMutation = useMutation({
    mutationFn: () => {
      const run = runQuery.data?.run;
      if (!run || !selectedDatasetId || !selectedEvalId) {
        throw new Error("Select dataset, run, and eval before registering a challenger.");
      }
      return registerChallengeV3({
        actor: "user",
        model_plugin_id: run.studentModelId.includes("4B") ? "qwen3.5-4b" : "qwen3.5-0.8b",
        parent_model_plugin_id: "qwen3.5-4b",
        dataset_id: selectedDatasetId,
        eval_run_id: selectedEvalId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["champion-vs-challenger-v3"] });
    },
  });

  const reviewChallengeMutation = useMutation({
    mutationFn: ({ candidateId, status }: { candidateId: string; status: "approved" | "rejected" | "promoted" }) =>
      reviewChallengeV3({
        actor: "user",
        candidate_id: candidateId,
        status,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["champion-vs-challenger-v3"] });
    },
  });

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[420px_minmax(0,1fr)_360px] gap-4 min-h-[760px]">
      <Panel>
        <PanelHeader title="Distill Pipeline" />
        <div className="p-3 space-y-3">
          <article className="rounded-md border border-white/10 bg-zinc-900/40 p-2.5">
            <div className="text-[11px] text-zinc-500 uppercase tracking-wide">Teacher quota</div>
            <div className="text-xs text-zinc-200 mt-1">
              {quotaQuery.data?.quota.remainingTokens ?? 0} / {quotaQuery.data?.quota.dailyTokenBudget ?? 0} tokens remaining
            </div>
            <div className="text-[10px] text-zinc-500 mt-1">
              requests today: {quotaQuery.data?.quota.requests ?? 0}
              {quotaQuery.data?.quota.cooldownUntil
                ? ` · cooldown until ${new Date(quotaQuery.data.quota.cooldownUntil).toLocaleTimeString()}`
                : ""}
            </div>
          </article>
          <article className="rounded-md border border-white/10 bg-zinc-900/40 p-2.5">
            <div className="text-[11px] text-zinc-500 uppercase tracking-wide">Pipeline readiness</div>
            <div className="text-xs text-zinc-200 mt-1">
              {readinessQuery.data ? (readinessQuery.data.ready ? "ready" : `${readinessQuery.data.blockers} blockers`) : "checking..."}
            </div>
            <div className="text-[10px] text-zinc-500 mt-1">
              warnings: {readinessQuery.data?.warnings ?? 0}
            </div>
          </article>
          <div>
            <label className="text-[11px] text-zinc-500 uppercase tracking-wide">Dataset title</label>
            <input
              value={datasetTitle}
              onChange={(event) => setDatasetTitle(event.target.value)}
              className="mt-1 w-full bg-zinc-950 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-zinc-200"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-zinc-500 uppercase tracking-wide">Sample count</label>
              <input
                type="number"
                min={1}
                max={500}
                value={sampleCount}
                onChange={(event) => setSampleCount(Number(event.target.value))}
                className="mt-1 w-full bg-zinc-950 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-zinc-200"
              />
            </div>
            <div>
              <label className="text-[11px] text-zinc-500 uppercase tracking-wide">Stage</label>
              <select
                value={stage}
                onChange={(event) => setStage(event.target.value as "sft" | "orpo" | "tool_rl")}
                className="mt-1 w-full bg-zinc-950 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-zinc-200"
              >
                <option value="sft">sft</option>
                <option value="orpo">orpo</option>
                <option value="tool_rl">tool_rl</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-[11px] text-zinc-500 uppercase tracking-wide">Retrieval context ids</label>
            <input
              value={retrievalIdsRaw}
              onChange={(event) => setRetrievalIdsRaw(event.target.value)}
              className="mt-1 w-full bg-zinc-950 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-zinc-200"
            />
          </div>
          <button
            onClick={() => generateMutation.mutate()}
            className="w-full px-3 py-1.5 rounded-md bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/40 text-cyan-200 text-xs"
          >
            Generate Dataset Batch
          </button>
          <button
            onClick={() => approveAllMutation.mutate()}
            className="w-full px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 border border-white/10 text-zinc-200 text-xs"
            disabled={!selectedDatasetId}
          >
            Approve Safe Pending Examples
          </button>
          <div>
            <label className="text-[11px] text-zinc-500 uppercase tracking-wide">Student model</label>
            <input
              value={studentModelId}
              onChange={(event) => setStudentModelId(event.target.value)}
              className="mt-1 w-full bg-zinc-950 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-zinc-200"
            />
          </div>
          <button
            onClick={() => trainMutation.mutate()}
            className="w-full px-3 py-1.5 rounded-md bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-200 text-xs"
            disabled={!selectedDatasetId}
          >
            Start Training
          </button>
          <div>
            <label className="text-[11px] text-zinc-500 uppercase tracking-wide">Baseline model</label>
            <input
              value={baselineModelId}
              onChange={(event) => setBaselineModelId(event.target.value)}
              className="mt-1 w-full bg-zinc-950 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-zinc-200"
            />
          </div>
          <button
            onClick={() => evalMutation.mutate()}
            className="w-full px-3 py-1.5 rounded-md bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/40 text-purple-200 text-xs"
            disabled={!selectedRunId}
          >
            Run Evaluation
          </button>
          <button
            onClick={() => promoteMutation.mutate()}
            className="w-full px-3 py-1.5 rounded-md bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 text-amber-200 text-xs"
            disabled={!selectedRunId}
          >
            Promote Model
          </button>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Dataset + Run State">
          <div className="flex gap-2">
            <select
              value={selectedDatasetId}
              onChange={(event) => setSelectedDatasetId(event.target.value)}
              className="bg-zinc-900 border border-white/10 rounded-md px-2 py-1 text-[11px] text-zinc-200"
            >
              <option value="">dataset id</option>
              {recentIds.datasetIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
            <select
              value={selectedRunId}
              onChange={(event) => setSelectedRunId(event.target.value)}
              className="bg-zinc-900 border border-white/10 rounded-md px-2 py-1 text-[11px] text-zinc-200"
            >
              <option value="">run id</option>
              {recentIds.runIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
            <select
              value={selectedEvalId}
              onChange={(event) => setSelectedEvalId(event.target.value)}
              className="bg-zinc-900 border border-white/10 rounded-md px-2 py-1 text-[11px] text-zinc-200"
            >
              <option value="">eval id</option>
              {recentIds.evalIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </div>
        </PanelHeader>
        <div className="p-3 space-y-4 max-h-[760px] overflow-y-auto custom-scrollbar">
          {datasetQuery.data?.dataset ? (
            <article className="rounded-md border border-white/10 bg-zinc-900/40 p-3">
              <div className="text-xs text-zinc-100">{datasetQuery.data.dataset.title}</div>
              <div className="text-[10px] text-zinc-500 mt-1">
                {datasetQuery.data.dataset.sampleCount} samples · {datasetQuery.data.dataset.approvedCount} approved ·{" "}
                {datasetQuery.data.dataset.rejectedCount} rejected
              </div>
              <div className="mt-2 flex gap-1">
                <Chip variant="subtle" className="text-[9px]">
                  {datasetQuery.data.dataset.status}
                </Chip>
                <Chip variant="subtle" className="text-[9px]">
                  {datasetQuery.data.dataset.objectiveSplit}
                </Chip>
              </div>
              <div className="mt-2 space-y-1">
                {datasetQuery.data.examples.slice(0, 10).map((example) => (
                  <div key={example.id} className="rounded border border-white/10 bg-zinc-950/60 p-2">
                    <div className="text-[10px] text-zinc-300">{example.spec.intent}</div>
                    <div className="text-[10px] text-zinc-500 mt-0.5">
                      {example.reviewerDecision} · privacy {example.privacySafe ? "safe" : "unsafe"}
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ) : (
            <div className="text-xs text-zinc-600">Pick or generate a dataset to inspect examples.</div>
          )}

          {runQuery.data?.run ? (
            <article className="rounded-md border border-cyan-500/20 bg-cyan-500/10 p-3">
              <div className="text-xs text-cyan-200">
                {runQuery.data.run.stage} · {runQuery.data.run.studentModelId}
              </div>
              <div className="text-[10px] text-cyan-100/70 mt-1">
                status: {runQuery.data.run.status}
                {runQuery.data.run.reasonCode ? ` · reason ${runQuery.data.run.reasonCode}` : ""}
              </div>
              <div className="text-[10px] text-cyan-100/70 mt-1">
                backend: {runQuery.data.run.backend ?? "n/a"} · job: {runQuery.data.run.jobId ?? "n/a"}
              </div>
              <pre className="text-[10px] text-cyan-100/70 mt-2 overflow-x-auto">{JSON.stringify(runQuery.data.run.metrics, null, 2)}</pre>
              <div className="mt-2 space-y-1">
                {(runLogsQuery.data?.items ?? []).slice(-8).map((log) => (
                  <div key={log.id} className="rounded border border-cyan-500/20 bg-zinc-950/40 p-2 text-[10px] text-cyan-100/80">
                    <div className="font-medium">{log.level}</div>
                    <div>{log.message}</div>
                  </div>
                ))}
              </div>
            </article>
          ) : null}

          {evalQuery.data?.eval ? (
            <article className="rounded-md border border-emerald-500/20 bg-emerald-500/10 p-3">
              <div className="text-xs text-emerald-200">eval pass: {evalQuery.data.eval.pass ? "true" : "false"}</div>
              <pre className="text-[10px] text-emerald-100/70 mt-2 overflow-x-auto">
                {JSON.stringify(evalQuery.data.eval.metrics, null, 2)}
              </pre>
              <button
                onClick={() => registerChallengeMutation.mutate()}
                className="mt-2 px-2.5 py-1.5 rounded-md bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-200 text-xs"
              >
                Register Challenger
              </button>
            </article>
          ) : null}

          {readinessQuery.data?.checks?.length ? (
            <article className="rounded-md border border-white/10 bg-zinc-900/40 p-3">
              <div className="text-xs text-zinc-300">Readiness checks</div>
              <div className="mt-2 space-y-1.5">
                {readinessQuery.data.checks.map((check) => (
                  <div key={check.key} className="text-[11px] text-zinc-400">
                    <span
                      className={
                        check.ok
                          ? "text-emerald-300"
                          : check.severity === "error"
                            ? "text-rose-300"
                            : "text-amber-300"
                      }
                    >
                      {check.ok ? "OK" : check.severity === "error" ? "ERR" : "WARN"}
                    </span>{" "}
                    {check.key}: {check.message}
                  </div>
                ))}
              </div>
            </article>
          ) : null}
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Models + Challengers">
          <Chip variant="subtle" className="text-[10px]">
            {(modelsQuery.data?.items.length ?? 0) + (challengerQuery.data?.challengers.length ?? 0)}
          </Chip>
        </PanelHeader>
        <div className="p-3 space-y-2 max-h-[760px] overflow-y-auto custom-scrollbar">
          {(challengerQuery.data?.challengers ?? []).map((candidate) => (
            <article key={candidate.id} className="rounded-md border border-cyan-500/20 bg-cyan-500/10 p-2.5">
              <div className="flex justify-between gap-2">
                <div className="text-xs text-cyan-100 break-all">{candidate.modelPluginId}</div>
                <Chip variant="subtle" className="text-[9px]">
                  {candidate.status}
                </Chip>
              </div>
              <div className="text-[10px] text-cyan-100/70 mt-1">dataset: {candidate.datasetId}</div>
              <div className="text-[10px] text-cyan-100/70">eval: {candidate.evalRunId}</div>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => reviewChallengeMutation.mutate({ candidateId: candidate.id, status: "approved" })}
                  className="px-2 py-1 rounded bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-200 text-[10px]"
                >
                  Approve
                </button>
                <button
                  onClick={() => reviewChallengeMutation.mutate({ candidateId: candidate.id, status: "rejected" })}
                  className="px-2 py-1 rounded bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/40 text-rose-200 text-[10px]"
                >
                  Reject
                </button>
              </div>
            </article>
          ))}
          {(modelsQuery.data?.items ?? []).map((model) => (
            <article key={model.modelId} className="rounded-md border border-white/10 bg-zinc-900/40 p-2.5">
              <div className="flex justify-between gap-2">
                <div className="text-xs text-zinc-100 break-all">{model.modelId}</div>
                {model.promoted ? (
                  <Chip variant="ok" className="text-[9px]">
                    promoted
                  </Chip>
                ) : (
                  <Chip variant="subtle" className="text-[9px]">
                    staged
                  </Chip>
                )}
              </div>
              <div className="text-[10px] text-zinc-500 mt-1">artifacts: {model.artifacts.join(", ")}</div>
              <div className="text-[10px] text-zinc-500">updated: {new Date(model.updatedAt).toLocaleString()}</div>
            </article>
          ))}
        </div>
      </Panel>
    </div>
  );
}
