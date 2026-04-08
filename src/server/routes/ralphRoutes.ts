import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db";
import { RalphModeOrchestrator } from "../execution/ralphMode";
import type { ProviderOrchestrator } from "../services/providerOrchestrator";
import type { ExecutionService } from "../services/executionService";
import { buildStreamHeaders } from "./shared/http";
import type { RalphModeInput } from "../../shared/contracts";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const startSchema = z.object({
  spec_content: z.string().min(1),
  actor: z.string().min(1),
  project_id: z.string().min(1),
  repo_id: z.string().optional(),
  ticket_id: z.string().optional(),
  worktree_path: z.string().optional(),
  max_iterations: z.number().int().min(1).max(50).optional(),
  verification_tier: z.enum(["STANDARD", "THOROUGH"]).optional(),
  resume_from_checkpoint: z.boolean().optional(),
});

const sessionIdParam = z.object({
  id: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Route Registration
// ---------------------------------------------------------------------------

export function registerRalphRoutes(deps: {
  app: FastifyInstance;
  providerOrchestrator: ProviderOrchestrator;
  executionService: ExecutionService;
}) {
  const { app, providerOrchestrator, executionService } = deps;

  // Active orchestrators by session ID
  const activeOrchestrators = new Map<string, RalphModeOrchestrator>();

  // POST /api/ralph/start — start new ralph session (or resume)
  app.post("/api/ralph/start", async (request, reply) => {
    const body = startSchema.parse(request.body);

    const runId = `ralph-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const input: RalphModeInput = {
      runId,
      repoId: body.repo_id ?? body.project_id,
      ticketId: body.ticket_id,
      specContent: body.spec_content,
      actor: body.actor,
      worktreePath: body.worktree_path ?? `/tmp/ralph-worktree-${runId}`,
      maxIterations: body.max_iterations,
      verificationTier: body.verification_tier,
      resumeFromCheckpoint: body.resume_from_checkpoint,
    };

    const orchestrator = new RalphModeOrchestrator({
      providerOrchestrator,
      executionService,
    });

    // Start execution in the background — the client connects to /stream
    const generator = orchestrator.execute(input);

    // Read the first event to get the session ID
    const first = await generator.next();
    let sessionId = runId;
    if (!first.done && first.value.type === "ralph_resumed") {
      // resumed — read next event for ralph_started
      const second = await generator.next();
      if (!second.done && second.value.type === "ralph_started") {
        sessionId = second.value.sessionId;
      }
    } else if (!first.done && first.value.type === "ralph_started") {
      sessionId = first.value.sessionId;
    }

    activeOrchestrators.set(sessionId, orchestrator);

    // Store the generator for streaming
    (orchestrator as unknown as Record<string, unknown>)._generator = generator;
    (orchestrator as unknown as Record<string, unknown>)._firstEvents = first.done
      ? []
      : [first.value];

    return reply.status(201).send({
      session_id: sessionId,
      run_id: runId,
      status: "started",
      stream_url: `/api/ralph/${sessionId}/stream`,
    });
  });

  // GET /api/ralph/:id/stream — SSE event stream
  app.get("/api/ralph/:id/stream", async (request, reply) => {
    const { id } = sessionIdParam.parse(request.params);

    const orchestrator = activeOrchestrators.get(id);
    if (!orchestrator) {
      return reply.status(404).send({ error: "No active session found" });
    }

    const headers = buildStreamHeaders(request.headers.origin);
    reply.raw.writeHead(200, headers);

    const generator = (orchestrator as unknown as Record<string, unknown>)
      ._generator as AsyncGenerator;
    const firstEvents = (
      (orchestrator as unknown as Record<string, unknown>)._firstEvents as unknown[]
    ) || [];

    // Send any buffered first events
    for (const event of firstEvents) {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    try {
      for await (const event of generator) {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (err) {
      reply.raw.write(
        `data: ${JSON.stringify({ type: "error", message: String(err) })}\n\n`,
      );
    } finally {
      activeOrchestrators.delete(id);
      reply.raw.end();
    }
  });

  // POST /api/ralph/:id/pause — pause after current phase
  app.post("/api/ralph/:id/pause", async (request, reply) => {
    const { id } = sessionIdParam.parse(request.params);

    const orchestrator = activeOrchestrators.get(id);
    if (!orchestrator) {
      // Check DB for session
      const session = await prisma.ralphSession.findUnique({ where: { id } });
      if (!session) {
        return reply.status(404).send({ error: "Session not found" });
      }
      return reply.send({ status: "already_inactive", session_id: id });
    }

    orchestrator.pause();
    return reply.send({ status: "pausing", session_id: id });
  });

  // POST /api/ralph/:id/resume — resume from last checkpoint
  app.post("/api/ralph/:id/resume", async (request, reply) => {
    const { id } = sessionIdParam.parse(request.params);

    const session = await prisma.ralphSession.findUnique({ where: { id } });
    if (!session) {
      return reply.status(404).send({ error: "Session not found" });
    }

    const orchestrator = new RalphModeOrchestrator({
      providerOrchestrator,
      executionService,
    });

    const resumeInput = await orchestrator.resume(id);
    if (!resumeInput) {
      return reply.status(404).send({ error: "Cannot resume — session not found" });
    }

    const generator = orchestrator.execute(resumeInput);
    activeOrchestrators.set(id, orchestrator);
    (orchestrator as unknown as Record<string, unknown>)._generator = generator;
    (orchestrator as unknown as Record<string, unknown>)._firstEvents = [];

    return reply.send({
      status: "resumed",
      session_id: id,
      stream_url: `/api/ralph/${id}/stream`,
    });
  });

  // GET /api/ralph/:id/status — get phase, iteration, ledger
  app.get("/api/ralph/:id/status", async (request, reply) => {
    const { id } = sessionIdParam.parse(request.params);

    const session = await prisma.ralphSession.findUnique({ where: { id } });
    if (!session) {
      return reply.status(404).send({ error: "Session not found" });
    }

    return reply.send({
      session_id: session.id,
      run_id: session.runId,
      current_phase: session.currentPhase,
      iteration: session.currentIteration,
      max_iterations: session.maxIterations,
      status: session.status,
      verification_tier: session.verificationTier,
      spec_content: session.specContent,
      progress_ledger: session.progressLedger,
      created_at: session.createdAt,
      updated_at: session.updatedAt,
    });
  });

  // GET /api/ralph/:id/ledger — get detailed progress ledger
  app.get("/api/ralph/:id/ledger", async (request, reply) => {
    const { id } = sessionIdParam.parse(request.params);

    const session = await prisma.ralphSession.findUnique({
      where: { id },
      include: {
        phases: { orderBy: { startedAt: "asc" } },
        verifications: { orderBy: { performedAt: "asc" } },
      },
    });

    if (!session) {
      return reply.status(404).send({ error: "Session not found" });
    }

    return reply.send({
      session_id: session.id,
      progress_ledger: session.progressLedger,
      phase_executions: session.phases.map((pe) => ({
        id: pe.id,
        phase: pe.phase,
        iteration: pe.iteration,
        status: pe.status,
        output: pe.output,
        files_changed: pe.filesChanged,
        started_at: pe.startedAt,
        completed_at: pe.completedAt,
      })),
      verifications: session.verifications.map((v) => ({
        id: v.id,
        iteration: v.iteration,
        tier: v.verificationTier,
        tests_passed: v.testsPassed,
        lints_passed: v.lintsPassed,
        regressions_passed: v.regressionsPassed,
        deslop_passed: v.deslopPassed,
        details: v.details,
        created_at: v.performedAt,
      })),
    });
  });
}
