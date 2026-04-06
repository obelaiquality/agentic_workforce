/**
 * RunReplayPanel - Timeline viewer for stepping through past agentic execution runs
 *
 * Displays a vertical timeline of all events in a run, allowing users to:
 * - Navigate through each step/event sequentially
 * - See event details (tool calls, LLM responses, user inputs, etc.)
 * - View timing information and durations
 * - Jump to start/end
 *
 * Usage:
 * ```tsx
 * import { RunReplayPanel } from "@/components/agentic/RunReplayPanel";
 *
 * function YourComponent({ runId }) {
 *   return <RunReplayPanel runId={runId} />;
 * }
 * ```
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  SkipBack,
  SkipForward,
  AlertCircle,
  Zap,
  MessageSquare,
  User,
  Settings,
  CheckCircle,
  XCircle,
  Layers,
} from "lucide-react";
import type { DomainEvent } from "../../../shared/contracts";
import { getRunReplayV2 } from "../../lib/apiClient";
import { cn } from "../UI";

interface RunReplayPanelProps {
  runId: string;
}

export function RunReplayPanel({ runId }: RunReplayPanelProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const { data: replay, isLoading, error } = useQuery({
    queryKey: ["run-replay", runId],
    queryFn: () => getRunReplayV2(runId),
    enabled: !!runId,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-sm text-zinc-500">Loading replay...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-medium text-red-300">Failed to load replay</div>
            <div className="mt-1 text-xs text-red-200/80">
              {error instanceof Error ? error.message : "Unknown error"}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!replay?.items || replay.items.length === 0) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-sm text-zinc-500">No events recorded for this run</div>
      </div>
    );
  }

  const events = replay.items;
  const selectedEvent = events[selectedIndex];

  const handlePrevious = () => {
    setSelectedIndex((prev) => Math.max(0, prev - 1));
  };

  const handleNext = () => {
    setSelectedIndex((prev) => Math.min(events.length - 1, prev + 1));
  };

  const handleJumpToStart = () => {
    setSelectedIndex(0);
  };

  const handleJumpToEnd = () => {
    setSelectedIndex(events.length - 1);
  };

  return (
    <div className="flex flex-col h-full min-h-[600px]">
      {/* Navigation Controls */}
      <div className="flex items-center justify-between gap-3 p-4 border-b border-white/6 bg-black/20">
        <div className="flex items-center gap-2">
          <button
            onClick={handleJumpToStart}
            disabled={selectedIndex === 0}
            className={cn(
              "p-1.5 rounded transition-colors",
              selectedIndex === 0
                ? "text-zinc-600 cursor-not-allowed"
                : "text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-200"
            )}
            title="Jump to start"
          >
            <SkipBack className="h-4 w-4" />
          </button>
          <button
            onClick={handlePrevious}
            disabled={selectedIndex === 0}
            className={cn(
              "p-1.5 rounded transition-colors",
              selectedIndex === 0
                ? "text-zinc-600 cursor-not-allowed"
                : "text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-200"
            )}
            title="Previous step"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          <div className="px-3 py-1 rounded-lg border border-white/6 bg-black/10">
            <span className="text-xs text-zinc-400 font-mono">
              Step {selectedIndex + 1} of {events.length}
            </span>
          </div>

          <button
            onClick={handleNext}
            disabled={selectedIndex === events.length - 1}
            className={cn(
              "p-1.5 rounded transition-colors",
              selectedIndex === events.length - 1
                ? "text-zinc-600 cursor-not-allowed"
                : "text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-200"
            )}
            title="Next step"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            onClick={handleJumpToEnd}
            disabled={selectedIndex === events.length - 1}
            className={cn(
              "p-1.5 rounded transition-colors",
              selectedIndex === events.length - 1
                ? "text-zinc-600 cursor-not-allowed"
                : "text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-200"
            )}
            title="Jump to end"
          >
            <SkipForward className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Clock className="h-3.5 w-3.5" />
          <span>
            {new Date(selectedEvent.timestamp).toLocaleTimeString()}
          </span>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Timeline Rail */}
        <div className="w-64 border-r border-white/6 bg-black/10 overflow-y-auto">
          <div className="p-3 space-y-1">
            {events.map((event, index) => (
              <TimelineNode
                key={event.event_id}
                event={event}
                isActive={index === selectedIndex}
                isFirst={index === 0}
                isLast={index === events.length - 1}
                onClick={() => setSelectedIndex(index)}
              />
            ))}
          </div>
        </div>

        {/* Step Detail Panel */}
        <div className="flex-1 overflow-y-auto">
          <EventDetailPanel event={selectedEvent} />
        </div>
      </div>
    </div>
  );
}

