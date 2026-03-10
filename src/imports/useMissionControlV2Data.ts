"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  GuidanceScope,
  MissionChangeBrief,
  MissionOutcomeBrief,
  MissionProgress,
  MissionRecommendation,
  MissionRunPhase,
  MissionSnapshot,
  MissionStream,
  MissionSynthesizer,
  MissionTimelineEvent,
  MissionTimelineResponse,
  OperatorActionRequest,
  TaskSpotlight,
} from "@/types/mission-control";
import {
  hasKnownValue,
  modelOptions,
  normalizeProvider,
  normalizedOrEmpty,
  preferredModel,
} from "./modelCatalog";
import { buildChangeBrief, extractRecentChangeTaskIds } from "./missionChangeBriefs";
import { fetchJsonSafe, type SafeApiError, type SafeApiSuccess } from "./missionApi";
import { pollDelayMillis, shouldFetchGuidance, shouldFetchTimeline } from "./missionPolling";

export type MissionLiveState = "loading" | "live" | "degraded" | "disconnected" | "recovering";

export interface RunConfigState {
  provider: string;
  model: string;
  custom_model_override: string;
  task_source: string;
  objective: string;
  parallel_workers: number;
  max_tasks_per_batch: number;
  max_iterations: number;
  command_timeout_seconds: number;
  worker_timeout_seconds: number;
  dry_run: boolean;
  skip_verification: boolean;
  qwen_cli_yolo: boolean;
  copy_fallback_on_worktree_failure: boolean;
  use_codebase_graphrag: boolean;
  graphrag_top_k: number;
}

interface GuidanceState {
  updated_at: string;
  global: Array<Record<string, unknown>>;
  workstream: Record<string, Array<Record<string, unknown>>>;
  task: Record<string, Array<Record<string, unknown>>>;
  retry_once: Record<string, Array<Record<string, unknown>>>;
}

interface MissionActionResponse {
  ok?: boolean;
  action?: string;
  result?: Record<string, unknown>;
  error?: string;
  detail?: string;
}

interface RefreshOptions {
  manual?: boolean;
  force?: boolean;
}

export interface MissionSnapshotV2 extends MissionSnapshot {
  run: MissionSnapshot["run"] & {
    run_id: string | null;
    phase: MissionRunPhase;
    ended_at: string | null;
    outcome?: "completed" | "stopped" | "error" | null;
    terminal_reason?: string | null;
    duration_seconds?: number | null;
  };
  progress: MissionProgress;
  streams: MissionStream[];
  synthesizer: MissionSynthesizer;
  outcome_brief: MissionOutcomeBrief;
}

const EMPTY_PROGRESS: MissionProgress = {
  total_known: 0,
  completion_ratio: 0,
  queued: 0,
  in_progress: 0,
  blocked: 0,
  failed: 0,
  completed: 0,
};

const EMPTY_SYNTHESIZER: MissionSynthesizer = {
  status: "ok",
  summary: "System is stable. Monitoring mission activity.",
  intervention_required: false,
  reason: "stable",
  repeated_failure: null,
  recommendations: [],
};

const EMPTY_OUTCOME: MissionOutcomeBrief = {
  last_completed_at: null,
  completed_delta: 0,
  failed_delta: 0,
  top_failures: [],
  latest_artifact_path: null,
};

const EMPTY_GUIDANCE_STATE: GuidanceState = {
  updated_at: "",
  global: [],
  workstream: {},
  task: {},
  retry_once: {},
};

const DEFAULT_SNAPSHOT_V2: MissionSnapshotV2 = {
  timestamp: "",
  run: {
    running: false,
    pid: null,
    started_at: null,
    run_id: null,
    phase: "idle",
    ended_at: null,
    outcome: null,
    terminal_reason: null,
    duration_seconds: null,
    provider: "qwen",
    model: "coder-model",
    qwen_subprocesses: 0,
    worktree_count: 0,
    reservation_count: 0,
    disk: {},
    queue_health: "idle",
  },
  counters: {
    queued: 0,
    in_progress: 0,
    blocked: 0,
    failed: 0,
    completed: 0,
    iterations: 0,
    completed_runtime: 0,
    failed_runtime: 0,
  },
  board: {
    Queued: [],
    "In Progress": [],
    Blocked: [],
    Failed: [],
    Completed: [],
  },
  spotlight_default: { task_id: "" },
  planner: { items: [] },
  failure_summary: [],
  progress: EMPTY_PROGRESS,
  streams: [],
  synthesizer: EMPTY_SYNTHESIZER,
  outcome_brief: EMPTY_OUTCOME,
};

