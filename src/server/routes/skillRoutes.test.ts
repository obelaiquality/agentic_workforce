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

  it("gets a single skill by ID and deletes it successfully", async () => {
    const { app } = createHarness();

    const createRes = await app.inject({
      method: "POST",
      url: "/api/skills",
      payload: {
        name: "fetch-skill",
        description: "Skill to fetch and delete",
        systemPrompt: "Do the thing",
      },
    });
    const skillId = createRes.json().item.id;

    // GET individual skill
    const getRes = await app.inject({
      method: "GET",
      url: `/api/skills/${skillId}`,
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().item.name).toBe("fetch-skill");
    expect(getRes.json().item.id).toBe(skillId);

    // DELETE successfully
    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/api/skills/${skillId}`,
    });
    expect(deleteRes.statusCode).toBe(200);
    expect(deleteRes.json()).toEqual({ ok: true });

    await app.close();
  });

  it("returns 404 when patching a non-existent skill", async () => {
    const { app } = createHarness();

    const res = await app.inject({
      method: "PATCH",
      url: "/api/skills/nonexistent-id",
      payload: { description: "updated" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Skill not found or is built-in" });

    await app.close();
  });

  it("returns 404 when deleting a non-existent skill", async () => {
    const { app } = createHarness();

    const res = await app.inject({
      method: "DELETE",
      url: "/api/skills/nonexistent-id",
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Skill not found or is built-in" });

    await app.close();
  });

  it("returns 400 when POST /api/skills throws an Error", async () => {
    const { app, service } = createHarness();
    vi.spyOn(service, "createSkill").mockRejectedValueOnce(new Error("Duplicate name"));

    const res = await app.inject({
      method: "POST",
      url: "/api/skills",
      payload: { name: "dup" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Duplicate name" });

    await app.close();
  });

  it("returns 400 when POST /api/skills throws a non-Error value", async () => {
    const { app, service } = createHarness();
    vi.spyOn(service, "createSkill").mockRejectedValueOnce("raw-string-error");

    const res = await app.inject({
      method: "POST",
      url: "/api/skills",
      payload: { name: "test" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "raw-string-error" });

    await app.close();
  });

  it("lists skills with tags filter", async () => {
    const { app } = createHarness();

    // Create a skill with tags
    await app.inject({
      method: "POST",
      url: "/api/skills",
      payload: {
        name: "tagged-skill",
        description: "Has tags",
        tags: ["ops", "deploy"],
        systemPrompt: "Do it",
      },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/skills?tags=ops,deploy",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.length).toBeGreaterThanOrEqual(1);

    await app.close();
  });

  it("creates a skill with non-array allowedTools and tags, and non-number maxIterations", async () => {
    const { app } = createHarness();

    const res = await app.inject({
      method: "POST",
      url: "/api/skills",
      payload: {
        name: "bare-skill",
        description: "Minimal config",
        systemPrompt: "Do something",
        allowedTools: "not-an-array",
        tags: "not-an-array",
        maxIterations: "not-a-number",
        referenceFiles: "not-an-array",
        author: "custom-author",
        version: "2.0.0",
        contextMode: "fork",
      },
    });
    expect(res.statusCode).toBe(201);
    const item = res.json().item;
    expect(item.allowedTools).toEqual([]);
    expect(item.tags).toEqual([]);
    expect(item.maxIterations).toBeNull();
    expect(item.referenceFiles).toEqual([]);
    expect(item.author).toBe("custom-author");
    expect(item.version).toBe("2.0.0");
    expect(item.contextMode).toBe("fork");

    await app.close();
  });

  it("lists invocations with limit query parameter", async () => {
    const { app } = createHarness();

    const res = await app.inject({
      method: "GET",
      url: "/api/skills/invocations?limit=10",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toEqual([]);

    await app.close();
  });
});
