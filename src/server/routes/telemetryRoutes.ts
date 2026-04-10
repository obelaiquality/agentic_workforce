import type { FastifyInstance } from "fastify";
import { getTelemetry } from "../telemetry/tracer";

export function registerTelemetryRoutes(app: FastifyInstance) {
  app.get("/api/telemetry/metrics", async () => {
    return getTelemetry().exportPrometheus();
  });

  app.get("/api/telemetry/spans", async (request) => {
    const query = request.query as { name?: string; status?: string };
    return getTelemetry().getSpanSummary(query);
  });

  /** Health check endpoint — uptime, memory, and timestamp. */
  app.get("/api/telemetry/health", async () => {
    return {
      status: "ok",
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString(),
    };
  });

  /** Accept client-side error reports from ErrorBoundary / unhandled errors. */
  app.post("/api/telemetry/client-error", async (request) => {
    const body = request.body as {
      message?: string;
      componentStack?: string;
      source?: string;
      timestamp?: string;
      url?: string;
    } | null;

    const message = body?.message || "Unknown client error";
    const telemetry = getTelemetry();
    const span = telemetry.startSpan({
      name: "client.error",
      attributes: {
        "error.message": message,
        "error.source": body?.source || "unknown",
        ...(body?.url ? { "error.url": body.url } : {}),
      },
    });
    span.setStatus("error", message);
    span.end();

    return { ok: true };
  });
}
