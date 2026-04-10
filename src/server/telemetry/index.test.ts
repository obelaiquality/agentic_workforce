import { describe, it, expect } from "vitest";
import * as TelemetryExports from "./index";

describe("telemetry barrel exports", () => {
  it("exports AgentTelemetry", () => {
    expect(TelemetryExports.AgentTelemetry).toBeDefined();
    expect(typeof TelemetryExports.AgentTelemetry).toBe("function");
  });

  it("exports getTelemetry", () => {
    expect(TelemetryExports.getTelemetry).toBeDefined();
    expect(typeof TelemetryExports.getTelemetry).toBe("function");
  });

  it("exports resetTelemetry", () => {
    expect(TelemetryExports.resetTelemetry).toBeDefined();
    expect(typeof TelemetryExports.resetTelemetry).toBe("function");
  });

  it("exports METRICS", () => {
    expect(TelemetryExports.METRICS).toBeDefined();
    expect(typeof TelemetryExports.METRICS).toBe("object");
  });

  it("exports METRIC_LABELS", () => {
    expect(TelemetryExports.METRIC_LABELS).toBeDefined();
    expect(typeof TelemetryExports.METRIC_LABELS).toBe("object");
  });
});
