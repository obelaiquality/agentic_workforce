import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getMergeReportV3,
  getRunReplayV2,
  getRunSummaryV3,
  getShareReportV5,
  getRetrievalTraceV3,
  getVerificationV5,
  listAgentLanesV3,
  listAuditEvents,
  listQuotaStatus,
  listRunAttemptsV5,
  listRecentCommandsV2,
} from "../../lib/apiClient";
import { Chip, Panel, PanelHeader } from "../UI";
import { formatDistanceToNow } from "date-fns";
import { useUiStore } from "../../store/uiStore";

export function RunsView() {
  const selectedRunId = useUiStore((state) => state.selectedRunId);
  const setSelectedRunId = useUiStore((state) => state.setSelectedRunId);
  const labsMode = useUiStore((state) => state.labsMode);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const auditQuery = useQuery({
    queryKey: ["audit-events"],
    queryFn: listAuditEvents,
    refetchInterval: 5000,
  });

  const quotaQuery = useQuery({
    queryKey: ["quota-status"],
    queryFn: listQuotaStatus,
    refetchInterval: 5000,
    enabled: labsMode || showAdvanced,
  });

  const commandsQuery = useQuery({
    queryKey: ["commands-v2"],
    queryFn: () => listRecentCommandsV2(120),
    refetchInterval: 5000,
  });

  const replayQuery = useQuery({
    queryKey: ["run-replay-v2", selectedRunId],
    enabled: Boolean(selectedRunId) && (labsMode || showAdvanced),
    queryFn: () => getRunReplayV2(selectedRunId),
    refetchInterval: 7000,
  });

  const runSummaryQuery = useQuery({
    queryKey: ["run-summary-v3", selectedRunId],
    enabled: Boolean(selectedRunId),
    queryFn: () => getRunSummaryV3(selectedRunId as string),
    refetchInterval: 7000,
  });

  const lanesQuery = useQuery({
    queryKey: ["agent-lanes-v3", selectedRunId],
    enabled: Boolean(selectedRunId) && (labsMode || showAdvanced),
    queryFn: () => listAgentLanesV3({ runId: selectedRunId }),
    refetchInterval: 7000,
  });

  const mergeReportQuery = useQuery({
    queryKey: ["merge-report-v3", selectedRunId],
    enabled: Boolean(selectedRunId),
    queryFn: () => getMergeReportV3(selectedRunId),
    refetchInterval: 7000,
  });

  const retrievalTraceQuery = useQuery({
    queryKey: ["retrieval-trace-v3", selectedRunId],
    enabled: Boolean(selectedRunId) && (labsMode || showAdvanced),
    queryFn: () => getRetrievalTraceV3(selectedRunId),
    refetchInterval: 7000,
  });

  const attemptsQuery = useQuery({
    queryKey: ["run-attempts-v5", selectedRunId],
    enabled: Boolean(selectedRunId),
    queryFn: () => listRunAttemptsV5(selectedRunId as string),
    refetchInterval: 7000,
  });

  const verificationQuery = useQuery({
    queryKey: ["run-verification-v5", selectedRunId],
    enabled: Boolean(selectedRunId),
    queryFn: () => getVerificationV5(selectedRunId as string),
    refetchInterval: 7000,
  });

  const shareReportQuery = useQuery({
    queryKey: ["run-share-v5", selectedRunId],
    enabled: Boolean(selectedRunId),
    queryFn: () => getShareReportV5(selectedRunId as string),
    refetchInterval: 7000,
  });

  const recentRunIds = useMemo(() => {
    const ids = new Set<string>();
    for (const row of commandsQuery.data?.items ?? []) {
      const runId = typeof row.result?.run_id === "string" ? row.result.run_id : null;
      if (runId) {
        ids.add(runId);
      }
    }
    return Array.from(ids);
  }, [commandsQuery.data?.items]);

  useEffect(() => {
    if (!selectedRunId && recentRunIds.length) {
      setSelectedRunId(recentRunIds[0]);
      return;
    }
    if (selectedRunId && recentRunIds.length && !recentRunIds.includes(selectedRunId)) {
      setSelectedRunId(recentRunIds[0]);
    }
  }, [recentRunIds, selectedRunId, setSelectedRunId]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] gap-4 min-h-[780px]">
      <Panel>
        <PanelHeader title="Run Browser">
          <Chip variant="subtle">{recentRunIds.length}</Chip>
        </PanelHeader>
        <div className="p-4 space-y-4">
          <select
            value={selectedRunId ?? ""}
            onChange={(event) => setSelectedRunId(event.target.value)}
            className="w-full bg-zinc-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-zinc-200"
          >
            <option value="">Select run</option>
            {recentRunIds.map((runId) => (
              <option key={runId} value={runId}>
                {runId}
              </option>
            ))}
          </select>

          {runSummaryQuery.data?.item ? (
            <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-4">
              <div className="text-[11px] uppercase tracking-[0.24em] text-cyan-200/80">Current run</div>
              <div className="text-base text-white font-medium mt-2">{runSummaryQuery.data.item.status}</div>
              <div className="text-xs text-cyan-100/70 mt-2">{runSummaryQuery.data.item.providerId ?? "n/a"} · {runSummaryQuery.data.item.modelRole ?? "n/a"}</div>
              <div className="text-xs text-cyan-100/60 mt-1">{runSummaryQuery.data.item.executionMode ?? "n/a"} · {runSummaryQuery.data.item.verificationDepth ?? "n/a"}</div>
            </div>
          ) : (
            <div className="text-xs text-zinc-600">Select a run to inspect the outcome.</div>
          )}

          {verificationQuery.data?.item ? (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4">
              <div className="text-[11px] uppercase tracking-[0.24em] text-emerald-200/80">Verification</div>
              <div className="text-base text-white font-medium mt-2">{verificationQuery.data.item.pass ? "Passed" : "Failed"}</div>
              <div className="text-xs text-emerald-100/70 mt-2">tests: {verificationQuery.data.item.impactedTests.length}</div>
              <div className="text-xs text-emerald-100/60 mt-1">docs checked: {verificationQuery.data.item.docsChecked.length}</div>
            </div>
          ) : null}

          {shareReportQuery.data?.item ? (
            <div className="rounded-xl border border-white/10 bg-zinc-900/50 p-4">
              <div className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Shareable summary</div>
              <div className="text-sm text-zinc-300 mt-2 whitespace-pre-wrap">{shareReportQuery.data.item.summary}</div>
            </div>
          ) : null}

          <button
            onClick={() => setShowAdvanced((current) => !current)}
            className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-300"
          >
            {showAdvanced ? "Hide advanced" : "Show advanced details"}
          </button>

          {(labsMode || showAdvanced) && quotaQuery.data?.items?.length ? (
            <div className="rounded-xl border border-white/10 bg-zinc-900/50 p-4 space-y-2">
              <div className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Provider state</div>
              {quotaQuery.data.items.map((item) => (
                <div key={item.id} className="text-xs text-zinc-400">
                  {item.label}: {item.state}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Outcome + Evidence">
          <div className="flex items-center gap-2">
            {mergeReportQuery.data?.item ? <Chip variant="subtle">merge ready</Chip> : null}
            {attemptsQuery.data?.items?.length ? <Chip variant="subtle">{attemptsQuery.data.items.length} attempts</Chip> : null}
          </div>
        </PanelHeader>
        <div className="p-4 space-y-4 max-h-[780px] overflow-y-auto custom-scrollbar">
          {attemptsQuery.data?.items?.length ? (
            <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <div className="text-sm text-white font-medium">Execution attempts</div>
              <div className="mt-3 space-y-2">
                {attemptsQuery.data.items.map((attempt) => (
                  <article key={attempt.id} className="rounded-lg border border-white/8 bg-zinc-950/60 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm text-zinc-100">{attempt.status}</div>
                      <Chip variant="subtle">{attempt.providerId}</Chip>
                    </div>
                    <div className="text-xs text-zinc-500 mt-1">{attempt.modelRole} · {attempt.changedFiles.join(", ") || "no changed files recorded"}</div>
                    <div className="text-xs text-zinc-400 mt-2">{attempt.patchSummary || attempt.objective}</div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {mergeReportQuery.data?.item ? (
            <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <div className="text-sm text-white font-medium">Merge readiness</div>
              <div className="text-xs text-zinc-500 mt-2">outcome: {mergeReportQuery.data.item.outcome}</div>
              <div className="text-xs text-zinc-500 mt-1">overlap: {(mergeReportQuery.data.item.overlapScore * 100).toFixed(0)}%</div>
              <div className="text-xs text-zinc-400 mt-2">files: {mergeReportQuery.data.item.changedFiles.join(", ") || "n/a"}</div>
            </section>
          ) : null}

          {(labsMode || showAdvanced) && lanesQuery.data?.items?.length ? (
            <section className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4">
              <div className="text-sm text-amber-100 font-medium">Lane details</div>
              <div className="mt-3 space-y-2">
                {lanesQuery.data.items.map((lane) => (
                  <div key={lane.id} className="text-xs text-amber-50/80">
                    {lane.role} · {lane.state} · {lane.worktreePath}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {(labsMode || showAdvanced) && retrievalTraceQuery.data?.items?.length ? (
            <section className="rounded-xl border border-white/10 bg-zinc-900/50 p-4">
              <div className="text-sm text-white font-medium">Retrieval trace</div>
              <div className="mt-3 space-y-2">
                {retrievalTraceQuery.data.items.slice(0, 5).map((trace) => (
                  <div key={trace.id} className="text-xs text-zinc-400">
                    {trace.query} · {trace.results.length} hits
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {(labsMode || showAdvanced) && replayQuery.data?.items?.length ? (
            <section className="rounded-xl border border-white/10 bg-zinc-900/50 p-4">
              <div className="text-sm text-white font-medium">Replay timeline</div>
              <div className="mt-3 space-y-2">
                {replayQuery.data.items.slice(0, 12).map((event) => (
                  <article key={event.event_id} className="rounded-lg border border-white/8 bg-zinc-950/60 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs text-zinc-200">{event.type}</div>
                      <div className="text-[10px] text-zinc-500">{new Date(event.timestamp).toLocaleString()}</div>
                    </div>
                    <div className="text-[10px] text-zinc-500 mt-1">aggregate: {event.aggregate_id}</div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {(labsMode || showAdvanced) && auditQuery.data?.items?.length ? (
            <section className="rounded-xl border border-white/10 bg-zinc-900/50 p-4">
              <div className="text-sm text-white font-medium">Audit events</div>
              <div className="mt-3 space-y-2">
                {auditQuery.data.items.slice(0, 8).map((event) => (
                  <article key={event.id} className="rounded-lg border border-white/8 bg-zinc-950/60 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs text-zinc-200">{event.eventType}</div>
                      <div className="text-[10px] text-zinc-500">{formatDistanceToNow(new Date(event.createdAt), { addSuffix: true })}</div>
                    </div>
                    <div className="text-[10px] text-zinc-500 mt-1">actor: {event.actor}</div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}
