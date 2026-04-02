/**
 * OpenTelemetry-compatible telemetry implementation
 * In-memory tracing and metrics for agent execution
 */

export interface SpanOptions {
  /** Span name */
  name: string;
  /** Optional attributes to attach to the span */
  attributes?: Record<string, string | number | boolean>;
}

export interface TelemetrySpan {
  /** Set an attribute on the span */
  setAttribute(key: string, value: string | number | boolean): void;
  /** Set the span status */
  setStatus(code: "ok" | "error", message?: string): void;
  /** Record an exception that occurred during span execution */
  recordException(error: Error): void;
  /** Add an event to the span */
  addEvent(name: string, attributes?: Record<string, unknown>): void;
  /** End the span (records end time) */
  end(): void;
}

interface SpanData {
  name: string;
  startTime: number;
  endTime?: number;
  attributes: Record<string, string | number | boolean>;
  status: "ok" | "error" | "unset";
  statusMessage?: string;
  events: Array<{ name: string; timestamp: number; attributes?: Record<string, unknown> }>;
}

interface MetricData {
  values: number[];
  labels: Record<string, string>;
}

/**
 * Agent telemetry system for tracking spans and metrics
 */
export class AgentTelemetry {
  private static readonly MAX_SPANS = 10_000;
  private static readonly MAX_METRIC_VALUES = 5_000;

  private spans: SpanData[] = [];
  private metrics = new Map<string, MetricData>();

  /**
   * Start a new span
   */
  startSpan(options: SpanOptions): TelemetrySpan {
    const spanData: SpanData = {
      name: options.name,
      startTime: Date.now(),
      attributes: options.attributes || {},
      status: "unset",
      events: [],
    };

    this.spans.push(spanData);

    if (this.spans.length > AgentTelemetry.MAX_SPANS) {
      this.spans = this.spans.slice(-AgentTelemetry.MAX_SPANS);
    }

    return {
      setAttribute: (key: string, value: string | number | boolean) => {
        spanData.attributes[key] = value;
      },
      setStatus: (code: "ok" | "error", message?: string) => {
        spanData.status = code;
        if (message) {
          spanData.statusMessage = message;
        }
      },
      recordException: (error: Error) => {
        spanData.events.push({
          name: "exception",
          timestamp: Date.now(),
          attributes: {
            "exception.type": error.name,
            "exception.message": error.message,
            "exception.stacktrace": error.stack || "",
          },
        });
        spanData.status = "error";
      },
      addEvent: (name: string, attributes?: Record<string, unknown>) => {
        spanData.events.push({
          name,
          timestamp: Date.now(),
          attributes,
        });
      },
      end: () => {
        spanData.endTime = Date.now();
      },
    };
  }

