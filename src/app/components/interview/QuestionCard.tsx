import { useState } from "react";
import { MessageCircle, Target } from "lucide-react";
import { cn, Chip, Button } from "../UI";

export interface QuestionCardQuestion {
  id: string;
  question: string;
  round: number;
  challengeMode?: string;
  targetDimension: string;
  answer?: string;
}

const challengeVariant: Record<string, "warn" | "subtle" | "ok"> = {
  contrarian: "warn",
  simplifier: "subtle",
  ontologist: "ok",
};

export function QuestionCard({
  question,
  onSubmit,
  isSubmitting,
}: {
  question: QuestionCardQuestion;
  onSubmit: (answer: string) => void;
  isSubmitting: boolean;
}) {
  const [draft, setDraft] = useState("");

  const handleSubmit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setDraft("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="rounded-lg border border-white/10 bg-zinc-950/50 p-4 space-y-3">
      {/* Header badges */}
      <div className="flex items-center gap-2 flex-wrap">
        <Chip variant="subtle" className="text-[10px]">
          Round {question.round}
        </Chip>
        {question.challengeMode && (
          <Chip
            variant={challengeVariant[question.challengeMode] ?? "subtle"}
            className="text-[10px]"
          >
            {question.challengeMode}
          </Chip>
        )}
        <Chip variant="ok" className="text-[10px]">
          <Target className="h-3 w-3 mr-1 inline" />
          {question.targetDimension}
        </Chip>
      </div>

      {/* Question text */}
      <div className="flex items-start gap-2">
        <MessageCircle className="h-4 w-4 mt-0.5 shrink-0 text-purple-400" />
        <p className="text-sm text-zinc-200 leading-relaxed">
          {question.question}
        </p>
      </div>

      {/* Answer section */}
      {question.answer ? (
        <div className="rounded-md border border-white/5 bg-white/[0.02] px-3 py-2">
          <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-1">
            Your Answer
          </div>
          <p className="text-xs text-zinc-300 whitespace-pre-wrap">
            {question.answer}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your answer..."
            disabled={isSubmitting}
            rows={3}
            className={cn(
              "w-full rounded-md border border-white/10 bg-zinc-900/80 px-3 py-2",
              "text-sm text-zinc-200 placeholder:text-zinc-600",
              "focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/30",
              "resize-none disabled:opacity-50 disabled:cursor-not-allowed",
            )}
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-zinc-600">
              Cmd+Enter to submit
            </span>
            <Button
              variant="primary"
              onClick={handleSubmit}
              disabled={isSubmitting || !draft.trim()}
            >
              {isSubmitting ? "Submitting..." : "Submit Answer"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
