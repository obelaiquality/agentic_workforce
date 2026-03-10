import { useState } from "react";
import { CodePattern } from "../../data/mockData";
import { Chip } from "../UI";
import { ShieldAlert, Zap, RefreshCw, Bug, ChevronDown, ChevronUp, FileCode2 } from "lucide-react";

const SEVERITY_CONFIG = {
  security: { label: "Security", icon: ShieldAlert, color: "text-rose-400", bg: "bg-rose-500/10", border: "border-rose-500/25", chip: "stop" as const },
  "bug-prone": { label: "Bug Risk", icon: Bug, color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/25", chip: "warn" as const },
  optimization: { label: "Optimize", icon: Zap, color: "text-cyan-400", bg: "bg-cyan-500/10", border: "border-cyan-500/25", chip: "subtle" as const },
  refactor: { label: "Refactor", icon: RefreshCw, color: "text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/25", chip: "subtle" as const },
};

const FILTERS = ["all", "security", "bug-prone", "optimization", "refactor"] as const;

export function PatternsView({ patterns }: { patterns: CodePattern[] }) {
  const [filter, setFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = patterns.filter(p => filter === "all" || p.severity === filter);
  const securityCount = patterns.filter(p => p.severity === "security").length;
  const bugCount = patterns.filter(p => p.severity === "bug-prone").length;

  return (
    <div className="space-y-4">
      {/* Alert Banner */}
      {(securityCount > 0 || bugCount > 0) && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-rose-500/5 border border-rose-500/20">
          <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
          <div className="text-xs text-rose-300">
            <span className="font-medium">{securityCount} security issue{securityCount > 1 ? "s" : ""}</span>
            {bugCount > 0 && <span> and <span className="font-medium">{bugCount} bug risk pattern{bugCount > 1 ? "s" : ""}</span></span>}
            {" "}detected — review recommended before next deploy.
          </div>
        </div>
      )}

      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {FILTERS.slice(1).map(sev => {
          const cfg = SEVERITY_CONFIG[sev as keyof typeof SEVERITY_CONFIG];
          const Icon = cfg.icon;
          const count = patterns.filter(p => p.severity === sev).length;
          return (
            <button
              key={sev}
              onClick={() => setFilter(filter === sev ? "all" : sev)}
              className={`flex items-center gap-2 p-3 rounded-lg border transition-all text-left ${
                filter === sev
                  ? `${cfg.bg} ${cfg.border}`
                  : "bg-[#121214] border-white/8 hover:border-white/15"
              }`}
            >
              <Icon className={`w-4 h-4 ${cfg.color} shrink-0`} />
              <div>
                <div className="text-base font-mono font-medium text-zinc-200">{count}</div>
                <div className="text-[9px] text-zinc-500 uppercase tracking-wide">{cfg.label}</div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {FILTERS.map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors border capitalize ${
              filter === f
                ? "bg-zinc-800 text-zinc-200 border-zinc-600"
                : "bg-transparent text-zinc-500 border-transparent hover:text-zinc-300 hover:border-zinc-700"
            }`}
          >
            {f === "all" ? `All (${patterns.length})` : f}
          </button>
        ))}
      </div>

      {/* Pattern Cards */}
      <div className="flex flex-col gap-3">
        {filtered.map(pattern => {
          const cfg = SEVERITY_CONFIG[pattern.severity];
          const Icon = cfg.icon;
          const isExpanded = expandedId === pattern.id;
          const confidencePct = Math.round(pattern.confidence * 100);

          return (
            <div
              key={pattern.id}
              className={`bg-[#121214] border rounded-xl overflow-hidden transition-all ${cfg.border}`}
            >
              <button
                onClick={() => setExpandedId(isExpanded ? null : pattern.id)}
                className="w-full p-4 text-left flex items-start gap-3 hover:bg-white/[0.02] transition-colors"
              >
                <div className={`w-8 h-8 rounded-lg ${cfg.bg} flex items-center justify-center shrink-0 mt-0.5`}>
                  <Icon className={`w-4 h-4 ${cfg.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-zinc-100">{pattern.name}</span>
                      <span className="text-[9px] font-mono text-zinc-600">{pattern.id}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-[10px] font-mono ${cfg.color}`}>{confidencePct}% conf.</span>
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-zinc-500" /> : <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />}
                    </div>
                  </div>
                  <p className="text-xs text-zinc-400 leading-relaxed line-clamp-2">{pattern.description}</p>
                  <div className="flex items-center gap-3 mt-2">
                    <span className="text-[10px] font-mono text-zinc-600">
                      {pattern.occurrences} occurrence{pattern.occurrences > 1 ? "s" : ""}
                    </span>
                    <div className="flex gap-1">
                      {pattern.tags.map(tag => (
                        <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 border border-zinc-700">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </button>

              {isExpanded && (
                <div className="px-4 pb-4 space-y-3 border-t border-white/5 pt-3">
                  {/* Confidence Bar */}
                  <div>
                    <div className="flex justify-between text-[10px] text-zinc-500 mb-1.5">
                      <span>Detection Confidence</span>
                      <span className={cfg.color}>{confidencePct}%</span>
                    </div>
                    <div className="h-1 rounded-full bg-zinc-800">
                      <div className={`h-full rounded-full ${cfg.bg.replace("10", "60")}`} style={{ width: `${confidencePct}%`, background: undefined }}
                      >
                        <div className={`h-full rounded-full ${pattern.severity === "security" ? "bg-rose-500" : pattern.severity === "bug-prone" ? "bg-amber-500" : pattern.severity === "optimization" ? "bg-cyan-500" : "bg-purple-500"}`} style={{ width: "100%" }} />
                      </div>
                    </div>
                  </div>

                  {/* Affected Files */}
                  <div>
                    <div className="text-[10px] text-zinc-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                      <FileCode2 className="w-3 h-3" /> Affected Files
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {pattern.files.map(f => (
                        <span key={f} className="text-[10px] px-2 py-1 rounded-md bg-zinc-800/70 text-zinc-300 font-mono border border-zinc-700/50">
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Suggestion */}
                  <div className="bg-black/30 rounded-md p-3 border-l-2 border-purple-500/50">
                    <div className="text-[10px] text-purple-400 uppercase tracking-wide mb-1">Suggestion</div>
                    <p className="text-xs text-zinc-300 leading-relaxed">{pattern.suggestion}</p>
                  </div>

                  <button className={`text-[11px] font-medium px-3 py-1.5 rounded-md border transition-all ${cfg.bg} ${cfg.color} ${cfg.border} hover:opacity-80`}>
                    Queue Fix Task →
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}