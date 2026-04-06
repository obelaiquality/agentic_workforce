import { useEffect, useState } from "react";
import { X } from "lucide-react";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
const mod = isMac ? "\u2318" : "Ctrl";

const SHORTCUT_GROUPS = [
  {
    title: "Navigation",
    shortcuts: [
      { keys: `${mod} + 1`, description: "Go to Work" },
      { keys: `${mod} + 2`, description: "Go to Codebase" },
      { keys: `${mod} + 3`, description: "Go to Console" },
      { keys: `${mod} + 4`, description: "Go to Projects" },
      { keys: `${mod} + 5`, description: "Go to Settings" },
    ],
  },
  {
    title: "Commands",
    shortcuts: [
      { keys: `${mod} + K`, description: "Open command palette" },
      { keys: "?", description: "Show keyboard shortcuts" },
      { keys: "Esc", description: "Close dialog / palette" },
    ],
  },
];

export function KeyboardShortcutsDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement)?.isContentEditable) return;

      if (e.key === "?" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
      <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-[#101013]/95 shadow-[0_20px_80px_rgba(0,0,0,0.6)] backdrop-blur-xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/8 px-5 py-3">
          <h2 className="text-sm font-semibold text-white">Keyboard Shortcuts</h2>
          <button
            onClick={() => setOpen(false)}
            className="rounded-lg p-1 text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-300 transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5 space-y-5 max-h-[60vh] overflow-y-auto custom-scrollbar">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="text-[10px] uppercase tracking-[0.15em] text-zinc-600 font-medium mb-2">
                {group.title}
              </h3>
              <div className="space-y-1">
                {group.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.keys}
                    className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-white/[0.03]"
                  >
                    <span className="text-sm text-zinc-300">{shortcut.description}</span>
                    <kbd className="rounded border border-white/10 bg-white/[0.04] px-2 py-0.5 text-xs text-zinc-500 font-mono">
                      {shortcut.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-white/8 px-5 py-2.5">
          <p className="text-[10px] text-zinc-600">
            Press <kbd className="font-mono">?</kbd> to toggle this dialog
          </p>
        </div>
      </div>
    </div>
  );
}
