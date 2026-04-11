import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerHookRoutes } from "./hookRoutes";
import { HookService } from "../hooks/hookService";

function createHarness() {
  const app = Fastify();
  const service = new HookService();
  registerHookRoutes(app, service);
  return { app, service };
}

describe("hookRoutes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates, filters, tests, and lists execution logs for hooks", async () => {
    const { app, service } = createHarness();

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/hooks",
      payload: {
        name: "Tool guard",
        description: "Review edits before execution",
        enabled: true,
        eventType: "PreToolUse",
        hookType: "Prompt",
        promptTemplate: "Inspect {{tool_name}} before it runs",
        projectId: "proj-1",
      },
    });

    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json().item;

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/hooks?projectId=proj-1&eventType=PreToolUse&enabled=true",
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().items).toHaveLength(1);

    const testResponse = await app.inject({
      method: "POST",
      url: `/api/hooks/${created.id}/test`,
      payload: {
        testPayload: {
          tool_name: "edit_file",
          params: { path: "src/app.ts" },
        },
      },
    });
    expect(testResponse.statusCode).toBe(200);
    expect(testResponse.json().output.systemMessage).toContain("Inspect edit_file");

    await service.executeHooksForEvent({
      eventType: "PreToolUse",
      eventPayload: {
        tool_name: "edit_file",
        params: { path: "src/app.ts" },
      },
      context: {
        runId: "run-1",
        projectId: "proj-1",
        ticketId: "ticket-1",
        stage: "build",
      },
    });

    const logResponse = await app.inject({
      method: "GET",
      url: `/api/hooks/executions?hookId=${created.id}&runId=run-1`,
    });
    expect(logResponse.statusCode).toBe(200);
    expect(logResponse.json().items).toHaveLength(1);
    expect(logResponse.json().items[0].hookName).toBe("Tool guard");

    const updateResponse = await app.inject({
      method: "PATCH",
      url: `/api/hooks/${created.id}`,
      payload: { enabled: false },
    });
    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json().item.enabled).toBe(false);

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/hooks/${created.id}`,
    });
    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json()).toEqual({ ok: true });

    await app.close();
  });

  it("returns 404 for unknown hooks", async () => {
    const { app } = createHarness();

    const response = await app.inject({
      method: "GET",
      url: "/api/hooks/missing",
    });
    expect(response.statusCode).toBe(404);

    await app.close();
  });

  it("gets a single hook by ID", async () => {
    const { app } = createHarness();

    const createRes = await app.inject({
      method: "POST",
      url: "/api/hooks",
      payload: {
        name: "Single hook",
        eventType: "PreToolUse",
        hookType: "Command",
        command: "echo test",
      },
    });
    const hookId = createRes.json().item.id;

    const getRes = await app.inject({
      method: "GET",
      url: `/api/hooks/${hookId}`,
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().item.name).toBe("Single hook");
    expect(getRes.json().item.id).toBe(hookId);

    await app.close();
  });

  it("returns 404 when patching a non-existent hook", async () => {
    const { app } = createHarness();

    const res = await app.inject({
      method: "PATCH",
      url: "/api/hooks/nonexistent-id",
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Hook not found" });

    await app.close();
  });

  it("returns 404 when deleting a non-existent hook", async () => {
    const { app } = createHarness();

    const res = await app.inject({
      method: "DELETE",
      url: "/api/hooks/nonexistent-id",
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Hook not found" });

    await app.close();
  });

  it("returns 400 when POST /api/hooks fails validation", async () => {
    const { app, service } = createHarness();
    vi.spyOn(service, "createHook").mockRejectedValueOnce(new Error("Name is required"));

    const res = await app.inject({
      method: "POST",
      url: "/api/hooks",
      payload: { name: "" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Name is required" });

    await app.close();
  });

  it("returns 400 when POST /api/hooks throws a non-Error value", async () => {
    const { app, service } = createHarness();
    vi.spyOn(service, "createHook").mockRejectedValueOnce("string-error");

    const res = await app.inject({
      method: "POST",
      url: "/api/hooks",
      payload: { name: "test" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "string-error" });

    await app.close();
  });

  it("returns 400 when POST /api/hooks/:id/test throws an error", async () => {
    const { app, service } = createHarness();
    vi.spyOn(service, "testHook").mockRejectedValueOnce(new Error("Test hook exploded"));

    // Create a hook first so we have a valid ID
    const createRes = await app.inject({
      method: "POST",
      url: "/api/hooks",
      payload: {
        name: "Tester",
        eventType: "PreToolUse",
        hookType: "Command",
        command: "echo hello",
      },
    });
    const hookId = createRes.json().item.id;

    const res = await app.inject({
      method: "POST",
      url: `/api/hooks/${hookId}/test`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Test hook exploded" });

    await app.close();
  });

  it("returns 400 when POST /api/hooks/:id/test throws a non-Error", async () => {
    const { app, service } = createHarness();
    vi.spyOn(service, "testHook").mockRejectedValueOnce(42);

    const createRes = await app.inject({
      method: "POST",
      url: "/api/hooks",
      payload: {
        name: "Tester2",
        eventType: "PreToolUse",
        hookType: "Command",
        command: "echo hello",
      },
    });
    const hookId = createRes.json().item.id;

    const res = await app.inject({
      method: "POST",
      url: `/api/hooks/${hookId}/test`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "42" });

    await app.close();
  });

  it("creates a hook with hookType Agent and Command (default)", async () => {
    const { app } = createHarness();

    // Agent hookType
    const agentRes = await app.inject({
      method: "POST",
      url: "/api/hooks",
      payload: {
        name: "Agent hook",
        eventType: "PostToolUse",
        hookType: "Agent",
        agentObjective: "Review output",
        allowedTools: ["bash", 123],
      },
    });
    expect(agentRes.statusCode).toBe(201);
    expect(agentRes.json().item.hookType).toBe("Agent");
    expect(agentRes.json().item.agentObjective).toBe("Review output");
    // Non-string items in allowedTools should be filtered out
    expect(agentRes.json().item.allowedTools).toEqual(["bash"]);

    // Default hookType (not Prompt or Agent -> Command)
    const cmdRes = await app.inject({
      method: "POST",
      url: "/api/hooks",
      payload: {
        name: "Command hook",
        eventType: "PostToolUse",
        hookType: "InvalidType",
        command: "/bin/run",
        canOverride: true,
        continueOnError: false,
        timeoutMs: 5000,
        enabled: false,
      },
    });
    expect(cmdRes.statusCode).toBe(201);
    expect(cmdRes.json().item.hookType).toBe("Command");
    expect(cmdRes.json().item.command).toBe("/bin/run");
    expect(cmdRes.json().item.canOverride).toBe(true);
    expect(cmdRes.json().item.continueOnError).toBe(false);
    expect(cmdRes.json().item.timeoutMs).toBe(5000);
    expect(cmdRes.json().item.enabled).toBe(false);

    await app.close();
  });

  it("lists hooks with enabled=false filter", async () => {
    const { app } = createHarness();

    // Create a disabled hook
    await app.inject({
      method: "POST",
      url: "/api/hooks",
      payload: {
        name: "Disabled hook",
        eventType: "PostToolUse",
        hookType: "Command",
        command: "echo disabled",
        enabled: false,
      },
    });

    // Create an enabled hook
    await app.inject({
      method: "POST",
      url: "/api/hooks",
      payload: {
        name: "Enabled hook",
        eventType: "PostToolUse",
        hookType: "Command",
        command: "echo enabled",
        enabled: true,
      },
    });

    // Filter by enabled=false
    const res = await app.inject({
      method: "GET",
      url: "/api/hooks?enabled=false",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(1);
    expect(res.json().items[0].name).toBe("Disabled hook");

    await app.close();
  });

  it("lists execution logs with limit query parameter", async () => {
    const { app } = createHarness();

    const res = await app.inject({
      method: "GET",
      url: "/api/hooks/executions?limit=5",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toEqual([]);

    await app.close();
  });
});
