/**
 * Lightweight client-side error reporter.
 *
 * Sends uncaught React errors (captured by ErrorBoundary) to the
 * backend telemetry endpoint for visibility in the Console view.
 *
 * Best-effort — silently swallows network failures so a broken
 * backend never cascades into the frontend error boundary itself.
 */

import { getDesktopBridge } from "./desktopBridge";

export interface ClientErrorReport {
  message: string;
  componentStack?: string;
  source: "error_boundary" | "unhandled_rejection" | "unhandled_error";
  timestamp: string;
  url?: string;
}

/**
 * Post a client-side error report to the backend.
 * Fire-and-forget — never throws.
 */
export function reportClientError(report: ClientErrorReport): void {
  try {
    const bridge = getDesktopBridge();
    if (bridge) {
      bridge
        .apiRequest({
          method: "POST",
          path: "/api/telemetry/client-error",
          body: report,
        })
        .catch(() => {
          /* swallow — backend may be down */
        });
      return;
    }

    // Fallback for non-Electron environments (web preview)
    const baseUrl = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8787";
    const token = import.meta.env.VITE_API_TOKEN || "";
    fetch(`${baseUrl}/api/telemetry/client-error`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "x-local-api-token": token } : {}),
      },
      body: JSON.stringify(report),
    }).catch(() => {
      /* swallow */
    });
  } catch {
    /* never throw from the reporter */
  }
}
