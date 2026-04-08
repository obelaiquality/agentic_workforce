import { useState } from "react";
import { FileText, Bug, Code } from "lucide-react";
import type { RalphProgressLedger } from "../../../../shared/contracts";
import { cn, Chip } from "../../UI";

interface PhaseExecution {
  phase: string;
  iteration: number;
  status: string;
  output?: string;
}

interface ProgressLedgerProps {
  ledger: RalphProgressLedger | null;
  phaseExecutions: PhaseExecution[];
}

function CollapsibleSection({
  title,
  icon: Icon,
  count,
  children,
  defaultOpen = false,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  count?: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border border-white/5 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-white/[0.02] transition-colors"
      >
        <Icon className="w-3.5 h-3.5 text-zinc-400" />
        <span className="text-xs font-medium text-zinc-300">{title}</span>
        {count != null && (
          <Chip variant="subtle" className="ml-auto">
            {count}
          </Chip>
        )}
        <svg
          className={cn(
            "w-3 h-3 text-zinc-500 transition-transform",
            count == null && "ml-auto",
            open && "rotate-180",
          )}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="px-3 pb-3 pt-1">{children}</div>}
    </div>
  );
}

export function ProgressLedger({ ledger, phaseExecutions }: ProgressLedgerProps) {
  if (!ledger) {
    return (
      <div className="px-5 py-3 text-xs text-zinc-500">
        Ledger not available yet
      </div>
    );
  }

  return (
    <div className="px-5 py-3 space-y-2">
      {/* Current objective */}
      {ledger.currentObjective && (
        <div className="text-xs text-zinc-400 mb-3">
          <span className="text-zinc-500 font-medium">Objective: </span>
          {ledger.currentObjective}
        </div>
      )}

      {/* Files modified */}
      <CollapsibleSection
        title="Files Modified"
        icon={FileText}
        count={ledger.filesModified.length}
      >
        {ledger.filesModified.length === 0 ? (
          <p className="text-xs text-zinc-500">None</p>
        ) : (
          <ul className="space-y-0.5">
            {ledger.filesModified.map((f) => (
              <li key={f} className="text-xs text-zinc-400 font-mono truncate">
                {f}
              </li>
            ))}
          </ul>
        )}
      </CollapsibleSection>

      {/* Deslop */}
      <CollapsibleSection title="Deslop Issues" icon={Bug}>
        <div className="flex gap-4 text-xs">
          <span className="text-zinc-400">
            Found:{" "}
            <span className="text-zinc-200 font-medium">
              {ledger.deslopIssuesFound}
            </span>
          </span>
          <span className="text-zinc-400">
            Fixed:{" "}
            <span className="text-emerald-400 font-medium">
              {ledger.deslopIssuesFixed}
            </span>
          </span>
        </div>
      </CollapsibleSection>

      {/* Verifications passed */}
      <div className="flex items-center gap-2 text-xs text-zinc-400 px-1">
        <span>Verifications passed:</span>
        <span className="text-zinc-200 font-medium">
          {ledger.verificationsPassed}
        </span>
      </div>

      {/* Phase execution history */}
      {phaseExecutions.length > 0 && (
        <CollapsibleSection
          title="Phase History"
          icon={Code}
          count={phaseExecutions.length}
        >
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {phaseExecutions.map((pe, idx) => (
              <div
                key={`${pe.phase}-${pe.iteration}-${idx}`}
                className="flex items-center gap-2 text-xs"
              >
                <Chip
                  variant={
                    pe.status === "completed"
                      ? "ok"
                      : pe.status === "failed"
                        ? "stop"
                        : "subtle"
                  }
                >
                  {pe.status}
                </Chip>
                <span className="text-zinc-400">
                  {pe.phase} (iter {pe.iteration})
                </span>
                {pe.output && (
                  <span className="text-zinc-500 truncate max-w-[200px]">
                    {pe.output}
                  </span>
                )}
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
}
