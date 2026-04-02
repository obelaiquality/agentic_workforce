import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  MultiAgentTeam,
  type AgentSpec,
  type TeamResult,
} from "../execution/multiAgentTeam";
import type { AgenticEvent, AgenticExecutionInput } from "../tools/types";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const teamExecuteSchema = z.object({
  actor: z.string().min(1),
  project_id: z.string().min(1),
  objective: z.string().min(1),
  team_config: z
    .object({
      agents: z
        .array(
          z.object({
            role: z.enum(["planner", "implementer", "tester", "reviewer", "researcher"]),
            objective: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  max_iterations: z.number().int().positive().optional(),
  provider_id: z
    .enum(["qwen-cli", "openai-compatible", "onprem-qwen", "openai-responses"])
    .optional(),
});

const teamMessageSchema = z.object({
  agent_role: z.string().min(1),
  message: z.string().min(1),
});

type TeamExecuteInput = z.infer<typeof teamExecuteSchema>;
type TeamMessageInput = z.infer<typeof teamMessageSchema>;

// ---------------------------------------------------------------------------
// In-memory team state (production would persist via DB)
// ---------------------------------------------------------------------------

interface TrackedTeam {
  id: string;
  projectId: string;
  objective: string;
  team: MultiAgentTeam;
  agents: AgentSpec[];
  status: "running" | "completed" | "failed";
  createdAt: string;
}

const activeTeams = new Map<string, TrackedTeam>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDefaultAgents(objective: string): AgentSpec[] {
  return [
    {
      id: `planner_${randomUUID().slice(0, 8)}`,
      role: "planner",
      objective: `Plan the implementation of: ${objective}`,
    },
    {
      id: `implementer_${randomUUID().slice(0, 8)}`,
      role: "implementer",
      objective,
    },
  ];
}

function buildAgentsFromConfig(
  config: NonNullable<TeamExecuteInput["team_config"]>,
  objective: string,
): AgentSpec[] {
  if (!config.agents || config.agents.length === 0) {
    return buildDefaultAgents(objective);
  }

  return config.agents.map((agent) => ({
    id: `${agent.role}_${randomUUID().slice(0, 8)}`,
    role: agent.role,
    objective: agent.objective ?? objective,
  }));
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export interface TeamRouteDeps {
  app: FastifyInstance;
  /** Optional factory to create orchestrator generators. Defaults to a no-op stub. */
  createOrchestrator?: (spec: AgentSpec) => AsyncGenerator<AgenticEvent>;
}

export function registerTeamRoutes(deps: TeamRouteDeps) {
  const { app } = deps;

  // Default orchestrator stub: yields nothing (fire-and-forget in tests)
  const createOrchestrator =
    deps.createOrchestrator ??
    (async function* (_spec: AgentSpec) {
      // No-op by default; real implementation wires into ExecutionService
    });

  // ----------- POST /api/agentic/execute-team -----------

  app.post<{ Body: TeamExecuteInput }>(
    "/api/agentic/execute-team",
    async (request, reply) => {
      const parsed = teamExecuteSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Invalid request body",
          details: parsed.error.issues,
        });
      }

      const { actor, project_id, objective, team_config, max_iterations, provider_id } =
        parsed.data;

      const teamId = `team_${randomUUID()}`;
      const agents = team_config
        ? buildAgentsFromConfig(team_config, objective)
        : buildDefaultAgents(objective);

      const team = new MultiAgentTeam(createOrchestrator);

      for (const agent of agents) {
        team.addAgent(agent);
      }

      const tracked: TrackedTeam = {
        id: teamId,
        projectId: project_id,
        objective,
        team,
        agents,
        status: "running",
        createdAt: new Date().toISOString(),
      };

      activeTeams.set(teamId, tracked);

      // Fire-and-forget team execution
      const baseInput: AgenticExecutionInput = {
        runId: teamId,
        repoId: project_id,
        ticketId: `ticket_${teamId}`,
        objective,
        worktreePath: `/tmp/${project_id}`,
        actor,
        maxIterations: max_iterations,
        providerId: provider_id,
      };

      void (async () => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          for await (const _event of team.execute(baseInput)) {
            // Events are consumed; a production system would publish them via SSE
          }
          tracked.status = "completed";
        } catch {
          tracked.status = "failed";
        }
      })();

      return reply.code(200).send({
        teamId,
        ticket: { id: `ticket_${teamId}`, objective },
        projectId: project_id,
      });
    },
  );

  // ----------- GET /api/agentic/teams/:id/status -----------

  app.get<{ Params: { id: string } }>(
    "/api/agentic/teams/:id/status",
    async (request, reply) => {
      const { id } = request.params;
      const tracked = activeTeams.get(id);

      if (!tracked) {
        return reply.code(404).send({ error: "Team not found" });
      }

      return reply.send({
        teamId: tracked.id,
        status: tracked.status,
        agents: tracked.agents.map((a) => ({
          id: a.id,
          role: a.role,
          objective: a.objective,
          active: tracked.team.getActiveAgents().includes(a.id),
        })),
        results: tracked.team.getResults(),
        createdAt: tracked.createdAt,
      });
    },
  );

  // ----------- POST /api/agentic/teams/:id/message -----------

  app.post<{ Params: { id: string }; Body: TeamMessageInput }>(
    "/api/agentic/teams/:id/message",
    async (request, reply) => {
      const { id } = request.params;
      const tracked = activeTeams.get(id);

      if (!tracked) {
        return reply.code(404).send({ error: "Team not found" });
      }

      const parsed = teamMessageSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Invalid request body",
          details: parsed.error.issues,
        });
      }

      const { agent_role, message } = parsed.data;

      // Find agent by role
      const targetAgent = tracked.agents.find((a) => a.role === agent_role);
      if (!targetAgent) {
        return reply.code(404).send({
          error: `Agent with role "${agent_role}" not found in team`,
        });
      }

      // Deliver message to the agent's queue
      tracked.team.sendMessage("user", targetAgent.id, message);

      return reply.send({ ok: true, agentId: targetAgent.id });
    },
  );
}

/**
 * Clear all tracked teams. Exposed for test cleanup.
 */
export function clearActiveTeams(): void {
  activeTeams.clear();
}
