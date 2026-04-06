import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getDistillReadinessV2,
  getDistillQuotaV2,
  listDistillModelsV2,
  generateDistillDatasetV2,
  getDistillDatasetV2,
  reviewDistillDatasetV2,
  startDistillTrainingV2,
  getDistillRunV2,
  getDistillRunLogsV2,
  runDistillEvalV2,
  getDistillEvalV2,
  promoteDistillModelV2,
} from "../../lib/apiClient";
import type {
  DistillReadinessStatus,
  DistillQuotaState,
  DistillDatasetDto,
  DistillExample,
  DistillRun,
  DistillRunLogEntry,
  DistillEvalRun,
  DistillReviewDecision,
  DistillStage,
} from "../../../shared/contracts";
import { Panel, PanelHeader, Button } from "../UI";
import { Badge } from "../ui/badge";
import {
  Beaker,
  FlaskConical,
  GraduationCap,
  Rocket,
  Database,
  CheckCircle,
  XCircle,
  AlertTriangle,
  ChevronRight,
  Play,
  Eye,
  ThumbsUp,
  ThumbsDown,
  Terminal,
} from "lucide-react";

type PipelineStep = "readiness" | "dataset" | "training" | "evaluation" | "promotion";

const STEP_ORDER: PipelineStep[] = ["readiness", "dataset", "training", "evaluation", "promotion"];

const STEP_CONFIG: Record<PipelineStep, { label: string; icon: typeof Beaker; description: string }> = {
  readiness: {
    label: "Environment Check",
    icon: FlaskConical,
    description: "Verify teacher CLI, Python, and disk space requirements",
  },
  dataset: {
    label: "Dataset Generation",
    icon: Database,
    description: "Generate and review training examples from teacher model",
  },
  training: {
    label: "Training Run",
    icon: GraduationCap,
    description: "Fine-tune student model on approved dataset",
  },
  evaluation: {
    label: "Evaluation",
    icon: Beaker,
    description: "Benchmark distilled model against baseline",
  },
  promotion: {
    label: "Promotion",
    icon: Rocket,
    description: "Promote successful model to production",
  },
};

