import { useEffect, useRef } from "react";
import { MessageCircle } from "lucide-react";
import { MessageBubble } from "./MessageBubble";
import { StreamingText } from "./StreamingText";
import { ToolCallInline } from "./ToolCallInline";
import type { ChatMessageDto, AgenticToolCallRecord } from "../../../shared/contracts";

export interface ConversationThreadProps {
  messages: ChatMessageDto[];
  /** Live streaming assistant text (token-by-token) */
  streamingText?: string;
  /** Whether the agent is currently streaming */
  isStreaming?: boolean;
  /** Tool calls to render inline between messages */
  toolCalls?: AgenticToolCallRecord[];
}

function formatDividerDate(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const isToday =
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear();
    if (isToday) {
      return `Today at ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric" }) +
      ` at ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  } catch {
    return "";
  }
}

function shouldShowDivider(current: ChatMessageDto, previous: ChatMessageDto | undefined): boolean {
  if (!previous) return false;
  // Show divider when role changes from assistant to user (new turn)
  if (previous.role === "assistant" && current.role === "user") return true;
  // Or after more than 5 minutes gap
  try {
    const gap = new Date(current.createdAt).getTime() - new Date(previous.createdAt).getTime();
    return gap > 5 * 60 * 1000;
  } catch {
    return false;
  }
}

function isGroupStart(current: ChatMessageDto, previous: ChatMessageDto | undefined): boolean {
  if (!previous) return true;
  return previous.role !== current.role;
}

export function ConversationThread({
  messages,
  streamingText,
  isStreaming = false,
  toolCalls = [],
}: ConversationThreadProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages or streaming text
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Only auto-scroll if user is near the bottom (within 120px)
    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < 120;

    if (isNearBottom && endRef.current?.scrollIntoView) {
      endRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length, streamingText]);

  if (messages.length === 0 && !isStreaming) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center"
        data-testid="conversation-empty"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/6 bg-white/[0.02]">
          <MessageCircle className="h-5 w-5 text-zinc-600" />
        </div>
        <div className="text-sm text-zinc-500">Start a conversation to begin</div>
        <div className="text-xs text-zinc-600">
          Type a message below or use /help to see available commands
        </div>
      </div>
    );
  }

  // Find tool calls that should appear after the last assistant message
  // (tool calls made during the current streaming turn)
  const pendingToolCalls = toolCalls.filter((tc) => {
    // Show tool calls that don't yet have a corresponding message
    const lastAssistantMsg = [...messages].reverse().find((m) => m.role === "assistant");
    if (!lastAssistantMsg) return true;
    try {
      return new Date(tc.timestamp).getTime() >= new Date(lastAssistantMsg.createdAt).getTime();
    } catch {
      return true;
    }
  });

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto px-4 py-4 space-y-2"
      data-testid="conversation-thread"
    >
      {messages.map((msg, idx) => {
        const prev = idx > 0 ? messages[idx - 1] : undefined;
        const showDivider = shouldShowDivider(msg, prev);
        const groupStart = isGroupStart(msg, prev);
        const msgIsStreaming = Boolean(
          msg.metadata?.streaming && isStreaming,
        );

        return (
          <div key={msg.id}>
            {showDivider && (
              <div className="flex items-center gap-3 py-3" data-testid="turn-divider">
                <div className="h-px flex-1 bg-white/6" />
                <span className="text-[10px] text-zinc-600 whitespace-nowrap">
                  {formatDividerDate(msg.createdAt)}
                </span>
                <div className="h-px flex-1 bg-white/6" />
              </div>
            )}
            <MessageBubble
              id={msg.id}
              role={msg.role as "user" | "assistant" | "system"}
              content={msg.content}
              createdAt={msg.createdAt}
              isStreaming={msgIsStreaming}
              isGroupStart={groupStart}
            />
          </div>
        );
      })}

      {/* Inline tool calls during streaming */}
      {pendingToolCalls.length > 0 && (
        <div className="pl-9">
          {pendingToolCalls.map((tc) => (
            <ToolCallInline key={tc.id} call={tc} />
          ))}
        </div>
      )}

      {/* Live streaming text when no streaming message in the messages array */}
      {isStreaming && streamingText && !messages.some((m) => m.metadata?.streaming) && (
        <div className="flex gap-2.5">
          <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-violet-500/15 text-violet-400">
            <MessageCircle className="h-3.5 w-3.5" />
          </div>
          <div className="max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed bg-[#1a1a1e] text-zinc-200 border border-white/6">
            <div className="mb-1 text-[10px] font-medium uppercase tracking-[0.18em] text-violet-400/70">
              Agent
            </div>
            <StreamingText text={streamingText} isStreaming />
          </div>
        </div>
      )}

      <div ref={endRef} />
    </div>
  );
}
