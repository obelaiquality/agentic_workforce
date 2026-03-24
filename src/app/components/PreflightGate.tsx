import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, RefreshCw, ShieldAlert } from "lucide-react";
import { getDesktopBridge, type DesktopPreflightCheck, type DesktopPreflightState } from "../lib/desktopBridge";

const PREFLIGHT_DISMISSED_KEY = "mission-control-preflight-dismissed";

export function PreflightGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DesktopPreflightState | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.sessionStorage.getItem(PREFLIGHT_DISMISSED_KEY) === "1";
  });
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const desktopBridge = getDesktopBridge();
    if (!desktopBridge?.getPreflight) {
      return;
    }

    setLoading(true);
    try {
      const preflight = await desktopBridge.getPreflight();
      setState(preflight);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const failingChecks = useMemo<DesktopPreflightCheck[]>(() => {
    return (state?.checks ?? []).filter((check) => !check.ok);
  }, [state?.checks]);

  const hasIssues = failingChecks.length > 0;

  return (
    <>
      {children}
      {hasIssues && !dismissed && (
        <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl rounded-xl border border-amber-500/30 bg-[#101013] shadow-2xl">
            <div className="px-5 py-4 border-b border-white/10 flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-amber-400" />
              <div>
                <h2 className="text-sm text-zinc-100 font-semibold">Preflight Checks Need Attention</h2>
                <p className="text-xs text-zinc-500 mt-0.5">Fix these before relying on agent execution.</p>
              </div>
            </div>

            <div className="p-4 space-y-2 max-h-[420px] overflow-y-auto custom-scrollbar">
              {failingChecks.map((check) => (
                <article
                  key={check.key}
                  className={`rounded-md border p-3 ${
                    check.severity === "error"
                      ? "border-rose-500/30 bg-rose-500/10"
                      : "border-amber-500/30 bg-amber-500/10"
                  }`}
                >
                  <div className="flex items-center gap-2 text-xs">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span className="uppercase tracking-wide">{check.key}</span>
                  </div>
                  <p className="text-xs text-zinc-200 mt-1 whitespace-pre-wrap">{check.message}</p>
                </article>
              ))}
            </div>

            <div className="px-5 py-3 border-t border-white/10 flex items-center justify-between">
              <div className="text-[11px] text-zinc-500">Last checked: {state?.checkedAt ?? "-"}</div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void load()}
                  className="px-3 py-1.5 rounded-md border border-white/15 bg-zinc-900/40 text-xs text-zinc-200"
                  disabled={loading}
                >
                  <RefreshCw className="w-3.5 h-3.5 inline mr-1" /> Retry checks
                </button>
                <button
                  onClick={() => {
                    setDismissed(true);
                    window.sessionStorage.setItem(PREFLIGHT_DISMISSED_KEY, "1");
                  }}
                  className="px-3 py-1.5 rounded-md border border-amber-500/30 bg-amber-500/20 text-xs text-amber-200"
                >
                  Continue anyway
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
