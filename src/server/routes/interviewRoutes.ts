import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db";
import { buildStreamHeaders } from "./shared/http";
import { InterviewModeOrchestrator } from "../execution/interviewMode";
import type { ProviderOrchestrator } from "../services/providerOrchestrator";
import type { AgenticEvent } from "../../shared/contracts";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const interviewStartSchema = z.object({
  actor: z.string().min(1),
  repo_id: z.string().min(1),
  ticket_id: z.string().optional(),
  objective: z.string().min(1),
  worktree_path: z.string().min(1),
  is_greenfield: z.boolean().optional(),
  max_rounds: z.number().int().positive().optional(),
  ambiguity_threshold: z.number().min(0).max(1).optional(),
  handoff_mode: z.enum(["ralph", "team", "autopilot"]).optional(),
});

const interviewAnswerSchema = z.object({
  question_id: z.string().min(1),
  answer: z.string().min(1),
});

const interviewHandoffSchema = z.object({
  target_mode: z.enum(["ralph", "team", "autopilot"]),
});

const sessionParamsSchema = z.object({
  id: z.string().min(1),
});

// ---------------------------------------------------------------------------
// In-memory orchestrator tracking
// ---------------------------------------------------------------------------

const activeOrchestrators = new Map<string, InterviewModeOrchestrator>();

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerInterviewRoutes(deps: {
  app: FastifyInstance;
  providerOrchestrator: ProviderOrchestrator;
}) {
  const { app, providerOrchestrator } = deps;

  // -------------------------------------------------------------------------
  // POST /api/interview/start — Start new interview session
  // -------------------------------------------------------------------------
  app.post("/api/interview/start", async (request, reply) => {
    const parseResult = interviewStartSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Invalid request body",
        details: parseResult.error.issues,
      });
    }

    const body = parseResult.data;
    const runId = randomUUID();

    const orchestrator = new InterviewModeOrchestrator({ providerOrchestrator });
    const sessionId = randomUUID();

    // We'll track the orchestrator by runId so the stream/answer routes can use it
    activeOrchestrators.set(runId, orchestrator);

    const input = {
      runId,
      repoId: body.repo_id,
      ticketId: body.ticket_id,
      objective: body.objective,
      actor: body.actor,
      worktreePath: body.worktree_path,
      isGreenfield: body.is_greenfield,
      maxRounds: body.max_rounds,
      ambiguityThreshold: body.ambiguity_threshold,
      handoffMode: body.handoff_mode,
    };

    // Start execution — collect initial events
    const events: AgenticEvent[] = [];
    try {
      for await (const event of orchestrator.execute(input)) {
        events.push(event);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({ error: message });
    }

    // Extract sessionId from the started event
    const startedEvent = events.find((e) => e.type === "interview_started");
    const actualSessionId = startedEvent && "sessionId" in startedEvent ? startedEvent.sessionId : sessionId;

    return reply.status(200).send({
      run_id: runId,
      session_id: actualSessionId,
      events,
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/interview/:id/stream — SSE event stream
  // -------------------------------------------------------------------------
  app.get("/api/interview/:id/stream", async (request, reply) => {
    const params = sessionParamsSchema.parse(request.params);

    const session = await prisma.interviewSession.findUnique({
      where: { id: params.id },
      include: {
        questions: { orderBy: { round: "asc" } },
        ambiguityScores: { orderBy: { round: "asc" } },
      },
    });

    if (!session) {
      return reply.status(404).send({ error: "Session not found" });
    }

    reply.hijack();
    reply.raw.writeHead(
      200,
      buildStreamHeaders(typeof request.headers.origin === "string" ? request.headers.origin : null),
    );

    // Send current state as events
    reply.raw.write(`data: ${JSON.stringify({ type: "interview_state", session })}\n\n`);
    reply.raw.end();
  });

  // -------------------------------------------------------------------------
  // POST /api/interview/:id/answer — Submit answer to current question
  // -------------------------------------------------------------------------
  app.post("/api/interview/:id/answer", async (request, reply) => {
    const paramsResult = sessionParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({ error: "Invalid session ID" });
    }

    const bodyResult = interviewAnswerSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: "Invalid request body",
        details: bodyResult.error.issues,
      });
    }

    const { id: sessionId } = paramsResult.data;
    const { question_id, answer } = bodyResult.data;

    // Find the session to get its runId and locate the orchestrator
    const session = await prisma.interviewSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      return reply.status(404).send({ error: "Session not found" });
    }

    if (session.status === "completed") {
      return reply.status(400).send({ error: "Session is already completed" });
    }

    // Get or create orchestrator
    let orchestrator = activeOrchestrators.get(session.runId);
    if (!orchestrator) {
      orchestrator = new InterviewModeOrchestrator({ providerOrchestrator });
      activeOrchestrators.set(session.runId, orchestrator);
    }

    const events: AgenticEvent[] = [];
    try {
      for await (const event of orchestrator.submitAnswer(sessionId, question_id, answer)) {
        events.push(event);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({ error: message });
    }

    return reply.status(200).send({ events });
  });

  // -------------------------------------------------------------------------
  // POST /api/interview/:id/handoff — Handoff spec to target mode
  // -------------------------------------------------------------------------
  app.post("/api/interview/:id/handoff", async (request, reply) => {
    const paramsResult = sessionParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({ error: "Invalid session ID" });
    }

    const bodyResult = interviewHandoffSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: "Invalid request body",
        details: bodyResult.error.issues,
      });
    }

    const { id: sessionId } = paramsResult.data;
    const { target_mode } = bodyResult.data;

    const session = await prisma.interviewSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      return reply.status(404).send({ error: "Session not found" });
    }

    if (!session.finalSpec) {
      return reply.status(400).send({ error: "Session has no crystallized spec yet" });
    }

    await prisma.interviewSession.update({
      where: { id: sessionId },
      data: { handoffMode: target_mode },
    });

    return reply.status(200).send({
      session_id: sessionId,
      target_mode,
      spec: session.finalSpec,
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/interview/:id/status — Get session state + scores
  // -------------------------------------------------------------------------
  app.get("/api/interview/:id/status", async (request, reply) => {
    const paramsResult = sessionParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({ error: "Invalid session ID" });
    }

    const { id: sessionId } = paramsResult.data;

    const session = await prisma.interviewSession.findUnique({
      where: { id: sessionId },
      include: {
        questions: { orderBy: { round: "asc" } },
        ambiguityScores: { orderBy: { round: "asc" } },
      },
    });

    if (!session) {
      return reply.status(404).send({ error: "Session not found" });
    }

    return reply.status(200).send({
      session_id: session.id,
      run_id: session.runId,
      status: session.status,
      current_round: session.currentRound,
      max_rounds: session.maxRounds,
      ambiguity_threshold: session.ambiguityThreshold,
      is_greenfield: session.isGreenfield,
      objective: session.objective,
      final_spec: session.finalSpec,
      handoff_mode: session.handoffMode,
      questions: session.questions.map((q) => ({
        id: q.id,
        round: q.round,
        question: q.question,
        answer: q.answer,
        challenge_mode: q.challengeMode,
        target_dimension: q.targetDimension,
        answered_at: q.answeredAt,
      })),
      ambiguity_scores: session.ambiguityScores.map((s) => ({
        round: s.round,
        overall: s.overallAmbiguity,
        dimensions: {
          intent: s.intentScore,
          outcome: s.outcomeScore,
          scope: s.scopeScore,
          constraints: s.constraintsScore,
          success: s.successScore,
          context: s.contextScore,
        },
      })),
    });
  });
}

/** Clear active orchestrators (for testing). */
export function clearActiveOrchestrators(): void {
  activeOrchestrators.clear();
}