function normalizeSnapshotV2(snapshot: MissionSnapshot): MissionSnapshotV2 {
  const runPhaseRaw = snapshot.run.phase;
  const runPhase: MissionRunPhase =
    runPhaseRaw === "starting" ||
    runPhaseRaw === "single_task_validation" ||
    runPhaseRaw === "parallel_running" ||
    runPhaseRaw === "draining" ||
    runPhaseRaw === "completed" ||
    runPhaseRaw === "stopped" ||
    runPhaseRaw === "error" ||
    runPhaseRaw === "idle"
      ? runPhaseRaw
      : "idle";

  return {
    ...DEFAULT_SNAPSHOT_V2,
    ...snapshot,
    run: {
      ...DEFAULT_SNAPSHOT_V2.run,
      ...snapshot.run,
      run_id: snapshot.run.run_id ?? null,
      phase: runPhase,
      ended_at: snapshot.run.ended_at ?? null,
      outcome: snapshot.run.outcome ?? null,
      terminal_reason: snapshot.run.terminal_reason ?? null,
      duration_seconds: snapshot.run.duration_seconds ?? null,
    },
    progress:
      snapshot.progress ??
      {
        ...EMPTY_PROGRESS,
        queued: snapshot.counters.queued,
        in_progress: snapshot.counters.in_progress,
        blocked: snapshot.counters.blocked,
        failed: snapshot.counters.failed,
        completed: snapshot.counters.completed,
        total_known:
          snapshot.counters.queued +
          snapshot.counters.in_progress +
          snapshot.counters.blocked +
          snapshot.counters.failed +
          snapshot.counters.completed,
        completion_ratio:
          snapshot.counters.completed > 0
            ? snapshot.counters.completed /
              Math.max(
                1,
                snapshot.counters.queued +
                  snapshot.counters.in_progress +
                  snapshot.counters.blocked +
                  snapshot.counters.failed +
                  snapshot.counters.completed
              )
            : 0,
      },
    streams: snapshot.streams ?? [],
    synthesizer: snapshot.synthesizer ?? EMPTY_SYNTHESIZER,
    outcome_brief: snapshot.outcome_brief ?? EMPTY_OUTCOME,
  };
}

function taskExists(snapshot: MissionSnapshotV2, taskId: string): boolean {
  const columns = ["Queued", "In Progress", "Blocked", "Failed", "Completed"] as const;
  return columns.some((column) => snapshot.board[column].some((task) => task.task_id === taskId));
}

function isQwenCliProvider(provider: string): boolean {
  const normalized = normalizeProvider(provider);
  return normalized === "qwen-cli";
}

function runConfigFromSnapshot(current: RunConfigState, snapshot: MissionSnapshotV2): RunConfigState {
  const incomingProvider = hasKnownValue(snapshot.run.provider)
    ? normalizeProvider(snapshot.run.provider)
    : current.provider;
  const incomingModel = hasKnownValue(snapshot.run.model) ? normalizedOrEmpty(snapshot.run.model) : current.model;
  const currentOverride = normalizedOrEmpty(current.custom_model_override);
  const fallbackProvider = incomingProvider || current.provider || "qwen";
  const fallbackModel = incomingModel || current.model || preferredModel(fallbackProvider);

  const merged: RunConfigState = {
    ...current,
    provider: fallbackProvider,
    model: fallbackModel,
    custom_model_override: currentOverride || fallbackModel,
    qwen_cli_yolo: isQwenCliProvider(fallbackProvider) ? current.qwen_cli_yolo : false,
  };

  if (!snapshot.run.running) {
    return {
      ...merged,
      provider: hasKnownValue(current.provider) ? current.provider : merged.provider,
      model: hasKnownValue(current.model) ? current.model : merged.model,
    };
  }

  return merged;
}

function withRefreshToken(url: string, refreshToken: string): string {
  return refreshToken ? `${url}${url.includes("?") ? "&" : "?"}_ts=${refreshToken}` : url;
}

function dedupeBriefs(briefs: MissionChangeBrief[]): MissionChangeBrief[] {
  const unique = new Map<string, MissionChangeBrief>();
  for (const brief of briefs) {
    unique.set(brief.task_id, brief);
  }
  return Array.from(unique.values());
}

