import type { RalphPhase } from "../../../shared/contracts";
import { Panel, PanelHeader } from "../UI";
import {
  useRalphSession,
  useRalphLedger,
  usePauseRalph,
  useResumeRalph,
  useRalphStream,
} from "../../hooks/useRalphMode";
import { PhaseTimeline } from "./PhaseTimeline";
import { VerificationBadges } from "./VerificationBadges";
import { ProgressLedger } from "./ProgressLedger";
import { RalphControls } from "./RalphControls";

interface RalphPanelProps {
  sessionId: string;
}

export function RalphPanel({ sessionId }: RalphPanelProps) {
  const { data: statusData, isLoading: statusLoading } =
    useRalphSession(sessionId);
  const { data: ledgerData } = useRalphLedger(sessionId);
  const pauseMutation = usePauseRalph(sessionId);
  const resumeMutation = useResumeRalph(sessionId);

  // Keep EventSource connected for live updates
  useRalphStream(sessionId);

  if (statusLoading || !statusData) {
    return (
      <Panel>
        <PanelHeader title="Ralph Mode" />
        <div className="px-5 py-8 text-center text-sm text-zinc-500">
          Loading session...
        </div>
      </Panel>
    );
  }

  const session = statusData.session;
  const ledger = ledgerData?.ledger ?? null;
  const phaseExecutions = ledgerData?.phaseExecutions ?? [];
  const verifications = ledgerData?.verifications ?? [];

  const completedPhases: RalphPhase[] = ledger?.completedPhases ?? [];
  const currentPhase = (session.currentPhase as RalphPhase) || "intake";

  return (
    <Panel>
      {/* Header */}
      <PanelHeader
        title={
          <span className="flex items-center gap-2">
            <span>Ralph:</span>
            <span className="text-zinc-400 font-normal truncate max-w-[300px]">
              &ldquo;{session.specContent?.slice(0, 80) ?? "Spec"}&rdquo;
            </span>
          </span>
        }
      >
        <RalphControls
          sessionId={sessionId}
          status={session.status}
          iteration={session.currentIteration}
          maxIterations={session.maxIterations}
          onPause={() => pauseMutation.mutate()}
          onResume={() => resumeMutation.mutate()}
        />
      </PanelHeader>

      {/* Phase timeline */}
      <div className="border-b border-white/5">
        <PhaseTimeline
          currentPhase={currentPhase}
          completedPhases={completedPhases}
        />
      </div>

      {/* Verification badges */}
      <div className="border-b border-white/5">
        <VerificationBadges verifications={verifications} />
      </div>

      {/* Progress ledger */}
      <ProgressLedger ledger={ledger} phaseExecutions={phaseExecutions} />
    </Panel>
  );
}
