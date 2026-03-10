import { useState } from "react";
import { ArtifactItem } from "../../data/mockData";
import { FileCode2, FileText, GitMerge, Cpu, Clock, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { Chip } from "../UI";
import { formatDistanceToNow } from "date-fns";

const TYPE_CONFIG = {
  patch: { icon: GitMerge, color: "text-purple-400", bg: "bg-purple-500/10", label: "Patch" },
  diff: { icon: FileCode2, color: "text-cyan-400", bg: "bg-cyan-500/10", label: "Diff" },
  generated: { icon: FileCode2, color: "text-emerald-400", bg: "bg-emerald-500/10", label: "Generated" },
  analysis: { icon: FileText, color: "text-amber-400", bg: "bg-amber-500/10", label: "Analysis" },
};

const STATUS_CONFIG = {
  applied: { chip: "ok" as const, icon: CheckCircle2, color: "text-emerald-400" },
  pending: { chip: "warn" as const, icon: AlertCircle, color: "text-amber-400" },
  rejected: { chip: "stop" as const, icon: XCircle, color: "text-rose-400" },
};

export function ArtifactsView({ artifacts }: { artifacts: ArtifactItem[] }) {
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(artifacts[0]?.id ?? null);

  const filtered = artifacts.filter(a => filter === "all" || a.type === filter || a.status === filter);
  const selected = artifacts.find(a => a.id === selectedId);

  return (
    <div className="flex gap-4" style={{ minHeight: 520 }}>
      {/* Left: Artifact List */}
      <div className="w-72 shrink-0 flex flex-col gap-3">
        {/* Filters */}
        <div className="flex flex-wrap gap-1">
          {["all", "patch", "diff", "generated", "analysis", "applied", "pending", "rejected"].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-[10px] px-2 py-0.5 rounded border capitalize transition-colors ${
                filter === f
                  ? "bg-zinc-800 text-zinc-200 border-zinc-600"
                  : "text-zinc-500 border-transparent hover:text-zinc-300"
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-2 overflow-y-auto custom-scrollbar flex-1">
          {filtered.map(artifact => {
            const tCfg = TYPE_CONFIG[artifact.type];
            const sCfg = STATUS_CONFIG[artifact.status];
            const TypeIcon = tCfg.icon;
            const isSelected = selectedId === artifact.id;
            return (
              <button
                key={artifact.id}
                onClick={() => setSelectedId(artifact.id)}
                className={`text-left p-3 rounded-lg border transition-all ${
                  isSelected
                    ? "bg-purple-500/10 border-purple-500/30"
                    : "bg-[#121214] border-white/8 hover:border-white/15"
                }`}
              >
                <div className="flex items-start gap-2">
                  <div className={`w-7 h-7 rounded-md ${tCfg.bg} flex items-center justify-center shrink-0`}>
                    <TypeIcon className={`w-3.5 h-3.5 ${tCfg.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <span className="text-xs font-medium text-zinc-200 truncate">{artifact.filename}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[9px] font-mono text-zinc-500">
                      <span>{artifact.taskId}</span>
                      <span>·</span>
                      <span>{artifact.size}</span>
                    </div>
                  </div>
                  <Chip variant={sCfg.chip} className="text-[8px] py-0 px-1 h-4 shrink-0">
                    {artifact.status}
                  </Chip>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right: Artifact Viewer */}
      <div className="flex-1 min-w-0 bg-[#121214] border border-white/8 rounded-xl overflow-hidden flex flex-col">
        {selected ? (
          <>
            <div className="px-4 py-3 border-b border-white/5 bg-zinc-900/30 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                {(() => { const tCfg = TYPE_CONFIG[selected.type]; const TypeIcon = tCfg.icon; return <TypeIcon className={`w-3.5 h-3.5 ${tCfg.color}`} />; })()}
                <span className="text-xs font-mono text-zinc-300">{selected.filename}</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono border border-zinc-700">
                  {selected.language}
                </span>
              </div>
              <div className="flex items-center gap-3 text-[10px] text-zinc-500 font-mono">
                <span className="flex items-center gap-1">
                  <Cpu className="w-3 h-3" /> {selected.taskId}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatDistanceToNow(new Date(selected.createdAt), { addSuffix: true })}
                </span>
                <Chip variant={STATUS_CONFIG[selected.status].chip} className="text-[9px] py-0">
                  {selected.status}
                </Chip>
              </div>
            </div>
            <div className="flex-1 overflow-auto custom-scrollbar">
              <pre className="text-[11px] font-mono leading-relaxed p-1">
                {selected.content.split("\n").map((line, i) => {
                  let lineClass = "text-zinc-300";
                  let bg = "";
                  if (line.startsWith("+") && !line.startsWith("+++")) {
                    lineClass = "text-emerald-400"; bg = "bg-emerald-500/8";
                  } else if (line.startsWith("-") && !line.startsWith("---")) {
                    lineClass = "text-rose-400"; bg = "bg-rose-500/8";
                  } else if (line.startsWith("@@")) {
                    lineClass = "text-cyan-400"; bg = "bg-cyan-500/8";
                  } else if (line.startsWith("##") || line.startsWith("//")) {
                    lineClass = "text-zinc-500";
                  }
                  return (
                    <div key={i} className={`flex gap-3 px-3 py-px ${bg}`}>
                      <span className="select-none text-zinc-700 w-6 text-right shrink-0 tabular-nums">{i + 1}</span>
                      <span className={lineClass}>{line || " "}</span>
                    </div>
                  );
                })}
              </pre>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-zinc-600 text-sm">
            Select an artifact to preview
          </div>
        )}
      </div>
    </div>
  );
}
