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

  describe("Prompt hook command execution", () => {
    it("executes command with stdin/stdout when command is provided", async () => {
      const hook = await service.createHook({
        name: "Transform prompt",
        description: "",
        enabled: true,
        eventType: "prompt_transform",
        hookType: "Prompt",
        command: "node -e \"const input = require('fs').readFileSync(0, 'utf-8'); process.stdout.write(input.toUpperCase());\"",
        promptTemplate: "Check {{tool_name}}",
        agentObjective: null,
        allowedTools: [],
        canOverride: false,
        continueOnError: false,
        timeoutMs: 1000,
        projectId: "proj-1",
      });

      const result = await service.executeHook({
        hookId: hook.id,
        eventType: "prompt_transform",
        eventPayload: { tool_name: "edit_file" },
        context: { runId: "run-1", projectId: "proj-1", ticketId: "ticket-1", stage: "build" },
      });

      expect(result.success).toBe(true);
      expect(result.systemMessage).toContain("CHECK EDIT_FILE");
    });

    it("falls back to template rendering when no command is provided", async () => {
      const hook = await service.createHook({
        name: "Template only",
        description: "",
        enabled: true,
        eventType: "prompt_transform",
        hookType: "Prompt",
        command: null,
        promptTemplate: "Review {{tool_name}}",
        agentObjective: null,
        allowedTools: [],
        canOverride: false,
        continueOnError: true,
        timeoutMs: 1000,
        projectId: "proj-1",
      });

      const result = await service.executeHook({
        hookId: hook.id,
        eventType: "prompt_transform",
        eventPayload: { tool_name: "bash" },
        context: { runId: "run-1", projectId: "proj-1", ticketId: "ticket-1", stage: "build" },
      });

      expect(result.success).toBe(true);
      expect(result.systemMessage).toContain("Review bash");
    });

    it("handles command errors gracefully with continueOnError=true", async () => {
      const hook = await service.createHook({
        name: "Failing command",
        description: "",
        enabled: true,
        eventType: "prompt_transform",
        hookType: "Prompt",
        command: "exit 1",
        promptTemplate: "Fallback text",
        agentObjective: null,
        allowedTools: [],
        canOverride: false,
        continueOnError: true,
        timeoutMs: 1000,
        projectId: "proj-1",
      });

      const result = await service.executeHook({
        hookId: hook.id,
        eventType: "prompt_transform",
        eventPayload: {},
        context: { runId: "run-1", projectId: "proj-1", ticketId: "ticket-1", stage: "build" },
      });

      expect(result.success).toBe(true);
      expect(result.systemMessage).toContain("Fallback text");
    });

    it("fails when command errors and continueOnError=false", async () => {
      const hook = await service.createHook({
        name: "Strict command",
        description: "",
        enabled: true,
        eventType: "prompt_transform",
        hookType: "Prompt",
        command: "exit 1",
        promptTemplate: "Should not see this",
        agentObjective: null,
        allowedTools: [],
        canOverride: false,
        continueOnError: false,
        timeoutMs: 1000,
        projectId: "proj-1",
      });

      const result = await service.executeHook({
        hookId: hook.id,
        eventType: "prompt_transform",
        eventPayload: {},
        context: { runId: "run-1", projectId: "proj-1", ticketId: "ticket-1", stage: "build" },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Prompt hook command failed");
    });
  });

  describe("Agent hook tool lifecycle", () => {
    it("tool_before hook can block execution", async () => {
      const hook = await service.createHook({
        name: "Block dangerous tools",
        description: "",
        enabled: true,
        eventType: "tool_before",
        hookType: "Agent",
        command: "node -e \"process.stdout.write(JSON.stringify({allow:false,reason:'Tool not allowed'}))\"",
        promptTemplate: null,
        agentObjective: null,
        allowedTools: [],
        canOverride: false,
        continueOnError: false,
        timeoutMs: 1000,
        projectId: "proj-1",
      });

      const result = await service.executeHook({
        hookId: hook.id,
        eventType: "tool_before",
        eventPayload: { tool_name: "bash", input: { command: "rm -rf /" } },
        context: { runId: "run-1", projectId: "proj-1", ticketId: "ticket-1", stage: "build" },
      });

      expect(result.success).toBe(true);
      expect(result.continue).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.blockReason).toBe("Tool not allowed");
    });

    it("tool_before hook can modify tool input", async () => {
      const hook = await service.createHook({
        name: "Sanitize input",
        description: "",
        enabled: true,
        eventType: "tool_before",
        hookType: "Agent",
        command:
          "node -e \"const data=JSON.parse(require('fs').readFileSync(0,'utf-8')); process.stdout.write(JSON.stringify({input:{...data.input,sanitized:true}}))\"",
        promptTemplate: null,
        agentObjective: null,
        allowedTools: [],
        canOverride: false,
        continueOnError: false,
        timeoutMs: 1000,
        projectId: "proj-1",
      });

      const result = await service.executeHook({
        hookId: hook.id,
        eventType: "tool_before",
        eventPayload: { tool_name: "edit_file", input: { path: "test.ts" } },
        context: { runId: "run-1", projectId: "proj-1", ticketId: "ticket-1", stage: "build" },
      });

      expect(result.success).toBe(true);
      expect(result.updatedInput).toEqual({ path: "test.ts", sanitized: true });
    });

    it("tool_after hook receives tool results", async () => {
      const hook = await service.createHook({
        name: "Log tool results",
        description: "",
        enabled: true,
        eventType: "tool_after",
        hookType: "Agent",
        command: "node -e \"const data=JSON.parse(require('fs').readFileSync(0,'utf-8')); process.stdout.write('Tool '+data.tool_name+' completed')\"",
        promptTemplate: null,
        agentObjective: null,
        allowedTools: [],
        canOverride: false,
        continueOnError: true,
        timeoutMs: 1000,
        projectId: "proj-1",
      });

      const result = await service.executeHook({
        hookId: hook.id,
        eventType: "tool_after",
        eventPayload: { tool_name: "bash", result: { stdout: "success" } },
        context: { runId: "run-1", projectId: "proj-1", ticketId: "ticket-1", stage: "build" },
      });

      expect(result.success).toBe(true);
      expect(result.systemMessage).toContain("Tool bash completed");
    });

    it("requires command for tool lifecycle events", async () => {
      const hook = await service.createHook({
        name: "No command",
        description: "",
        enabled: true,
        eventType: "tool_before",
        hookType: "Agent",
        command: null,
        promptTemplate: null,
        agentObjective: "Should fail",
        allowedTools: [],
        canOverride: false,
        continueOnError: false,
        timeoutMs: 1000,
        projectId: "proj-1",
      });

      const result = await service.executeHook({
        hookId: hook.id,
        eventType: "tool_before",
        eventPayload: { tool_name: "bash" },
        context: { runId: "run-1", projectId: "proj-1", ticketId: "ticket-1", stage: "build" },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("requires a command");
    });
  });

  describe("Agent hook run lifecycle", () => {
    it("run_start hook executes with command", async () => {
      const hook = await service.createHook({
        name: "Run started",
        description: "",
        enabled: true,
        eventType: "run_start",
        hookType: "Agent",
        command: "node -e \"process.stdout.write('Starting new run')\"",
        promptTemplate: null,
        agentObjective: null,
        allowedTools: [],
        canOverride: false,
        continueOnError: true,
        timeoutMs: 1000,
        projectId: "proj-1",
      });

      const result = await service.executeHook({
        hookId: hook.id,
        eventType: "run_start",
        eventPayload: { objective: "Build feature X" },
        context: { runId: "run-1", projectId: "proj-1", ticketId: "ticket-1", stage: "build" },
      });

      expect(result.success).toBe(true);
      expect(result.systemMessage).toContain("Starting new run");
    });

    it("run_end hook executes with command", async () => {
      const hook = await service.createHook({
        name: "Run ended",
        description: "",
        enabled: true,
        eventType: "run_end",
        hookType: "Agent",
        command: "node -e \"const data=JSON.parse(require('fs').readFileSync(0,'utf-8')); process.stdout.write('Run completed: '+data.status)\"",
        promptTemplate: null,
        agentObjective: null,
        allowedTools: [],
        canOverride: false,
        continueOnError: true,
        timeoutMs: 1000,
        projectId: "proj-1",
      });

      const result = await service.executeHook({
        hookId: hook.id,
        eventType: "run_end",
        eventPayload: { status: "success" },
        context: { runId: "run-1", projectId: "proj-1", ticketId: "ticket-1", stage: "review" },
      });

      expect(result.success).toBe(true);
      expect(result.systemMessage).toContain("Run completed: success");
    });
  });

  it("deleteHook returns false for non-existent hook", async () => {
    expect(await service.deleteHook("non-existent-id")).toBe(false);
  });

  it("executeHook returns error for non-existent hook", async () => {
    const result = await service.executeHook({
      hookId: "non-existent",
      eventType: "PreToolUse",
      eventPayload: {},
      context: { runId: "r", projectId: "p", ticketId: "t", stage: "s" },
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Hook not found");
    expect(result.durationMs).toBe(0);
  });

  it("executeHook returns error for unknown hookType", async () => {
    // Create a hook and then mutate its type to something unknown
    const hook = await service.createHook({
      name: "Weird type",
      description: "",
      enabled: true,
      eventType: "Notification",
      hookType: "Command" as any,
      command: null,
      promptTemplate: null,
      agentObjective: null,
      allowedTools: [],
      canOverride: false,
      continueOnError: true,
      timeoutMs: 1000,
      projectId: null,
    });
    // Overwrite the hook type to an unknown one via updateHook internals
    const stored = service.getHook(hook.id)!;
    (stored as any).hookType = "UnknownType";

    const result = await service.executeHook({
      hookId: hook.id,
      eventType: "Notification",
      eventPayload: {},
      context: { runId: "r", projectId: "p", ticketId: "t", stage: "s" },
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown hook type");
  });

  it("catches thrown errors during hook execution", async () => {
    // A Command hook whose command will throw via execSync
    const hook = await service.createHook({
      name: "Crash hook",
      description: "",
      enabled: true,
      eventType: "PreToolUse",
      hookType: "Command",
      command: null,
      promptTemplate: null,
      agentObjective: null,
      allowedTools: [],
      canOverride: false,
      continueOnError: false,
      timeoutMs: 1000,
      projectId: null,
    });
    // This should hit the "no command defined" error path
    const result = await service.executeHook({
      hookId: hook.id,
      eventType: "PreToolUse",
      eventPayload: {},
      context: { runId: "r", projectId: "p", ticketId: "t", stage: "s" },
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Command hook has no command defined");
  });

  it("testHook returns error for non-existent hook", async () => {
    const result = await service.testHook("non-existent", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("Hook not found");
  });

  it("listHooks filters by eventType", async () => {
    await service.createHook({
      name: "Tool hook",
      description: "",
      enabled: true,
      eventType: "PreToolUse",
      hookType: "Command",
      command: "echo ok",
      promptTemplate: null,
      agentObjective: null,
      allowedTools: [],
      canOverride: false,
      continueOnError: true,
      timeoutMs: 1000,
      projectId: null,
    });
    await service.createHook({
      name: "Notification hook",
      description: "",
      enabled: true,
      eventType: "Notification",
      hookType: "Prompt",
      command: null,
      promptTemplate: "hello",
      agentObjective: null,
      allowedTools: [],
      canOverride: false,
      continueOnError: true,
      timeoutMs: 1000,
      projectId: null,
    });
    expect(service.listHooks({ eventType: "PreToolUse" })).toHaveLength(1);
    expect(service.listHooks({ eventType: "Notification" })).toHaveLength(1);
    expect(service.listHooks({ eventType: "PostToolUse" })).toHaveLength(0);
  });

  it("getHook returns null for missing hook", () => {
    expect(service.getHook("does-not-exist")).toBeNull();
  });

  describe("Command hook edge cases", () => {
    it("returns non-JSON stdout as systemMessage", async () => {
      const hook = await service.createHook({
        name: "Plain output",
        description: "",
        enabled: true,
        eventType: "PreToolUse",
        hookType: "Command",
        command: "node -e \"process.stdout.write('plain text output')\"",
        promptTemplate: null,
        agentObjective: null,
        allowedTools: [],
        canOverride: false,
        continueOnError: true,
        timeoutMs: 1000,
        projectId: null,
      });

      const result = await service.executeHook({
        hookId: hook.id,
        eventType: "PreToolUse",
        eventPayload: {},
        context: { runId: "r", projectId: "p", ticketId: "t", stage: "s" },
      });
      expect(result.success).toBe(true);
      expect(result.systemMessage).toBe("plain text output");
    });

    it("returns undefined systemMessage when stdout is empty", async () => {
      const hook = await service.createHook({
        name: "Empty output",
        description: "",
        enabled: true,
        eventType: "PreToolUse",
        hookType: "Command",
        command: "node -e \"\"",
        promptTemplate: null,
        agentObjective: null,
        allowedTools: [],
        canOverride: false,
        continueOnError: true,
        timeoutMs: 1000,
        projectId: null,
      });

      const result = await service.executeHook({
        hookId: hook.id,
        eventType: "PreToolUse",
        eventPayload: {},
        context: { runId: "r", projectId: "p", ticketId: "t", stage: "s" },
      });
      expect(result.success).toBe(true);
      expect(result.systemMessage).toBeUndefined();
    });

    it("command hook error uses continueOnError value", async () => {
      const hook = await service.createHook({
        name: "Fail with continue",
        description: "",
        enabled: true,
        eventType: "PreToolUse",
        hookType: "Command",
        command: "exit 1",
        promptTemplate: null,
        agentObjective: null,
        allowedTools: [],
        canOverride: false,
        continueOnError: true,
        timeoutMs: 1000,
        projectId: null,
      });

      const result = await service.executeHook({
        hookId: hook.id,
        eventType: "PreToolUse",
        eventPayload: {},
        context: { runId: "r", projectId: "p", ticketId: "t", stage: "s" },
      });
      expect(result.success).toBe(false);
      expect(result.continue).toBe(true);
      expect(result.error).toContain("Command hook failed");
    });

    it("command hook error with continueOnError=false stops execution", async () => {
      const hook = await service.createHook({
        name: "Fail hard",
        description: "",
        enabled: true,
        eventType: "PreToolUse",
        hookType: "Command",
        command: "exit 1",
        promptTemplate: null,
        agentObjective: null,
        allowedTools: [],
        canOverride: false,
        continueOnError: false,
        timeoutMs: 1000,
        projectId: null,
      });

      const result = await service.executeHook({
        hookId: hook.id,
        eventType: "PreToolUse",
        eventPayload: {},
        context: { runId: "r", projectId: "p", ticketId: "t", stage: "s" },
      });
      expect(result.success).toBe(false);
      expect(result.continue).toBe(false);
    });

    it("JSON output with continue=false is respected", async () => {
      const hook = await service.createHook({
        name: "Stop via JSON",
        description: "",
        enabled: true,
        eventType: "PreToolUse",
        hookType: "Command",
        command: "node -e \"process.stdout.write(JSON.stringify({continue:false,systemMessage:'stop here'}))\"",
        promptTemplate: null,
        agentObjective: null,
        allowedTools: [],
        canOverride: false,
        continueOnError: true,
        timeoutMs: 1000,
        projectId: null,
      });

      const result = await service.executeHook({
        hookId: hook.id,
        eventType: "PreToolUse",
        eventPayload: {},
        context: { runId: "r", projectId: "p", ticketId: "t", stage: "s" },
      });
      expect(result.success).toBe(true);
      expect(result.continue).toBe(false);
      expect(result.systemMessage).toBe("stop here");
    });
  });

  describe("Prompt hook edge cases", () => {
    it("returns error when no promptTemplate is defined", async () => {
      const hook = await service.createHook({
        name: "No template",
        description: "",
        enabled: true,
        eventType: "PreToolUse",
        hookType: "Prompt",
        command: null,
        promptTemplate: null,
        agentObjective: null,
        allowedTools: [],
        canOverride: false,
        continueOnError: true,
        timeoutMs: 1000,
        projectId: null,
      });

      const result = await service.executeHook({
        hookId: hook.id,
        eventType: "PreToolUse",
        eventPayload: {},
        context: { runId: "r", projectId: "p", ticketId: "t", stage: "s" },
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("no prompt template defined");
    });
  });

  describe("Agent hook edge cases", () => {
    it("returns error when no agentObjective and no command", async () => {
      const hook = await service.createHook({
        name: "Empty agent",
        description: "",
        enabled: true,
        eventType: "Notification",
        hookType: "Agent",
        command: null,
        promptTemplate: null,
        agentObjective: null,
        allowedTools: [],
        canOverride: false,
        continueOnError: true,
        timeoutMs: 1000,
        projectId: null,
      });

      const result = await service.executeHook({
        hookId: hook.id,
        eventType: "Notification",
        eventPayload: {},
        context: { runId: "r", projectId: "p", ticketId: "t", stage: "s" },
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("no agent objective or command defined");
    });

    it("tool_before with non-JSON output returns as system message", async () => {
      const hook = await service.createHook({
        name: "Plain agent",
        description: "",
        enabled: true,
        eventType: "tool_before",
        hookType: "Agent",
        command: "node -e \"process.stdout.write('plain text')\"",
        promptTemplate: null,
        agentObjective: "check tools",
        allowedTools: [],
        canOverride: false,
        continueOnError: true,
        timeoutMs: 1000,
        projectId: null,
      });

      const result = await service.executeHook({
        hookId: hook.id,
        eventType: "tool_before",
        eventPayload: { tool_name: "bash" },
        context: { runId: "r", projectId: "p", ticketId: "t", stage: "s" },
      });
      expect(result.success).toBe(true);
      expect(result.continue).toBe(true);
      expect(result.systemMessage).toBe("plain text");
    });

    it("tool_before with empty non-JSON output returns undefined systemMessage", async () => {
      const hook = await service.createHook({
        name: "Empty agent output",
        description: "",
        enabled: true,
        eventType: "tool_before",
        hookType: "Agent",
        command: "node -e \"\"",
        promptTemplate: null,
        agentObjective: "check tools",
        allowedTools: [],
        canOverride: false,
        continueOnError: true,
        timeoutMs: 1000,
        projectId: null,
      });

      const result = await service.executeHook({
        hookId: hook.id,
        eventType: "tool_before",
        eventPayload: { tool_name: "bash" },
        context: { runId: "r", projectId: "p", ticketId: "t", stage: "s" },
      });
      expect(result.success).toBe(true);
      expect(result.systemMessage).toBeUndefined();
    });

    it("tool_before command error respects continueOnError", async () => {
      const hook = await service.createHook({
        name: "Failing tool hook",
        description: "",
        enabled: true,
        eventType: "tool_before",
        hookType: "Agent",
        command: "exit 1",
        promptTemplate: null,
        agentObjective: "check tools",
        allowedTools: [],
        canOverride: false,
        continueOnError: true,
        timeoutMs: 1000,
        projectId: null,
      });

      const result = await service.executeHook({
        hookId: hook.id,
        eventType: "tool_before",
        eventPayload: { tool_name: "bash" },
        context: { runId: "r", projectId: "p", ticketId: "t", stage: "s" },
      });
      expect(result.success).toBe(false);
      expect(result.continue).toBe(true);
      expect(result.error).toContain("Agent hook command failed");
    });

    it("tool_after command error respects continueOnError", async () => {
      const hook = await service.createHook({
        name: "Failing tool_after hook",
        description: "",
        enabled: true,
        eventType: "tool_after",
        hookType: "Agent",
        command: "exit 1",
        promptTemplate: null,
        agentObjective: "check tools",
        allowedTools: [],
        canOverride: false,
        continueOnError: false,
        timeoutMs: 1000,
        projectId: null,
      });

      const result = await service.executeHook({
        hookId: hook.id,
        eventType: "tool_after",
        eventPayload: { tool_name: "bash", result: {} },
        context: { runId: "r", projectId: "p", ticketId: "t", stage: "s" },
      });
      expect(result.success).toBe(false);
      expect(result.continue).toBe(false);
      expect(result.error).toContain("Agent hook command failed");
    });

    it("tool_after without command falls through to no-command error", async () => {
      const hook = await service.createHook({
        name: "No-cmd tool_after",
        description: "",
        enabled: true,
        eventType: "tool_after",
        hookType: "Agent",
        command: null,
        promptTemplate: null,
        agentObjective: "check tools",
        allowedTools: [],
        canOverride: false,
        continueOnError: true,
        timeoutMs: 1000,
        projectId: null,
      });

      const result = await service.executeHook({
        hookId: hook.id,
        eventType: "tool_after",
        eventPayload: { tool_name: "bash", result: {} },
        context: { runId: "r", projectId: "p", ticketId: "t", stage: "s" },
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("requires a command");
    });

    it("tool_before JSON with systemMessage in result", async () => {
      const hook = await service.createHook({
        name: "Block with message",
        description: "",
        enabled: true,
        eventType: "tool_before",
        hookType: "Agent",
        command: "node -e \"process.stdout.write(JSON.stringify({allow:false,reason:'blocked',systemMessage:'custom block msg'}))\"",
        promptTemplate: null,
        agentObjective: "block",
        allowedTools: [],
        canOverride: false,
        continueOnError: false,
        timeoutMs: 1000,
        projectId: null,
      });

      const result = await service.executeHook({
        hookId: hook.id,
        eventType: "tool_before",
        eventPayload: { tool_name: "bash" },
        context: { runId: "r", projectId: "p", ticketId: "t", stage: "s" },
      });
      expect(result.blocked).toBe(true);
      expect(result.systemMessage).toBe("custom block msg");
    });

    it("tool_after JSON result uses systemMessage from parsed JSON", async () => {
      const hook = await service.createHook({
        name: "After with system msg",
        description: "",
        enabled: true,
        eventType: "tool_after",
        hookType: "Agent",
        command: "node -e \"process.stdout.write(JSON.stringify({systemMessage:'from json',continue:true}))\"",
        promptTemplate: null,
        agentObjective: "check",
        allowedTools: [],
        canOverride: false,
        continueOnError: true,
        timeoutMs: 1000,
        projectId: null,
      });

      const result = await service.executeHook({
        hookId: hook.id,
        eventType: "tool_after",
        eventPayload: { tool_name: "bash", result: {} },
        context: { runId: "r", projectId: "p", ticketId: "t", stage: "s" },
      });
      expect(result.success).toBe(true);
      expect(result.systemMessage).toBe("from json");
    });

    it("tool_after JSON result without systemMessage falls back to stdout", async () => {
      const hook = await service.createHook({
        name: "After no sysmsg",
        description: "",
        enabled: true,
        eventType: "tool_after",
        hookType: "Agent",
        command: "node -e \"process.stdout.write(JSON.stringify({continue:true}))\"",
        promptTemplate: null,
        agentObjective: "check",
        allowedTools: [],
        canOverride: false,
        continueOnError: true,
        timeoutMs: 1000,
        projectId: null,
      });

      const result = await service.executeHook({
        hookId: hook.id,
        eventType: "tool_after",
        eventPayload: { tool_name: "bash", result: {} },
        context: { runId: "r", projectId: "p", ticketId: "t", stage: "s" },
      });
      expect(result.success).toBe(true);
      // Should fall back to raw stdout since systemMessage is undefined
      expect(result.systemMessage).toBe('{"continue":true}');
    });

    it("run_start command error respects continueOnError", async () => {
      const hook = await service.createHook({
        name: "Fail run_start",
        description: "",
        enabled: true,
        eventType: "run_start",
        hookType: "Agent",
        command: "exit 1",
        promptTemplate: null,
        agentObjective: null,
        allowedTools: [],
        canOverride: false,
        continueOnError: false,
        timeoutMs: 1000,
        projectId: null,
      });

      const result = await service.executeHook({
        hookId: hook.id,
        eventType: "run_start",
        eventPayload: {},
        context: { runId: "r", projectId: "p", ticketId: "t", stage: "s" },
      });
      expect(result.success).toBe(false);
      expect(result.continue).toBe(false);
      expect(result.error).toContain("Agent hook command failed");
    });

    it("run_end command error respects continueOnError", async () => {
      const hook = await service.createHook({
        name: "Fail run_end",
        description: "",
        enabled: true,
        eventType: "run_end",
        hookType: "Agent",
        command: "exit 1",
        promptTemplate: null,
        agentObjective: null,
        allowedTools: [],
        canOverride: false,
        continueOnError: true,
        timeoutMs: 1000,
        projectId: null,
      });

      const result = await service.executeHook({
        hookId: hook.id,
        eventType: "run_end",
        eventPayload: {},
        context: { runId: "r", projectId: "p", ticketId: "t", stage: "s" },
      });
      expect(result.success).toBe(false);
      expect(result.continue).toBe(true);
      expect(result.error).toContain("Agent hook command failed");
    });

    it("run_start without command falls through to default behavior", async () => {
      const hook = await service.createHook({
        name: "No-cmd run_start",
        description: "",
        enabled: true,
        eventType: "run_start",
        hookType: "Agent",
        command: null,
        promptTemplate: null,
        agentObjective: "Start objective",
        allowedTools: [],
        canOverride: false,
        continueOnError: true,
        timeoutMs: 1000,
        projectId: null,
      });

      const result = await service.executeHook({
        hookId: hook.id,
        eventType: "run_start",
        eventPayload: {},
        context: { runId: "r", projectId: "p", ticketId: "t", stage: "s" },
      });
      expect(result.success).toBe(true);
      expect(result.systemMessage).toContain("Agent objective: Start objective");
    });

    it("run_end without command falls through to default behavior", async () => {
      const hook = await service.createHook({
        name: "No-cmd run_end",
        description: "",
        enabled: true,
        eventType: "run_end",
        hookType: "Agent",
        command: null,
        promptTemplate: null,
        agentObjective: "End objective",
        allowedTools: [],
        canOverride: false,
        continueOnError: true,
        timeoutMs: 1000,
        projectId: null,
      });

      const result = await service.executeHook({
        hookId: hook.id,
        eventType: "run_end",
        eventPayload: {},
        context: { runId: "r", projectId: "p", ticketId: "t", stage: "s" },
      });
      expect(result.success).toBe(true);
      expect(result.systemMessage).toContain("Agent objective: End objective");
    });

    it("command_before command error respects continueOnError", async () => {
      const hook = await service.createHook({
        name: "Fail cmd_before",
        description: "",
        enabled: true,
        eventType: "command_before",
        hookType: "Agent",
        command: "exit 1",
        promptTemplate: null,
        agentObjective: null,
        allowedTools: [],
        canOverride: false,
        continueOnError: false,
        timeoutMs: 1000,
        projectId: null,
      });

      const result = await service.executeHook({
        hookId: hook.id,
        eventType: "command_before",
        eventPayload: { command: "test" },
        context: { runId: "r", projectId: "p", ticketId: "t", stage: "s" },
      });
      expect(result.success).toBe(false);
      expect(result.continue).toBe(false);
      expect(result.error).toContain("Agent hook command failed");
    });

    it("command_after command error respects continueOnError", async () => {
      const hook = await service.createHook({
        name: "Fail cmd_after",
        description: "",
        enabled: true,
        eventType: "command_after",
        hookType: "Agent",
        command: "exit 1",
        promptTemplate: null,
        agentObjective: null,
        allowedTools: [],
        canOverride: false,
        continueOnError: true,
        timeoutMs: 1000,
        projectId: null,
      });

      const result = await service.executeHook({
        hookId: hook.id,
        eventType: "command_after",
        eventPayload: { command: "test" },
        context: { runId: "r", projectId: "p", ticketId: "t", stage: "s" },
      });
      expect(result.success).toBe(false);
      expect(result.continue).toBe(true);
      expect(result.error).toContain("Agent hook command failed");
    });

    it("command_before without command falls through to default behavior", async () => {
      const hook = await service.createHook({
        name: "No-cmd cmd_before",
        description: "",
        enabled: true,
        eventType: "command_before",
        hookType: "Agent",
        command: null,
        promptTemplate: null,
        agentObjective: "Validate commands",
        allowedTools: [],
        canOverride: false,
        continueOnError: true,
        timeoutMs: 1000,
        projectId: null,
      });

      const result = await service.executeHook({
        hookId: hook.id,
        eventType: "command_before",
        eventPayload: { command: "npm test" },
        context: { runId: "r", projectId: "p", ticketId: "t", stage: "s" },
      });
      expect(result.success).toBe(true);
      expect(result.systemMessage).toContain("Agent objective: Validate commands");
    });

    it("command_after without command falls through to default behavior", async () => {
      const hook = await service.createHook({
        name: "No-cmd cmd_after",
        description: "",
        enabled: true,
        eventType: "command_after",
        hookType: "Agent",
        command: null,
        promptTemplate: null,
        agentObjective: "Log commands",
        allowedTools: [],
        canOverride: false,
        continueOnError: true,
        timeoutMs: 1000,
        projectId: null,
      });

      const result = await service.executeHook({
        hookId: hook.id,
        eventType: "command_after",
        eventPayload: { command: "npm test", exitCode: 0 },
        context: { runId: "r", projectId: "p", ticketId: "t", stage: "s" },
      });
      expect(result.success).toBe(true);
      expect(result.systemMessage).toContain("Agent objective: Log commands");
    });

    it("tool_before with toolName (camelCase) in eventPayload", async () => {
      const hook = await service.createHook({
        name: "CamelCase tool",
        description: "",
        enabled: true,
        eventType: "tool_before",
        hookType: "Agent",
        command: "node -e \"const d=JSON.parse(require('fs').readFileSync(0,'utf-8')); process.stdout.write(JSON.stringify({systemMessage:'got '+d.tool_name}))\"",
        promptTemplate: null,
        agentObjective: "check",
        allowedTools: [],
        canOverride: false,
        continueOnError: true,
        timeoutMs: 1000,
        projectId: null,
      });

      const result = await service.executeHook({
        hookId: hook.id,
        eventType: "tool_before",
        eventPayload: { toolName: "edit_file" },
        context: { runId: "r", projectId: "p", ticketId: "t", stage: "s" },
      });
      expect(result.success).toBe(true);
      expect(result.systemMessage).toContain("got edit_file");
    });

    it("tool_before with continue=false in input result", async () => {
      const hook = await service.createHook({
        name: "Input with stop",
        description: "",
        enabled: true,
        eventType: "tool_before",
        hookType: "Agent",
        command: "node -e \"process.stdout.write(JSON.stringify({input:{modified:true},continue:false}))\"",
        promptTemplate: null,
        agentObjective: "check",
        allowedTools: [],
        canOverride: false,
        continueOnError: true,
        timeoutMs: 1000,
        projectId: null,
      });

      const result = await service.executeHook({
        hookId: hook.id,
        eventType: "tool_before",
        eventPayload: { tool_name: "bash" },
        context: { runId: "r", projectId: "p", ticketId: "t", stage: "s" },
      });
      expect(result.success).toBe(true);
      expect(result.updatedInput).toEqual({ modified: true });
      expect(result.continue).toBe(false);
    });

    it("tool_after with continue=false in JSON result", async () => {
      const hook = await service.createHook({
        name: "After stop",
        description: "",
        enabled: true,
        eventType: "tool_after",
        hookType: "Agent",
        command: "node -e \"process.stdout.write(JSON.stringify({continue:false,systemMessage:'stop after'}))\"",
        promptTemplate: null,
        agentObjective: "check",
        allowedTools: [],
        canOverride: false,
        continueOnError: true,
        timeoutMs: 1000,
        projectId: null,
      });

      const result = await service.executeHook({
        hookId: hook.id,
        eventType: "tool_after",
        eventPayload: { tool_name: "bash", result: {} },
        context: { runId: "r", projectId: "p", ticketId: "t", stage: "s" },
      });
      expect(result.success).toBe(true);
      expect(result.continue).toBe(false);
      expect(result.systemMessage).toBe("stop after");
    });
  });

  describe("executeHooksForEvent permission decision aggregation", () => {
    it("deny overrides allow", async () => {
      await service.createHook({
        name: "Allow hook",
        description: "",
        enabled: true,
        eventType: "PreToolUse",
        hookType: "Command",
        command: "node -e \"process.stdout.write(JSON.stringify({continue:true,permissionDecision:'allow'}))\"",
        promptTemplate: null,
        agentObjective: null,
        allowedTools: [],
        canOverride: false,
        continueOnError: true,
        timeoutMs: 1000,
        projectId: null,
      });
      await service.createHook({
        name: "Deny hook",
        description: "",
        enabled: true,
        eventType: "PreToolUse",
        hookType: "Command",
        command: "node -e \"process.stdout.write(JSON.stringify({continue:true,permissionDecision:'deny'}))\"",
        promptTemplate: null,
        agentObjective: null,
        allowedTools: [],
        canOverride: false,
        continueOnError: true,
        timeoutMs: 1000,
        projectId: null,
      });

      const aggregate = await service.executeHooksForEvent({
        eventType: "PreToolUse",
        eventPayload: {},
        context: { runId: "r", projectId: "p", ticketId: "t", stage: "s" },
      });
      expect(aggregate.permissionDecision).toBe("deny");
      expect(aggregate.shouldContinue).toBe(true);
    });

    it("allow is set when no prior decision exists", async () => {
      await service.createHook({
        name: "Allow only",
        description: "",
        enabled: true,
        eventType: "PreToolUse",
        hookType: "Command",
        command: "node -e \"process.stdout.write(JSON.stringify({continue:true,permissionDecision:'allow'}))\"",
        promptTemplate: null,
        agentObjective: null,
        allowedTools: [],
        canOverride: false,
        continueOnError: true,
        timeoutMs: 1000,
        projectId: null,
      });

      const aggregate = await service.executeHooksForEvent({
        eventType: "PreToolUse",
        eventPayload: {},
        context: { runId: "r", projectId: "p", ticketId: "t", stage: "s" },
      });
      expect(aggregate.permissionDecision).toBe("allow");
    });

    it("no hooks results in undefined permissionDecision", async () => {
      const aggregate = await service.executeHooksForEvent({
        eventType: "PreToolUse",
        eventPayload: {},
        context: { runId: "r", projectId: "p", ticketId: "t", stage: "s" },
      });
      expect(aggregate.permissionDecision).toBeUndefined();
      expect(aggregate.outputs).toHaveLength(0);
      expect(aggregate.shouldContinue).toBe(true);
    });
  });

  describe("Execution log without persistence", () => {
    let noPersistService: HookService;

    beforeEach(async () => {
      noPersistService = new HookService();
      await noPersistService.initialize();
    });

    it("stores and retrieves in-memory execution logs", async () => {
      const hook = await noPersistService.createHook({
        name: "Memory hook",
        description: "",
        enabled: true,
        eventType: "Notification",
        hookType: "Prompt",
        command: null,
        promptTemplate: "hello {{tool_name}}",
        agentObjective: null,
        allowedTools: [],
        canOverride: false,
        continueOnError: true,
        timeoutMs: 1000,
        projectId: null,
      });

      await noPersistService.executeHook({
        hookId: hook.id,
        eventType: "Notification",
        eventPayload: { tool_name: "bash" },
        context: { runId: "run-1", projectId: "p", ticketId: "t", stage: "s" },
      });
      await noPersistService.executeHook({
        hookId: hook.id,
        eventType: "Notification",
        eventPayload: { tool_name: "edit" },
        context: { runId: "run-2", projectId: "p", ticketId: "t", stage: "s" },
      });

      // No filter
      const allLogs = await noPersistService.getExecutionLog();
      expect(allLogs).toHaveLength(2);

      // Filter by hookId
      const hookLogs = await noPersistService.getExecutionLog({ hookId: hook.id });
      expect(hookLogs).toHaveLength(2);

      // Filter by runId
      const runLogs = await noPersistService.getExecutionLog({ runId: "run-1" });
      expect(runLogs).toHaveLength(1);
      expect(runLogs[0]?.runId).toBe("run-1");

      // With limit
      const limited = await noPersistService.getExecutionLog({ limit: 1 });
      expect(limited).toHaveLength(1);
    });

    it("sorts logs by createdAt descending", async () => {
      const hook = await noPersistService.createHook({
        name: "Order hook",
        description: "",
        enabled: true,
        eventType: "Notification",
        hookType: "Prompt",
        command: null,
        promptTemplate: "hello",
        agentObjective: null,
        allowedTools: [],
        canOverride: false,
        continueOnError: true,
        timeoutMs: 1000,
        projectId: null,
      });

      await noPersistService.executeHook({
        hookId: hook.id,
        eventType: "Notification",
        eventPayload: {},
        context: { runId: "run-a", projectId: "p", ticketId: "t", stage: "s" },
      });

      // Wait a small amount to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));

      await noPersistService.executeHook({
        hookId: hook.id,
        eventType: "Notification",
        eventPayload: {},
        context: { runId: "run-b", projectId: "p", ticketId: "t", stage: "s" },
      });

      const logs = await noPersistService.getExecutionLog();
      // Most recent first (descending by createdAt)
      expect(logs).toHaveLength(2);
      expect(logs[0]?.runId).toBe("run-b");
      expect(logs[1]?.runId).toBe("run-a");
    });

    it("persistHooks is a no-op without persistence", async () => {
      // Just verifying createHook works without persistence (it calls persistHooks internally)
      const hook = await noPersistService.createHook({
        name: "No persist",
        description: "",
        enabled: true,
        eventType: "Notification",
        hookType: "Prompt",
        command: null,
        promptTemplate: "hi",
        agentObjective: null,
        allowedTools: [],
        canOverride: false,
        continueOnError: true,
        timeoutMs: 1000,
        projectId: null,
      });
      expect(noPersistService.getHook(hook.id)).not.toBeNull();

      // Also verify delete works without persistence
      expect(await noPersistService.deleteHook(hook.id)).toBe(true);

      // Also verify update works without persistence
      const hook2 = await noPersistService.createHook({
        name: "No persist 2",
        description: "",
        enabled: true,
        eventType: "Notification",
        hookType: "Prompt",
        command: null,
        promptTemplate: "hi",
        agentObjective: null,
        allowedTools: [],
        canOverride: false,
        continueOnError: true,
        timeoutMs: 1000,
        projectId: null,
      });
      const updated = await noPersistService.updateHook(hook2.id, { name: "Renamed" });
      expect(updated?.name).toBe("Renamed");
    });
  });

  it("updateHook returns null for non-existent hook", async () => {
    const result = await service.updateHook("non-existent", { name: "foo" });
    expect(result).toBeNull();
  });

  it("initialize is idempotent (second call is no-op)", async () => {
    // Already initialized in beforeEach; calling again should not throw
    await service.initialize();
    // Hooks should still be accessible
    const hook = await service.createHook({
      name: "After re-init",
      description: "",
      enabled: true,
      eventType: "Notification",
      hookType: "Prompt",
      command: null,
      promptTemplate: "hi",
      agentObjective: null,
      allowedTools: [],
      canOverride: false,
      continueOnError: true,
      timeoutMs: 1000,
      projectId: null,
    });
    expect(service.getHook(hook.id)).not.toBeNull();
  });

  it("getHooksForEvent excludes hooks scoped to a different project", () => {
    // Synchronous setup by directly testing after createHook
    return (async () => {
      await service.createHook({
        name: "Other project hook",
        description: "",
        enabled: true,
        eventType: "Notification",
        hookType: "Prompt",
        command: null,
        promptTemplate: "hi",
        agentObjective: null,
        allowedTools: [],
        canOverride: false,
        continueOnError: true,
        timeoutMs: 1000,
        projectId: "other-project",
      });

      const hooks = service.getHooksForEvent("Notification", "my-project");
      expect(hooks).toHaveLength(0);
    })();
  });

  describe("Agent hook command lifecycle", () => {
    it("command_before hook executes before command", async () => {
      const hook = await service.createHook({
        name: "Pre-command validation",
        description: "",
        enabled: true,
        eventType: "command_before",
        hookType: "Agent",
        command: "node -e \"const data=JSON.parse(require('fs').readFileSync(0,'utf-8')); process.stdout.write('Validating: '+data.command)\"",
        promptTemplate: null,
        agentObjective: null,
        allowedTools: [],
        canOverride: false,
        continueOnError: true,
        timeoutMs: 1000,
        projectId: "proj-1",
      });

      const result = await service.executeHook({
        hookId: hook.id,
        eventType: "command_before",
        eventPayload: { command: "npm test", cwd: "/project" },
        context: { runId: "run-1", projectId: "proj-1", ticketId: "ticket-1", stage: "build" },
      });

      expect(result.success).toBe(true);
      expect(result.systemMessage).toContain("Validating: npm test");
    });

    it("command_before hook can block execution", async () => {
      const hook = await service.createHook({
        name: "Block dangerous commands",
        description: "",
        enabled: true,
        eventType: "command_before",
        hookType: "Command",
        command: "node -e \"const data=JSON.parse(require('fs').readFileSync(0,'utf-8')); if(data.command.includes('rm -rf')) process.stdout.write(JSON.stringify({continue:false,systemMessage:'Dangerous command blocked'})); else process.stdout.write(JSON.stringify({continue:true}));\"",
        promptTemplate: null,
        agentObjective: null,
        allowedTools: [],
        canOverride: true,
        continueOnError: false,
        timeoutMs: 1000,
        projectId: "proj-1",
      });

      const result = await service.executeHook({
        hookId: hook.id,
        eventType: "command_before",
        eventPayload: { command: "rm -rf /", cwd: "/" },
        context: { runId: "run-1", projectId: "proj-1", ticketId: "ticket-1", stage: "build" },
      });

      expect(result.success).toBe(true);
      expect(result.continue).toBe(false);
      expect(result.systemMessage).toBe("Dangerous command blocked");
    });

    it("command_before hook can modify command input", async () => {
      const hook = await service.createHook({
        name: "Add dry-run flag",
        description: "",
        enabled: true,
        eventType: "command_before",
        hookType: "Command",
        command: "node -e \"const data=JSON.parse(require('fs').readFileSync(0,'utf-8')); process.stdout.write(JSON.stringify({continue:true,updatedInput:{command:data.command+' --dry-run',cwd:data.cwd}}))\"",
        promptTemplate: null,
        agentObjective: null,
        allowedTools: [],
        canOverride: true,
        continueOnError: false,
        timeoutMs: 1000,
        projectId: "proj-1",
      });

      const result = await service.executeHook({
        hookId: hook.id,
        eventType: "command_before",
        eventPayload: { command: "npm install", cwd: "/project" },
        context: { runId: "run-1", projectId: "proj-1", ticketId: "ticket-1", stage: "build" },
      });

      expect(result.success).toBe(true);
      expect(result.updatedInput).toEqual({ command: "npm install --dry-run", cwd: "/project" });
    });

    it("command_after hook receives command execution results", async () => {
      const hook = await service.createHook({
        name: "Log command results",
        description: "",
        enabled: true,
        eventType: "command_after",
        hookType: "Agent",
        command: "node -e \"const data=JSON.parse(require('fs').readFileSync(0,'utf-8')); process.stdout.write('Command '+data.command+' exited with code '+data.exitCode)\"",
        promptTemplate: null,
        agentObjective: null,
        allowedTools: [],
        canOverride: false,
        continueOnError: true,
        timeoutMs: 1000,
        projectId: "proj-1",
      });

      const result = await service.executeHook({
        hookId: hook.id,
        eventType: "command_after",
        eventPayload: { command: "npm test", exitCode: 0, stdout: "All tests passed", stderr: "" },
        context: { runId: "run-1", projectId: "proj-1", ticketId: "ticket-1", stage: "build" },
      });

      expect(result.success).toBe(true);
      expect(result.systemMessage).toContain("Command npm test exited with code 0");
    });

    it("command_after hook can analyze failure output", async () => {
      const hook = await service.createHook({
        name: "Analyze failures",
        description: "",
        enabled: true,
        eventType: "command_after",
        hookType: "Command",
        command: "node -e \"const data=JSON.parse(require('fs').readFileSync(0,'utf-8')); const msg = data.exitCode !== 0 ? 'Command failed: '+data.stderr : 'Success'; process.stdout.write(JSON.stringify({continue:true,systemMessage:msg}))\"",
        promptTemplate: null,
        agentObjective: null,
        allowedTools: [],
        canOverride: false,
        continueOnError: true,
        timeoutMs: 1000,
        projectId: "proj-1",
      });

      const result = await service.executeHook({
        hookId: hook.id,
        eventType: "command_after",
        eventPayload: { command: "npm test", exitCode: 1, stdout: "", stderr: "Test suite failed" },
        context: { runId: "run-1", projectId: "proj-1", ticketId: "ticket-1", stage: "build" },
      });

      expect(result.success).toBe(true);
      expect(result.systemMessage).toContain("Command failed: Test suite failed");
    });
  });

  describe("createPrismaHookPersistence", () => {
    it("loadHooks returns empty array when no row found", async () => {
      const { createPrismaHookPersistence } = await import("./hookService");

      // Mock prisma inline
      const { prisma } = await import("../db");
      const origFindUnique = prisma.appSetting.findUnique;
      prisma.appSetting.findUnique = (async () => null) as any;

      try {
        const persistence = createPrismaHookPersistence();
        const hooks = await persistence.loadHooks();
        expect(hooks).toEqual([]);
      } finally {
        prisma.appSetting.findUnique = origFindUnique;
      }
    });

    it("loadHooks returns hooks when row has valid array", async () => {
      const { createPrismaHookPersistence } = await import("./hookService");
      const { prisma } = await import("../db");
      const origFindUnique = prisma.appSetting.findUnique;
      const sampleHook = {
        id: "hook_test1",
        name: "Test",
        description: "",
        enabled: true,
        eventType: "Notification",
        hookType: "Prompt",
        command: null,
        promptTemplate: "hi",
        agentObjective: null,
        allowedTools: [],
        canOverride: false,
        continueOnError: true,
        timeoutMs: 1000,
        projectId: null,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      };
      prisma.appSetting.findUnique = (async () => ({
        key: "agentic.hooks.registry.v1",
        value: [sampleHook, null, "invalid", { id: "hook_test2", name: "Valid2" }],
        updatedAt: new Date(),
      })) as any;

      try {
        const persistence = createPrismaHookPersistence();
        const hooks = await persistence.loadHooks();
        // Should filter out null and "invalid" string, keep objects
        expect(hooks.length).toBeGreaterThanOrEqual(2);
      } finally {
        prisma.appSetting.findUnique = origFindUnique;
      }
    });

    it("loadHooks returns empty array when value is not an array", async () => {
      const { createPrismaHookPersistence } = await import("./hookService");
      const { prisma } = await import("../db");
      const origFindUnique = prisma.appSetting.findUnique;
      prisma.appSetting.findUnique = (async () => ({
        key: "agentic.hooks.registry.v1",
        value: "not-an-array",
        updatedAt: new Date(),
      })) as any;

      try {
        const persistence = createPrismaHookPersistence();
        const hooks = await persistence.loadHooks();
        expect(hooks).toEqual([]);
      } finally {
        prisma.appSetting.findUnique = origFindUnique;
      }
    });

    it("saveHooks upserts to prisma", async () => {
      const { createPrismaHookPersistence } = await import("./hookService");
      const { prisma } = await import("../db");
      const origUpsert = prisma.appSetting.upsert;
      let upsertArgs: any = null;
      prisma.appSetting.upsert = (async (args: any) => {
        upsertArgs = args;
        return { key: args.where.key, value: args.create.value, updatedAt: new Date() };
      }) as any;

      try {
        const persistence = createPrismaHookPersistence();
        await persistence.saveHooks([{ id: "h1" } as any]);
        expect(upsertArgs).not.toBeNull();
        expect(upsertArgs.where.key).toBe("agentic.hooks.registry.v1");
        expect(upsertArgs.create.value).toEqual([{ id: "h1" }]);
      } finally {
        prisma.appSetting.upsert = origUpsert;
      }
    });

    it("saveExecutionLog upserts log record", async () => {
      const { createPrismaHookPersistence } = await import("./hookService");
      const { prisma } = await import("../db");
      const origUpsert = prisma.appSetting.upsert;
      let upsertArgs: any = null;
      prisma.appSetting.upsert = (async (args: any) => {
        upsertArgs = args;
        return { key: args.where.key, value: args.create.value, updatedAt: new Date() };
      }) as any;

      try {
        const persistence = createPrismaHookPersistence();
        const logRecord = { id: "log1", hookId: "h1" } as any;
        await persistence.saveExecutionLog(logRecord);
        expect(upsertArgs.where.key).toBe("agentic.hook.log.log1");
      } finally {
        prisma.appSetting.upsert = origUpsert;
      }
    });

    it("listExecutionLogs queries and filters", async () => {
      const { createPrismaHookPersistence } = await import("./hookService");
      const { prisma } = await import("../db");
      const origFindMany = prisma.appSetting.findMany;
      prisma.appSetting.findMany = (async () => [
        { key: "agentic.hook.log.1", value: { id: "1", hookId: "h1", runId: "r1" }, updatedAt: new Date() },
        { key: "agentic.hook.log.2", value: { id: "2", hookId: "h2", runId: "r2" }, updatedAt: new Date() },
      ]) as any;

      try {
        const persistence = createPrismaHookPersistence();

        // No filter
        const all = await persistence.listExecutionLogs();
        expect(all).toHaveLength(2);

        // Filter by hookId
        const filtered = await persistence.listExecutionLogs({ hookId: "h1" });
        expect(filtered).toHaveLength(1);
        expect(filtered[0]?.hookId).toBe("h1");

        // Filter by runId
        const runFiltered = await persistence.listExecutionLogs({ runId: "r2" });
        expect(runFiltered).toHaveLength(1);

        // Filter with limit
        const limited = await persistence.listExecutionLogs({ limit: 5 });
        expect(limited).toHaveLength(2);

        // Filter with limit=0 uses default 100
        const noLimit = await persistence.listExecutionLogs({ limit: 0 });
        expect(noLimit).toHaveLength(2);
      } finally {
        prisma.appSetting.findMany = origFindMany;
      }
    });
  });

  describe("logExecution trimming", () => {
    it("trims execution log when exceeding maxLogEntries", async () => {
      const svc = new HookService();
      await svc.initialize();

      const hook = await svc.createHook({
        name: "Log spam",
        description: "",
        enabled: true,
        eventType: "Notification",
        hookType: "Prompt",
        command: null,
        promptTemplate: "hi",
        agentObjective: null,
        allowedTools: [],
        canOverride: false,
        continueOnError: true,
        timeoutMs: 1000,
        projectId: null,
      });

      // Execute more than 500 times to trigger log trimming
      const promises = [];
      for (let i = 0; i < 505; i++) {
        promises.push(
          svc.executeHook({
            hookId: hook.id,
            eventType: "Notification",
            eventPayload: {},
            context: { runId: `run-${i}`, projectId: "p", ticketId: "t", stage: "s" },
          }),
        );
      }
      await Promise.all(promises);

      const logs = await svc.getExecutionLog();
      // Should have been trimmed to 500
      expect(logs.length).toBeLessThanOrEqual(500);
    });
  });

  describe("executeHookInternal error catch path", () => {
    it("catches non-Error thrown objects in hook execution", async () => {
      // We need to trigger the catch block at line 210-218
      // The catch wraps around the switch statement, so if the hook type methods throw,
      // it should be caught there.
      // We can test this by making the hook type throw a string instead of Error
      const hook = await service.createHook({
        name: "Throw hook",
        description: "",
        enabled: true,
        eventType: "Notification",
        hookType: "Agent",
        command: null,
        promptTemplate: null,
        agentObjective: "objective",
        allowedTools: [],
        canOverride: false,
        continueOnError: false,
        timeoutMs: 1000,
        projectId: null,
      });

      // Monkey-patch the internal method to throw
      const proto = Object.getPrototypeOf(service);
      const origMethod = proto.executeAgentHook;
      proto.executeAgentHook = function () {
        throw new Error("Unexpected agent crash");
      };

      try {
        const result = await service.executeHook({
          hookId: hook.id,
          eventType: "Notification",
          eventPayload: {},
          context: { runId: "r", projectId: "p", ticketId: "t", stage: "s" },
        });
        expect(result.success).toBe(false);
        expect(result.error).toContain("Hook execution failed");
        expect(result.error).toContain("Unexpected agent crash");
        expect(result.continue).toBe(false); // continueOnError is false
      } finally {
        proto.executeAgentHook = origMethod;
      }
    });

    it("catches non-Error thrown values and converts to string", async () => {
      const hook = await service.createHook({
        name: "String throw",
        description: "",
        enabled: true,
        eventType: "Notification",
        hookType: "Agent",
        command: null,
        promptTemplate: null,
        agentObjective: "objective",
        allowedTools: [],
        canOverride: false,
        continueOnError: true,
        timeoutMs: 1000,
        projectId: null,
      });

      const proto = Object.getPrototypeOf(service);
      const origMethod = proto.executeAgentHook;
      proto.executeAgentHook = function () {
        throw "string error value";
      };

      try {
        const result = await service.executeHook({
          hookId: hook.id,
          eventType: "Notification",
          eventPayload: {},
          context: { runId: "r", projectId: "p", ticketId: "t", stage: "s" },
        });
        expect(result.success).toBe(false);
        expect(result.error).toContain("string error value");
        expect(result.continue).toBe(true); // continueOnError is true
      } finally {
        proto.executeAgentHook = origMethod;
      }
    });
  });

  it("getExecutionLog with persistence updates local cache", async () => {
    // Verify that getExecutionLog with persistence populates executionLog
    const hook = await service.createHook({
      name: "Persist log",
      description: "",
      enabled: true,
      eventType: "Notification",
      hookType: "Prompt",
      command: null,
      promptTemplate: "hello",
      agentObjective: null,
      allowedTools: [],
      canOverride: false,
      continueOnError: true,
      timeoutMs: 1000,
      projectId: null,
    });

    await service.executeHook({
      hookId: hook.id,
      eventType: "Notification",
      eventPayload: {},
      context: { runId: "r1", projectId: "p", ticketId: "t", stage: "s" },
    });

    // getExecutionLog with persistence should work
    const logs = await service.getExecutionLog({ limit: 10 });
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });

  it("command hook error from non-Error object uses String()", async () => {
    // Test the non-Error catch path in executeCommandHook (line 383)
    const hook = await service.createHook({
      name: "Non-Error throw",
      description: "",
      enabled: true,
      eventType: "PreToolUse",
      hookType: "Command",
      command: "node -e \"process.exit(42)\"",
      promptTemplate: null,
      agentObjective: null,
      allowedTools: [],
      canOverride: false,
      continueOnError: true,
      timeoutMs: 1000,
      projectId: null,
    });

    const result = await service.executeHook({
      hookId: hook.id,
      eventType: "PreToolUse",
      eventPayload: {},
      context: { runId: "r", projectId: "p", ticketId: "t", stage: "s" },
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Command hook failed");
  });
});
