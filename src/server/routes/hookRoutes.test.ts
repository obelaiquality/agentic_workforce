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
});
