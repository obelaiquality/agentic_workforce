import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { SkillService } from "../skills/skillService";

const skillIdParams = z.object({
  id: z.string().min(1),
});

export function registerSkillRoutes(app: FastifyInstance, service: SkillService) {
  app.get("/api/skills", async (request, reply) => {
    const query = request.query as { tags?: string; builtIn?: string };
    const filter: { tags?: string[]; builtIn?: boolean } = {};
    if (query.tags) filter.tags = query.tags.split(",");
    if (query.builtIn !== undefined) filter.builtIn = query.builtIn === "true";
    return reply.send({ items: service.listSkills(filter) });
  });

  app.get<{ Params: { id: string } }>("/api/skills/:id", async (request, reply) => {
    const params = skillIdParams.parse(request.params);
    const skill = service.getSkill(params.id);
    if (!skill) {
      return reply.code(404).send({ error: "Skill not found" });
    }
    return reply.send({ item: skill });
  });

  app.post("/api/skills", async (request, reply) => {
    try {
      const body = request.body as Record<string, unknown>;
      const skill = await service.createSkill({
        name: String(body.name || ""),
        description: String(body.description || ""),
        version: String(body.version || "1.0.0"),
        contextMode: body.contextMode === "fork" ? "fork" : "inline",
        allowedTools: Array.isArray(body.allowedTools) ? body.allowedTools.filter((item): item is string => typeof item === "string") : [],
        maxIterations: typeof body.maxIterations === "number" ? body.maxIterations : null,
        systemPrompt: String(body.systemPrompt || ""),
        referenceFiles: Array.isArray(body.referenceFiles) ? body.referenceFiles as Array<{ path: string; purpose: string }> : [],
        author: String(body.author || "user"),
        tags: Array.isArray(body.tags) ? body.tags.filter((item): item is string => typeof item === "string") : [],
      });
      return reply.code(201).send({ item: skill });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(400).send({ error: message });
    }
  });

  app.patch<{ Params: { id: string } }>("/api/skills/:id", async (request, reply) => {
    const params = skillIdParams.parse(request.params);
    const skill = await service.updateSkill(params.id, request.body as Record<string, unknown>);
    if (!skill) {
      return reply.code(404).send({ error: "Skill not found or is built-in" });
    }
    return reply.send({ item: skill });
  });

  app.delete<{ Params: { id: string } }>("/api/skills/:id", async (request, reply) => {
    const params = skillIdParams.parse(request.params);
    const deleted = await service.deleteSkill(params.id);
    if (!deleted) {
      return reply.code(404).send({ error: "Skill not found or is built-in" });
    }
    return reply.send({ ok: true });
  });

  app.get("/api/skills/invocations", async (request, reply) => {
    const query = request.query as { runId?: string; limit?: string };
    const items = await service.listInvocations({
      runId: query.runId,
      limit: query.limit ? Number(query.limit) : undefined,
    });
    return reply.send({ items });
  });

  app.get<{ Params: { id: string } }>("/api/skills/invocations/:id", async (request, reply) => {
    const params = skillIdParams.parse(request.params);
    const item = await service.getInvocation(params.id);
    if (!item) {
      return reply.code(404).send({ error: "Invocation not found" });
    }
    return reply.send({ item });
  });
}
