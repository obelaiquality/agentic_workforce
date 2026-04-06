import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listBenchmarkProjectsV4,
  getBenchmarkProjectV4,
  startBenchmarkRunV4,
  executeBenchmarkTaskV4,
  recomputeBenchmarkScoreV4,
  getBenchmarkRunV4,
  getBenchmarkScorecardV4,
  getBenchmarkLeaderboardV4,
  getBenchmarkFailuresV4,
} from "../../lib/apiClient";
import type {
  BenchmarkProject,
  BenchmarkTask,
  BenchmarkRun,
  BenchmarkScorecard,
} from "../../../shared/contracts";
import { Panel, PanelHeader, Button } from "../UI";
import { Badge } from "../ui/badge";
import {
  Play,
  Trophy,
  Target,
  AlertCircle,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronRight,
  BarChart3,
  Sparkles,
} from "lucide-react";

type DifficultyBadge = "easy" | "medium" | "hard";

const DIFFICULTY_COLORS: Record<DifficultyBadge, string> = {
  easy: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  medium: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  hard: "bg-rose-500/10 text-rose-400 border-rose-500/20",
};

export function BenchmarkView() {
  const queryClient = useQueryClient();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [expandedFailures, setExpandedFailures] = useState(false);

  // Queries
  const projectsQuery = useQuery({
    queryKey: ["benchmark-projects"],
    queryFn: listBenchmarkProjectsV4,
    refetchInterval: 30000,
  });

  const projectQuery = useQuery({
    queryKey: ["benchmark-project", selectedProjectId],
    queryFn: () => getBenchmarkProjectV4(selectedProjectId!),
    enabled: !!selectedProjectId,
  });

  const runQuery = useQuery({
    queryKey: ["benchmark-run", selectedRunId],
    queryFn: () => getBenchmarkRunV4(selectedRunId!),
    enabled: !!selectedRunId,
    refetchInterval: (query) => {
      const run = query.state.data?.run;
      return run?.status === "running" || run?.status === "queued" ? 3000 : false;
    },
  });

  const scorecardQuery = useQuery({
    queryKey: ["benchmark-scorecard", selectedRunId],
    queryFn: () => getBenchmarkScorecardV4(selectedRunId!),
    enabled: !!selectedRunId,
  });

  const leaderboardQuery = useQuery({
    queryKey: ["benchmark-leaderboard"],
    queryFn: getBenchmarkLeaderboardV4,
    refetchInterval: 60000,
  });

  const failuresQuery = useQuery({
    queryKey: ["benchmark-failures"],
    queryFn: getBenchmarkFailuresV4,
    refetchInterval: 60000,
  });

  // Mutations
  const startRunMutation = useMutation({
    mutationFn: async (input: { projectId: string; taskId: string }) => {
      return startBenchmarkRunV4({
        actor: "user",
        project_id: input.projectId,
        task_id: input.taskId,
        mode: "operator_e2e",
        provider_role: "coder_default",
      });
    },
    onSuccess: (data) => {
      if (data.run) {
        setSelectedRunId(data.run.id);
      }
      void queryClient.invalidateQueries({ queryKey: ["benchmark-run"] });
    },
  });

  const executeTaskMutation = useMutation({
    mutationFn: async (runId: string) => {
      return executeBenchmarkTaskV4({ actor: "user", run_id: runId });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["benchmark-run", selectedRunId] });
    },
  });

  const recomputeScoreMutation = useMutation({
    mutationFn: async (runId: string) => {
      return recomputeBenchmarkScoreV4({ actor: "user", run_id: runId });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["benchmark-scorecard", selectedRunId] });
      void queryClient.invalidateQueries({ queryKey: ["benchmark-run", selectedRunId] });
    },
  });

  const projects = projectsQuery.data?.items ?? [];
  const project = projectQuery.data?.project;
  const tasks = projectQuery.data?.tasks ?? [];
  const run = runQuery.data?.run;
  const scorecard = scorecardQuery.data?.item;
  const leaderboard = leaderboardQuery.data?.items ?? [];
  const failures = failuresQuery.data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-6 w-6 text-cyan-400" />
          <h1 className="text-2xl font-bold text-white">Benchmarks</h1>
        </div>
        <Button
          variant="primary"
          onClick={() => {
            if (projects.length > 0 && projects[0]) {
              setSelectedProjectId(projects[0].id);
            }
          }}
          disabled={projects.length === 0}
        >
          <Play className="h-4 w-4" />
          Start New Run
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Leaderboard */}
        <Panel className="lg:col-span-2">
          <PanelHeader title={<div className="flex items-center gap-2"><Trophy className="h-4 w-4 text-amber-400" />Leaderboard</div>} />
          <div className="p-4">
            {leaderboardQuery.isLoading ? (
              <div className="text-sm text-zinc-500">Loading leaderboard...</div>
            ) : leaderboard.length === 0 ? (
              <div className="text-sm text-zinc-500">No benchmark runs yet</div>
            ) : (
              <div className="space-y-2">
                {leaderboard.slice(0, 10).map((entry, idx) => (
                  <div
                    key={entry.runId}
                    className="flex items-center justify-between rounded-lg border border-zinc-700 bg-zinc-800/20 p-3 hover:bg-zinc-800/40 transition-colors cursor-pointer"
                    onClick={() => setSelectedRunId(entry.runId)}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                        idx === 0 ? "bg-amber-500/20 text-amber-400" :
                        idx === 1 ? "bg-zinc-400/20 text-zinc-300" :
                        idx === 2 ? "bg-orange-600/20 text-orange-400" :
                        "bg-zinc-700 text-zinc-400"
                      }`}>
                        {idx + 1}
                      </div>
                      <div>
                        <div className="text-sm font-medium truncate">Run {entry.runId.slice(0, 8)}</div>
                        <div className="text-xs text-zinc-400">{entry.summary || "No summary"}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="text-sm font-mono font-bold text-emerald-400">{entry.totalScore.toFixed(1)}</div>
                        <div className="text-xs text-zinc-500">Score</div>
                      </div>
                      {entry.pass ? (
                        <CheckCircle className="h-5 w-5 text-emerald-400" />
                      ) : (
                        <XCircle className="h-5 w-5 text-rose-400" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Panel>

        {/* Recent Runs */}
        <Panel>
          <PanelHeader title={<div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-cyan-400" />Active Runs</div>} />
          <div className="p-4 space-y-2">
            {run ? (
              <div className="rounded-lg border border-zinc-700 bg-zinc-800/20 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Current Run</span>
                  <Badge
                    variant={
                      run.status === "completed" ? "success" :
                      run.status === "running" ? "default" :
                      run.status === "failed" ? "destructive" : "default"
                    }
                  >
                    {run.status}
                  </Badge>
                </div>
                <div className="text-xs text-zinc-400 space-y-1">
                  <div>Mode: {run.mode}</div>
                  <div>Provider: {run.providerRole}</div>
                  {scorecard && (
                    <div className="mt-2 pt-2 border-t border-zinc-700">
                      <div className="font-mono font-bold text-emerald-400">
                        Score: {scorecard.totalScore.toFixed(1)}
                      </div>
                    </div>
                  )}
                </div>
                {run.status === "running" && (
                  <Button
                    className="mt-3 w-full"
                    variant="subtle"
                    onClick={() => executeTaskMutation.mutate(run.id)}
                    disabled={executeTaskMutation.isPending}
                  >
                    Execute Task
                  </Button>
                )}
                {run.status === "completed" && (
                  <Button
                    className="mt-3 w-full"
                    variant="subtle"
                    onClick={() => recomputeScoreMutation.mutate(run.id)}
                    disabled={recomputeScoreMutation.isPending}
                  >
                    Recompute Score
                  </Button>
                )}
              </div>
            ) : (
              <div className="text-sm text-zinc-500">No active run</div>
            )}
          </div>
        </Panel>
      </div>

      {/* Projects */}
      <Panel>
        <PanelHeader title={<div className="flex items-center gap-2"><Target className="h-4 w-4 text-purple-400" />Benchmark Projects</div>} />
        <div className="p-4">
          {projectsQuery.isLoading ? (
            <div className="text-sm text-zinc-500">Loading projects...</div>
          ) : projects.length === 0 ? (
            <div className="text-sm text-zinc-500">No benchmark projects configured</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {projects.map((proj) => (
                <div
                  key={proj.id}
                  className="rounded-lg border border-zinc-700 bg-zinc-800/20 p-4 hover:bg-zinc-800/40 transition-colors cursor-pointer"
                  onClick={() => setSelectedProjectId(proj.id)}
                >
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="text-sm font-semibold text-white">{proj.displayName}</h3>
                    <Badge className="text-xs">
                      {proj.languages.join(", ")}
                    </Badge>
                  </div>
                  <div className="text-xs text-zinc-400 space-y-1">
                    <div>Source: {proj.sourceKind}</div>
                    <div>Provider: {proj.defaultProviderRole}</div>
                    <div>Budget: {proj.timeBudgetSec}s</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Panel>

      {/* Selected Project Tasks */}
      {selectedProjectId && project && (
        <Panel>
          <PanelHeader title={`Tasks - ${project.displayName}`}>
            <Button variant="subtle" onClick={() => setSelectedProjectId(null)}>
              Close
            </Button>
          </PanelHeader>
          <div className="p-4 space-y-2">
            {tasks.length === 0 ? (
              <div className="text-sm text-zinc-500">No tasks found</div>
            ) : (
              tasks.map((task) => (
                <div
                  key={task.id}
                  className="rounded-lg border border-zinc-700 bg-zinc-800/20 p-3"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <h4 className="text-sm font-medium text-white">{task.title}</h4>
                      <p className="text-xs text-zinc-400 mt-1">{task.prompt.slice(0, 120)}...</p>
                    </div>
                    <div className="flex items-center gap-2 ml-3">
                      <Badge className={`text-xs ${DIFFICULTY_COLORS[task.category as DifficultyBadge] || "bg-zinc-700 text-zinc-400"}`}>
                        {task.category}
                      </Badge>
                      <Button
                        variant="primary"
                        className="text-xs px-2 py-1"
                        onClick={() => startRunMutation.mutate({ projectId: project.id, taskId: task.id })}
                        disabled={startRunMutation.isPending}
                      >
                        <Play className="h-3 w-3" />
                        Run
                      </Button>
                    </div>
                  </div>
                  <div className="text-xs text-zinc-500 space-y-1">
                    <div>Artifacts: {task.expectedArtifacts.join(", ")}</div>
                    <div>Checks: {task.requiredChecks.join(", ")}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </Panel>
      )}

      {/* Failures */}
      <Panel>
        <PanelHeader title={<div className="flex items-center gap-2"><AlertCircle className="h-4 w-4 text-rose-400" />Recent Failures</div>}>
          <button
            onClick={() => setExpandedFailures(!expandedFailures)}
            className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-300"
          >
            {expandedFailures ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            {expandedFailures ? "Collapse" : "Expand"}
          </button>
        </PanelHeader>
        {expandedFailures && (
          <div className="p-4">
            {failuresQuery.isLoading ? (
              <div className="text-sm text-zinc-500">Loading failures...</div>
            ) : failures.length === 0 ? (
              <div className="text-sm text-zinc-500">No recent failures</div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {failures.slice(0, 20).map((failure) => (
                  <div
                    key={failure.runId}
                    className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 cursor-pointer hover:bg-rose-500/10 transition-colors"
                    onClick={() => setSelectedRunId(failure.runId)}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <div className="text-sm font-medium text-white">Run {failure.runId.slice(0, 8)}</div>
                        <div className="text-xs text-zinc-400 mt-1">{failure.summary}</div>
                      </div>
                      <div className="text-sm font-mono text-rose-400">{failure.totalScore.toFixed(1)}</div>
                    </div>
                    {failure.hardFailures.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-rose-500/20">
                        <div className="text-xs text-rose-300">Hard failures:</div>
                        <ul className="text-xs text-rose-400 mt-1 space-y-0.5">
                          {failure.hardFailures.map((fail, idx) => (
                            <li key={idx}>• {fail}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}
