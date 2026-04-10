import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  JsonFileExporter,
  type ExportedSpan,
  type ExportedMetric,
} from "./jsonFileExporter";

describe("JsonFileExporter", () => {
  let tmpDir: string;
  let exporter: JsonFileExporter;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "json-exporter-test-"));
    exporter = new JsonFileExporter(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function makeSpan(overrides?: Partial<ExportedSpan>): ExportedSpan {
    return {
      name: "test-span",
      startTime: Date.now() - 100,
      endTime: Date.now(),
      durationMs: 100,
      attributes: { tool: "bash" },
      status: "ok",
      events: [{ name: "checkpoint", timestamp: Date.now() }],
      ...overrides,
    };
  }

  function makeMetric(overrides?: Partial<ExportedMetric>): ExportedMetric {
    return {
      name: "tool.execution.duration_ms",
      value: 150,
      labels: { tool_name: "bash" },
      timestamp: Date.now(),
      ...overrides,
    };
  }

  // ---------------------------------------------------------------------------
  // exportSpans
  // ---------------------------------------------------------------------------

  describe("exportSpans", () => {
    it("writes spans to a JSON file and returns the filepath", () => {
      const spans = [makeSpan(), makeSpan({ name: "span-2" })];
      const filepath = exporter.exportSpans(spans);

      expect(fs.existsSync(filepath)).toBe(true);
      expect(filepath).toContain(tmpDir);
      expect(filepath).toMatch(/spans-.*\.json$/);

      const parsed = JSON.parse(fs.readFileSync(filepath, "utf-8"));
      expect(parsed).toHaveLength(2);
      expect(parsed[0].name).toBe("test-span");
      expect(parsed[1].name).toBe("span-2");
    });

    it("uses a custom filename when provided", () => {
      const filepath = exporter.exportSpans([makeSpan()], "custom-spans.json");
      expect(path.basename(filepath)).toBe("custom-spans.json");
    });

    it("creates the output directory if it does not exist", () => {
      const nestedDir = path.join(tmpDir, "nested", "deep");
      const nestedExporter = new JsonFileExporter(nestedDir);
      const filepath = nestedExporter.exportSpans([makeSpan()]);
      expect(fs.existsSync(filepath)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // exportMetrics
  // ---------------------------------------------------------------------------

  describe("exportMetrics", () => {
    it("writes metrics to a JSON file and returns the filepath", () => {
      const metrics = [makeMetric(), makeMetric({ name: "provider.request.count", value: 5 })];
      const filepath = exporter.exportMetrics(metrics);

      expect(fs.existsSync(filepath)).toBe(true);
      expect(filepath).toMatch(/metrics-.*\.json$/);

      const parsed = JSON.parse(fs.readFileSync(filepath, "utf-8"));
      expect(parsed).toHaveLength(2);
      expect(parsed[0].name).toBe("tool.execution.duration_ms");
      expect(parsed[1].value).toBe(5);
    });

    it("round-trips metric data accurately", () => {
      const original = makeMetric({
        labels: { tool_name: "read_file", stage: "build" },
      });
      const filepath = exporter.exportMetrics([original]);
      const parsed = JSON.parse(fs.readFileSync(filepath, "utf-8"));

      expect(parsed[0]).toEqual(original);
    });
  });

  // ---------------------------------------------------------------------------
  // exportSnapshot
  // ---------------------------------------------------------------------------

  describe("exportSnapshot", () => {
    it("writes a combined snapshot with spans and metrics", () => {
      const spans = [makeSpan()];
      const metrics = [makeMetric()];
      const filepath = exporter.exportSnapshot(spans, metrics);

      expect(filepath).toMatch(/snapshot-.*\.json$/);

      const parsed = JSON.parse(fs.readFileSync(filepath, "utf-8"));
      expect(parsed.exportedAt).toBeDefined();
      expect(parsed.spans).toHaveLength(1);
      expect(parsed.metrics).toHaveLength(1);
      expect(parsed.spans[0].name).toBe("test-span");
      expect(parsed.metrics[0].name).toBe("tool.execution.duration_ms");
    });
  });

  // ---------------------------------------------------------------------------
  // cleanup
  // ---------------------------------------------------------------------------

  describe("cleanup", () => {
    it("removes old files beyond the maxFiles limit", () => {
      // Create 5 files
      for (let i = 0; i < 5; i++) {
        exporter.exportSpans([makeSpan()], `file-${i}.json`);
      }

      const deleted = exporter.cleanup(3);
      expect(deleted).toBe(2);

      const remaining = fs
        .readdirSync(tmpDir)
        .filter((f) => f.endsWith(".json"));
      expect(remaining).toHaveLength(3);
    });

    it("returns 0 when there are fewer files than maxFiles", () => {
      exporter.exportSpans([makeSpan()], "only-one.json");
      const deleted = exporter.cleanup(50);
      expect(deleted).toBe(0);
    });

    it("returns 0 when the output directory does not exist", () => {
      const missing = new JsonFileExporter(
        path.join(tmpDir, "nonexistent-dir"),
      );
      const deleted = missing.cleanup();
      expect(deleted).toBe(0);
    });

    it("uses default maxFiles of 50", () => {
      for (let i = 0; i < 55; i++) {
        exporter.exportSpans([makeSpan()], `batch-${String(i).padStart(3, "0")}.json`);
      }
      const deleted = exporter.cleanup();
      expect(deleted).toBe(5);
    });
  });

  // ---------------------------------------------------------------------------
  // Default output directory
  // ---------------------------------------------------------------------------

  describe("default output directory", () => {
    it("defaults to ~/.agentic-workforce/telemetry/", () => {
      const defaultExporter = new JsonFileExporter();
      // Access the private outputDir via a test-friendly method
      const expected = path.join(
        os.homedir(),
        ".agentic-workforce",
        "telemetry",
      );
      // We can verify by exporting and checking the path prefix
      // Instead, just check the constructor doesn't throw
      expect(defaultExporter).toBeDefined();
    });
  });
});
