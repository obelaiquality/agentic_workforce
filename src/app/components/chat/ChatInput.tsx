import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Square, Settings2, Command, Paperclip } from "lucide-react";
import { cn } from "../ui/utils";
import { builtinCommands } from "../../../server/commands/builtinCommands";

const SMART_PASTE_THRESHOLD = 500;
const pasteStore = new Map<string, string>();

function hashContent(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36).slice(0, 8);
}

/** Retrieve a stored paste by its hash reference. */
export function getPasteContent(ref: string): string | undefined {
  const match = ref.match(/\[paste:([a-z0-9]+)\]/);
  if (!match) return undefined;
  return pasteStore.get(match[1]);
}

/** Get the count of stored pastes. */
export function getPasteStoreSize(): number {
  return pasteStore.size;
}

export interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop?: () => void;
  isStreaming?: boolean;
  isActing?: boolean;
  planModeEnabled?: boolean;
  onTogglePlanMode?: (enabled: boolean) => void;
  placeholder?: string;
}

interface SlashSuggestion {
  name: string;
  description: string;
  aliases?: string[];
}

const SLASH_COMMANDS: SlashSuggestion[] = builtinCommands.map((cmd) => ({
  name: cmd.name,
  description: cmd.description,
  aliases: cmd.aliases,
}));

export function ChatInput({
  value,
  onChange,
  onSend,
  onStop,
  isStreaming = false,
  isActing = false,
  planModeEnabled = false,
  onTogglePlanMode,
  placeholder = "Send a message...",
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showSlash, setShowSlash] = useState(false);
  const [slashFilter, setSlashFilter] = useState("");
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0);
  const popupRef = useRef<HTMLDivElement>(null);

  // Auto-grow textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  // Filter slash commands
  const filteredCommands = slashFilter
    ? SLASH_COMMANDS.filter(
        (cmd) =>
          cmd.name.startsWith(slashFilter) ||
          cmd.aliases?.some((a) => a.startsWith(slashFilter)),
      )
    : SLASH_COMMANDS;

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedSlashIndex(0);
  }, [slashFilter]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      onChange(newValue);

      // Slash command detection
      if (newValue.startsWith("/")) {
        const commandPart = newValue.slice(1).split(" ")[0];
        setSlashFilter(commandPart);
        setShowSlash(true);
      } else {
        setShowSlash(false);
        setSlashFilter("");
      }
    },
    [onChange],
  );

  const selectSlashCommand = useCallback(
    (cmd: SlashSuggestion) => {
      onChange(`/${cmd.name} `);
      setShowSlash(false);
      setSlashFilter("");
      textareaRef.current?.focus();
    },
    [onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Slash command navigation
      if (showSlash && filteredCommands.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedSlashIndex((prev) =>
            prev < filteredCommands.length - 1 ? prev + 1 : 0,
          );
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedSlashIndex((prev) =>
            prev > 0 ? prev - 1 : filteredCommands.length - 1,
          );
          return;
        }
        if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
          e.preventDefault();
          selectSlashCommand(filteredCommands[selectedSlashIndex]);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setShowSlash(false);
          return;
        }
      }

      // Send on Enter (without Shift)
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (value.trim() && !isActing) {
          onSend();
        }
      }
    },
    [showSlash, filteredCommands, selectedSlashIndex, selectSlashCommand, value, isActing, onSend],
  );

  const [pasteNotice, setPasteNotice] = useState<string | null>(null);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const pastedText = e.clipboardData.getData("text/plain");
      if (pastedText.length > SMART_PASTE_THRESHOLD) {
        e.preventDefault();
        const hash = hashContent(pastedText);
        pasteStore.set(hash, pastedText);
        const ref = `[paste:${hash}]`;
        const lines = pastedText.split("\n").length;
        const chars = pastedText.length;
        onChange(value + ref);
        setPasteNotice(`Large paste stored (${chars} chars, ${lines} lines) as ${ref}`);
        setTimeout(() => setPasteNotice(null), 4000);
      }
    },
    [onChange, value],
  );

  const canSend = value.trim().length > 0 && !isActing;

  return (
    <div className="border-t border-white/6 bg-[#0e0e10]" data-testid="chat-input">
      {pasteNotice && (
        <div className="mx-3 mt-1.5 flex items-center gap-2 rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-3 py-1.5 text-xs text-cyan-300">
          <Paperclip className="h-3 w-3 shrink-0" />
          {pasteNotice}
        </div>
      )}
      {/* Slash command popup */}
      {showSlash && filteredCommands.length > 0 && (
        <div
          ref={popupRef}
          className="mx-3 mb-1 max-h-52 overflow-y-auto rounded-xl border border-white/10 bg-[#161618] shadow-2xl shadow-black/50"
          data-testid="slash-popup"
        >
          {filteredCommands.map((cmd, idx) => (
            <button
              key={cmd.name}
              type="button"
              onClick={() => selectSlashCommand(cmd)}
              className={cn(
                "flex w-full items-start gap-3 px-3 py-2 text-left transition-colors",
                idx === selectedSlashIndex
                  ? "bg-cyan-500/10 text-cyan-100"
                  : "text-zinc-300 hover:bg-white/[0.03]",
              )}
            >
              <Command className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-zinc-500" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm">/{cmd.name}</span>
                  {cmd.aliases && cmd.aliases.length > 0 && (
                    <span className="text-[10px] text-zinc-600">
                      {cmd.aliases.map((a) => `/${a}`).join(", ")}
                    </span>
                  )}
                </div>
                <div className="text-xs text-zinc-500 mt-0.5 line-clamp-1">
                  {cmd.description}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2 px-3 py-2.5">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={placeholder}
          rows={1}
          disabled={isStreaming}
          data-testid="chat-input-textarea"
          className={cn(
            "flex-1 resize-none rounded-xl border border-white/10 bg-[#161618] px-3.5 py-2.5",
            "text-sm leading-relaxed text-zinc-100 outline-none",
            "placeholder:text-zinc-600",
            "focus:border-cyan-500/30 focus:ring-1 focus:ring-cyan-500/10",
            "disabled:cursor-not-allowed disabled:opacity-60",
            "transition-colors",
          )}
        />

        <div className="flex items-center gap-1.5 pb-0.5">
          {/* Plan mode toggle */}
          {onTogglePlanMode && (
            <button
              type="button"
              onClick={() => onTogglePlanMode(!planModeEnabled)}
              title={planModeEnabled ? "Plan mode on" : "Plan mode off"}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-lg border transition-colors",
                planModeEnabled
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                  : "border-white/10 bg-white/[0.03] text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-300",
              )}
            >
              <Settings2 className="h-3.5 w-3.5" />
            </button>
          )}

          {/* Stop / Send */}
          {isStreaming ? (
            <button
              type="button"
              onClick={onStop}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 transition-colors"
              title="Stop"
              data-testid="chat-stop-button"
            >
              <Square className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onSend}
              disabled={!canSend}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-lg border transition-colors",
                canSend
                  ? "border-cyan-500/30 bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25"
                  : "border-white/10 bg-white/[0.03] text-zinc-600 cursor-not-allowed",
              )}
              title="Send message"
              data-testid="chat-send-button"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-4 pb-2 text-[10px] text-zinc-600">
        <span>
          {isStreaming ? (
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
              Agent is responding...
            </span>
          ) : (
            "Enter to send, Shift+Enter for newline, / for commands"
          )}
        </span>
        {planModeEnabled && (
          <span className="text-amber-400/60">Plan mode</span>
        )}
      </div>
    </div>
  );
}
