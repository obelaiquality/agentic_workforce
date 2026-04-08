import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { buildStreamHeaders } from "./shared/http";
import { prisma } from "../db";
import {
  EnhancedTeamOrchestrator,
  isValidTransition,
} from "../execution/enhancedTeamMode";
import type { ProviderOrchestrator } from "../services/providerOrchestrator";
import type { TeamPhase, AgenticEvent } from "../../shared/contracts";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const startSchema = z.object({
  actor: z.string().min(1),
  repoId: z.string().min(1),
  objective: z.string().min(1),
  ticketId: z.string().optional(),
  worktreePath: z.string().min(1),
  maxWorkers: z.number().int().positive().optional(),
  maxConcurrentWorkers: z.number().int().positive().optional(),
  enableHeartbeat: z.boolean().optional(),
  heartbeatIntervalMs: z.number().int().positive().optional(),
  heartbeatTimeoutMs: z.number().int().positive().optional(),
});

const messageSchema = z.object({
  fromWorkerId: z.string().min(1),
  toWorkerId: z.string().optional(),
  content: z.string().min(1),
});

const phaseSchema = z.object({
  phase: z.enum(["team_plan", "team_exec", "team_verify", "team_fix", "team_complete"]),
});

type StartInput = z.infer<typeof startSchema>;
type MessageInput = z.infer<typeof messageSchema>;
type PhaseInput = z.infer<typeof phaseSchema>;

// ---------------------------------------------------------------------------
// Active session streams (for SSE)
// ---------------------------------------------------------------------------

const activeGenerators = new Map<string, AsyncGenerator<AgenticEvent>>();

// ---------------------------------------------------------------------------
// Route Registration
// ---------------------------------------------------------------------------