export function useMissionControlV2Data() {
  const [snapshot, setSnapshot] = useState<MissionSnapshotV2>(DEFAULT_SNAPSHOT_V2);
  const [timeline, setTimeline] = useState<MissionTimelineEvent[]>([]);
  const [changeBriefs, setChangeBriefs] = useState<MissionChangeBrief[]>([]);
  const [guidanceState, setGuidanceState] = useState<GuidanceState | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string>("");
  const [spotlight, setSpotlight] = useState<TaskSpotlight | null>(null);
  const [liveState, setLiveState] = useState<MissionLiveState>("loading");
  const [error, setError] = useState<string>("");
  const [actionMessage, setActionMessage] = useState<string>("");
  const [isActing, setIsActing] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string>("");
  const [runConfig, setRunConfig] = useState<RunConfigState>({
    provider: "qwen",
    model: "coder-model",
    custom_model_override: "coder-model",
    task_source: "auto",
    objective: "",
    parallel_workers: 3,
    max_tasks_per_batch: 3,
    max_iterations: 3,
    command_timeout_seconds: 300,
    worker_timeout_seconds: 900,
    dry_run: true,
    skip_verification: false,
    qwen_cli_yolo: false,
    copy_fallback_on_worktree_failure: false,
    use_codebase_graphrag: true,
    graphrag_top_k: 6,
  });

  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const failureCountRef = useRef(0);
  const selectedTaskRef = useRef("");
  const snapshotRef = useRef(snapshot);
  const timelineRef = useRef<MissionTimelineEvent[]>(timeline);
  const guidanceRef = useRef<GuidanceState | null>(guidanceState);
  const refreshCountRef = useRef(0);
  const inflightRefreshRef = useRef(0);
  const briefCacheRef = useRef<Map<string, MissionChangeBrief>>(new Map());

  useEffect(() => {
    selectedTaskRef.current = selectedTaskId;
  }, [selectedTaskId]);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    timelineRef.current = timeline;
  }, [timeline]);

  useEffect(() => {
    guidanceRef.current = guidanceState;
  }, [guidanceState]);

  const resolveModelOptions = useMemo(() => {
    const known = modelOptions(runConfig.provider);
    if (!known.length) {
      return [runConfig.model || preferredModel(runConfig.provider)];
    }
    if (runConfig.model && !known.includes(runConfig.model)) {
      return [runConfig.model, ...known];
    }
    return known;
  }, [runConfig.model, runConfig.provider]);

  const refreshAll = useCallback(
    async (options: RefreshOptions = {}) => {
      const manualRefresh = Boolean(options.manual || options.force);
      const refreshToken = options.force ? Date.now().toString() : "";

      requestIdRef.current += 1;
      const requestId = requestIdRef.current;
      refreshCountRef.current += 1;
      inflightRefreshRef.current += 1;
      setIsRefreshing(true);

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const runIsActive = snapshotRef.current.run.running;
      const fetchTimelineNow = shouldFetchTimeline(runIsActive, refreshCountRef.current, manualRefresh);
      const fetchGuidanceNow = shouldFetchGuidance(runIsActive, refreshCountRef.current, manualRefresh);

      try {
        if (liveState === "disconnected") {
          setLiveState("recovering");
        }

        const timelineFallback: SafeApiSuccess<MissionTimelineResponse> = {
          ok: true,
          status: 200,
          data: {
            items: timelineRef.current,
            next_cursor: "",
            total: timelineRef.current.length,
            run_id: snapshotRef.current.run.run_id,
          },
        };

        const guidanceFallback: SafeApiSuccess<GuidanceState> = {
          ok: true,
          status: 200,
          data: guidanceRef.current ?? EMPTY_GUIDANCE_STATE,
        };

        const [snapshotResult, timelineResult, guidanceResult] = await Promise.all([
          fetchJsonSafe<MissionSnapshot>(withRefreshToken("/api/mission-control/snapshot?view=v2", refreshToken), {
            signal: controller.signal,
          }),
          fetchTimelineNow
            ? fetchJsonSafe<MissionTimelineResponse>(withRefreshToken("/api/mission-control/timeline?limit=160", refreshToken), {
                signal: controller.signal,
              })
            : Promise.resolve(timelineFallback),
          fetchGuidanceNow
            ? fetchJsonSafe<GuidanceState>(withRefreshToken("/api/mission-control/guidance", refreshToken), {
                signal: controller.signal,
              })
            : Promise.resolve(guidanceFallback),
        ]);

        if (requestId !== requestIdRef.current) {
          return;
        }

        if (!snapshotResult.ok) {
          if (snapshotResult.error.status !== 499) {
            failureCountRef.current += 1;
            setError(snapshotResult.error.message);
            setLiveState(failureCountRef.current >= 2 ? "disconnected" : "degraded");
          }
          return;
        }

        const normalizedSnapshot = normalizeSnapshotV2(snapshotResult.data);
        const preferredTask =
          selectedTaskRef.current && taskExists(normalizedSnapshot, selectedTaskRef.current)
            ? selectedTaskRef.current
            : normalizedSnapshot.spotlight_default.task_id || selectedTaskRef.current;

        const taskResult = preferredTask
          ? await fetchJsonSafe<TaskSpotlight>(
              withRefreshToken(`/api/mission-control/task?task_id=${encodeURIComponent(preferredTask)}`, refreshToken),
              {
                signal: controller.signal,
              }
            )
          : ({ ok: true, data: null, status: 200 } as SafeApiSuccess<null>);

        if (requestId !== requestIdRef.current) {
          return;
        }

        const partialFailures: SafeApiError[] = [];
        setSnapshot(normalizedSnapshot);
        setRunConfig((previous) => runConfigFromSnapshot(previous, normalizedSnapshot));
        setLastUpdatedAt(normalizedSnapshot.timestamp || new Date().toISOString());

        if (preferredTask !== selectedTaskRef.current) {
          setSelectedTaskId(preferredTask);
        }

        if (taskResult.ok) {
          setSpotlight(taskResult.data as TaskSpotlight | null);
        } else if (taskResult.error.status !== 499) {
          setSpotlight(null);
          partialFailures.push(taskResult.error);
        }

        const timelineItems = timelineResult.ok ? timelineResult.data.items ?? [] : timelineRef.current;
        const recentTaskIds = extractRecentChangeTaskIds(timelineItems, 3);
        const candidateTaskIds = Array.from(new Set([preferredTask, ...recentTaskIds].filter(Boolean))).slice(0, 3);

        const shouldRefetchBriefs = manualRefresh || fetchTimelineNow || normalizedSnapshot.run.running;

        const nextBriefs: MissionChangeBrief[] = [];
        if (preferredTask && taskResult.ok && taskResult.data) {
          const preferredBrief = buildChangeBrief(taskResult.data);
          if (preferredBrief) {
            nextBriefs.push(preferredBrief);
            briefCacheRef.current.set(preferredBrief.task_id, preferredBrief);
          }
        }

        const secondaryTaskIds = candidateTaskIds.filter((taskId) => taskId !== preferredTask);
        const secondaryResults = await Promise.all(
          secondaryTaskIds.map(async (taskId) => {
            const cached = briefCacheRef.current.get(taskId);
            if (!shouldRefetchBriefs && cached) {
              return { taskId, brief: cached };
            }
            const detailResult = await fetchJsonSafe<TaskSpotlight>(
              withRefreshToken(`/api/mission-control/task?task_id=${encodeURIComponent(taskId)}`, refreshToken),
              {
                signal: controller.signal,
              }
            );
            if (!detailResult.ok) {
              return { taskId, error: detailResult.error };
            }
            const brief = buildChangeBrief(detailResult.data);
            if (!brief) {
              return { taskId };
            }
            return { taskId, brief };
          })
        );

        for (const entry of secondaryResults) {
          if (entry.error) {
            if (entry.error.status !== 499) {
              partialFailures.push(entry.error);
            }
            continue;
          }
          if (!entry.brief) {
            continue;
          }
          nextBriefs.push(entry.brief);
          briefCacheRef.current.set(entry.taskId, entry.brief);
        }

        if (nextBriefs.length === 0 && candidateTaskIds.length > 0) {
          for (const taskId of candidateTaskIds) {
            const cached = briefCacheRef.current.get(taskId);
            if (cached) {
              nextBriefs.push(cached);
            }
          }
        }

        setChangeBriefs(dedupeBriefs(nextBriefs));

        if (timelineResult.ok) {
          setTimeline(timelineItems);
        } else if (timelineResult.error.status !== 499) {
          partialFailures.push(timelineResult.error);
        }

        if (guidanceResult.ok) {
          setGuidanceState(guidanceResult.data);
        } else if (guidanceResult.error.status !== 499) {
          partialFailures.push(guidanceResult.error);
        }

        const hadConsecutiveFailures = failureCountRef.current > 0;
        failureCountRef.current = 0;

        if (partialFailures.length > 0) {
          setLiveState("degraded");
          setError(`Partial data mode: ${partialFailures.map((entry) => entry.message).join(" | ")}`);
          return;
        }

        setError("");
        if (hadConsecutiveFailures) {
          setLiveState("recovering");
          window.setTimeout(() => {
            setLiveState((current) => (current === "recovering" ? "live" : current));
          }, 1200);
        } else {
          setLiveState("live");
        }

        if (options.manual) {
          setActionMessage("Manual refresh completed.");
        }
      } finally {
        inflightRefreshRef.current = Math.max(0, inflightRefreshRef.current - 1);
        if (inflightRefreshRef.current === 0) {
          setIsRefreshing(false);
        }
      }
    },
    [liveState]
  );

  useEffect(() => {
    let cancelled = false;
    let timeout: number | undefined;

    const loop = async () => {
      if (cancelled) {
        return;
      }
      await refreshAll();
      if (cancelled) {
        return;
      }

      const delay = pollDelayMillis(snapshotRef.current.run.running, failureCountRef.current);
      timeout = window.setTimeout(loop, delay);
    };

    timeout = window.setTimeout(loop, 0);

    return () => {
      cancelled = true;
      if (timeout) {
        window.clearTimeout(timeout);
      }
      abortRef.current?.abort();
    };
  }, [refreshAll]);

  const submitAction = useCallback(
    async (request: OperatorActionRequest): Promise<boolean> => {
      setIsActing(true);
      setActionMessage("");

      const result = await fetchJsonSafe<MissionActionResponse>("/api/mission-control/actions", {
        method: "POST",
        body: JSON.stringify(request),
      });

      if (!result.ok) {
        setError(result.error.message);
        setIsActing(false);
        return false;
      }

      if (result.data.error || result.data.detail) {
        setError(result.data.error || result.data.detail || "Mission action failed");
        setIsActing(false);
        return false;
      }

      setActionMessage(`Action '${request.action}' completed.`);
      await refreshAll({ force: true });
      setIsActing(false);
      return true;
    },
    [refreshAll]
  );

  const startRun = useCallback(async (): Promise<boolean> => {
    const model = normalizedOrEmpty(runConfig.custom_model_override) || runConfig.model;
    return submitAction({
      action: "start_run",
      run_config: {
        provider: runConfig.provider,
        model,
        task_source: runConfig.task_source,
        objective: runConfig.objective,
        parallel_workers: runConfig.parallel_workers,
        max_tasks_per_batch: runConfig.max_tasks_per_batch,
        max_iterations: runConfig.max_iterations,
        command_timeout_seconds: runConfig.command_timeout_seconds,
        worker_timeout_seconds: runConfig.worker_timeout_seconds,
        dry_run: runConfig.dry_run,
        skip_verification: runConfig.skip_verification,
        qwen_cli_yolo: isQwenCliProvider(runConfig.provider) ? runConfig.qwen_cli_yolo : false,
        copy_fallback_on_worktree_failure: runConfig.copy_fallback_on_worktree_failure,
        use_codebase_graphrag: runConfig.use_codebase_graphrag,
        graphrag_top_k: runConfig.graphrag_top_k,
      },
    });
  }, [runConfig, submitAction]);

  const stopRun = useCallback(async (): Promise<boolean> => {
    return submitAction({ action: "stop_run" });
  }, [submitAction]);

  const applyRecommendation = useCallback(
    async (recommendation: MissionRecommendation): Promise<boolean> => {
      if (!recommendation.task_id) {
        setError("Recommendation is not bound to a specific task.");
        return false;
      }
      return submitAction({
        action: "retry_with_guidance",
        task_id: recommendation.task_id,
        scope: recommendation.scope as GuidanceScope,
        guidance: recommendation.instruction,
      });
    },
    [submitAction]
  );

  const guidanceCount = useMemo(() => {
    const taskId = selectedTaskId;
    if (!guidanceState || !taskId) {
      return 0;
    }
    const taskCount = guidanceState.task?.[taskId]?.length ?? 0;
    const retryCount = guidanceState.retry_once?.[taskId]?.length ?? 0;
    return taskCount + retryCount + (guidanceState.global?.length ?? 0);
  }, [guidanceState, selectedTaskId]);

  return {
    snapshot,
    timeline,
    changeBriefs,
    guidanceState,
    selectedTaskId,
    setSelectedTaskId,
    spotlight,
    liveState,
    error,
    actionMessage,
    isActing,
    isRefreshing,
    lastUpdatedAt,
    runConfig,
    setRunConfig,
    resolveModelOptions,
    guidanceCount,
    refreshAll,
    startRun,
    stopRun,
    submitAction,
    applyRecommendation,
  };
}
