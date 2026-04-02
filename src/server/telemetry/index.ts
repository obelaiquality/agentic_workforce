/**
 * OpenTelemetry-compatible telemetry system
 *
 * Provides in-memory tracing and metrics for agent execution,
 * compatible with OpenTelemetry export formats.
 */

export type { SpanOptions, TelemetrySpan } from "./tracer";

export { AgentTelemetry, getTelemetry, resetTelemetry } from "./tracer";

export { METRICS, METRIC_LABELS } from "./metrics";
