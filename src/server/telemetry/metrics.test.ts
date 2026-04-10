import { describe, it, expect } from "vitest";
import { METRICS, METRIC_LABELS } from "./metrics";

// ---------------------------------------------------------------------------
// METRICS
// ---------------------------------------------------------------------------

describe("METRICS", () => {
  it("has exactly 18 keys", () => {
    expect(Object.keys(METRICS)).toHaveLength(18);
  });

  it("all values are non-empty strings", () => {
    for (const [key, value] of Object.entries(METRICS)) {
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it("all values follow dotted naming convention (contain at least one dot)", () => {
    for (const [key, value] of Object.entries(METRICS)) {
      expect(value).toContain(".");
    }
  });

  it("all values are unique", () => {
    const values = Object.values(METRICS);
    expect(new Set(values).size).toBe(values.length);
  });

  it("spot-check: TOOL_EXECUTION_COUNT === 'tool.execution.count'", () => {
    expect(METRICS.TOOL_EXECUTION_COUNT).toBe("tool.execution.count");
  });
});

// ---------------------------------------------------------------------------
// METRIC_LABELS
// ---------------------------------------------------------------------------

describe("METRIC_LABELS", () => {
  it("has exactly 10 keys", () => {
    expect(Object.keys(METRIC_LABELS)).toHaveLength(10);
  });

  it("all values are non-empty strings", () => {
    for (const [key, value] of Object.entries(METRIC_LABELS)) {
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it("all values are unique", () => {
    const values = Object.values(METRIC_LABELS);
    expect(new Set(values).size).toBe(values.length);
  });

  it("spot-check: TOOL_NAME === 'tool_name'", () => {
    expect(METRIC_LABELS.TOOL_NAME).toBe("tool_name");
  });
});
