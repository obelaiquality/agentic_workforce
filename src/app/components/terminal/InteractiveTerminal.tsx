import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal as TerminalIcon, Trash2 } from "lucide-react";
import { cn } from "../ui/utils";

// ---------------------------------------------------------------------------
// Types for the desktop bridge terminal API
// ---------------------------------------------------------------------------

interface ElectronTerminalApi {
  spawn: () => Promise<{ ok: boolean }>;
  write: (data: string) => Promise<void>;
  resize: (cols: number, rows: number) => Promise<void>;
  kill: () => Promise<void>;
  onData: (callback: (data: string) => void) => () => void;
}

function getElectronTerminal(): ElectronTerminalApi | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { electronTerminal?: ElectronTerminalApi }).electronTerminal;
}

// ---------------------------------------------------------------------------
// Attempt to load xterm lazily so the build doesn't break when it's absent.
// We use indirect dynamic imports via string variables so Vite's static
// import analysis does not try to resolve these modules at build time.
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
type XTermTerminal = any;
type XTermFitAddon = any;

interface XTermModules {
  Terminal: new (opts?: any) => XTermTerminal;
  FitAddon: new () => XTermFitAddon;
}

let xtermPromise: Promise<XTermModules> | null = null;

function loadXterm(): Promise<XTermModules> {
  if (!xtermPromise) {
    // String indirection prevents Vite from statically resolving these imports
    const xtermId = "xterm";
    const fitId = "@xterm/addon-fit";
    xtermPromise = Promise.all([
      import(/* @vite-ignore */ xtermId).catch(() => null),
      import(/* @vite-ignore */ fitId).catch(() => null),
    ]).then(([xtermMod, fitMod]) => {
      if (!xtermMod || !fitMod) {
        throw new Error("xterm_not_installed");
      }
      return {
        Terminal: xtermMod.Terminal,
        FitAddon: fitMod.FitAddon,
      };
    });
  }
  return xtermPromise;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function InteractiveTerminal() {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTermTerminal | null>(null);
  const fitAddonRef = useRef<XTermFitAddon | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const [status, setStatus] = useState<"loading" | "ready" | "no-xterm" | "no-electron">("loading");

  const electronTerminal = getElectronTerminal();
  const isElectron = Boolean(electronTerminal);

  // -----------------------------------------------------------------------
  // Clear / reset
  // -----------------------------------------------------------------------
  const handleClear = useCallback(() => {
    const term = terminalRef.current;
    if (term) {
      term.clear();
    }
  }, []);

  // -----------------------------------------------------------------------
  // Bootstrap
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!isElectron) {
      setStatus("no-electron");
      return;
    }

    let disposed = false;

    loadXterm()
      .then(async ({ Terminal, FitAddon }) => {
        if (disposed || !containerRef.current) return;

        // Import the xterm CSS - best-effort since the path may vary
        try {
          const cssId = "xterm/css/xterm.css";
          await import(/* @vite-ignore */ cssId);
        } catch {
          // CSS import may fail in test/SSR environments - that's fine
        }

        const fitAddon = new FitAddon();
        const term = new Terminal({
          cursorBlink: true,
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
          fontSize: 13,
          lineHeight: 1.35,
          theme: {
            background: "#0a0b0e",
            foreground: "#d4d4d8",
            cursor: "#22d3ee",
            selectionBackground: "rgba(34, 211, 238, 0.25)",
            black: "#18181b",
            red: "#fb7185",
            green: "#4ade80",
            yellow: "#facc15",
            blue: "#60a5fa",
            magenta: "#c084fc",
            cyan: "#22d3ee",
            white: "#d4d4d8",
            brightBlack: "#3f3f46",
            brightRed: "#fda4af",
            brightGreen: "#86efac",
            brightYellow: "#fde68a",
            brightBlue: "#93c5fd",
            brightMagenta: "#d8b4fe",
            brightCyan: "#67e8f9",
            brightWhite: "#fafafa",
          },
          scrollback: 5000,
          allowTransparency: true,
        });

        term.loadAddon(fitAddon);
        term.open(containerRef.current);

        try {
          fitAddon.fit();
        } catch {
          // fit can throw if container has zero dimensions
        }

        terminalRef.current = term;
        fitAddonRef.current = fitAddon;

        // Wire up IPC
        const api = getElectronTerminal();
        if (api) {
          const unsubData = api.onData((data: string) => {
            term.write(data);
          });

          term.onData((data: string) => {
            void api.write(data);
          });

          // Spawn the shell
          await api.spawn();

          // Send initial resize
          try {
            fitAddon.fit();
            await api.resize(term.cols, term.rows);
          } catch {
            // ignore
          }

          cleanupRef.current = () => {
            unsubData();
            void api.kill();
          };
        }

        // Handle container resize
        const resizeObserver = new ResizeObserver(() => {
          try {
            fitAddon.fit();
            const api2 = getElectronTerminal();
            if (api2 && term.cols && term.rows) {
              void api2.resize(term.cols, term.rows);
            }
          } catch {
            // ignore
          }
        });

        if (containerRef.current) {
          resizeObserver.observe(containerRef.current);
        }

        setStatus("ready");

        // Augment cleanup
        const prevCleanup = cleanupRef.current;
        cleanupRef.current = () => {
          prevCleanup?.();
          resizeObserver.disconnect();
          term.dispose();
        };
      })
      .catch(() => {
        if (!disposed) {
          setStatus("no-xterm");
        }
      });

    return () => {
      disposed = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [isElectron]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  if (status === "no-electron") {
    return (
      <div data-testid="terminal-no-electron" className="flex flex-col items-center justify-center h-full gap-3 text-zinc-500">
        <TerminalIcon className="h-8 w-8" />
        <p className="text-sm">Terminal requires the desktop app</p>
        <p className="text-xs text-zinc-600">
          The interactive terminal is only available when running in Electron.
        </p>
      </div>
    );
  }

  if (status === "no-xterm") {
    return (
      <div data-testid="terminal-no-xterm" className="flex flex-col items-center justify-center h-full gap-3 text-zinc-500">
        <TerminalIcon className="h-8 w-8" />
        <p className="text-sm">Install xterm and @xterm/addon-fit to enable the interactive terminal</p>
        <p className="text-xs text-zinc-600 font-mono">npm install xterm @xterm/addon-fit</p>
      </div>
    );
  }

  return (
    <div data-testid="terminal-root" className="flex flex-col h-full">
      {/* Header */}
      <div
        data-testid="terminal-header"
        className="flex items-center gap-2 px-4 py-2.5 border-b border-white/6 bg-zinc-900/30 shrink-0"
      >
        <TerminalIcon className="h-3.5 w-3.5 text-cyan-400" />
        <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-400 font-mono">
          Terminal
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {status === "loading" && (
            <span className="text-[10px] text-zinc-600 font-mono">connecting...</span>
          )}
          <button
            data-testid="terminal-clear-button"
            type="button"
            onClick={handleClear}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border border-white/8 bg-white/[0.04] px-2 py-1",
              "text-[10px] uppercase tracking-[0.12em] text-zinc-400 transition hover:bg-white/[0.08] hover:text-zinc-200"
            )}
            title="Clear terminal output"
          >
            <Trash2 className="h-3 w-3" />
            Clear
          </button>
        </div>
      </div>

      {/* Terminal container */}
      <div
        ref={containerRef}
        data-testid="terminal-container"
        className="flex-1 min-h-0 bg-[#0a0b0e] p-1"
      />
    </div>
  );
}
