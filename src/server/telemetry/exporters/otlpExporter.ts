/**
 * OTLP (OpenTelemetry Protocol) exporter for telemetry spans.
 *
 * Sends spans in OTLP JSON format via HTTP POST to a configurable endpoint.
 * Uses native fetch() — no external dependencies.
 * Fire-and-forget by default; gracefully handles unreachable endpoints.
 */

import type { ExportedSpan } from "./jsonFileExporter";

export interface OtlpConfig {
  /** OTLP endpoint URL, e.g. "http://localhost:4318/v1/traces" */
  endpoint: string;
  /** Optional headers to include in the request */
  headers?: Record<string, string>;
  /** Whether the exporter is enabled */
  enabled: boolean;
}

/**
 * Exports telemetry spans to an OTLP-compatible collector.
 */
export class OtlpExporter {
  constructor(private readonly config: OtlpConfig) {}

  /**
   * Send spans in OTLP JSON format.
   * Returns success/failure — never throws.
   */
  async exportSpans(
    spans: ExportedSpan[],
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.config.enabled) {
      return { success: false, error: "Exporter is disabled" };
    }

    if (spans.length === 0) {
      return { success: true };
    }

    const body = this.buildOtlpPayload(spans);

    try {
      const response = await fetch(this.config.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.config.headers,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }

  /**
   * Check whether the exporter is enabled and the endpoint is reachable.
   */
  async healthCheck(): Promise<boolean> {
    if (!this.config.enabled) return false;

    try {
      const response = await fetch(this.config.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.config.headers,
        },
        body: JSON.stringify({ resourceSpans: [] }),
      });
      // Accept any 2xx or 4xx (reachable even if payload rejected)
      return response.status < 500;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private buildOtlpPayload(spans: ExportedSpan[]): unknown {
    return {
      resourceSpans: [
        {
          resource: {
            attributes: [
              {
                key: "service.name",
                value: { stringValue: "agentic-workforce" },
              },
            ],
          },
          scopeSpans: [
            {
              scope: { name: "agentic-workforce-telemetry" },
              spans: spans.map((span) => this.mapSpan(span)),
            },
          ],
        },
      ],
    };
  }

  private mapSpan(span: ExportedSpan): unknown {
    const statusCode =
      span.status === "ok"
        ? "STATUS_CODE_OK"
        : span.status === "error"
          ? "STATUS_CODE_ERROR"
          : "STATUS_CODE_UNSET";

    return {
      name: span.name,
      kind: 1, // INTERNAL
      startTimeUnixNano: span.startTime * 1_000_000,
      endTimeUnixNano: span.endTime ? span.endTime * 1_000_000 : undefined,
      attributes: Object.entries(span.attributes).map(([key, value]) => ({
        key,
        value: this.formatValue(value),
      })),
      status: { code: statusCode },
      events: span.events.map((event) => ({
        name: event.name,
        timeUnixNano: event.timestamp * 1_000_000,
      })),
    };
  }

  private formatValue(
    value: string | number | boolean,
  ): Record<string, unknown> {
    if (typeof value === "string") return { stringValue: value };
    if (typeof value === "number") return { intValue: Math.floor(value) };
    if (typeof value === "boolean") return { boolValue: value };
    return { stringValue: String(value) };
  }
}
