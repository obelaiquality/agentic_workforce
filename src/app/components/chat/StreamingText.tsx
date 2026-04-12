import { cn } from "../ui/utils";

export interface StreamingTextProps {
  text: string;
  isStreaming?: boolean;
  className?: string;
}

export function StreamingText({ text, isStreaming = true, className }: StreamingTextProps) {
  if (!text && !isStreaming) {
    return null;
  }

  return (
    <span className={cn("whitespace-pre-wrap", className)} data-testid="streaming-text">
      {text}
      {isStreaming && (
        <span
          className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-cyan-400 align-text-bottom"
          aria-hidden
          data-testid="streaming-cursor"
        />
      )}
    </span>
  );
}