interface TimelineNodeProps {
  event: DomainEvent;
  isActive: boolean;
  isFirst: boolean;
  isLast: boolean;
  onClick: () => void;
}

function TimelineNode({ event, isActive, isFirst, isLast, onClick }: TimelineNodeProps) {
  const Icon = getEventIcon(event.type);
  const color = getEventColor(event.type);

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left relative pl-6 pr-3 py-2 rounded-lg transition-colors",
        isActive
          ? "bg-cyan-500/10 border border-cyan-500/20"
          : "hover:bg-white/[0.03] border border-transparent"
      )}
    >
      {/* Vertical line */}
      {!isLast && (
        <div
          className="absolute left-3 top-8 bottom-0 w-px"
          style={{ backgroundColor: "rgba(255, 255, 255, 0.1)" }}
        />
      )}

      {/* Node dot */}
      <div
        className={cn(
          "absolute left-2.5 top-3 w-2 h-2 rounded-full border-2",
          isActive ? `bg-${color}-400 border-${color}-400` : `bg-zinc-800 border-${color}-600`
        )}
        style={{
          backgroundColor: isActive ? getEventColorHex(color) : "#27272a",
          borderColor: getEventColorHex(color),
        }}
      />

      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Icon className={cn("h-3.5 w-3.5", `text-${color}-400`)} style={{ color: getEventColorHex(color) }} />
          <span className={cn("text-xs font-medium", isActive ? "text-zinc-100" : "text-zinc-400")}>
            {formatEventType(event.type)}
          </span>
        </div>
        <div className="text-[10px] text-zinc-600">
          {new Date(event.timestamp).toLocaleTimeString()}
        </div>
        <div className="text-[10px] text-zinc-500 line-clamp-2">
          {getEventDescription(event)}
        </div>
      </div>
    </button>
  );
}

function EventDetailPanel({ event }: { event: DomainEvent }) {
  const payload = parsePayload(event.payload_json);
  const Icon = getEventIcon(event.type);
  const color = getEventColor(event.type);

  return (
    <div className="p-6 space-y-4">
      {/* Event Header */}
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <div
            className={cn("p-2 rounded-lg border", `bg-${color}-500/10 border-${color}-500/20`)}
            style={{
              backgroundColor: `${getEventColorHex(color)}15`,
              borderColor: `${getEventColorHex(color)}30`,
            }}
          >
            <Icon className={cn("h-5 w-5", `text-${color}-400`)} style={{ color: getEventColorHex(color) }} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-medium text-zinc-100">
              {formatEventType(event.type)}
            </h3>
            <div className="mt-1 flex items-center gap-3 text-xs text-zinc-500">
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                <span>{new Date(event.timestamp).toLocaleString()}</span>
              </div>
              <div className="flex items-center gap-1">
                <User className="h-3 w-3" />
                <span>{event.actor}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="text-sm text-zinc-300">
          {getEventDescription(event)}
        </div>
      </div>

      {/* Event Metadata */}
      <div className="grid grid-cols-2 gap-3">
        <MetadataField label="Event ID" value={event.event_id} mono />
        <MetadataField label="Aggregate ID" value={event.aggregate_id} mono />
        <MetadataField label="Causation ID" value={event.causation_id} mono />
        <MetadataField label="Correlation ID" value={event.correlation_id} mono />
      </div>

      {/* Payload Details */}
      {payload && Object.keys(payload).length > 0 && (
        <div className="rounded-xl border border-white/6 bg-black/20 overflow-hidden">
          <div className="px-4 py-3 border-b border-white/6">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-violet-400" />
              <span className="text-sm font-medium text-zinc-200">Event Payload</span>
            </div>
          </div>
          <div className="p-4">
            <PayloadViewer payload={payload} eventType={event.type} />
          </div>
        </div>
      )}
    </div>
  );
}

