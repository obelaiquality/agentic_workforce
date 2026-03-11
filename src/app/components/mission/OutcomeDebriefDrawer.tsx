import { CheckCircle2, FileBadge2, XCircle } from "lucide-react";
import { Chip, Panel, PanelHeader } from "../UI";
import type { ExecutionRunSummary, ProjectBlueprint, ShareableRunReport, VerificationBundle } from "../../../shared/contracts";
import { executionModeLabel, modelRoleLabel, providerLabel } from "../../lib/missionLabels";

export function OutcomeDebriefDrawer({
  runSummary,
  verification,
  shareReport,
  blueprint,
}: {
  runSummary: ExecutionRunSummary | null;
  verification: VerificationBundle | null;
  shareReport: ShareableRunReport | null;
  blueprint?: ProjectBlueprint | null;
}) {
  const pass = verification?.pass ?? false;
  const verificationMetadata = (verification?.metadata ?? {}) as Record<string, unknown>;
  const shareMetadata = (shareReport?.metadata ?? {}) as Record<string, unknown>;
  const verificationReasons = uniqueStrings(
    asStringArray(verificationMetadata.verification_reasons).length
      ? asStringArray(verificationMetadata.verification_reasons)
      : asStringArray(shareMetadata.verification_reasons)
  );
  const enforcedRules = uniqueStrings(
    asStringArray(verificationMetadata.enforced_rules).length
      ? asStringArray(verificationMetadata.enforced_rules)
      : asStringArray(shareMetadata.enforced_rules)
  );
  const verificationCommands = uniqueStrings(
    asStringArray(verificationMetadata.verification_commands).length
      ? asStringArray(verificationMetadata.verification_commands)
      : [...(verification?.changedFileChecks || []), ...(verification?.impactedTests || [])]
  );
  const repairedFiles = uniqueStrings(
    asStringArray(verificationMetadata.repaired_files).length
      ? asStringArray(verificationMetadata.repaired_files)
      : asStringArray(shareMetadata.repaired_files)
  );

  return (
    <Panel>
      <PanelHeader title="Outcome Debrief">
        <Chip variant={verification ? (pass ? "ok" : "warn") : "subtle"} className="text-[10px]">
          {verification ? (pass ? "verified" : "needs follow-up") : "idle"}
        </Chip>
      </PanelHeader>
      <div className="p-4 grid grid-cols-1 md:grid-cols-[1.2fr_0.8fr] gap-4">
        <div className="space-y-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Run</div>
            <div className="mt-1 text-sm font-medium text-white">{runSummary?.status || "No execution yet"}</div>
            <p className="mt-1 text-xs text-zinc-400">
              {runSummary
                ? `${providerLabel(runSummary.providerId)} · ${modelRoleLabel(runSummary.modelRole)} · ${executionModeLabel(runSummary.executionMode)}`
                : "Review a route and execute to see verification, changed files, and shareable output here."}
            </p>
          </div>

          {verification?.failures?.length ? (
            <div className="rounded-lg border border-rose-500/20 bg-rose-500/8 p-3">
              <div className="flex items-center gap-2 text-rose-200 text-sm font-medium">
                <XCircle className="h-4 w-4 text-rose-400" />
                Verification failures
              </div>
              <ul className="mt-2 space-y-1 text-xs text-rose-100/80">
                {uniqueStrings(verification.failures).slice(0, 4).map((failure, index) => (
                  <li key={`failure-${index}`}>• {failure}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {shareReport?.summary ? (
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Shareable summary</div>
              <div className="mt-2 text-xs leading-5 text-zinc-300">{shareReport.summary}</div>
            </div>
          ) : null}

          {verificationReasons.length ? (
            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
              <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Why these checks ran</div>
              <ul className="mt-2 space-y-1 text-xs leading-5 text-zinc-300">
                {verificationReasons.slice(0, 4).map((reason, index) => (
                  <li key={`reason-${index}`}>• {reason}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {repairedFiles.length ? (
            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
              <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Repair loop touched</div>
              <ul className="mt-2 space-y-1 text-xs leading-5 text-zinc-300">
                {repairedFiles.slice(0, 6).map((file, index) => (
                  <li key={`repair-${index}`}>• {file}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="space-y-3 rounded-xl border border-white/5 bg-zinc-950/40 p-4">
          <div className="flex items-center gap-2 text-white text-sm font-medium">
            {pass ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <FileBadge2 className="h-4 w-4 text-cyan-400" />}
            Verification bundle
          </div>
          <div className="text-xs text-zinc-400">Changed-file checks, impacted tests, and doc requirements surface here after execution.</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg border border-white/5 bg-black/20 p-3">
              <div className="text-zinc-500">Checks</div>
              <div className="mt-1 text-white">{verification?.changedFileChecks.length ?? 0}</div>
            </div>
            <div className="rounded-lg border border-white/5 bg-black/20 p-3">
              <div className="text-zinc-500">Tests</div>
              <div className="mt-1 text-white">{verification?.impactedTests.length ?? 0}</div>
            </div>
            <div className="rounded-lg border border-white/5 bg-black/20 p-3">
              <div className="text-zinc-500">Docs</div>
              <div className="mt-1 text-white">{verification?.docsChecked.length ?? 0}</div>
            </div>
            <div className="rounded-lg border border-white/5 bg-black/20 p-3">
              <div className="text-zinc-500">Artifacts</div>
              <div className="mt-1 text-white">{verification?.artifacts.length ?? 0}</div>
            </div>
          </div>

          {enforcedRules.length ? (
            <div className="rounded-lg border border-white/5 bg-black/20 p-3">
              <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Rules enforced</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {enforcedRules.map((rule, index) => (
                  <span key={`rule-${index}`} className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-1 text-[10px] text-zinc-300">
                    {rule}
                  </span>
                ))}
              </div>
            </div>
          ) : blueprint ? (
            <div className="rounded-lg border border-white/5 bg-black/20 p-3">
              <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Blueprint defaults</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {[
                  blueprint.testingPolicy.requiredForBehaviorChange ? "Tests required for behavior changes" : "Tests optional by default",
                  blueprint.documentationPolicy.updateUserFacingDocs ? "Docs updates expected" : "Docs optional by default",
                ].map((rule, index) => (
                  <span key={`blueprint-rule-${index}`} className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-1 text-[10px] text-zinc-300">
                    {rule}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {verificationCommands.length ? (
            <div className="rounded-lg border border-white/5 bg-black/20 p-3">
              <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Verification commands</div>
              <ul className="mt-2 space-y-1 text-[11px] font-mono text-zinc-300">
                {verificationCommands.slice(0, 6).map((command, index) => (
                  <li key={`command-${index}`}>{command}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function uniqueStrings(value: string[]) {
  return Array.from(new Set(value.filter(Boolean)));
}
