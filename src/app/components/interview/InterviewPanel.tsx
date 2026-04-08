import { useState, useMemo } from "react";
import { MessageCircle, ChevronDown, ChevronRight, CheckCircle2 } from "lucide-react";
import { cn, Chip, Panel, PanelHeader } from "../UI";
import {
  useInterviewSession,
  useInterviewStream,
  useSubmitAnswer,
  useHandoff,
} from "../../hooks/useInterviewMode";
import type { InterviewDimensions } from "../../../shared/contracts";
import { AmbiguityChart } from "./AmbiguityChart";
import { DimensionRadar } from "./DimensionRadar";
import { QuestionCard } from "./QuestionCard";
import { HandoffSelector } from "./HandoffSelector";

export function InterviewPanel({ sessionId }: { sessionId: string }) {
  const { data, isLoading } = useInterviewSession(sessionId);
  const { latestScores, isConnected } = useInterviewStream(sessionId);
  const submitAnswer = useSubmitAnswer(sessionId);
  const handoff = useHandoff(sessionId);
  const [showPrevious, setShowPrevious] = useState(false);

  const session = data?.session ?? null;

  // Merge server scores with live SSE scores
  const allScores = useMemo(() => {
    const serverScores = session?.scores ?? [];
    const serverRounds = new Set(serverScores.map((s) => s.round));
    const merged = [...serverScores];
    for (const s of latestScores) {
      if (!serverRounds.has(s.round)) {
        merged.push(s);
      }
    }
    return merged.sort((a, b) => a.round - b.round);
  }, [session?.scores, latestScores]);

  const ambiguityData = useMemo(
    () => allScores.map((s) => ({ round: s.round, overall: s.overall })),
    [allScores],
  );

  const latestDimensions: InterviewDimensions | null = useMemo(() => {
    if (allScores.length === 0) return null;
    return allScores[allScores.length - 1].dimensions;
  }, [allScores]);

  const questions = session?.questions ?? [];
  const currentQuestion = questions.find((q) => !q.answer);
  const answeredQuestions = questions.filter((q) => !!q.answer);
  const isCrystallized = session?.status === "crystallized" || session?.status === "handed_off" || session?.status === "completed";

  if (isLoading) {
    return (
      <Panel>
        <PanelHeader title="Interview" />
        <div className="p-8 flex items-center justify-center">
          <div className="text-sm text-zinc-500 animate-pulse">Loading session...</div>
        </div>
      </Panel>
    );
  }

  if (!session) {
    return (
      <Panel>
        <PanelHeader title="Interview" />
        <div className="p-8 flex items-center justify-center">
          <div className="text-sm text-zinc-500">Session not found</div>
        </div>
      </Panel>
    );
  }

  return (
    <Panel>
      {/* Header */}
      <PanelHeader
        title={
          <span className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-purple-400" />
            <span className="truncate max-w-xs">
              Interview: &ldquo;{session.objective}&rdquo;
            </span>
          </span>
        }
      >
        <div className="flex items-center gap-2">
          {isConnected && (
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          )}
          <Chip
            variant={isCrystallized ? "ok" : "subtle"}
            className="text-[10px]"
          >
            {isCrystallized
              ? "crystallized"
              : `Round ${session.currentRound}/${session.maxRounds}`}
          </Chip>
        </div>
      </PanelHeader>

      <div className="p-4 space-y-4 overflow-y-auto">
        {/* Charts row */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-white/5 bg-zinc-950/50 p-3">
            <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-2">
              Ambiguity Over Rounds
            </div>
            <div className="h-40">
              <AmbiguityChart
                scores={ambiguityData}
                threshold={session.ambiguityThreshold}
              />
            </div>
          </div>
          <div className="rounded-lg border border-white/5 bg-zinc-950/50 p-3">
            <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-2">
              Dimension Coverage
            </div>
            <div className="h-40">
              {latestDimensions ? (
                <DimensionRadar dimensions={latestDimensions} />
              ) : (
                <div className="flex items-center justify-center h-full text-xs text-zinc-500">
                  Waiting for first score
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Current question or handoff */}
        {isCrystallized && session.specContent ? (
          <HandoffSelector
            onHandoff={(mode) => handoff.mutate(mode)}
            specContent={session.specContent}
          />
        ) : currentQuestion ? (
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-2">
              Current Question
            </div>
            <QuestionCard
              question={currentQuestion}
              onSubmit={(answer) => submitAnswer.mutate({ questionId: currentQuestion.id, answer })}
              isSubmitting={submitAnswer.isPending}
            />
          </div>
        ) : (
          <div className="rounded-lg border border-white/5 bg-zinc-950/50 p-4 text-center">
            <CheckCircle2 className="h-5 w-5 text-emerald-400 mx-auto mb-2" />
            <div className="text-sm text-zinc-300">
              All questions answered. Waiting for next round...
            </div>
          </div>
        )}

        {/* Previous Q&A (collapsible) */}
        {answeredQuestions.length > 0 && (
          <div className="rounded-lg border border-white/5 bg-zinc-950/50 overflow-hidden">
            <button
              onClick={() => setShowPrevious((v) => !v)}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-white/[0.02] transition-colors"
            >
              {showPrevious ? (
                <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />
              )}
              <span className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                Previous Q&amp;A ({answeredQuestions.length})
              </span>
            </button>
            {showPrevious && (
              <div className="px-4 pb-4 space-y-3">
                {answeredQuestions.map((q) => (
                  <QuestionCard
                    key={q.id}
                    question={q}
                    onSubmit={() => {}}
                    isSubmitting={false}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
