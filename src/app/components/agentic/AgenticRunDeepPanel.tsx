/**
 * AgenticRunDeepPanel - Rich, expandable panel for agentic run visualization
 *
 * Replaces the shallow agentic run panel in CommandCenterView with comprehensive sections:
 * - Status header with status/phase chips and last reason
 * - Doom loop alert banner when detected
 * - Metrics grid (iterations, tool calls, approvals, escalations)
 * - Budget & tokens with SVG sparkline visualization
 * - Expandable tool calls with policy decisions and details
 * - Context compaction events with token savings
 * - Escalation history
 * - Thinking log (when available)
 * - Latest assistant output
 *
 * Usage:
 * ```tsx
 * import { AgenticRunDeepPanel } from "@/components/agentic";
 *
 * function YourComponent({ mission }) {
 *   if (!mission.agenticRun) return null;
 *   return <AgenticRunDeepPanel run={mission.agenticRun} />;
 * }
 * ```
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Activity,
  Zap,
  Shield,
  Brain,
  ArrowRightLeft,
  Layers,
  Sparkles,
  Webhook,
  BookOpen,
  RotateCcw,
  Clock,
  Wrench,
  GitMerge,
} from "lucide-react";
import type {
  AgenticRunSnapshot,
  AgenticToolCallRecord,
  AgenticCompactionRecord,
  AgenticEscalationRecord,
  AgenticDoomLoopRecord,
  AgenticSkillEventRecord,
  AgenticHookEventRecord,
  AgenticMemoryExtractionRecord,
  ToolResultDto,
  DomainEvent,
  ToolInvocationEvent,
} from "../../../shared/contracts";
import { cn } from "../UI";
import { resumeAgenticRun, getTaskTimelineV2, listRunToolEventsV9, getMergeReportV3 } from "../../lib/apiClient";

interface AgenticRunDeepPanelProps {
  run: AgenticRunSnapshot;
  ticketId?: string | null;
}

export function AgenticRunDeepPanel({ run, ticketId }: AgenticRunDeepPanelProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [resuming, setResuming] = useState(false);

  const { data: timelineData } = useQuery({
    queryKey: ["task-timeline", ticketId],
    queryFn: () => getTaskTimelineV2(ticketId!),
    enabled: !!ticketId,
    staleTime: 30_000,
  });

  const { data: toolEventsData } = useQuery({
    queryKey: ["run-tool-events", run.runId],
    queryFn: () => listRunToolEventsV9(run.runId),
    enabled: run.status !== "idle",
    staleTime: 15_000,
  });

  const { data: mergeReportData } = useQuery({
    queryKey: ["merge-report", run.runId],
    queryFn: () => getMergeReportV3(run.runId),
    enabled: run.status !== "idle",
    staleTime: 30_000,
  });

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  const handleMetricClick = (section: string) => {
    if (!expandedSections.has(section)) {
      toggleSection(section);
    }
  };

  const handleResume = async () => {
    setResuming(true);
    try {
      await resumeAgenticRun(run.runId);
    } catch (error) {
      console.error("Failed to resume run:", error);
    } finally {
      setResuming(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Status Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <StatusChip status={run.status} />
            <PhaseChip phase={run.phase} />
            {run.latestRole && (
              <div className="text-xs text-zinc-500 font-mono">
                {run.latestRole}
              </div>
            )}
          </div>
          {run.lastReason && (
            <div className="text-sm text-zinc-400 max-w-2xl">
              {run.lastReason}
            </div>
          )}
        </div>
        {(run.status === "failed" || run.status === "aborted") && run.resumable && (
          <button
            onClick={handleResume}
            disabled={resuming}
            className={cn(
              "rounded-lg border px-3 py-2 text-sm font-medium transition-colors flex items-center gap-2",
              resuming
                ? "border-zinc-700 bg-zinc-800 text-zinc-500 cursor-not-allowed"
                : "border-cyan-500/20 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/16 hover:border-cyan-500/30"
            )}
          >
            <RotateCcw className={cn("h-4 w-4", resuming && "animate-spin")} />
            {resuming ? "Resuming..." : "Resume"}
          </button>
        )}
      </div>

      {/* Plan */}
      {run.plan && run.plan.planContent && (
        <ExpandableSection
          title="Plan"
          icon={BookOpen}
          badge={run.plan.phase}
          expanded={expandedSections.has("plan")}
          onToggle={() => toggleSection("plan")}
        >
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
                run.plan.phase === "executing" ? "bg-emerald-500/15 text-emerald-300" :
                run.plan.phase === "plan_review" ? "bg-amber-500/15 text-amber-300" :
                run.plan.phase === "planning" ? "bg-cyan-500/15 text-cyan-300" :
                "bg-zinc-500/15 text-zinc-400"
              )}>
                {run.plan.phase}
              </span>
              {run.plan.approved && (
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-300">
                  Approved
                </span>
              )}
            </div>
            <pre className="whitespace-pre-wrap rounded-lg border border-white/6 bg-black/20 p-3 text-sm text-zinc-300 font-mono leading-relaxed">
              {run.plan.planContent}
            </pre>
            {run.plan.questions.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Questions</div>
                {run.plan.questions.map((q) => (
                  <div key={q.id} className="rounded-lg border border-white/6 bg-black/10 p-2">
                    <div className="text-sm text-zinc-300">{q.question}</div>
                    {q.answer && (
                      <div className="mt-1 text-sm text-cyan-300/80 pl-3 border-l-2 border-cyan-500/20">
                        {q.answer}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </ExpandableSection>
      )}

      {/* Doom Loop Alert */}
      {run.doomLoopCount > 0 && run.doomLoops.length > 0 && (
        <DoomLoopAlert doomLoop={run.doomLoops[run.doomLoops.length - 1]} />
      )}

      {/* Metrics Grid */}
      <div className="grid grid-cols-4 gap-3">
        <MetricCard
          label="Iterations"
          value={run.iterationCount}
          onClick={() => handleMetricClick("events")}
        />
        <MetricCard
          label="Tool Calls"
          value={run.toolCallCount}
          onClick={() => handleMetricClick("toolCalls")}
        />
        <MetricCard
          label="Approvals"
          value={run.approvalCount}
          sublabel={run.deniedCount > 0 ? `${run.deniedCount} denied` : undefined}
          onClick={() => handleMetricClick("toolCalls")}
        />
        <MetricCard
          label="Escalations"
          value={run.escalationCount}
          onClick={() => handleMetricClick("escalations")}
        />
      </div>

      {/* Budget & Tokens */}
      <ExpandableSection
        title="Budget & Tokens"
        icon={Activity}
        badge={run.budget.tokensConsumed ? formatNumber(run.budget.tokensConsumed) : null}
        expanded={expandedSections.has("budget")}
        onToggle={() => toggleSection("budget")}
      >
        <div className="space-y-4">
          {run.budget.tokenTimeline.length >= 2 && (
            <div>
              <div className="text-xs text-zinc-500 mb-2">Token Consumption Timeline</div>
              <BudgetSparkline
                timeline={run.budget.tokenTimeline}
                maxTokens={run.budget.maxTokens}
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <BudgetMetric
              label="Tokens"
              consumed={run.budget.tokensConsumed}
              max={run.budget.maxTokens}
              formatter={formatNumber}
            />
            <BudgetMetric
              label="Cost"
              consumed={run.budget.costUsdConsumed}
              max={run.budget.maxCostUsd}
              formatter={(n) => `$${n.toFixed(4)}`}
            />
            <BudgetMetric
              label="Iterations"
              consumed={run.budget.iterationsConsumed}
              max={run.budget.maxIterations}
              formatter={formatNumber}
            />
            <div className="rounded-lg border border-white/6 bg-black/10 px-3 py-2">
              <div className="text-xs text-zinc-500">Thinking Tokens</div>
              <div className="mt-1 text-base text-zinc-200">
                {formatNumber(run.thinkingTokenCount)}
              </div>
            </div>
          </div>
        </div>
      </ExpandableSection>

      {/* Tool Calls */}
      {run.toolCalls.length > 0 && (
        <ExpandableSection
          title="Tool Calls"
          icon={Zap}
          badge={run.toolCalls.length.toLocaleString()}
          expanded={expandedSections.has("toolCalls")}
          onToggle={() => toggleSection("toolCalls")}
        >
          <ToolCallList toolCalls={run.toolCalls} />
        </ExpandableSection>
      )}

      {/* Context Compaction */}
      {run.compactionEvents.length > 0 && (
        <ExpandableSection
          title="Context Compaction"
          icon={Layers}
          badge={run.compactionEvents.length.toLocaleString()}
          expanded={expandedSections.has("compaction")}
          onToggle={() => toggleSection("compaction")}
        >
          <CompactionEventList events={run.compactionEvents} />
        </ExpandableSection>
      )}

      {/* Escalations */}
      {run.escalations.length > 0 && (
        <ExpandableSection
          title="Escalations"
          icon={ArrowRightLeft}
          badge={run.escalations.length.toLocaleString()}
          expanded={expandedSections.has("escalations")}
          onToggle={() => toggleSection("escalations")}
        >
          <EscalationList escalations={run.escalations} />
        </ExpandableSection>
      )}

      {/* Skills */}
      {run.skillEvents.length > 0 && (
        <ExpandableSection
          title="Skills"
          icon={Sparkles}
          badge={run.skillEvents.length.toLocaleString()}
          expanded={expandedSections.has("skills")}
          onToggle={() => toggleSection("skills")}
        >
          <SkillEventList events={run.skillEvents} />
        </ExpandableSection>
      )}

      {/* Hooks */}
      {run.hookEvents.length > 0 && (
        <ExpandableSection
          title="Hooks"
          icon={Webhook}
          badge={run.hookEvents.length.toLocaleString()}
          expanded={expandedSections.has("hooks")}
          onToggle={() => toggleSection("hooks")}
        >
          <HookEventList events={run.hookEvents} />
        </ExpandableSection>
      )}

      {/* Memory Extractions */}
      {run.memoryExtractions.length > 0 && (
        <ExpandableSection
          title="Memory"
          icon={BookOpen}
          badge={run.memoryExtractions.length.toLocaleString()}
          expanded={expandedSections.has("memory")}
          onToggle={() => toggleSection("memory")}
        >
          <MemoryExtractionList extractions={run.memoryExtractions} />
        </ExpandableSection>
      )}

      {/* Merge Report */}
      {mergeReportData?.item && mergeReportData.item.changedFiles.length > 0 && (
        <ExpandableSection
          title="Merge Report"
          icon={GitMerge}
          badge={mergeReportData.item.changedFiles.length.toLocaleString()}
          expanded={expandedSections.has("mergeReport")}
          onToggle={() => toggleSection("mergeReport")}
        >
          <MergeReportList report={mergeReportData.item} />
        </ExpandableSection>
      )}

      {/* Task Timeline */}
      {timelineData && timelineData.items.length > 0 && (
        <ExpandableSection
          title="Task Timeline"
          icon={Clock}
          badge={timelineData.items.length.toLocaleString()}
          expanded={expandedSections.has("timeline")}
          onToggle={() => toggleSection("timeline")}
        >
          <TaskTimelineList events={timelineData.items} />
        </ExpandableSection>
      )}

      {/* Run Tool Events */}
      {toolEventsData && toolEventsData.items.length > 0 && (
        <ExpandableSection
          title="Tool Events"
          icon={Wrench}
          badge={toolEventsData.items.length.toLocaleString()}
          expanded={expandedSections.has("toolEvents")}
          onToggle={() => toggleSection("toolEvents")}
        >
          <ToolInvocationList events={toolEventsData.items} />
        </ExpandableSection>
      )}

      {/* Thinking Log */}
      {run.thinkingLog && (
        <ExpandableSection
          title="Thinking Log"
          icon={Brain}
          expanded={expandedSections.has("thinking")}
          onToggle={() => toggleSection("thinking")}
        >
          <pre className="text-xs text-zinc-300 whitespace-pre-wrap font-mono overflow-x-auto">
            {run.thinkingLog}
          </pre>
        </ExpandableSection>
      )}

      {/* Latest Output */}
      {run.lastAssistantText && (
        <div className="rounded-xl border border-white/6 bg-black/20 px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Latest Output</div>
          <div className="mt-2 line-clamp-4 text-sm leading-6 text-zinc-200">
            {run.lastAssistantText}
          </div>
        </div>
      )}
    </div>
  );
}

// Helper Components

interface ExpandableSectionProps {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string | null;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function ExpandableSection({
  title,
  icon: Icon,
  badge,
  expanded,
  onToggle,
  children,
}: ExpandableSectionProps) {
  return (
    <div className="rounded-xl border border-white/6 bg-black/20 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-cyan-400" />
          <span className="text-sm font-medium text-zinc-200">{title}</span>
          {badge && (
            <span className="text-xs text-zinc-500 font-mono">{badge}</span>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-zinc-500" />
        ) : (
          <ChevronDown className="h-4 w-4 text-zinc-500" />
        )}
      </button>
      {expanded && (
        <div className="px-4 pb-4 border-t border-white/6">
          <div className="pt-3">{children}</div>
        </div>
      )}
    </div>
  );
}

interface MetricCardProps {
  label: string;
  value: number;
  sublabel?: string;
  onClick?: () => void;
}

function MetricCard({ label, value, sublabel, onClick }: MetricCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-white/6 bg-black/20 px-3 py-2",
        onClick && "cursor-pointer hover:bg-white/[0.03] transition-colors"
      )}
      onClick={onClick}
    >
      <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">{label}</div>
      <div className="mt-1 text-lg text-white">{value.toLocaleString()}</div>
      {sublabel && (
        <div className="text-[10px] text-zinc-600 mt-0.5">{sublabel}</div>
      )}
    </div>
  );
}

function StatusChip({ status }: { status: AgenticRunSnapshot["status"] }) {
  const variants = {
    idle: { bg: "bg-zinc-500/10", text: "text-zinc-400", border: "border-zinc-500/20" },
    running: { bg: "bg-amber-500/10", text: "text-amber-300", border: "border-amber-500/20" },
    completed: { bg: "bg-emerald-500/10", text: "text-emerald-300", border: "border-emerald-500/20" },
    aborted: { bg: "bg-red-500/10", text: "text-red-300", border: "border-red-500/20" },
    failed: { bg: "bg-red-500/10", text: "text-red-300", border: "border-red-500/20" },
  };

  const variant = variants[status];

  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border font-mono tracking-wide uppercase",
        variant.bg,
        variant.text,
        variant.border
      )}
    >
      {status}
    </span>
  );
}

