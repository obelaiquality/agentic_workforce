import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bot, User, Info } from "lucide-react";
import { cn } from "../ui/utils";
import { StreamingText } from "./StreamingText";
import type { ChatRole } from "../../../shared/contracts";

export interface MessageBubbleProps {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  isStreaming?: boolean;
  isGroupStart?: boolean;
}

const ROLE_ICON: Record<ChatRole, React.ReactNode> = {
  user: <User className="h-3.5 w-3.5" />,
  assistant: <Bot className="h-3.5 w-3.5" />,
  system: <Info className="h-3.5 w-3.5" />,
};

const ROLE_LABEL: Record<ChatRole, string> = {
  user: "You",
  assistant: "Agent",
  system: "System",
};

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function MessageBubble({
  id,
  role,
  content,
  createdAt,
  isStreaming = false,
  isGroupStart = true,
}: MessageBubbleProps) {
  const [hovered, setHovered] = useState(false);

  if (role === "system") {
    return (
      <div
        className="flex justify-center py-1.5"
        data-testid={`message-${id}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div className="flex items-center gap-1.5 rounded-full border border-white/6 bg-white/[0.02] px-3 py-1 text-[11px] text-zinc-500">
          <Info className="h-3 w-3" />
          <span>{content}</span>
        </div>
        {hovered && (
          <span className="ml-2 self-center text-[10px] text-zinc-600">
            {formatTime(createdAt)}
          </span>
        )}
      </div>
    );
  }

  const isUser = role === "user";

  return (
    <div
      className={cn("flex gap-2.5", isUser ? "flex-row-reverse" : "flex-row")}
      data-testid={`message-${id}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Avatar */}
      {isGroupStart ? (
        <div
          className={cn(
            "mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full",
            isUser
              ? "bg-cyan-500/15 text-cyan-400"
              : "bg-violet-500/15 text-violet-400",
          )}
        >
          {ROLE_ICON[role]}
        </div>
      ) : (
        <div className="w-7 flex-shrink-0" />
      )}

      {/* Bubble */}
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
          isUser
            ? "bg-cyan-500/12 text-cyan-50 border border-cyan-500/15"
            : "bg-[#1a1a1e] text-zinc-200 border border-white/6",
        )}
      >
        {isGroupStart && (
          <div
            className={cn(
              "mb-1 text-[10px] font-medium uppercase tracking-[0.18em]",
              isUser ? "text-cyan-400/70" : "text-violet-400/70",
            )}
          >
            {ROLE_LABEL[role]}
          </div>
        )}

        {isStreaming ? (
          <StreamingText text={content} isStreaming />
        ) : (
          <div className="chat-markdown prose prose-invert prose-sm max-w-none prose-p:my-1 prose-pre:my-2 prose-pre:bg-black/30 prose-pre:border prose-pre:border-white/6 prose-code:text-cyan-300 prose-code:text-xs prose-headings:text-zinc-100 prose-a:text-cyan-400">
            <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
          </div>
        )}
      </div>

      {/* Timestamp on hover */}
      {hovered && (
        <span
          className={cn(
            "self-end text-[10px] text-zinc-600 whitespace-nowrap",
            isUser ? "mr-1" : "ml-1",
          )}
        >
          {formatTime(createdAt)}
        </span>
      )}
    </div>
  );
}