function MetadataField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-white/6 bg-black/10 px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">{label}</div>
      <div className={cn("mt-1 text-xs text-zinc-300 truncate", mono && "font-mono")}>
        {value}
      </div>
    </div>
  );
}

function PayloadViewer({ payload, eventType }: { payload: unknown; eventType: string }) {
  // Special handling for known event types
  if (eventType.includes("ToolUse") && typeof payload === "object" && payload !== null) {
    const toolPayload = payload as Record<string, unknown>;
    return (
      <div className="space-y-3">
        {toolPayload.name && (
          <div>
            <div className="text-xs text-zinc-500 mb-1">Tool Name</div>
            <div className="text-sm text-zinc-200 font-mono">{String(toolPayload.name)}</div>
          </div>
        )}
        {toolPayload.input && (
          <div>
            <div className="text-xs text-zinc-500 mb-1">Input</div>
            <pre className="text-xs text-zinc-300 bg-black/20 rounded p-2 overflow-x-auto font-mono whitespace-pre-wrap">
              {JSON.stringify(toolPayload.input, null, 2)}
            </pre>
          </div>
        )}
        {toolPayload.result && (
          <div>
            <div className="text-xs text-zinc-500 mb-1">Result</div>
            <pre className="text-xs text-zinc-300 bg-black/20 rounded p-2 overflow-x-auto font-mono whitespace-pre-wrap">
              {JSON.stringify(toolPayload.result, null, 2)}
            </pre>
          </div>
        )}
        {toolPayload.duration_ms && (
          <div>
            <div className="text-xs text-zinc-500 mb-1">Duration</div>
            <div className="text-sm text-zinc-200">{toolPayload.duration_ms}ms</div>
          </div>
        )}
      </div>
    );
  }

  // Default JSON view
  return (
    <pre className="text-xs text-zinc-300 bg-black/20 rounded p-3 overflow-x-auto font-mono whitespace-pre-wrap">
      {JSON.stringify(payload, null, 2)}
    </pre>
  );
}

// Utility functions

function parsePayload(payloadJson: string): unknown {
  try {
    return JSON.parse(payloadJson);
  } catch {
    return null;
  }
}

function getEventIcon(eventType: string) {
  if (eventType.includes("ToolUse") || eventType.includes("tool_")) return Zap;
  if (eventType.includes("Message") || eventType.includes("message_")) return MessageSquare;
  if (eventType.includes("User") || eventType.includes("user_")) return User;
  if (eventType.includes("Config") || eventType.includes("config_")) return Settings;
  if (eventType.includes("Success") || eventType.includes("Completed")) return CheckCircle;
  if (eventType.includes("Error") || eventType.includes("Failed")) return XCircle;
  return Layers;
}

function getEventColor(eventType: string): "cyan" | "amber" | "emerald" | "red" | "violet" | "zinc" {
  if (eventType.includes("ToolUse") || eventType.includes("tool_")) return "cyan";
  if (eventType.includes("Message") || eventType.includes("message_")) return "violet";
  if (eventType.includes("User") || eventType.includes("user_")) return "amber";
  if (eventType.includes("Success") || eventType.includes("Completed")) return "emerald";
  if (eventType.includes("Error") || eventType.includes("Failed")) return "red";
  return "zinc";
}

function getEventColorHex(color: string): string {
  const colors: Record<string, string> = {
    cyan: "#22d3ee",
    amber: "#fbbf24",
    emerald: "#10b981",
    red: "#ef4444",
    violet: "#a78bfa",
    zinc: "#a1a1aa",
  };
  return colors[color] || colors.zinc;
}

function formatEventType(eventType: string): string {
  return eventType
    .replace(/_/g, " ")
    .replace(/([A-Z])/g, " $1")
    .trim()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function getEventDescription(event: DomainEvent): string {
  const payload = parsePayload(event.payload_json);
  if (!payload || typeof payload !== "object") {
    return event.type;
  }

  const p = payload as Record<string, unknown>;

  // Try to extract meaningful description from common fields
  if (p.message && typeof p.message === "string") return p.message;
  if (p.summary && typeof p.summary === "string") return p.summary;
  if (p.description && typeof p.description === "string") return p.description;
  if (p.name && typeof p.name === "string") return p.name;
  if (p.title && typeof p.title === "string") return p.title;

  return event.type;
}
