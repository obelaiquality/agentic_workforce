import { describe, it, expect, beforeEach } from "vitest";
import { AgentTelemetry, getTelemetry, resetTelemetry } from "./tracer";
import { METRICS, METRIC_LABELS } from "./metrics";

describe("AgentTelemetry", () => {
  let telemetry: AgentTelemetry;

  beforeEach(() => {
    telemetry = new AgentTelemetry();
  });

  describe("Spans", () => {
    it("should create and record a span", () => {
      const span = telemetry.startSpan({
        name: "test-operation",
        attributes: { foo: "bar" },
      });

      span.setAttribute("baz", 123);
      span.setStatus("ok");
      span.end();

      const spans = telemetry.getSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0].name).toBe("test-operation");
      expect(spans[0].attributes.foo).toBe("bar");
      expect(spans[0].attributes.baz).toBe(123);
      expect(spans[0].status).toBe("ok");
      expect(spans[0].endTime).toBeDefined();
    });

    it("should record exceptions in spans", () => {
      const span = telemetry.startSpan({ name: "failing-operation" });

      const error = new Error("Test error");
      span.recordException(error);
      span.end();

      const spans = telemetry.getSpans();
      expect(spans[0].status).toBe("error");
      expect(spans[0].events).toHaveLength(1);
      expect(spans[0].events[0].name).toBe("exception");
      expect(spans[0].events[0].attributes?.["exception.message"]).toBe(
        "Test error"
      );
    });

    it("should add events to spans", () => {
      const span = telemetry.startSpan({ name: "test-operation" });

      span.addEvent("checkpoint-1", { step: 1 });
      span.addEvent("checkpoint-2", { step: 2 });
      span.end();

      const spans = telemetry.getSpans();
      expect(spans[0].events).toHaveLength(2);
      expect(spans[0].events[0].name).toBe("checkpoint-1");
      expect(spans[0].events[1].name).toBe("checkpoint-2");
    });

    it("should trace async functions", async () => {
      const result = await telemetry.trace(
        "async-operation",
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return "success";
        },
        { operation: "test" }
      );

      expect(result).toBe("success");

      const spans = telemetry.getSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0].name).toBe("async-operation");
      expect(spans[0].status).toBe("ok");
      expect(spans[0].attributes.operation).toBe("test");
    });

    it("should record errors in traced functions", async () => {
      await expect(
        telemetry.trace("failing-operation", async () => {
          throw new Error("Test failure");
        })
      ).rejects.toThrow("Test failure");

      const spans = telemetry.getSpans();
      expect(spans[0].status).toBe("error");
      expect(spans[0].events).toHaveLength(1);
      expect(spans[0].events[0].name).toBe("exception");
    });

    it("should export spans in OpenTelemetry format", () => {
      const span = telemetry.startSpan({
        name: "test-operation",
        attributes: { key: "value" },
      });
      span.setStatus("ok");
      span.end();

      const exported = telemetry.exportSpans();
      expect(exported).toHaveLength(1);
      expect(exported[0]).toMatchObject({
        name: "test-operation",
        kind: "INTERNAL",
        status: {
          code: "STATUS_CODE_OK",
        },
      });
    });
  });

  describe("Metrics", () => {
    it("should record metric values", () => {
      telemetry.recordMetric(METRICS.TOOL_EXECUTION_DURATION_MS, 100, {
        [METRIC_LABELS.TOOL_NAME]: "bash",
      });
      telemetry.recordMetric(METRICS.TOOL_EXECUTION_DURATION_MS, 200, {
        [METRIC_LABELS.TOOL_NAME]: "bash",
      });

      const summary = telemetry.getMetricSummary(
        METRICS.TOOL_EXECUTION_DURATION_MS,
        { [METRIC_LABELS.TOOL_NAME]: "bash" }
      );

      expect(summary).toBeDefined();
      expect(summary!.count).toBe(2);
      expect(summary!.sum).toBe(300);
      expect(summary!.avg).toBe(150);
      expect(summary!.min).toBe(100);
      expect(summary!.max).toBe(200);
    });

    it("should increment counters", () => {
      telemetry.incrementCounter(METRICS.TOOL_EXECUTION_COUNT, {
        [METRIC_LABELS.TOOL_NAME]: "read_file",
      });
      telemetry.incrementCounter(METRICS.TOOL_EXECUTION_COUNT, {
        [METRIC_LABELS.TOOL_NAME]: "read_file",
      });
      telemetry.incrementCounter(METRICS.TOOL_EXECUTION_COUNT, {
        [METRIC_LABELS.TOOL_NAME]: "read_file",
      });

      const summary = telemetry.getMetricSummary(
        METRICS.TOOL_EXECUTION_COUNT,
        { [METRIC_LABELS.TOOL_NAME]: "read_file" }
      );

      expect(summary).toBeDefined();
      expect(summary!.count).toBe(3);
      expect(summary!.sum).toBe(3);
    });

    it("should separate metrics by labels", () => {
      telemetry.recordMetric(METRICS.TOOL_EXECUTION_DURATION_MS, 100, {
        [METRIC_LABELS.TOOL_NAME]: "bash",
      });
      telemetry.recordMetric(METRICS.TOOL_EXECUTION_DURATION_MS, 200, {
        [METRIC_LABELS.TOOL_NAME]: "read_file",
      });

      const bashSummary = telemetry.getMetricSummary(
        METRICS.TOOL_EXECUTION_DURATION_MS,
        { [METRIC_LABELS.TOOL_NAME]: "bash" }
      );
      const readFileSummary = telemetry.getMetricSummary(
        METRICS.TOOL_EXECUTION_DURATION_MS,
        { [METRIC_LABELS.TOOL_NAME]: "read_file" }
      );

      expect(bashSummary!.count).toBe(1);
      expect(bashSummary!.avg).toBe(100);
      expect(readFileSummary!.count).toBe(1);
      expect(readFileSummary!.avg).toBe(200);
    });

    it("should return null for non-existent metrics", () => {
      const summary = telemetry.getMetricSummary("non.existent.metric");
      expect(summary).toBeNull();
    });
  });

  describe("Eviction and compaction", () => {
    it("evicts oldest spans when MAX_SPANS exceeded", () => {
      for (let i = 0; i < 10_001; i++) {
        telemetry.startSpan({ name: `span-${i}` }).end();
      }

      const spans = telemetry.getSpans();
      expect(spans.length).toBe(10_000);
      // The oldest span (span-0) should have been evicted; first remaining is span-1
      expect(spans[0].name).toBe("span-1");
      expect(spans[spans.length - 1].name).toBe("span-10000");
    });

    it("compacts metric values when MAX_METRIC_VALUES exceeded", () => {
      for (let i = 0; i < 5_001; i++) {
        telemetry.recordMetric("load", i);
      }

      const metrics = telemetry.getMetrics();
      const data = metrics.get("load");
      expect(data).toBeDefined();
      // After compaction, only the last 1000 values should remain
      expect(data!.values.length).toBe(1000);
      // The most recent value should still be present
      expect(data!.values[data!.values.length - 1]).toBe(5000);
      // The first retained value should be 4001 (5001 - 1000)
      expect(data!.values[0]).toBe(4001);
    });

    it("resetMetrics clears all metric data", () => {
      telemetry.recordMetric("test.metric", 100);
      telemetry.recordMetric("other.metric", 200);

      telemetry.resetMetrics();

      expect(telemetry.getMetricSummary("test.metric")).toBeNull();
      expect(telemetry.getMetricSummary("other.metric")).toBeNull();
      expect(telemetry.getMetrics().size).toBe(0);
    });

    it("compact removes ended spans older than threshold", () => {
      // Create a span with an old endTime
      const oldSpan = telemetry.startSpan({ name: "old-span" });
      oldSpan.end();
      // Manually backdate the span's endTime
      const spans = telemetry.getSpans() as any[];
      spans[0].endTime = Date.now() - 2 * 60 * 60 * 1000; // 2 hours ago

      // Create a recent span
      const recentSpan = telemetry.startSpan({ name: "recent-span" });
      recentSpan.end();

      // Create an unended (in-progress) span -- should be kept
      telemetry.startSpan({ name: "in-progress-span" });

      // Compact with 1-hour threshold
      telemetry.compact(60 * 60 * 1000);

      const remaining = telemetry.getSpans();
      expect(remaining.length).toBe(2);
      expect(remaining[0].name).toBe("recent-span");
      expect(remaining[1].name).toBe("in-progress-span");
    });
  });

  describe("Reset", () => {
    it("should clear all spans and metrics", () => {
      telemetry.startSpan({ name: "test" }).end();
      telemetry.recordMetric("test.metric", 100);

      telemetry.reset();

      expect(telemetry.getSpans()).toHaveLength(0);
      expect(telemetry.getMetricSummary("test.metric")).toBeNull();
    });
  });

  describe("exportPrometheus", () => {
    it("exportPrometheus returns valid Prometheus format", () => {
      telemetry.recordMetric("tool.execution.duration_ms", 150, { tool_name: "read_file" });

      const output = telemetry.exportPrometheus();

      expect(output).toContain("# HELP tool_execution_duration_ms");
      expect(output).toContain("# TYPE tool_execution_duration_ms summary");
      expect(output).toContain('tool_execution_duration_ms{tool_name="read_file"}');
      expect(output).toContain("count=1");
      expect(output).toContain("sum=150");
      expect(output).toContain("min=150");
      expect(output).toContain("max=150");
    });

    it("exportPrometheus includes all recorded metrics", () => {
      telemetry.recordMetric("tool.execution.duration_ms", 100, { tool_name: "bash" });
      telemetry.recordMetric("tool.execution.duration_ms", 200, { tool_name: "bash" });
      telemetry.recordMetric("tool.execution.duration_ms", 300, { tool_name: "bash" });
      telemetry.recordMetric("tool.execution.count", 1, { tool_name: "read_file" });
      telemetry.recordMetric("tool.execution.count", 1, { tool_name: "read_file" });

      const output = telemetry.exportPrometheus();

      // Duration metric for bash
      expect(output).toContain("# HELP tool_execution_duration_ms");
      expect(output).toContain('tool_execution_duration_ms{tool_name="bash"} count=3 sum=600 min=100 max=300');

      // Count metric for read_file
      expect(output).toContain("# HELP tool_execution_count");
      expect(output).toContain('tool_execution_count{tool_name="read_file"} count=2 sum=2 min=1 max=1');
    });
  });

  describe("getSpanSummary", () => {
    it("getSpanSummary returns aggregated statistics", () => {
      const span1 = telemetry.startSpan({ name: "op-a" });
      span1.setStatus("ok");
      span1.end();

      const span2 = telemetry.startSpan({ name: "op-a" });
      span2.setStatus("ok");
      span2.end();

      const span3 = telemetry.startSpan({ name: "op-b" });
      span3.setStatus("error", "boom");
      span3.end();

      const summary = telemetry.getSpanSummary();
      expect(summary).toHaveLength(2);

      const opA = summary.find((s) => s.name === "op-a");
      expect(opA).toBeDefined();
      expect(opA!.count).toBe(2);
      expect(opA!.errorCount).toBe(0);

      const opB = summary.find((s) => s.name === "op-b");
      expect(opB).toBeDefined();
      expect(opB!.count).toBe(1);
      expect(opB!.errorCount).toBe(1);
    });

    it("getSpanSummary filters by name", () => {
      telemetry.startSpan({ name: "alpha" }).end();
      telemetry.startSpan({ name: "beta" }).end();
      telemetry.startSpan({ name: "alpha" }).end();

      const summary = telemetry.getSpanSummary({ name: "alpha" });
      expect(summary).toHaveLength(1);
      expect(summary[0].name).toBe("alpha");
      expect(summary[0].count).toBe(2);
    });

    it("getSpanSummary filters by status", () => {
      const okSpan = telemetry.startSpan({ name: "mixed" });
      okSpan.setStatus("ok");
      okSpan.end();

      const errSpan = telemetry.startSpan({ name: "mixed" });
      errSpan.setStatus("error", "fail");
      errSpan.end();

      const okOnly = telemetry.getSpanSummary({ status: "ok" });
      expect(okOnly).toHaveLength(1);
      expect(okOnly[0].count).toBe(1);
      expect(okOnly[0].errorCount).toBe(0);

      const errorOnly = telemetry.getSpanSummary({ status: "error" });
      expect(errorOnly).toHaveLength(1);
      expect(errorOnly[0].count).toBe(1);
      expect(errorOnly[0].errorCount).toBe(1);
    });
  });

  describe("Singleton", () => {
    it("should return the same instance", () => {
      const instance1 = getTelemetry();
      const instance2 = getTelemetry();

      expect(instance1).toBe(instance2);
    });

    it("should reset singleton state", () => {
      const instance = getTelemetry();
      instance.startSpan({ name: "test" }).end();

      resetTelemetry();

      const spans = getTelemetry().getSpans();
      expect(spans).toHaveLength(0);
    });
  });
});
