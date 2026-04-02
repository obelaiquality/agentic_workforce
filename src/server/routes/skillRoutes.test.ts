import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerSkillRoutes } from "./skillRoutes";
import { SkillService } from "../skills/skillService";
import { setSkillService, skillTool } from "../tools/definitions/skill";
import type { ToolContext } from "../tools/types";

function createHarness() {
  const app = Fastify();
  const service = new SkillService();
  setSkillService(service);
  registerSkillRoutes(app, service);
  return { app, service };
}

describe("skillRoutes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a skill through the API and exposes it to the runtime tool", async () => {
    const { app, service } = createHarness();

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/skills",
      payload: {
        name: "deploy",
        description: "Ship the current branch",
        contextMode: "inline",
        allowedTools: ["bash", "git_status"],
        maxIterations: 2,
        systemPrompt: "Prepare a safe deploy plan and execute only after verification.",
        tags: ["ops", "release"],
      },
    });

    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json().item;
    expect(service.getSkill(created.id)?.name).toBe("deploy");

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/skills?builtIn=false",
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().items).toHaveLength(1);

    const updateResponse = await app.inject({
      method: "PATCH",
      url: `/api/skills/${created.id}`,
      payload: {
        description: "Ship the current branch after checks",
      },
    });
    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json().item.description).toContain("after checks");

    const context = {
      runId: "run-1",
      repoId: "proj-1",
      ticketId: "ticket-1",
      worktreePath: "/tmp/project",
      actor: "operator",
      stage: "build",
      conversationHistory: [],
      createApproval: vi.fn(async () => ({ id: "approval-1" })),
      recordEvent: vi.fn(async () => {}),
    } as unknown as ToolContext;

    const result = await skillTool.execute({ skill: created.id, args: "deploy staging" }, context);
    expect(result.type).toBe("success");
    if (result.type === "success") {
      expect(result.content).toContain("Prepare a safe deploy plan");
      expect(result.metadata?.skillName).toBe("deploy");
      expect(result.metadata?.maxIterations).toBe(2);
    }

    const invocationsResponse = await app.inject({
      method: "GET",
      url: "/api/skills/invocations?runId=run-1",
    });
    expect(invocationsResponse.statusCode).toBe(200);
    expect(invocationsResponse.json().items).toHaveLength(1);

    const invocationId = invocationsResponse.json().items[0].id;
    const invocationResponse = await app.inject({
      method: "GET",
      url: `/api/skills/invocations/${invocationId}`,
    });
    expect(invocationResponse.statusCode).toBe(200);
    expect(invocationResponse.json().item.skillName).toBe("deploy");

    await app.close();
  });

  it("returns 404 for unknown skill or invocation", async () => {
    const { app } = createHarness();

    const skillResponse = await app.inject({
      method: "GET",
      url: "/api/skills/missing",
    });
    expect(skillResponse.statusCode).toBe(404);

    const invocationResponse = await app.inject({
      method: "GET",
      url: "/api/skills/invocations/missing",
    });
    expect(invocationResponse.statusCode).toBe(404);

    await app.close();
  });
});
