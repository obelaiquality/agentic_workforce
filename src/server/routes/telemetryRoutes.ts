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
}
