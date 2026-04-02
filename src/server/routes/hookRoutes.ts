import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { HookEventType } from "../../shared/contracts";
import type { HookService } from "../hooks/hookService";

const hookIdParams = z.object({
  id: z.string().min(1),
});

export function registerHookRoutes(app: FastifyInstance, service: HookService) {
  app.get("/api/hooks", async (request, reply) => {
    const query = request.query as { projectId?: string; eventType?: string; enabled?: string };
    const filter: { projectId?: string; eventType?: HookEventType; enabled?: boolean } = {};
    if (query.projectId) filter.projectId = query.projectId;
    if (query.eventType) filter.eventType = query.eventType as HookEventType;
    if (query.enabled !== undefined) filter.enabled = query.enabled === "true";
    return reply.send({ items: service.listHooks(filter) });
  });

  app.get<{ Params: { id: string } }>("/api/hooks/:id", async (request, reply) => {
    const params = hookIdParams.parse(request.params);
    const hook = service.getHook(params.id);
    if (!hook) {
      return reply.code(404).send({ error: "Hook not found" });
    }
    return reply.send({ item: hook });
  });

  app.post("/api/hooks", async (request, reply) => {
    try {
      const body = request.body as Record<string, unknown>;
      const hook = await service.createHook({
        name: String(body.name || ""),
        description: typeof body.description === "string" ? body.description : "",
        enabled: body.enabled !== false,
        eventType: body.eventType as HookEventType,
        hookType: body.hookType === "Prompt" || body.hookType === "Agent" ? body.hookType : "Command",
        command: typeof body.command === "string" ? body.command : null,
        promptTemplate: typeof body.promptTemplate === "string" ? body.promptTemplate : null,
        agentObjective: typeof body.agentObjective === "string" ? body.agentObjective : null,
        allowedTools: Array.isArray(body.allowedTools) ? body.allowedTools.filter((item): item is string => typeof item === "string") : [],
        canOverride: body.canOverride === true,
        continueOnError: body.continueOnError !== false,
        timeoutMs: typeof body.timeoutMs === "number" ? body.timeoutMs : 30000,
        projectId: typeof body.projectId === "string" ? body.projectId : null,
      });
      return reply.code(201).send({ item: hook });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(400).send({ error: message });
    }
  });

  app.patch<{ Params: { id: string } }>("/api/hooks/:id", async (request, reply) => {
    const params = hookIdParams.parse(request.params);
    const hook = await service.updateHook(params.id, request.body as Record<string, unknown>);
    if (!hook) {
      return reply.code(404).send({ error: "Hook not found" });
    }
    return reply.send({ item: hook });
  });

  app.delete<{ Params: { id: string } }>("/api/hooks/:id", async (request, reply) => {
    const params = hookIdParams.parse(request.params);
    const deleted = await service.deleteHook(params.id);
    if (!deleted) {
      return reply.code(404).send({ error: "Hook not found" });
    }
    return reply.send({ ok: true });
  });

  app.post<{ Params: { id: string } }>("/api/hooks/:id/test", async (request, reply) => {
    try {
      const params = hookIdParams.parse(request.params);
      const body = request.body as { testPayload?: Record<string, unknown> };
      const output = await service.testHook(params.id, body.testPayload || {});
      return reply.send({ output });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(400).send({ error: message });
    }
  });

  app.get("/api/hooks/executions", async (request, reply) => {
    const query = request.query as { hookId?: string; runId?: string; limit?: string };
    const items = await service.getExecutionLog({
      hookId: query.hookId,
      runId: query.runId,
      limit: query.limit ? Number(query.limit) : undefined,
    });
    return reply.send({ items });
  });
}
