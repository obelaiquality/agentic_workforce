import { beforeEach, describe, expect, it } from "vitest";
import { HookService, type HookPersistence } from "./hookService";

function createMemoryPersistence(): HookPersistence & {
  hooks: any[];
  logs: any[];
} {
  return {
    hooks: [],
    logs: [],
    async loadHooks() {
      return this.hooks;
    },
    async saveHooks(hooks) {
      this.hooks = hooks.map((item) => ({ ...item }));
    },
    async saveExecutionLog(log) {
      this.logs = [log, ...this.logs.filter((item) => item.id !== log.id)];
    },
    async listExecutionLogs(filter) {
      let items = [...this.logs];
      if (filter?.hookId) {
        items = items.filter((item) => item.hookId === filter.hookId);
      }
      if (filter?.runId) {
        items = items.filter((item) => item.runId === filter.runId);
      }
      return filter?.limit ? items.slice(0, filter.limit) : items;
    },
  };
}

describe("HookService", () => {
  let persistence: ReturnType<typeof createMemoryPersistence>;
  let service: HookService;

  beforeEach(async () => {
    persistence = createMemoryPersistence();
    service = new HookService(persistence);
    await service.initialize();
  });

  it("creates, updates, filters, and deletes hooks", async () => {
    const created = await service.createHook({
      name: "Guard writes",
      description: "Ask before mutation",
      enabled: true,
      eventType: "PreToolUse",
      hookType: "Prompt",
      command: null,
      promptTemplate: "Review {{tool_name}}",
      agentObjective: null,
      allowedTools: ["edit_file"],
      canOverride: false,
      continueOnError: true,
      timeoutMs: 1000,
      projectId: "proj-1",
    });

    expect(service.getHook(created.id)?.name).toBe("Guard writes");
    expect(service.listHooks({ projectId: "proj-1", enabled: true })).toHaveLength(1);

    const updated = await service.updateHook(created.id, {
      enabled: false,
      description: "Updated description",
    });

    expect(updated?.enabled).toBe(false);
    expect(updated?.description).toBe("Updated description");
    expect(service.listHooks({ enabled: false })).toHaveLength(1);

    expect(await service.deleteHook(created.id)).toBe(true);
    expect(service.getHook(created.id)).toBeNull();
  });

  it("includes global hooks during project-scoped execution", async () => {
    const globalHook = await service.createHook({
      name: "Global prompt",
      description: "",
      enabled: true,
      eventType: "Notification",
      hookType: "Prompt",
      command: null,
      promptTemplate: "Global notice",
      agentObjective: null,
      allowedTools: [],
      canOverride: false,
      continueOnError: true,
      timeoutMs: 1000,
      projectId: null,
    });
    const scopedHook = await service.createHook({
      name: "Scoped prompt",
      description: "",
      enabled: true,
      eventType: "Notification",
      hookType: "Prompt",
      command: null,
      promptTemplate: "Scoped notice",
      agentObjective: null,
      allowedTools: [],
      canOverride: false,
      continueOnError: true,
      timeoutMs: 1000,
      projectId: "proj-1",
    });

    const hooks = service.getHooksForEvent("Notification", "proj-1");
    expect(hooks.map((hook) => hook.id)).toEqual(
      expect.arrayContaining([globalHook.id, scopedHook.id]),
    );
  });

  it("executes command hooks with structured JSON output and logs them", async () => {
    const hook = await service.createHook({
      name: "Approve command",
      description: "",
      enabled: true,
      eventType: "PreToolUse",
      hookType: "Command",
      command:
        "node -e \"process.stdout.write(JSON.stringify({continue:true,systemMessage:'structured ok',permissionDecision:'approval_required',updatedInput:{dryRun:true}}))\"",
      promptTemplate: null,
      agentObjective: null,
      allowedTools: [],
      canOverride: true,
      continueOnError: true,
      timeoutMs: 1000,
      projectId: "proj-1",
    });

    const result = await service.executeHook({
      hookId: hook.id,
      eventType: "PreToolUse",
      eventPayload: { tool_name: "bash" },
      context: { runId: "run-1", projectId: "proj-1", ticketId: "ticket-1", stage: "build" },
    });

    expect(result.success).toBe(true);
    expect(result.permissionDecision).toBe("approval_required");
    expect(result.updatedInput).toEqual({ dryRun: true });
    expect(result.systemMessage).toBe("structured ok");

    const logs = await service.getExecutionLog({ hookId: hook.id });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.runId).toBe("run-1");
  });

  it("executes prompt and agent hooks", async () => {
    const promptHook = await service.createHook({
      name: "Prompt hook",
      description: "",
      enabled: true,
      eventType: "PreToolUse",
      hookType: "Prompt",
      command: null,
      promptTemplate: "Check {{tool_name}} with {{params}}",
      agentObjective: null,
      allowedTools: [],
      canOverride: false,
      continueOnError: true,
      timeoutMs: 1000,
      projectId: "proj-1",
    });
    const agentHook = await service.createHook({
      name: "Agent hook",
      description: "",
      enabled: true,
      eventType: "Notification",
      hookType: "Agent",
      command: null,
      promptTemplate: null,
      agentObjective: "Review the latest output",
      allowedTools: [],
      canOverride: false,
      continueOnError: true,
      timeoutMs: 1000,
      projectId: "proj-1",
    });

    const promptResult = await service.executeHook({
      hookId: promptHook.id,
      eventType: "PreToolUse",
      eventPayload: { tool_name: "edit_file", params: { path: "a.ts" } },
      context: { runId: "run-1", projectId: "proj-1", ticketId: "ticket-1", stage: "build" },
    });
    const agentResult = await service.executeHook({
      hookId: agentHook.id,
      eventType: "Notification",
      eventPayload: { message: "done" },
      context: { runId: "run-1", projectId: "proj-1", ticketId: "ticket-1", stage: "review" },
    });

    expect(promptResult.systemMessage).toContain("Check edit_file");
    expect(agentResult.systemMessage).toContain("Review the latest output");
  });

  it("returns a disabled error without executing", async () => {
    const hook = await service.createHook({
      name: "Disabled hook",
      description: "",
      enabled: false,
      eventType: "PreToolUse",
      hookType: "Prompt",
      command: null,
      promptTemplate: "never",
      agentObjective: null,
      allowedTools: [],
      canOverride: false,
      continueOnError: true,
      timeoutMs: 1000,
      projectId: "proj-1",
    });

    const result = await service.executeHook({
      hookId: hook.id,
      eventType: "PreToolUse",
      eventPayload: {},
      context: { runId: "run-1", projectId: "proj-1", ticketId: "ticket-1", stage: "build" },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("disabled");
  });

  it("aggregates lifecycle hook output and stops on continue=false", async () => {
    await service.createHook({
      name: "Mutate input",
      description: "",
      enabled: true,
      eventType: "PreToolUse",
      hookType: "Command",
      command:
        "node -e \"process.stdout.write(JSON.stringify({continue:true,systemMessage:'first',updatedInput:{tool_name:'safe_tool'},permissionDecision:'allow'}))\"",
      promptTemplate: null,
      agentObjective: null,
      allowedTools: [],
      canOverride: true,
      continueOnError: true,
      timeoutMs: 1000,
      projectId: "proj-1",
    });
    await service.createHook({
      name: "Require approval",
      description: "",
      enabled: true,
      eventType: "PreToolUse",
      hookType: "Command",
      command:
        "node -e \"process.stdout.write(JSON.stringify({continue:false,systemMessage:'second',permissionDecision:'approval_required'}))\"",
      promptTemplate: null,
      agentObjective: null,
      allowedTools: [],
      canOverride: true,
      continueOnError: true,
      timeoutMs: 1000,
      projectId: "proj-1",
    });

    const aggregate = await service.executeHooksForEvent({
      eventType: "PreToolUse",
      eventPayload: { tool_name: "bash" },
      context: { runId: "run-1", projectId: "proj-1", ticketId: "ticket-1", stage: "build" },
    });

    expect(aggregate.outputs).toHaveLength(2);
    expect(aggregate.updatedInput.tool_name).toBe("safe_tool");
    expect(aggregate.systemMessages).toEqual(["first", "second"]);
    expect(aggregate.permissionDecision).toBe("approval_required");
    expect(aggregate.shouldContinue).toBe(false);
  });

  it("testHook does not persist execution logs", async () => {
    const hook = await service.createHook({
      name: "Prompt test",
      description: "",
      enabled: true,
      eventType: "PreToolUse",
      hookType: "Prompt",
      command: null,
      promptTemplate: "Test {{tool_name}}",
      agentObjective: null,
      allowedTools: [],
      canOverride: false,
      continueOnError: true,
      timeoutMs: 1000,
      projectId: "proj-1",
    });

    const result = await service.testHook(hook.id, { tool_name: "bash" });
    expect(result.success).toBe(true);
    expect(await service.getExecutionLog()).toHaveLength(0);
  });

  it("reloads hooks and execution logs from persistence", async () => {
    const hook = await service.createHook({
      name: "Persisted",
      description: "",
      enabled: true,
      eventType: "Notification",
      hookType: "Agent",
      command: null,
      promptTemplate: null,
      agentObjective: "Persist this hook",
      allowedTools: [],
      canOverride: false,
      continueOnError: true,
      timeoutMs: 1000,
      projectId: "proj-1",
    });

    await service.executeHook({
      hookId: hook.id,
      eventType: "Notification",
      eventPayload: { message: "done" },
      context: { runId: "run-99", projectId: "proj-1", ticketId: "ticket-1", stage: "review" },
    });

    const reloaded = new HookService(persistence);
    await reloaded.initialize();

    expect(reloaded.getHook(hook.id)?.name).toBe("Persisted");
    const logs = await reloaded.getExecutionLog({ runId: "run-99" });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.hookName).toBe("Persisted");
  });
});
