import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  executeBenchmarkRunV5,
  getBenchmarkFailuresV4,
  getBenchmarkLeaderboardV4,
  getBenchmarkRunV4,
  getBenchmarkScorecardV4,
  getBenchmarkProjectV4,
  listBenchmarkProjectsV4,
  recomputeBenchmarkScoreV4,
  startBenchmarkRunV4,
} from "../../lib/apiClient";
import { useUiStore } from "../../store/uiStore";
import { Chip, Panel, PanelHeader } from "../UI";
import { PlayCircle, RefreshCw, Trophy } from "lucide-react";

export function BenchmarksView() {
  const queryClient = useQueryClient();
  const selectedRepoId = useUiStore((state) => state.selectedRepoId);
  const selectedBenchmarkRunId = useUiStore((state) => state.selectedBenchmarkRunId);
  const setSelectedBenchmarkRunId = useUiStore((state) => state.setSelectedBenchmarkRunId);

  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [selectedTaskId, setSelectedTaskId] = useState<string>("");

  const projectsQuery = useQuery({
    queryKey: ["benchmark-projects-v4"],
    queryFn: listBenchmarkProjectsV4,
    refetchInterval: 30000,
  });

  useEffect(() => {
    if (!selectedProjectId && projectsQuery.data?.items?.length) {
      setSelectedProjectId(projectsQuery.data.items[0].id);
    }
  }, [projectsQuery.data?.items, selectedProjectId]);

  const projectDetailQuery = useQuery({
    queryKey: ["benchmark-project-v4", selectedProjectId],
    enabled: Boolean(selectedProjectId),
    queryFn: () => getBenchmarkProjectV4(selectedProjectId),
  });

  useEffect(() => {
    if (!selectedTaskId && projectDetailQuery.data?.tasks?.length) {
      setSelectedTaskId(projectDetailQuery.data.tasks[0].id);
    }
  }, [projectDetailQuery.data?.tasks, selectedTaskId]);

  const runQuery = useQuery({
    queryKey: ["benchmark-run-v4", selectedBenchmarkRunId],
    enabled: Boolean(selectedBenchmarkRunId),
    queryFn: () => getBenchmarkRunV4(selectedBenchmarkRunId as string),
    refetchInterval: 5000,
  });

  const scorecardQuery = useQuery({
    queryKey: ["benchmark-scorecard-v4", selectedBenchmarkRunId],
    enabled: Boolean(selectedBenchmarkRunId),
    queryFn: () => getBenchmarkScorecardV4(selectedBenchmarkRunId as string),
    refetchInterval: 5000,
  });

  const leaderboardQuery = useQuery({
    queryKey: ["benchmark-leaderboard-v4"],
    queryFn: getBenchmarkLeaderboardV4,
    refetchInterval: 10000,
  });

  const failuresQuery = useQuery({
    queryKey: ["benchmark-failures-v4"],
    queryFn: getBenchmarkFailuresV4,
    refetchInterval: 10000,
  });

  const startRunMutation = useMutation({
    mutationFn: () =>
      startBenchmarkRunV4({
        actor: "user",
        project_id: selectedProjectId,
        task_id: selectedTaskId,
        mode: "api_regression",
        repo_id: selectedRepoId || undefined,
      }),
    onSuccess: ({ run }) => {
      setSelectedBenchmarkRunId(run.id);
      queryClient.invalidateQueries({ queryKey: ["benchmark-run-v4", run.id] });
    },
  });

  const executeTaskMutation = useMutation({
    mutationFn: () => executeBenchmarkRunV5({ actor: "user", run_id: selectedBenchmarkRunId as string }),
    onSuccess: ({ run }) => {
      setSelectedBenchmarkRunId(run.id);
      queryClient.invalidateQueries({ queryKey: ["benchmark-run-v4", run.id] });
      queryClient.invalidateQueries({ queryKey: ["benchmark-scorecard-v4", run.id] });
      queryClient.invalidateQueries({ queryKey: ["benchmark-leaderboard-v4"] });
      queryClient.invalidateQueries({ queryKey: ["benchmark-failures-v4"] });
    },
  });

  const scoreRunMutation = useMutation({
    mutationFn: () => recomputeBenchmarkScoreV4({ actor: "user", run_id: selectedBenchmarkRunId as string }),
    onSuccess: ({ run }) => {
      queryClient.invalidateQueries({ queryKey: ["benchmark-run-v4", run.id] });
      queryClient.invalidateQueries({ queryKey: ["benchmark-scorecard-v4", run.id] });
      queryClient.invalidateQueries({ queryKey: ["benchmark-leaderboard-v4"] });
      queryClient.invalidateQueries({ queryKey: ["benchmark-failures-v4"] });
    },
  });

  const selectedTask = useMemo(() => {
    return projectDetailQuery.data?.tasks?.find((task) => task.id === selectedTaskId) || null;
  }, [projectDetailQuery.data?.tasks, selectedTaskId]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[380px_minmax(0,1fr)] gap-4">
      <div className="space-y-4">
        <Panel>
          <PanelHeader title="Benchmark Runner">
            <Chip variant="subtle">{selectedRepoId ? "repo-linked" : "repo-optional"}</Chip>
          </PanelHeader>
          <div className="p-3 space-y-2">
            <select
              value={selectedProjectId}
              onChange={(event) => {
                setSelectedProjectId(event.target.value);
                setSelectedTaskId("");
              }}
              className="w-full rounded-md border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-200"
            >
              {(projectsQuery.data?.items || []).map((project) => (
                <option key={project.id} value={project.id}>
                  {project.displayName}
                </option>
              ))}
            </select>
            <select
              value={selectedTaskId}
              onChange={(event) => setSelectedTaskId(event.target.value)}
              className="w-full rounded-md border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-200"
            >
              {(projectDetailQuery.data?.tasks || []).map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title}
                </option>
              ))}
            </select>
            <button
              onClick={() => startRunMutation.mutate()}
              disabled={!selectedProjectId || !selectedTaskId || startRunMutation.isPending}
              className="w-full rounded-md bg-cyan-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
            >
              Start Benchmark Run
            </button>
            <button
              onClick={() => executeTaskMutation.mutate()}
              disabled={!selectedBenchmarkRunId || executeTaskMutation.isPending}
              className="w-full rounded-md bg-emerald-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
            >
              Execute + Verify
            </button>
            <button
              onClick={() => scoreRunMutation.mutate()}
              disabled={!selectedBenchmarkRunId || scoreRunMutation.isPending}
              className="w-full rounded-md bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-100 disabled:opacity-50"
            >
              Recompute Scorecard
            </button>
          </div>
        </Panel>

        <Panel className="min-h-[340px]">
          <PanelHeader title="Selected Task">
            <Chip variant="subtle">{selectedTask?.category || "n/a"}</Chip>
          </PanelHeader>
          <div className="p-3 space-y-3 text-xs">
            <div className="text-zinc-200 whitespace-pre-wrap">{selectedTask?.prompt || "Select a task."}</div>
            <div className="text-zinc-400 uppercase tracking-wide">Required checks</div>
            <div className="flex flex-wrap gap-2">
              {(selectedTask?.requiredChecks || []).map((item) => (
                <Chip key={item} variant="subtle">
                  {item}
                </Chip>
              ))}
            </div>
            <div className="text-zinc-400 uppercase tracking-wide">Required docs</div>
            <div className="flex flex-wrap gap-2">
              {(selectedTask?.requiredDocs || []).map((item) => (
                <Chip key={item} variant="subtle">
                  {item}
                </Chip>
              ))}
            </div>
          </div>
        </Panel>
      </div>

      <div className="space-y-4">
        <Panel>
          <PanelHeader title="Run State">
            <div className="flex items-center gap-2">
              <PlayCircle className="h-4 w-4 text-emerald-300" />
              <span className="text-xs text-zinc-400">{runQuery.data?.run?.id || "No run selected"}</span>
            </div>
          </PanelHeader>
          <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="space-y-2">
              <div className="text-zinc-500 uppercase tracking-wide text-[11px]">Status</div>
              <div className="text-zinc-100">{runQuery.data?.run?.status || "n/a"}</div>
              <div className="text-zinc-500 uppercase tracking-wide text-[11px]">Worktree</div>
              <div className="text-zinc-100 break-all">{runQuery.data?.run?.worktreePath || "n/a"}</div>
            </div>
            <div className="space-y-2">
              <div className="text-zinc-500 uppercase tracking-wide text-[11px]">Chat Session</div>
              <div className="text-zinc-100">{runQuery.data?.run?.chatSessionId || "n/a"}</div>
              <div className="text-zinc-500 uppercase tracking-wide text-[11px]">Routing Decision</div>
              <div className="text-zinc-100">{runQuery.data?.run?.routingDecisionId || "n/a"}</div>
            </div>
          </div>
        </Panel>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Panel className="min-h-[320px]">
            <PanelHeader title="Scorecard">
              <button
                onClick={() => queryClient.invalidateQueries({ queryKey: ["benchmark-scorecard-v4", selectedBenchmarkRunId] })}
                className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-zinc-300"
              >
                <RefreshCw className="inline h-3 w-3 mr-1" /> Refresh
              </button>
            </PanelHeader>
            <div className="p-3 space-y-2 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded bg-zinc-950 p-2">total: {scorecardQuery.data?.item?.totalScore ?? "n/a"}</div>
                <div className="rounded bg-zinc-950 p-2">pass: {scorecardQuery.data?.item?.pass ? "true" : "false"}</div>
                <div className="rounded bg-zinc-950 p-2">functional: {scorecardQuery.data?.item?.functionalCorrectness ?? "n/a"}</div>
                <div className="rounded bg-zinc-950 p-2">guidelines: {scorecardQuery.data?.item?.guidelineAdherence ?? "n/a"}</div>
              </div>
              <div className="text-zinc-400 uppercase tracking-wide">Hard failures</div>
              {(scorecardQuery.data?.item?.hardFailures || []).map((item) => (
                <div key={item} className="rounded bg-rose-500/10 px-2 py-1 text-rose-200">
                  {item}
                </div>
              ))}
            </div>
          </Panel>

          <Panel className="min-h-[320px]">
            <PanelHeader title="Evidence">
              <Chip variant="subtle">{runQuery.data?.evidence?.length || 0}</Chip>
            </PanelHeader>
            <div className="p-3 space-y-2 text-xs">
              {(runQuery.data?.evidence || []).map((item) => (
                <div key={item.id} className="rounded bg-zinc-950 p-2">
                  <div className="text-zinc-200">{item.kind}</div>
                  <pre className="mt-1 whitespace-pre-wrap text-[11px] text-zinc-400">{JSON.stringify(item.payload, null, 2)}</pre>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Panel className="min-h-[260px]">
            <PanelHeader title="Leaderboard">
              <Trophy className="h-4 w-4 text-amber-300" />
            </PanelHeader>
            <div className="p-3 space-y-2 text-xs">
              {(leaderboardQuery.data?.items || []).slice(0, 10).map((item) => (
                <div key={item.runId} className="rounded bg-zinc-950 px-2 py-1 flex items-center justify-between gap-2">
                  <span className="truncate text-zinc-200">{item.runId}</span>
                  <span className="text-zinc-400">{item.totalScore.toFixed(1)}</span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel className="min-h-[260px]">
            <PanelHeader title="Recent Failures">
              <Chip variant="subtle">{failuresQuery.data?.items.length || 0}</Chip>
            </PanelHeader>
            <div className="p-3 space-y-2 text-xs">
              {(failuresQuery.data?.items || []).slice(0, 10).map((item) => (
                <button
                  key={item.runId}
                  onClick={() => setSelectedBenchmarkRunId(item.runId)}
                  className="w-full rounded bg-zinc-950 px-2 py-2 text-left hover:bg-white/5"
                >
                  <div className="text-zinc-200">{item.runId}</div>
                  <div className="text-zinc-500">{item.hardFailures.join(", ") || "score below threshold"}</div>
                </button>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
