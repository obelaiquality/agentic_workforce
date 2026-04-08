import { useState } from "react";
import { cn, Button } from "../../UI";
import { Send } from "lucide-react";

interface MessageDto {
  id: string;
  fromWorkerId: string;
  toWorkerId: string | null;
  content: string;
  read: boolean;
  createdAt: string;
}

interface MessageLogProps {
  messages: MessageDto[];
  onSend?: (content: string) => void;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "";
  }
}

export function MessageLog({ messages, onSend }: MessageLogProps) {
  const [draft, setDraft] = useState("");

  function handleSend() {
    const trimmed = draft.trim();
    if (!trimmed || !onSend) return;
    onSend(trimmed);
    setDraft("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex flex-col gap-2 px-5 py-4">
      <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="text-xs text-zinc-600 italic py-2">No messages yet.</div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "rounded-md border border-white/5 bg-zinc-900/40 px-3 py-2 text-sm",
                !msg.read && "border-blue-500/20",
              )}
            >
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs font-medium text-zinc-300">{msg.fromWorkerId}</span>
                {msg.toWorkerId ? (
                  <span className="text-xs text-zinc-500">
                    &rarr; {msg.toWorkerId}
                  </span>
                ) : (
                  <span className="text-xs text-zinc-600">broadcast</span>
                )}
                <span className="ml-auto text-[10px] text-zinc-600">{formatTime(msg.createdAt)}</span>
              </div>
              <p className="text-zinc-400 text-xs whitespace-pre-wrap">{msg.content}</p>
            </div>
          ))
        )}
      </div>

      {onSend && (
        <div className="flex items-center gap-2 pt-2 border-t border-white/5">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Send a message..."
            className="flex-1 bg-zinc-900/60 border border-white/10 rounded-md px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-purple-500/50"
          />
          <Button variant="subtle" onClick={handleSend} disabled={!draft.trim()}>
            <Send className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
