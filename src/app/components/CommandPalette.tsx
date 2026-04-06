import { useEffect, useState, useCallback } from "react";
import { Command as CommandPrimitive } from "cmdk";
import {
  Activity,
  Code2,
  Terminal,
  FolderGit2,
  Settings,
  Brain,
  Rocket,
  Keyboard,
  Search,
  Beaker,
  BarChart3,
  Layers,
} from "lucide-react";
import { useUiStore } from "../store/uiStore";

type Action = {
  id: string;
  label: string;
  icon: React.ReactNode;
  group: string;
  shortcut?: string;
  onSelect: () => void;
};

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const setActiveSection = useUiStore((s) => s.setActiveSection);
  const setSettingsFocusTarget = useUiStore((s) => s.setSettingsFocusTarget);
  const labsMode = useUiStore((s) => s.labsMode);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
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

  const navigate = useCallback(
    (section: string) => {
      setActiveSection(section as any);
      setOpen(false);
    },
    [setActiveSection],
  );

  const openSettings = useCallback(
    (target: "providers" | "execution_profiles") => {
      setActiveSection("settings");
      setSettingsFocusTarget(target);
      setOpen(false);
    },
    [setActiveSection, setSettingsFocusTarget],
  );

  const actions: Action[] = [
    // Navigation
    { id: "nav-work", label: "Go to Work", icon: <Activity className="h-4 w-4" />, group: "Navigation", shortcut: "\u2318 1", onSelect: () => navigate("live") },
    { id: "nav-codebase", label: "Go to Codebase", icon: <Code2 className="h-4 w-4" />, group: "Navigation", shortcut: "\u2318 2", onSelect: () => navigate("codebase") },
    { id: "nav-console", label: "Go to Console", icon: <Terminal className="h-4 w-4" />, group: "Navigation", shortcut: "\u2318 3", onSelect: () => navigate("console") },
    { id: "nav-projects", label: "Go to Projects", icon: <FolderGit2 className="h-4 w-4" />, group: "Navigation", shortcut: "\u2318 4", onSelect: () => navigate("projects") },
    { id: "nav-settings", label: "Go to Settings", icon: <Settings className="h-4 w-4" />, group: "Navigation", shortcut: "\u2318 5", onSelect: () => navigate("settings") },

    // Quick actions
    { id: "act-essentials", label: "Open Essentials", icon: <Settings className="h-4 w-4" />, group: "Quick Actions", onSelect: () => openSettings("providers") },
    { id: "act-advanced", label: "Open Advanced Settings", icon: <Layers className="h-4 w-4" />, group: "Quick Actions", onSelect: () => openSettings("execution_profiles") },
    { id: "act-learnings", label: "Open Learnings Lab", icon: <Brain className="h-4 w-4" />, group: "Quick Actions", onSelect: () => navigate("learnings") },
    { id: "act-distillation", label: "Open Distillation", icon: <Rocket className="h-4 w-4" />, group: "Quick Actions", onSelect: () => navigate("distillation") },
    { id: "act-benchmarks", label: "Open Benchmarks", icon: <BarChart3 className="h-4 w-4" />, group: "Quick Actions", onSelect: () => navigate("benchmarks") },

    // Labs-only
    ...(labsMode
      ? [
          { id: "act-telemetry", label: "Open Telemetry", icon: <Beaker className="h-4 w-4" />, group: "Labs", onSelect: () => navigate("live") },
        ]
      : []),
  ];

  const groups = [...new Set(actions.map((a) => a.group))];

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[20vh]">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
      <div className="relative w-full max-w-lg rounded-2xl border border-white/10 bg-[#101013]/95 shadow-[0_20px_80px_rgba(0,0,0,0.6)] backdrop-blur-xl overflow-hidden">
        <CommandPrimitive
          className="flex flex-col"
          loop
        >
          <div className="flex items-center gap-2 border-b border-white/8 px-4 py-3">
            <Search className="h-4 w-4 text-zinc-500 shrink-0" />
            <CommandPrimitive.Input
              placeholder="Type a command or search..."
              className="flex-1 bg-transparent text-sm text-zinc-200 placeholder:text-zinc-600 outline-none"
              autoFocus
            />
            <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-zinc-500 font-mono">
              ESC
            </kbd>
          </div>
          <CommandPrimitive.List className="max-h-[320px] overflow-y-auto p-2 custom-scrollbar">
            <CommandPrimitive.Empty className="py-8 text-center text-sm text-zinc-500">
              No results found.
            </CommandPrimitive.Empty>
            {groups.map((group) => (
              <CommandPrimitive.Group
                key={group}
                heading={group}
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.15em] [&_[cmdk-group-heading]]:text-zinc-600 [&_[cmdk-group-heading]]:font-medium"
              >
                {actions
                  .filter((a) => a.group === group)
                  .map((action) => (
                    <CommandPrimitive.Item
                      key={action.id}
                      value={action.label}
                      onSelect={action.onSelect}
                      className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-zinc-300 cursor-pointer transition-colors data-[selected=true]:bg-white/[0.06] data-[selected=true]:text-white"
                    >
                      <span className="text-zinc-500">{action.icon}</span>
                      <span className="flex-1">{action.label}</span>
                      {action.shortcut && (
                        <kbd className="text-[10px] text-zinc-600 font-mono tracking-wider">
                          {action.shortcut}
                        </kbd>
                      )}
                    </CommandPrimitive.Item>
                  ))}
              </CommandPrimitive.Group>
            ))}
          </CommandPrimitive.List>
          <div className="border-t border-white/8 px-4 py-2 flex items-center justify-between">
            <div className="flex items-center gap-3 text-[10px] text-zinc-600">
              <span className="flex items-center gap-1">
                <Keyboard className="h-3 w-3" />
                Navigate
              </span>
              <span>Enter to select</span>
            </div>
            <span className="text-[10px] text-zinc-700">
              <kbd className="font-mono">{"\u2318"}K</kbd> to toggle
            </span>
          </div>
        </CommandPrimitive>
      </div>
    </div>
  );
}
