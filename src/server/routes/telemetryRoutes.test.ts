import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerTelemetryRoutes } from "./telemetryRoutes";

const mockExportPrometheus = vi.fn();
const mockGetSpanSummary = vi.fn();

vi.mock("../telemetry/tracer", () => ({
  getTelemetry: () => ({
    exportPrometheus: mockExportPrometheus,
    getSpanSummary: mockGetSpanSummary,
  }),
}));

function createApp() {
  const app = Fastify();
  registerTelemetryRoutes(app);
  return app;
}

describe("telemetryRoutes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /metrics returns 200", async () => {
    mockExportPrometheus.mockReturnValue("");
    const app = createApp();

    const res = await app.inject({ method: "GET", url: "/api/telemetry/metrics" });
    expect(res.statusCode).toBe(200);

    await app.close();
  });

  it("GET /metrics returns Prometheus format text", async () => {
    const promText =
      '# HELP agent_tasks agent.tasks\n# TYPE agent_tasks summary\nagent_tasks count=5 sum=5 min=1 max=1\n';
    mockExportPrometheus.mockReturnValue(promText);
    const app = createApp();

    const res = await app.inject({ method: "GET", url: "/api/telemetry/metrics" });
    expect(res.body).toContain("# HELP");
    expect(res.body).toContain("agent_tasks");

    await app.close();
  });

  it("GET /spans returns span summary array", async () => {
    const summary = [
      { name: "llm.call", count: 3, avgDurationMs: 120, errorCount: 0 },
    ];
    mockGetSpanSummary.mockReturnValue(summary);
    const app = createApp();

    const res = await app.inject({ method: "GET", url: "/api/telemetry/spans" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(summary);

    await app.close();
  });

  it("GET /spans with name filter passes filter to getSpanSummary", async () => {
    mockGetSpanSummary.mockReturnValue([]);
    const app = createApp();

    await app.inject({ method: "GET", url: "/api/telemetry/spans?name=tool.exec" });
    expect(mockGetSpanSummary).toHaveBeenCalledWith(
      expect.objectContaining({ name: "tool.exec" }),
    );

    await app.close();
  });

  it("GET /spans with status filter passes filter to getSpanSummary", async () => {
    mockGetSpanSummary.mockReturnValue([]);
    const app = createApp();

    await app.inject({ method: "GET", url: "/api/telemetry/spans?status=error" });
    expect(mockGetSpanSummary).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error" }),
    );

    await app.close();
  });

  it("GET /spans returns empty array when no spans exist", async () => {
    mockGetSpanSummary.mockReturnValue([]);
    const app = createApp();

    const res = await app.inject({ method: "GET", url: "/api/telemetry/spans" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);

    await app.close();
  });
});