export function registerEnhancedTeamRoutes(deps: {
  app: FastifyInstance;
  providerOrchestrator: ProviderOrchestrator;
}) {
  const { app, providerOrchestrator } = deps;

  // ----------- POST /api/enhanced-team/start -----------

  app.post<{ Body: StartInput }>("/api/enhanced-team/start", async (request, reply) => {
    const parsed = startSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid request body",
        details: parsed.error.issues,
      });
    }

    const body = parsed.data;
    const runId = `enhanced-team-${Date.now()}`;

    const orchestrator = new EnhancedTeamOrchestrator({ providerOrchestrator });

    const generator = orchestrator.execute({
      runId,
      repoId: body.repoId,
      ticketId: body.ticketId ?? `ticket-${runId}`,
      objective: body.objective,
      worktreePath: body.worktreePath,
      actor: body.actor,
      maxWorkers: body.maxWorkers,
      maxConcurrentWorkers: body.maxConcurrentWorkers,
      enableHeartbeat: body.enableHeartbeat,
      heartbeatIntervalMs: body.heartbeatIntervalMs,
      heartbeatTimeoutMs: body.heartbeatTimeoutMs,
    });

    // Peek at the first event to extract the sessionId
    const first = await generator.next();
    let sessionId: string | undefined;

    if (!first.done && first.value.type === "team_session_started") {
      sessionId = first.value.sessionId;
    }

    if (!sessionId) {
      return reply.code(500).send({ error: "Failed to start team session" });
    }

    // Store the generator for SSE streaming
    activeGenerators.set(sessionId, generator);

    return reply.code(200).send({
      sessionId,
      runId,
      status: "active",
    });
  });

  // ----------- GET /api/enhanced-team/:id -----------

  app.get<{ Params: { id: string } }>(
    "/api/enhanced-team/:id",
    async (request, reply) => {
      const { id } = request.params;
      const session = await prisma.teamSession.findUnique({ where: { id } });
      if (!session) {
        return reply.code(404).send({ error: "Session not found" });
      }
      const workerCount = await prisma.teamWorker.count({ where: { sessionId: id } });
      return reply.send({
        session: {
          id: session.id,
          objective: session.objective,
          phase: session.currentPhase,
          status: session.status,
          maxWorkers: session.maxWorkers,
          maxConcurrent: session.maxConcurrent,
          workerCount,
          createdAt: session.createdAt.toISOString(),
        },
      });
    },
  );

  // ----------- GET /api/enhanced-team/:id/stream -----------

  app.get<{ Params: { id: string } }>(
    "/api/enhanced-team/:id/stream",
    async (request, reply) => {
      const { id } = request.params;

      const generator = activeGenerators.get(id);
      if (!generator) {
        return reply.code(404).send({ error: "Session not found or stream already consumed" });
      }

      const headers = buildStreamHeaders(request.headers.origin);
      await reply.raw.writeHead(200, headers);

      try {
        for await (const event of generator) {
          const data = JSON.stringify(event);
          reply.raw.write(`data: ${data}\n\n`);
        }
      } catch {
        // Stream ended or errored
      } finally {
        activeGenerators.delete(id);
        reply.raw.end();
      }
    },
  );

  // ----------- GET /api/enhanced-team/:id/workers -----------

  app.get<{ Params: { id: string } }>(
    "/api/enhanced-team/:id/workers",
    async (request, reply) => {
      const { id } = request.params;

      const session = await prisma.teamSession.findUnique({ where: { id } });
      if (!session) {
        return reply.code(404).send({ error: "Session not found" });
      }

      const workers = await prisma.teamWorker.findMany({
        where: { sessionId: id },
        orderBy: { createdAt: "asc" },
      });

      return reply.send({
        sessionId: id,
        workers: workers.map((w) => ({
          id: w.id,
          workerId: w.workerId,
          role: w.role,
          status: w.status,
          currentTaskId: w.currentTaskId,
          lastHeartbeatAt: w.lastHeartbeatAt?.toISOString() ?? null,
        })),
      });
    },
  );

  // ----------- GET /api/enhanced-team/:id/tasks -----------

  app.get<{ Params: { id: string } }>(
    "/api/enhanced-team/:id/tasks",
    async (request, reply) => {
      const { id } = request.params;

      const session = await prisma.teamSession.findUnique({ where: { id } });
      if (!session) {
        return reply.code(404).send({ error: "Session not found" });
      }

      const tasks = await prisma.teamTask.findMany({
        where: { sessionId: id },
        orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      });

      return reply.send({
        sessionId: id,
        tasks: tasks.map((t) => ({
          id: t.id,
          name: t.taskName,
          description: t.description,
          status: t.status,
          assignedTo: t.assignedTo,
          priority: t.priority,
          result: t.result,
          claimedAt: t.claimedAt?.toISOString() ?? null,
          leaseExpires: t.leaseExpires?.toISOString() ?? null,
        })),
      });
    },
  );

  // ----------- POST /api/enhanced-team/:id/message -----------

  app.post<{ Params: { id: string }; Body: MessageInput }>(
    "/api/enhanced-team/:id/message",
    async (request, reply) => {
      const { id } = request.params;

      const session = await prisma.teamSession.findUnique({ where: { id } });
      if (!session) {
        return reply.code(404).send({ error: "Session not found" });
      }

      const parsed = messageSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Invalid request body",
          details: parsed.error.issues,
        });
      }

      const { fromWorkerId, toWorkerId, content } = parsed.data;

      const message = await prisma.teamMessage.create({
        data: {
          sessionId: id,
          fromWorkerId,
          toWorkerId: toWorkerId ?? null,
          content,
        },
      });

      return reply.code(200).send({
        ok: true,
        messageId: message.id,
      });
    },
  );

  // ----------- GET /api/enhanced-team/:id/messages -----------

  app.get<{ Params: { id: string } }>(
    "/api/enhanced-team/:id/messages",
    async (request, reply) => {
      const { id } = request.params;

      const session = await prisma.teamSession.findUnique({ where: { id } });
      if (!session) {
        return reply.code(404).send({ error: "Session not found" });
      }

      const messages = await prisma.teamMessage.findMany({
        where: { sessionId: id },
        orderBy: { createdAt: "asc" },
      });

      return reply.send({
        sessionId: id,
        messages: messages.map((m) => ({
          id: m.id,
          fromWorkerId: m.fromWorkerId,
          toWorkerId: m.toWorkerId,
          content: m.content,
          read: m.read,
          createdAt: m.createdAt.toISOString(),
        })),
      });
    },
  );

  // ----------- GET /api/enhanced-team/:id/messages/:workerId -----------

  app.get<{ Params: { id: string; workerId: string } }>(
    "/api/enhanced-team/:id/messages/:workerId",
    async (request, reply) => {
      const { id, workerId } = request.params;

      const session = await prisma.teamSession.findUnique({ where: { id } });
      if (!session) {
        return reply.code(404).send({ error: "Session not found" });
      }

      const messages = await prisma.teamMessage.findMany({
        where: {
          sessionId: id,
          OR: [{ toWorkerId: workerId }, { toWorkerId: null }],
        },
        orderBy: { createdAt: "asc" },
      });

      return reply.send({
        sessionId: id,
        workerId,
        messages: messages.map((m) => ({
          id: m.id,
          fromWorkerId: m.fromWorkerId,
          toWorkerId: m.toWorkerId,
          content: m.content,
          read: m.read,
          createdAt: m.createdAt.toISOString(),
        })),
      });
    },
  );

  // ----------- POST /api/enhanced-team/:id/phase -----------

  app.post<{ Params: { id: string }; Body: PhaseInput }>(
    "/api/enhanced-team/:id/phase",
    async (request, reply) => {
      const { id } = request.params;

      const session = await prisma.teamSession.findUnique({ where: { id } });
      if (!session) {
        return reply.code(404).send({ error: "Session not found" });
      }

      const parsed = phaseSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Invalid request body",
          details: parsed.error.issues,
        });
      }

      const currentPhase = session.currentPhase as TeamPhase;
      const targetPhase = parsed.data.phase;

      if (!isValidTransition(currentPhase, targetPhase)) {
        return reply.code(400).send({
          error: `Invalid phase transition: ${currentPhase} -> ${targetPhase}`,
        });
      }

      await prisma.teamSession.update({
        where: { id },
        data: { currentPhase: targetPhase },
      });

      return reply.send({
        ok: true,
        previousPhase: currentPhase,
        currentPhase: targetPhase,
      });
    },
  );
}

/**
 * Clear active generators. Exposed for test cleanup.
 */
export function clearActiveGenerators(): void {
  activeGenerators.clear();
}
