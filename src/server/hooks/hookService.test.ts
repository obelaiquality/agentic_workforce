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
});
