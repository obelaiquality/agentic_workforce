import { useState } from "react";
import { ChevronDown, ChevronUp, Wrench, Check, X, Loader2 } from "lucide-react";
import { cn } from "../ui/utils";
import type { AgenticToolCallRecord } from "../../../shared/contracts";

export interface ToolCallInlineProps {
  call: AgenticToolCallRecord;
}

type ToolStatus = "running" | "completed" | "failed";

function resolveStatus(call: AgenticToolCallRecord): ToolStatus {
  if (!call.result) return "running";
  return call.result.type === "error" ? "failed" : "completed";
}

const STATUS_ICON: Record<ToolStatus, React.ReactNode> = {
  running: <Loader2 className="h-3 w-3 animate-spin text-amber-400" />,
  completed: <Check className="h-3 w-3 text-emerald-400" />,
  failed: <X className="h-3 w-3 text-red-400" />,
};

const STATUS_BORDER: Record<ToolStatus, string> = {
  running: "border-amber-500/20",
  completed: "border-emerald-500/20",
  failed: "border-red-500/20",
};

export function ToolCallInline({ call }: ToolCallInlineProps) {
  const [expanded, setExpanded] = useState(false);
  const status = resolveStatus(call);

  return (
    <div
      className={cn(
        "my-1.5 rounded-lg border bg-black/20 text-xs",
        STATUS_BORDER[status],
      )}
      data-testid="tool-call-inline"
    >
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-white/[0.02] transition-colors"
      >
        <Wrench className="h-3 w-3 text-zinc-500 flex-shrink-0" />
        <span className="font-mono text-zinc-300 truncate">{call.name}</span>
        {STATUS_ICON[status]}
        {call.durationMs != null && status !== "running" && (
          <span className="text-zinc-600 ml-auto mr-1">{call.durationMs}ms</span>
        )}
        {expanded ? (
          <ChevronUp className="h-3 w-3 text-zinc-600 flex-shrink-0" />
        ) : (
          <ChevronDown className="h-3 w-3 text-zinc-600 flex-shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-white/6 px-3 py-2 space-y-2">
          <div>
            <div className="text-zinc-500 mb-1">Arguments</div>
            <pre className="text-zinc-400 bg-black/30 rounded p-2 overflow-x-auto font-mono text-[10px] leading-4">
              {JSON.stringify(call.args, null, 2)}
            </pre>
          </div>
          {call.result && (
            <div>
              <div className="text-zinc-500 mb-1">Result</div>
              <pre className="text-zinc-400 bg-black/30 rounded p-2 overflow-x-auto font-mono text-[10px] leading-4 max-h-40 overflow-y-auto">
                {call.result.type === "error"
                  ? JSON.stringify({ type: "error", error: call.result.error }, null, 2)
                  : JSON.stringify({ type: "success", content: call.result.content }, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