export function DistillationView() {
  const queryClient = useQueryClient();
  const [activeStep, setActiveStep] = useState<PipelineStep>("readiness");
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedEvalId, setSelectedEvalId] = useState<string | null>(null);

  // Queries
  const readinessQuery = useQuery<DistillReadinessStatus>({
    queryKey: ["distill-readiness"],
    queryFn: async () => {
      const result = await getDistillReadinessV2();
      return result;
    },
    refetchInterval: 10000,
  });

  const quotaQuery = useQuery<{ quota: DistillQuotaState }>({
    queryKey: ["distill-quota"],
    queryFn: async () => {
      const result = await getDistillQuotaV2();
      return result;
    },
    refetchInterval: 30000,
  });

  const modelsQuery = useQuery({
    queryKey: ["distill-models"],
    queryFn: listDistillModelsV2,
    refetchInterval: 30000,
  });

  const datasetQuery = useQuery<{ dataset: DistillDatasetDto; examples: DistillExample[] }>({
    queryKey: ["distill-dataset", selectedDatasetId],
    queryFn: () => getDistillDatasetV2(selectedDatasetId!),
    enabled: !!selectedDatasetId,
  });

  const runQuery = useQuery<{ run: DistillRun }>({
    queryKey: ["distill-run", selectedRunId],
    queryFn: () => getDistillRunV2(selectedRunId!),
    enabled: !!selectedRunId,
    refetchInterval: (query) => {
      const run = query.state.data?.run;
      return run?.status === "running" || run?.status === "queued" ? 5000 : false;
    },
  });

  const logsQuery = useQuery<{ items: DistillRunLogEntry[] }>({
    queryKey: ["distill-run-logs", selectedRunId],
    queryFn: () => getDistillRunLogsV2(selectedRunId!),
    enabled: !!selectedRunId,
    refetchInterval: (query) => {
      const run = runQuery.data?.run;
      return run?.status === "running" ? 3000 : false;
    },
  });

  const evalQuery = useQuery<{ eval: DistillEvalRun }>({
    queryKey: ["distill-eval", selectedEvalId],
    queryFn: () => getDistillEvalV2(selectedEvalId!),
    enabled: !!selectedEvalId,
  });

  // Mutations
  const generateDatasetMutation = useMutation({
    mutationFn: async (input: { title: string; sampleCount: number }) => {
      return generateDistillDatasetV2({
        actor: "user",
        title: input.title,
        sample_count: input.sampleCount,
        retrieval_context_ids: [],
      });
    },
    onSuccess: (data) => {
      if (data.dataset) {
        setSelectedDatasetId(data.dataset.id);
        setActiveStep("dataset");
      }
      void queryClient.invalidateQueries({ queryKey: ["distill-dataset"] });
    },
  });

  const reviewDatasetMutation = useMutation({
    mutationFn: async (input: { datasetId: string; decisions: Array<{ example_id: string; decision: DistillReviewDecision }> }) => {
      return reviewDistillDatasetV2({
        actor: "user",
        dataset_id: input.datasetId,
        decisions: input.decisions,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["distill-dataset", selectedDatasetId] });
    },
  });

  const startTrainingMutation = useMutation({
    mutationFn: async (input: { datasetId: string; stage: DistillStage; studentModelId: string }) => {
      return startDistillTrainingV2({
        actor: "user",
        dataset_id: input.datasetId,
        stage: input.stage,
        student_model_id: input.studentModelId,
      });
    },
    onSuccess: (data) => {
      if (data.run) {
        setSelectedRunId(data.run.id);
        setActiveStep("training");
      }
      void queryClient.invalidateQueries({ queryKey: ["distill-run"] });
    },
  });

  const runEvalMutation = useMutation({
    mutationFn: async (input: { runId: string; baselineModelId?: string }) => {
      return runDistillEvalV2({
        actor: "user",
        run_id: input.runId,
        baseline_model_id: input.baselineModelId,
      });
    },
    onSuccess: (data) => {
      if (data.eval) {
        setSelectedEvalId(data.eval.id);
        setActiveStep("evaluation");
      }
      void queryClient.invalidateQueries({ queryKey: ["distill-eval"] });
    },
  });

  const promoteModelMutation = useMutation({
    mutationFn: async (input: { runId: string }) => {
      return promoteDistillModelV2({
        actor: "user",
        run_id: input.runId,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["distill-models"] });
      setActiveStep("promotion");
    },
  });

  const readiness = readinessQuery.data;
  const quota = quotaQuery.data?.quota;
  const dataset = datasetQuery.data?.dataset;
  const examples = datasetQuery.data?.examples ?? [];
  const run = runQuery.data?.run;
  const logs = logsQuery.data?.items ?? [];
  const evalRun = evalQuery.data?.eval;
  const models = modelsQuery.data?.items ?? [];

  const blockers = readiness?.checks.filter((c) => c.severity === "error" && !c.ok) ?? [];
  const warnings = readiness?.checks.filter((c) => c.severity === "warning" && !c.ok) ?? [];

  return (
    <div className="flex h-full gap-4 p-4">
      {/* Main Pipeline */}
      <div className="flex-1 space-y-4 overflow-y-auto">
        {/* Step Navigation */}
        <Panel>
          <div className="flex items-center gap-2 p-3">
            {STEP_ORDER.map((step, idx) => {
              const config = STEP_CONFIG[step];
              const Icon = config.icon;
              const isActive = activeStep === step;
              const isCompleted = STEP_ORDER.indexOf(step) < STEP_ORDER.indexOf(activeStep);
              return (
                <div key={step} className="flex items-center gap-2">
                  <button
                    onClick={() => setActiveStep(step)}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                      isActive
                        ? "bg-zinc-700 text-white"
                        : isCompleted
                        ? "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                        : "text-zinc-400 hover:bg-zinc-800/50"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{config.label}</span>
                  </button>
                  {idx < STEP_ORDER.length - 1 && (
                    <ChevronRight className="h-4 w-4 text-zinc-600" />
                  )}
                </div>
              );
            })}
          </div>
        </Panel>

        {/* Step Content */}
        {activeStep === "readiness" && (
          <Panel>
            <PanelHeader title="Environment Readiness" />
            <div className="space-y-3 p-4">
              <p className="text-sm text-zinc-400">
                {STEP_CONFIG.readiness.description}
              </p>

              {readinessQuery.isLoading ? (
                <div className="text-sm text-zinc-500">Checking environment...</div>
              ) : readiness ? (
                <>
                  <div className="flex items-center gap-3">
                    {readiness.ready ? (
                      <Badge variant="default" className="flex items-center gap-1">
                        <CheckCircle className="h-3 w-3" />
                        Ready
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="flex items-center gap-1">
                        <XCircle className="h-3 w-3" />
                        Not Ready
                      </Badge>
                    )}
                    <span className="text-sm text-zinc-400">
                      {blockers.length} blockers, {warnings.length} warnings
                    </span>
                  </div>

                  <div className="space-y-2">
                    {readiness.checks.map((check) => (
                      <div
                        key={check.key}
                        className={`flex items-start gap-3 rounded-lg border p-3 ${
                          check.ok
                            ? "border-zinc-700/50 bg-zinc-800/20"
                            : check.severity === "error"
                            ? "border-red-500/30 bg-red-500/5"
                            : "border-yellow-500/30 bg-yellow-500/5"
                        }`}
                      >
                        {check.ok ? (
                          <CheckCircle className="h-5 w-5 shrink-0 text-emerald-400" />
                        ) : check.severity === "error" ? (
                          <XCircle className="h-5 w-5 shrink-0 text-red-400" />
                        ) : (
                          <AlertTriangle className="h-5 w-5 shrink-0 text-yellow-400" />
                        )}
                        <div className="flex-1 space-y-1">
                          <div className="text-sm font-medium">{check.key}</div>
                          <div className="text-sm text-zinc-400">{check.message}</div>
                          {check.details && Object.keys(check.details).length > 0 && (
                            <div className="mt-2 rounded bg-zinc-900/50 p-2 font-mono text-xs text-zinc-500">
                              {JSON.stringify(check.details, null, 2)}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="text-sm text-zinc-500">No readiness data available</div>
              )}
            </div>
          </Panel>
        )}

        {activeStep === "dataset" && (
          <Panel>
            <PanelHeader title="Dataset Generation & Review" />
            <div className="space-y-3 p-4">
              <p className="text-sm text-zinc-400">
                {STEP_CONFIG.dataset.description}
              </p>

              {!selectedDatasetId ? (
                <div className="space-y-3">
                  <Button
                    onClick={() => {
                      const title = prompt("Dataset title:", `distill_${new Date().toISOString().split("T")[0]}`);
                      const count = prompt("Sample count:", "50");
                      if (title && count) {
                        generateDatasetMutation.mutate({
                          title,
                          sampleCount: parseInt(count, 10),
                        });
                      }
                    }}
                    disabled={generateDatasetMutation.isPending}
                  >
                    <Play className="h-4 w-4" />
                    Generate Dataset
                  </Button>
                  {generateDatasetMutation.isPending && (
                    <div className="text-sm text-zinc-500">Generating dataset...</div>
                  )}
                </div>
              ) : datasetQuery.isLoading ? (
                <div className="text-sm text-zinc-500">Loading dataset...</div>
              ) : dataset ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">{dataset.title}</div>
                      <div className="text-sm text-zinc-400">
                        {dataset.sampleCount} samples, {dataset.approvedCount} approved, {dataset.rejectedCount} rejected
                      </div>
                    </div>
                    <Badge
                      variant={
                        dataset.status === "approved"
                          ? "success"
                          : dataset.status === "draft"
                          ? "default"
                          : "warning"
                      }
                    >
                      {dataset.status}
                    </Badge>
                  </div>

                  <div className="max-h-96 space-y-2 overflow-y-auto">
                    {examples.map((example) => (
                      <div
                        key={example.id}
                        className="rounded-lg border border-zinc-700 bg-zinc-800/20 p-3"
                      >
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-sm font-medium">{example.spec.intent}</span>
                          <div className="flex items-center gap-2">
                            {example.privacySafe ? (
                              <Badge variant="default" className="text-xs">Safe</Badge>
                            ) : (
                              <Badge variant="destructive" className="text-xs">Review</Badge>
                            )}
                            <button
                              onClick={() => {
                                reviewDatasetMutation.mutate({
                                  datasetId: dataset.id,
                                  decisions: [{ example_id: example.id, decision: "approved" }],
                                });
                              }}
                              className="text-emerald-400 hover:text-emerald-300"
                            >
                              <ThumbsUp className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => {
                                reviewDatasetMutation.mutate({
                                  datasetId: dataset.id,
                                  decisions: [{ example_id: example.id, decision: "rejected" }],
                                });
                              }}
                              className="text-red-400 hover:text-red-300"
                            >
                              <ThumbsDown className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                        <div className="text-xs text-zinc-400">
                          <div className="mb-1">Inputs: {example.spec.inputs.join(", ")}</div>
                          <div className="mb-1">Tools: {example.spec.requiredTools.join(", ")}</div>
                          <div className="max-h-24 overflow-y-auto rounded bg-zinc-900/50 p-2 font-mono text-xs">
                            {example.teacherOutput.substring(0, 200)}
                            {example.teacherOutput.length > 200 && "..."}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {dataset.status === "approved" && (
                    <Button
                      onClick={() => setActiveStep("training")}
                      className="w-full"
                    >
                      <ChevronRight className="h-4 w-4" />
                      Continue to Training
                    </Button>
                  )}
                </div>
              ) : (
                <div className="text-sm text-zinc-500">No dataset selected</div>
              )}
            </div>
          </Panel>
        )}

        {activeStep === "training" && (
          <Panel>
            <PanelHeader title="Training Run" />
            <div className="space-y-3 p-4">
              <p className="text-sm text-zinc-400">
                {STEP_CONFIG.training.description}
              </p>

              {!selectedRunId ? (
                <div className="space-y-3">
                  {selectedDatasetId && dataset?.status === "approved" ? (
                    <>
                      <Button
                        onClick={() => {
                          const studentModelId = prompt("Student model ID:", "qwen2.5-coder-0.5b-instruct");
                          if (studentModelId) {
                            startTrainingMutation.mutate({
                              datasetId: selectedDatasetId,
                              stage: "sft",
                              studentModelId,
                            });
                          }
                        }}
                        disabled={startTrainingMutation.isPending}
                      >
                        <Play className="h-4 w-4" />
                        Start Training
                      </Button>
                      {startTrainingMutation.isPending && (
                        <div className="text-sm text-zinc-500">Starting training run...</div>
                      )}
                    </>
                  ) : (
                    <div className="text-sm text-zinc-500">
                      Complete dataset generation and approval first
                    </div>
                  )}
                </div>
              ) : runQuery.isLoading ? (
                <div className="text-sm text-zinc-500">Loading run...</div>
              ) : run ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">{run.studentModelId}</div>
                      <div className="text-sm text-zinc-400">
                        Stage: {run.stage} | Backend: {run.backend || "N/A"}
                      </div>
                    </div>
                    <Badge
                      variant={
                        run.status === "completed"
                          ? "success"
                          : run.status === "running"
                          ? "default"
                          : run.status === "failed"
                          ? "error"
                          : "default"
                      }
                    >
                      {run.status}
                    </Badge>
                  </div>

                  {run.metrics && Object.keys(run.metrics).length > 0 && (
                    <div className="grid grid-cols-2 gap-2">
                      {Object.entries(run.metrics).map(([key, value]) => (
                        <div key={key} className="rounded border border-zinc-700 bg-zinc-800/20 p-2">
                          <div className="text-xs text-zinc-400">{key}</div>
                          <div className="font-mono text-sm">{String(value)}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Logs Viewer */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Terminal className="h-4 w-4" />
                      Training Logs
                    </div>
                    <div className="max-h-96 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-950 p-3 font-mono text-xs">
                      {logs.length === 0 ? (
                        <div className="text-zinc-600">No logs available</div>
                      ) : (
                        logs.map((log) => (
                          <div
                            key={log.id}
                            className={`mb-1 ${
                              log.level === "error"
                                ? "text-red-400"
                                : log.level === "warn"
                                ? "text-yellow-400"
                                : "text-zinc-400"
                            }`}
                          >
                            <span className="text-zinc-600">[{new Date(log.createdAt).toLocaleTimeString()}]</span>{" "}
                            {log.message}
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {run.status === "completed" && (
                    <Button
                      onClick={() => setActiveStep("evaluation")}
                      className="w-full"
                    >
                      <ChevronRight className="h-4 w-4" />
                      Continue to Evaluation
                    </Button>
                  )}
                </div>
              ) : (
                <div className="text-sm text-zinc-500">No run selected</div>
              )}
            </div>
          </Panel>
        )}

        {activeStep === "evaluation" && (
          <Panel>
            <PanelHeader title="Model Evaluation" />
            <div className="space-y-3 p-4">
              <p className="text-sm text-zinc-400">
                {STEP_CONFIG.evaluation.description}
              </p>

              {!selectedEvalId ? (
                <div className="space-y-3">
                  {selectedRunId && run?.status === "completed" ? (
                    <>
                      <Button
                        onClick={() => {
                          runEvalMutation.mutate({ runId: selectedRunId });
                        }}
                        disabled={runEvalMutation.isPending}
                      >
                        <Play className="h-4 w-4" />
                        Run Evaluation
                      </Button>
                      {runEvalMutation.isPending && (
                        <div className="text-sm text-zinc-500">Running evaluation...</div>
                      )}
                    </>
                  ) : (
                    <div className="text-sm text-zinc-500">
                      Complete training run first
                    </div>
                  )}
                </div>
              ) : evalQuery.isLoading ? (
                <div className="text-sm text-zinc-500">Loading evaluation...</div>
              ) : evalRun ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">Evaluation Results</div>
                    <Badge variant={evalRun.pass ? "success" : "error"}>
                      {evalRun.pass ? "PASS" : "FAIL"}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(evalRun.metrics).map(([key, value]) => (
                      <div key={key} className="rounded border border-zinc-700 bg-zinc-800/20 p-3">
                        <div className="text-xs text-zinc-400">{key}</div>
                        <div className="font-mono text-lg">{value.toFixed(3)}</div>
                      </div>
                    ))}
                  </div>

                  {evalRun.pass && (
                    <Button
                      onClick={() => setActiveStep("promotion")}
                      className="w-full"
                    >
                      <ChevronRight className="h-4 w-4" />
                      Continue to Promotion
                    </Button>
                  )}
                </div>
              ) : (
                <div className="text-sm text-zinc-500">No evaluation selected</div>
              )}
            </div>
          </Panel>
        )}

        {activeStep === "promotion" && (
          <Panel>
            <PanelHeader title="Model Promotion" />
            <div className="space-y-3 p-4">
              <p className="text-sm text-zinc-400">
                {STEP_CONFIG.promotion.description}
              </p>

              {selectedRunId && run?.status === "completed" && evalRun?.pass ? (
                <div className="space-y-3">
                  <Button
                    onClick={() => {
                      promoteModelMutation.mutate({ runId: selectedRunId });
                    }}
                    disabled={promoteModelMutation.isPending}
                  >
                    <Rocket className="h-4 w-4" />
                    Promote Model
                  </Button>
                  {promoteModelMutation.isPending && (
                    <div className="text-sm text-zinc-500">Promoting model...</div>
                  )}
                  {promoteModelMutation.isSuccess && (
                    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-400">
                      Model successfully promoted!
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-sm text-zinc-500">
                  Complete training and pass evaluation first
                </div>
              )}
            </div>
          </Panel>
        )}
      </div>

      {/* Sidebar */}
      <div className="w-80 space-y-4 overflow-y-auto">
        {/* Quota & Budget */}
        <Panel>
          <PanelHeader title="Quota Status" />
          <div className="space-y-2 p-4">
            {quotaQuery.isLoading ? (
              <div className="text-sm text-zinc-500">Loading quota...</div>
            ) : quota ? (
              <>
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-400">Tokens Used</span>
                  <span className="font-mono">{quota.tokensUsed.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-400">Remaining</span>
                  <span className="font-mono">{quota.remainingTokens.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-400">Daily Budget</span>
                  <span className="font-mono">{quota.dailyTokenBudget.toLocaleString()}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full bg-emerald-500"
                    style={{
                      width: `${Math.min(100, (quota.tokensUsed / quota.dailyTokenBudget) * 100)}%`,
                    }}
                  />
                </div>
                {quota.cooldownUntil && (
                  <div className="text-xs text-yellow-400">
                    Cooldown until {new Date(quota.cooldownUntil).toLocaleTimeString()}
                  </div>
                )}
              </>
            ) : (
              <div className="text-sm text-zinc-500">No quota data</div>
            )}
          </div>
        </Panel>

        {/* Distilled Models */}
        <Panel>
          <PanelHeader title="Distilled Models" />
          <div className="space-y-2 p-4">
            {modelsQuery.isLoading ? (
              <div className="text-sm text-zinc-500">Loading models...</div>
            ) : models.length === 0 ? (
              <div className="text-sm text-zinc-500">No models yet</div>
            ) : (
              models.map((model) => (
                <div
                  key={model.modelId}
                  className="rounded-lg border border-zinc-700 bg-zinc-800/20 p-3"
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-sm font-medium">{model.modelId}</span>
                    {model.promoted && (
                      <Badge variant="default" className="text-xs">
                        Promoted
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-zinc-400">
                    {model.artifacts.length} artifacts
                  </div>
                  <div className="text-xs text-zinc-500">
                    Updated {new Date(model.updatedAt).toLocaleDateString()}
                  </div>
                </div>
              ))
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