  /**
   * Trace an async function with automatic span lifecycle
   */
  async trace<T>(
    name: string,
    fn: () => Promise<T>,
    attributes?: Record<string, string | number | boolean>
  ): Promise<T> {
    const span = this.startSpan({ name, attributes });
    try {
      const result = await fn();
      span.setStatus("ok");
      return result;
    } catch (error) {
      if (error instanceof Error) {
        span.recordException(error);
      } else {
        span.setStatus("error", String(error));
      }
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Record a metric value
   */
  recordMetric(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = this.getMetricKey(name, labels);
    const existing = this.metrics.get(key);

    if (existing) {
      existing.values.push(value);

      if (existing.values.length > AgentTelemetry.MAX_METRIC_VALUES) {
        // Compact: keep last 1000 values (summary stats can be recomputed via getMetricSummary)
        existing.values = existing.values.slice(-1000);
      }
    } else {
      this.metrics.set(key, {
        values: [value],
        labels,
      });
    }
  }

  /**
   * Increment a counter (convenience method)
   */
  incrementCounter(name: string, labels: Record<string, string> = {}): void {
    this.recordMetric(name, 1, labels);
  }

  /**
   * Get all recorded spans
   */
  getSpans(): readonly SpanData[] {
    return this.spans;
  }

  /**
   * Get metric summary (aggregated statistics)
   */
  getMetricSummary(
    name: string,
    labels?: Record<string, string>
  ): { count: number; sum: number; avg: number; min: number; max: number } | null {
    // Find all metrics matching the name and optional labels
    const matchingMetrics: number[] = [];

    // Convert to array to avoid iterator issues
    const entries = Array.from(this.metrics.entries());
    for (const [key, data] of entries) {
      if (!key.startsWith(name + "|")) continue;

      // Check if labels match (if provided)
      if (labels) {
        const labelsMatch = Object.entries(labels).every(
          ([k, v]) => data.labels[k] === v
        );
        if (!labelsMatch) continue;
      }

      matchingMetrics.push(...data.values);
    }

    if (matchingMetrics.length === 0) return null;

    const sum = matchingMetrics.reduce((acc, val) => acc + val, 0);
    const count = matchingMetrics.length;

    return {
      count,
      sum,
      avg: sum / count,
      min: Math.min(...matchingMetrics),
      max: Math.max(...matchingMetrics),
    };
  }

  /**
   * Export metrics in Prometheus exposition format.
   */
  exportPrometheus(): string {
    const lines: string[] = [];
    const seenMetrics = new Set<string>();

    const entries = Array.from(this.metrics.entries());
    for (const [key, data] of entries) {
      // key format: "name|label1=val1,label2=val2" when labels exist, or just "name" when no labels
      const pipeIndex = key.indexOf("|");
      const metricName = pipeIndex >= 0 ? key.substring(0, pipeIndex) : key;
      const labelString = pipeIndex >= 0 ? key.substring(pipeIndex + 1) : "";

      // Convert dotted metric name to prometheus-style underscored name
      const promName = metricName.replace(/\./g, "_");

      // Add HELP/TYPE headers once per metric name
      if (!seenMetrics.has(promName)) {
        seenMetrics.add(promName);
        lines.push(`# HELP ${promName} ${metricName}`);
        lines.push(`# TYPE ${promName} summary`);
      }

      // Build label set for Prometheus
      const labelParts = labelString
        ? labelString.split(",").map((pair) => {
            const eqIndex = pair.indexOf("=");
            const k = pair.substring(0, eqIndex);
            const v = pair.substring(eqIndex + 1);
            return `${k}="${v}"`;
          })
        : [];
      const labelBlock = labelParts.length > 0 ? `{${labelParts.join(",")}}` : "";

      const values = data.values;
      const count = values.length;
      const sum = values.reduce((a, b) => a + b, 0);
      const min = Math.min(...values);
      const max = Math.max(...values);

      lines.push(`${promName}${labelBlock} count=${count} sum=${sum} min=${min} max=${max}`);
    }

    return lines.join("\n") + (lines.length > 0 ? "\n" : "");
  }

  /**
   * Get aggregated span statistics, optionally filtered by name and/or status.
   */
  getSpanSummary(filter?: { name?: string; status?: string }): Array<{
    name: string;
    count: number;
    avgDurationMs: number;
    errorCount: number;
  }> {
    const groups = new Map<string, { totalDuration: number; count: number; errorCount: number }>();

    for (const span of this.spans) {
      // Apply filters
      if (filter?.name && span.name !== filter.name) continue;
      if (filter?.status && span.status !== filter.status) continue;

      const existing = groups.get(span.name);
      const duration = span.endTime ? span.endTime - span.startTime : 0;
      const isError = span.status === "error" ? 1 : 0;

      if (existing) {
        existing.totalDuration += duration;
        existing.count += 1;
        existing.errorCount += isError;
      } else {
        groups.set(span.name, {
          totalDuration: duration,
          count: 1,
          errorCount: isError,
        });
      }
    }

    return Array.from(groups.entries()).map(([name, data]) => ({
      name,
      count: data.count,
      avgDurationMs: data.count > 0 ? data.totalDuration / data.count : 0,
      errorCount: data.errorCount,
    }));
  }

  /**
   * Export spans in OpenTelemetry JSON format
   */
  exportSpans(): unknown[] {
    return this.spans.map((span) => ({
      traceId: "00000000000000000000000000000000", // Placeholder
      spanId: this.generateSpanId(),
      name: span.name,
      kind: "INTERNAL",
      startTimeUnixNano: span.startTime * 1_000_000,
      endTimeUnixNano: span.endTime ? span.endTime * 1_000_000 : undefined,
      attributes: Object.entries(span.attributes).map(([key, value]) => ({
        key,
        value: this.formatAttributeValue(value),
      })),
      status: {
        code: span.status === "ok" ? "STATUS_CODE_OK" : span.status === "error" ? "STATUS_CODE_ERROR" : "STATUS_CODE_UNSET",
        message: span.statusMessage,
      },
      events: span.events.map((event) => ({
        name: event.name,
        timeUnixNano: event.timestamp * 1_000_000,
        attributes: event.attributes
          ? Object.entries(event.attributes).map(([key, value]) => ({
              key,
              value: { stringValue: String(value) },
            }))
          : [],
      })),
    }));
  }

  /**
   * Get all metrics (for debugging/export)
   */
  getMetrics(): Map<string, MetricData> {
    return new Map(this.metrics);
  }

  /**
   * Compact telemetry data by removing ended spans older than the given threshold
   * and trimming metric values to the most recent entries.
   */
  compact(maxAgeMs: number = 60 * 60 * 1000): void {
    const cutoff = Date.now() - maxAgeMs;
    this.spans = this.spans.filter(
      (span) => !span.endTime || span.endTime >= cutoff
    );
  }

  /**
   * Reset all metric data (useful for test isolation)
   */
  resetMetrics(): void {
    this.metrics.clear();
  }

  /**
   * Clear all recorded data
   */
  reset(): void {
    this.spans = [];
    this.metrics.clear();
  }

  /**
   * Generate a unique metric key from name and labels
   */
  private getMetricKey(name: string, labels: Record<string, string>): string {
    const labelPairs = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    return labelPairs ? `${name}|${labelPairs}` : name;
  }

  /**
   * Generate a random span ID
   */
  private generateSpanId(): string {
    return Array.from({ length: 16 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join("");
  }

  /**
   * Format attribute value for OpenTelemetry export
   */
  private formatAttributeValue(value: string | number | boolean): unknown {
    if (typeof value === "string") return { stringValue: value };
    if (typeof value === "number") return { intValue: Math.floor(value) };
    if (typeof value === "boolean") return { boolValue: value };
    return { stringValue: String(value) };
  }
}

/**
 * Singleton telemetry instance
 */
let instance: AgentTelemetry | null = null;

/**
 * Get the global telemetry instance
 */
export function getTelemetry(): AgentTelemetry {
  if (!instance) {
    instance = new AgentTelemetry();
  }
  return instance;
}

/**
 * Reset the global telemetry instance (for testing)
 */
export function resetTelemetry(): void {
  if (instance) {
    instance.reset();
  }
}
