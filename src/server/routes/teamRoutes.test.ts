import Fastify from "fastify";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { registerTeamRoutes, clearActiveTeams } from "./teamRoutes";
import type { AgentSpec } from "../execution/multiAgentTeam";
import type { AgenticEvent } from "../tools/types";

function createHarness(overrides?: {
  createOrchestrator?: (spec: AgentSpec) => AsyncGenerator<AgenticEvent>;
}) {
  const app = Fastify();
  const createOrchestrator =
    overrides?.createOrchestrator ??
    (async function* (_spec: AgentSpec) {
      // No-op default
    });

  registerTeamRoutes({ app, createOrchestrator });
  return { app };
}

describe("teamRoutes", () => {
  afterEach(() => {
    clearActiveTeams();
  });

  // ---------------------------------------------------------------------------
  // POST /api/agentic/execute-team validation
  // ---------------------------------------------------------------------------

  it("POST /api/agentic/execute-team — validates required fields", async () => {
    const { app } = createHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/agentic/execute-team",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error).toBe("Invalid request body");
    expect(body.details).toBeDefined();

    await app.close();
  });

  it("POST /api/agentic/execute-team — rejects missing actor", async () => {
    const { app } = createHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/agentic/execute-team",
      payload: {
        project_id: "proj-1",
        objective: "Build feature X",
      },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.details).toBeDefined();
    expect(body.details.some((d: { path: string[] }) => d.path.includes("actor"))).toBe(true);

    await app.close();
  });

  it("POST /api/agentic/execute-team — rejects missing project_id", async () => {
    const { app } = createHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/agentic/execute-team",
      payload: {
        actor: "user-1",
        objective: "Build feature X",
      },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.details).toBeDefined();
    expect(
      body.details.some((d: { path: string[] }) => d.path.includes("project_id")),
    ).toBe(true);

    await app.close();
  });

  it("POST /api/agentic/execute-team — rejects missing objective", async () => {
    const { app } = createHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/agentic/execute-team",
      payload: {
        actor: "user-1",
        project_id: "proj-1",
      },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.details).toBeDefined();
    expect(
      body.details.some((d: { path: string[] }) => d.path.includes("objective")),
    ).toBe(true);

    await app.close();
  });

  // ---------------------------------------------------------------------------
  // POST /api/agentic/execute-team — success cases
  // ---------------------------------------------------------------------------

  it("POST /api/agentic/execute-team — accepts valid input and returns teamId", async () => {
    const { app } = createHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/agentic/execute-team",
      payload: {
        actor: "user-1",
        project_id: "proj-1",
        objective: "Build feature X",
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.teamId).toBeDefined();
    expect(body.teamId).toMatch(/^team_/);
    expect(body.projectId).toBe("proj-1");
    expect(body.ticket).toBeDefined();
    expect(body.ticket.objective).toBe("Build feature X");

    await app.close();
  });

  it("POST /api/agentic/execute-team — accepts optional team_config", async () => {
    const { app } = createHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/agentic/execute-team",
      payload: {
        actor: "user-1",
        project_id: "proj-1",
        objective: "Build feature Y",
        team_config: {
          agents: [
            { role: "planner", objective: "Plan Y" },
            { role: "implementer" },
            { role: "tester", objective: "Test Y" },
          ],
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.teamId).toBeDefined();

    // Verify the team was created and can be queried
    const statusResponse = await app.inject({
      method: "GET",
      url: `/api/agentic/teams/${body.teamId}/status`,
    });

    expect(statusResponse.statusCode).toBe(200);
    const status = statusResponse.json();
    expect(status.agents).toHaveLength(3);
    expect(status.agents.map((a: { role: string }) => a.role)).toEqual([
      "planner",
      "implementer",
      "tester",
    ]);

    await app.close();
  });

  it("POST /api/agentic/execute-team — accepts optional provider_id", async () => {
    const { app } = createHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/agentic/execute-team",
      payload: {
        actor: "user-1",
        project_id: "proj-1",
        objective: "Build feature Z",
        provider_id: "openai-responses",
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.teamId).toBeDefined();

    await app.close();
  });

  // ---------------------------------------------------------------------------
  // GET /api/agentic/teams/:id/status
  // ---------------------------------------------------------------------------

  it("GET /api/agentic/teams/:id/status — returns 404 for unknown team", async () => {
    const { app } = createHarness();

    const response = await app.inject({
      method: "GET",
      url: "/api/agentic/teams/nonexistent-team/status",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe("Team not found");

    await app.close();
  });

  it("GET /api/agentic/teams/:id/status — returns status for existing team", async () => {
    const { app } = createHarness();

    // Create a team first
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/agentic/execute-team",
      payload: {
        actor: "user-1",
        project_id: "proj-1",
        objective: "Status test",
      },
    });

    const teamId = createResponse.json().teamId;

    const statusResponse = await app.inject({
      method: "GET",
      url: `/api/agentic/teams/${teamId}/status`,
    });

    expect(statusResponse.statusCode).toBe(200);
    const status = statusResponse.json();
    expect(status.teamId).toBe(teamId);
    expect(["running", "completed"]).toContain(status.status);
    expect(status.agents).toBeDefined();
    expect(status.agents.length).toBeGreaterThan(0);
    expect(status.createdAt).toBeDefined();

    await app.close();
  });

  // ---------------------------------------------------------------------------
  // POST /api/agentic/teams/:id/message
  // ---------------------------------------------------------------------------

  it("POST /api/agentic/teams/:id/message — returns 404 for unknown team", async () => {
    const { app } = createHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/agentic/teams/nonexistent-team/message",
      payload: {
        agent_role: "planner",
        message: "Hello",
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe("Team not found");

    await app.close();
  });

  it("POST /api/agentic/teams/:id/message — validates required fields", async () => {
    const { app } = createHarness();

    // Create a team first
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/agentic/execute-team",
      payload: {
        actor: "user-1",
        project_id: "proj-1",
        objective: "Message test",
      },
    });
    const teamId = createResponse.json().teamId;

    const response = await app.inject({
      method: "POST",
      url: `/api/agentic/teams/${teamId}/message`,
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("Invalid request body");

    await app.close();
  });

  it("POST /api/agentic/teams/:id/message — delivers message to agent", async () => {
    const { app } = createHarness();

    // Create a team with a planner
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/agentic/execute-team",
      payload: {
        actor: "user-1",
        project_id: "proj-1",
        objective: "Deliver message test",
        team_config: {
          agents: [{ role: "planner" }],
        },
      },
    });

    const teamId = createResponse.json().teamId;

    const msgResponse = await app.inject({
      method: "POST",
      url: `/api/agentic/teams/${teamId}/message`,
      payload: {
        agent_role: "planner",
        message: "Please prioritize feature A",
      },
    });

    expect(msgResponse.statusCode).toBe(200);
    const msgBody = msgResponse.json();
    expect(msgBody.ok).toBe(true);
    expect(msgBody.agentId).toBeDefined();

    await app.close();
  });

  it("POST /api/agentic/teams/:id/message — returns 404 for unknown agent role", async () => {
    const { app } = createHarness();

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/agentic/execute-team",
      payload: {
        actor: "user-1",
        project_id: "proj-1",
        objective: "Unknown role test",
        team_config: {
          agents: [{ role: "planner" }],
        },
      },
    });

    const teamId = createResponse.json().teamId;

    const response = await app.inject({
      method: "POST",
      url: `/api/agentic/teams/${teamId}/message`,
      payload: {
        agent_role: "nonexistent_role",
        message: "Hello",
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toContain("not found in team");

    await app.close();
  });
});