function PhaseChip({ phase }: { phase: AgenticRunSnapshot["phase"] }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border font-mono tracking-wide bg-violet-500/10 text-violet-300 border-violet-500/20">
      {phase}
    </span>
  );
}

function DoomLoopAlert({ doomLoop }: { doomLoop: AgenticDoomLoopRecord }) {
  return (
    <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
        <div className="min-w-0">
          <div className="text-sm font-medium text-red-300">Doom Loop Detected</div>
          <div className="mt-1 text-sm text-red-200/80">{doomLoop.reason}</div>
          {doomLoop.suggestion && (
            <div className="mt-2 text-xs text-red-300/60 italic">
              Suggestion: {doomLoop.suggestion}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BudgetMetric({
  label,
  consumed,
  max,
  formatter,
}: {
  label: string;
  consumed: number | null;
  max: number | null;
  formatter: (n: number) => string;
}) {
  const percentage = consumed !== null && max !== null && max > 0
    ? (consumed / max) * 100
    : null;

  return (
    <div className="rounded-lg border border-white/6 bg-black/10 px-3 py-2">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-1 text-base text-zinc-200">
        {consumed !== null ? formatter(consumed) : "—"}
        {max !== null && (
          <span className="text-xs text-zinc-500 ml-1">/ {formatter(max)}</span>
        )}
      </div>
      {percentage !== null && (
        <div className="mt-1.5 h-1 bg-white/5 rounded-full overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              percentage >= 90 ? "bg-red-500" : percentage >= 70 ? "bg-amber-500" : "bg-emerald-500"
            )}
            style={{ width: `${Math.min(percentage, 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

function BudgetSparkline({
  timeline,
  maxTokens,
}: {
  timeline: Array<{ iteration: number; tokens: number }>;
  maxTokens: number | null;
}) {
  if (timeline.length < 2) {
    return (
      <div className="h-20 flex items-center justify-center text-xs text-zinc-600 rounded-lg border border-white/6 bg-black/10">
        Not enough data
      </div>
    );
  }

  const width = 400;
  const height = 80;
  const padding = 8;

  const maxVal = Math.max(...timeline.map((t) => t.tokens), maxTokens || 0) || 1;

  const points = timeline
    .map((t, i) => {
      const x = padding + (i / (timeline.length - 1)) * (width - 2 * padding);
      const y = height - padding - (t.tokens / maxVal) * (height - 2 * padding);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div className="rounded-lg border border-white/6 bg-black/10 p-2">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-20">
        {maxTokens && (
          <line
            x1={padding}
            y1={height - padding - (maxTokens / maxVal) * (height - 2 * padding)}
            x2={width - padding}
            y2={height - padding - (maxTokens / maxVal) * (height - 2 * padding)}
            stroke="rgb(239, 68, 68)"
            strokeWidth="1"
            strokeDasharray="4 4"
            opacity="0.5"
          />
        )}
        <polyline
          points={points}
          fill="none"
          stroke="rgb(34, 211, 238)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {timeline.map((t, i) => {
          const x = padding + (i / (timeline.length - 1)) * (width - 2 * padding);
          const y = height - padding - (t.tokens / maxVal) * (height - 2 * padding);
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r="2"
              fill="rgb(34, 211, 238)"
            />
          );
        })}
      </svg>
    </div>
  );
}

function ToolCallList({ toolCalls }: { toolCalls: AgenticToolCallRecord[] }) {
  return (
    <div className="space-y-3">
      {toolCalls.map((call) => (
        <ToolCallItem key={call.id} call={call} />
      ))}
    </div>
  );
}

function ToolCallItem({ call }: { call: AgenticToolCallRecord }) {
  const [expanded, setExpanded] = useState(false);

  const policyVariants = {
    allow: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/20" },
    approval_required: { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/20" },
    deny: { bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/20" },
  };

  const policyVariant = policyVariants[call.policyDecision];

  return (
    <div className="rounded-lg border border-white/6 bg-black/10">
      <div className="px-3 py-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-zinc-200 font-mono">{call.name}</span>
              <span className="text-xs text-zinc-600">iter {call.iteration}</span>
              <span
                className={cn(
                  "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border uppercase tracking-wide",
                  policyVariant.bg,
                  policyVariant.text,
                  policyVariant.border
                )}
              >
                {call.policyDecision.replace("_", " ")}
              </span>
            </div>
            <div className="text-xs text-zinc-500 mt-0.5">{call.durationMs}ms</div>
          </div>
        </div>
      </div>

      <details
        open={expanded}
        onToggle={(e) => setExpanded((e.target as HTMLDetailsElement).open)}
        className="border-t border-white/6"
      >
        <summary className="px-3 py-2 text-xs text-zinc-500 cursor-pointer hover:bg-white/[0.02] transition-colors">
          {expanded ? "Hide details" : "Show details"}
        </summary>
        <div className="px-3 pb-3 space-y-2 text-xs">
          <div>
            <div className="text-zinc-500 mb-1">Arguments:</div>
            <pre className="text-zinc-300 bg-black/20 rounded p-2 overflow-x-auto font-mono">
              {JSON.stringify(call.args, null, 2)}
            </pre>
          </div>
          <div>
            <div className="text-zinc-500 mb-1">Result:</div>
            <pre className="text-zinc-300 bg-black/20 rounded p-2 overflow-x-auto font-mono">
              {formatToolResult(call.result)}
            </pre>
          </div>
        </div>
      </details>
    </div>
  );
}

function CompactionEventList({ events }: { events: AgenticCompactionRecord[] }) {
  return (
    <div className="space-y-2">
      {events.map((event, idx) => {
        const savings = event.tokensBefore - event.tokensAfter;
        const savingsPercent = ((savings / event.tokensBefore) * 100).toFixed(1);

        return (
          <div key={idx} className="rounded-lg border border-white/6 bg-black/10 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-zinc-400">
                <span className="text-zinc-500">Iteration {event.iteration}</span>
                <span className="mx-2 text-zinc-700">•</span>
                <span className="text-zinc-500">Stage {event.stage}</span>
              </div>
              <div className="text-xs text-emerald-400">
                -{savingsPercent}%
              </div>
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs">
              <span className="text-zinc-500">
                {formatNumber(event.tokensBefore)} → {formatNumber(event.tokensAfter)} tokens
              </span>
              <span className="text-emerald-500/60">
                ({formatNumber(savings)} saved)
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EscalationList({ escalations }: { escalations: AgenticEscalationRecord[] }) {
  return (
    <div className="space-y-2">
      {escalations.map((escalation, idx) => (
        <div key={idx} className="rounded-lg border border-white/6 bg-black/10 px-3 py-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-zinc-500">Iteration {escalation.iteration}</span>
            <ArrowRightLeft className="h-3 w-3 text-zinc-600" />
            <span className="font-mono text-cyan-400">{escalation.fromRole}</span>
            <span className="text-zinc-600">→</span>
            <span className="font-mono text-violet-400">{escalation.toRole}</span>
          </div>
          {escalation.reason && (
            <div className="mt-1 text-xs text-zinc-400">{escalation.reason}</div>
          )}
        </div>
      ))}
    </div>
  );
}

function SkillEventList({ events }: { events: AgenticSkillEventRecord[] }) {
  const statusVariants = {
    running: { text: "text-amber-400", border: "border-amber-500/20", bg: "bg-amber-500/10" },
    completed: { text: "text-emerald-400", border: "border-emerald-500/20", bg: "bg-emerald-500/10" },
    failed: { text: "text-red-400", border: "border-red-500/20", bg: "bg-red-500/10" },
  };

  return (
    <div className="space-y-2">
      {events.map((event) => {
        const variant = statusVariants[event.status];
        return (
          <div key={event.invocationId} className="rounded-lg border border-white/6 bg-black/10 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-violet-400" />
                <span className="text-sm font-medium text-zinc-200 font-mono">{event.skillName}</span>
              </div>
              <span
                className={cn(
                  "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border uppercase tracking-wide",
                  variant.bg, variant.text, variant.border
                )}
              >
                {event.status}
              </span>
            </div>
            {event.output && (
              <div className="mt-1.5 text-xs text-zinc-400 line-clamp-2">{event.output}</div>
            )}
            {event.childRunId && (
              <div className="mt-1 text-[10px] text-zinc-600 font-mono">fork: {event.childRunId}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function HookEventList({ events }: { events: AgenticHookEventRecord[] }) {
  return (
    <div className="space-y-2">
      {events.map((event, idx) => (
        <div key={`${event.hookId}-${idx}`} className="rounded-lg border border-white/6 bg-black/10 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Webhook className="h-3.5 w-3.5 text-cyan-400" />
              <span className="text-sm font-medium text-zinc-200">{event.hookName}</span>
              <span className="text-[10px] text-zinc-600 font-mono">{event.eventType}</span>
            </div>
            <span
              className={cn(
                "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border uppercase tracking-wide",
                event.success
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : "bg-red-500/10 text-red-400 border-red-500/20"
              )}
            >
              {event.success ? "ok" : "fail"}
            </span>
          </div>
          {event.error && (
            <div className="mt-1.5 text-xs text-red-300/80">{event.error}</div>
          )}
          {event.output && !event.error && (
            <div className="mt-1.5 text-xs text-zinc-400 line-clamp-2">{event.output}</div>
          )}
        </div>
      ))}
    </div>
  );
}

function MemoryExtractionList({ extractions }: { extractions: AgenticMemoryExtractionRecord[] }) {
  return (
    <div className="space-y-2">
      {extractions.map((extraction) => (
        <div key={extraction.memoryId} className="rounded-lg border border-white/6 bg-black/10 px-3 py-2">
          <div className="flex items-start gap-2">
            <BookOpen className="h-3.5 w-3.5 text-fuchsia-400 flex-shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-sm text-zinc-200">{extraction.summary}</div>
              <div className="mt-1 text-[10px] text-zinc-600 font-mono">{extraction.memoryId}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function MergeReportList({ report }: { report: import("../../../shared/contracts").MergeReport }) {
  const statusVariants = {
    clean: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/20" },
    conflict: { bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/20" },
    added: { bg: "bg-cyan-500/10", text: "text-cyan-400", border: "border-cyan-500/20" },
    deleted: { bg: "bg-zinc-500/10", text: "text-zinc-400", border: "border-zinc-500/20" },
  };

  return (
    <div className="space-y-3">
      {report.changedFiles.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs text-zinc-500">Changed Files</div>
          {report.changedFiles.map((filePath, idx) => {
            const status = "clean";
            const variant = statusVariants[status];
            return (
              <div key={idx} className="rounded-lg border border-white/6 bg-black/10 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs text-zinc-300 font-mono truncate">{filePath}</div>
                  <span
                    className={cn(
                      "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border uppercase tracking-wide flex-shrink-0",
                      variant.bg,
                      variant.text,
                      variant.border
                    )}
                  >
                    {status}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {report.semanticConflicts && report.semanticConflicts.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs text-zinc-500">Semantic Conflicts</div>
          {report.semanticConflicts.map((conflict, idx) => (
            <div key={idx} className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
              <div className="text-xs text-red-300">{conflict}</div>
            </div>
          ))}
        </div>
      )}

      {report.outcome && (
        <div className="rounded-lg border border-white/6 bg-black/10 px-3 py-2">
          <div className="text-xs text-zinc-500 mb-1">Outcome</div>
          <div className="text-sm text-zinc-200 capitalize">{report.outcome.replace(/_/g, " ")}</div>
        </div>
      )}

      {report.overlapScore !== undefined && (
        <div className="rounded-lg border border-white/6 bg-black/10 px-3 py-2">
          <div className="text-xs text-zinc-500 mb-1">Overlap Score</div>
          <div className="text-sm text-zinc-200">{(report.overlapScore * 100).toFixed(1)}%</div>
        </div>
      )}
    </div>
  );
}

function TaskTimelineList({ events }: { events: DomainEvent[] }) {
  return (
    <div className="space-y-2">
      {events.map((event) => {
        let payload: Record<string, unknown> = {};
        try {
          payload = JSON.parse(event.payload_json);
        } catch {
          // ignore parse errors
        }
        return (
          <div key={event.event_id} className="rounded-lg border border-white/6 bg-black/10 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-cyan-400" />
                <span className="text-sm font-medium text-zinc-200 font-mono">{event.type}</span>
              </div>
              <span className="text-[10px] text-zinc-600">
                {new Date(event.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-[10px] text-zinc-500">
              <span>actor: {event.actor}</span>
              <span className="text-zinc-700">|</span>
              <span className="font-mono">{event.aggregate_id.slice(0, 12)}</span>
            </div>
            {Object.keys(payload).length > 0 && (
              <details className="mt-1.5">
                <summary className="text-[10px] text-zinc-600 cursor-pointer hover:text-zinc-400">
                  payload
                </summary>
                <pre className="mt-1 text-[10px] text-zinc-400 bg-black/20 rounded p-1.5 overflow-x-auto font-mono">
                  {JSON.stringify(payload, null, 2)}
                </pre>
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ToolInvocationList({ events }: { events: ToolInvocationEvent[] }) {
  const policyVariants: Record<string, { bg: string; text: string; border: string }> = {
    allowed: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/20" },
    approval_required: { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/20" },
    denied: { bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/20" },
  };

  return (
    <div className="space-y-2">
      {events.map((event) => {
        const variant = policyVariants[event.policyDecision] || policyVariants.allowed;
        return (
          <div key={event.id} className="rounded-lg border border-white/6 bg-black/10 px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-zinc-200 font-mono">{event.command}</span>
                  <span className="text-[10px] text-zinc-600">{event.stage}</span>
                  <span
                    className={cn(
                      "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border uppercase tracking-wide",
                      variant.bg, variant.text, variant.border
                    )}
                  >
                    {event.policyDecision.replace("_", " ")}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[10px] text-zinc-500">
                  <span>{event.durationMs}ms</span>
                  {event.exitCode !== null && (
                    <>
                      <span className="text-zinc-700">|</span>
                      <span className={event.exitCode === 0 ? "text-emerald-500" : "text-red-400"}>
                        exit {event.exitCode}
                      </span>
                    </>
                  )}
                  <span className="text-zinc-700">|</span>
                  <span className="font-mono">{event.toolType}</span>
                </div>
              </div>
            </div>
            {event.summary && (
              <div className="mt-1.5 text-xs text-zinc-400 line-clamp-2">{event.summary}</div>
            )}
            {event.errorClass !== "none" && (
              <div className="mt-1 text-[10px] text-red-400">
                Error: {event.errorClass.replace(/_/g, " ")}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Utilities

function formatNumber(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString();
}

function formatToolResult(result: ToolResultDto): string {
  if (result.type === "success") {
    return JSON.stringify({ type: "success", content: result.content, metadata: result.metadata }, null, 2);
  } else if (result.type === "error") {
    return JSON.stringify({ type: "error", error: result.error, metadata: result.metadata }, null, 2);
  } else {
    return JSON.stringify(result, null, 2);
  }
}
