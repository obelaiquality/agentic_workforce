import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {},
}));

vi.mock("../db", () => ({
  prisma: mocks.prisma,
}));

import { registerMissionRoutes } from "./missionRoutes";

function createHarness() {
  const app = Fastify();

  registerMissionRoutes({
    app,
    apiToken: "local-token",
    approvalService: {} as never,
    chatService: {} as never,
    codeGraphService: {} as never,
    commandEngine: {} as never,
    contextService: {} as never,
    executionService: {} as never,
    githubService: {} as never,
    missionControlService: {} as never,
    projectBlueprintService: {} as never,
    providerOrchestrator: {} as never,
    repoService: {} as never,
    routerService: {} as never,
    ticketService: {} as never,
    v2CommandService: {} as never,
    v2EventService: {} as never,
    v2QueryService: {} as never,
  });

  return { app };
}

describe("missionRoutes command bootstrap surface", () => {
  it("does not expose the deprecated raw tool invoke route", async () => {
    const { app } = createHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/v9/mission/tool.invoke",
      payload: {},
    });

    expect(response.statusCode).toBe(404);

    await app.close();
  });

  it("registers the dependency bootstrap route instead", async () => {
    const { app } = createHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/v9/mission/dependency.bootstrap",
      payload: {},
    });

    expect(response.statusCode).not.toBe(404);

    await app.close();
  });

  it("rejects full_access writes on the public ticket permission route", async () => {
    const { app } = createHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/v9/mission/ticket.permission",
      payload: {
        ticket_id: "ticket-1",
        mode: "full_access",
      },
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it("rejects full_access as an execute-time permission mode", async () => {
    const { app } = createHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/v9/mission/execute",
      payload: {
        actor: "user",
        project_id: "repo-1",
        prompt: "Verify the build",
        permission_mode: "full_access",
      },
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });
});
