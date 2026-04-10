import { describe, it, expect, beforeEach, vi } from "vitest";
import { PermissionPolicyEngine } from "./policyEngine";
import {
  autoApproveReadOnly,
  denyDangerousCommands,
  autoApproveInTestMode,
  requireApprovalForInstall,
} from "./defaultPolicies";
import { SafetyClassifier } from "./safetyClassifier";
import type { ToolDefinition, ToolContext } from "../tools/types";
import { z } from "zod";

describe("PermissionPolicyEngine", () => {
  let engine: PermissionPolicyEngine;

  beforeEach(() => {
    engine = new PermissionPolicyEngine();
  });

  const mockContext: ToolContext = {
    runId: "test-run",
    repoId: "test-repo",
    ticketId: "test-ticket",
    worktreePath: "/tmp/test",
    actor: "test-agent",
    stage: "build",
    conversationHistory: [],
    createApproval: async () => ({ id: "approval-1" }),
    recordEvent: async () => {},
  };

  it("should use default policy when no policies match", async () => {
    const readOnlyTool: ToolDefinition = {
      name: "test_read",
      description: "Test tool",
      inputSchema: z.object({}),
      execute: async () => ({ type: "success", content: "ok" }),
      permission: {
        scope: "repo.read",
        readOnly: true,
      },
    };

    const result = await engine.check(readOnlyTool, {}, mockContext);

    expect(result.decision).toBe("allow");
    expect(result.requiresApproval).toBe(false);
    expect(result.source).toBe("default");
  });

  it("should apply autoApproveReadOnly policy", async () => {
    engine.addPolicy(autoApproveReadOnly);

    const readOnlyTool: ToolDefinition = {
      name: "test_read",
      description: "Test tool",
      inputSchema: z.object({}),
      execute: async () => ({ type: "success", content: "ok" }),
      permission: {
        scope: "repo.read",
        readOnly: true,
      },
    };

    const result = await engine.check(readOnlyTool, {}, mockContext);

    expect(result.decision).toBe("allow");
    expect(result.requiresApproval).toBe(false);
    expect(result.source).toBe("policy");
  });

  it("should deny dangerous commands", async () => {
    engine.addPolicy(denyDangerousCommands);

    const bashTool: ToolDefinition = {
      name: "bash",
      description: "Execute bash command",
      inputSchema: z.object({ command: z.string() }),
      execute: async () => ({ type: "success", content: "ok" }),
      permission: {
        scope: "repo.edit",
      },
    };

    const result = await engine.check(
      bashTool,
      { command: "rm -rf /" },
      mockContext
    );

    expect(result.decision).toBe("deny");
    expect(result.requiresApproval).toBe(false);
    expect(result.reasons.some((r) => r.includes("dangerous"))).toBe(true);
  });

  it("should require approval for install commands", async () => {
    engine.addPolicy(requireApprovalForInstall);

    const bashTool: ToolDefinition = {
      name: "bash",
      description: "Execute bash command",
      inputSchema: z.object({ command: z.string() }),
      execute: async () => ({ type: "success", content: "ok" }),
      permission: {
        scope: "repo.edit",
      },
    };

    const result = await engine.check(
      bashTool,
      { command: "npm install lodash" },
      mockContext
    );

    expect(result.decision).toBe("approval_required");
    expect(result.requiresApproval).toBe(true);
  });

  it("should respect policy priority order", async () => {
    // Add in reverse priority order
    engine.addPolicy(autoApproveReadOnly); // priority 10
    engine.addPolicy(denyDangerousCommands); // priority 1 (higher)

    const bashTool: ToolDefinition = {
      name: "bash",
      description: "Execute bash command",
      inputSchema: z.object({ command: z.string() }),
      execute: async () => ({ type: "success", content: "ok" }),
      permission: {
        scope: "repo.edit",
        readOnly: true, // Matches both policies
      },
    };

    // denyDangerousCommands should win because it has higher priority (lower number)
    const result = await engine.check(
      bashTool,
      { command: "rm -rf /" },
      mockContext
    );

    expect(result.decision).toBe("deny");
  });

  it("should allow pre-hooks to short-circuit evaluation", async () => {
    engine.addPolicy(denyDangerousCommands);

    engine.addHook({
      name: "test-override",
      phase: "pre",
      execute: async () => ({
        override: true,
        decision: {
          decision: "allow",
          requiresApproval: false,
          reasons: ["Pre-hook override"],
          source: "hook",
        },
      }),
    });

    const bashTool: ToolDefinition = {
      name: "bash",
      description: "Execute bash command",
      inputSchema: z.object({ command: z.string() }),
      execute: async () => ({ type: "success", content: "ok" }),
      permission: {
        scope: "repo.edit",
      },
    };

    const result = await engine.check(
      bashTool,
      { command: "rm -rf /" },
      mockContext
    );

    // Pre-hook should override the deny policy
    expect(result.decision).toBe("allow");
    expect(result.source).toBe("hook");
  });

  it("should allow post-hooks to override decisions", async () => {
    engine.addPolicy(autoApproveReadOnly);

    engine.addHook({
      name: "test-post-override",
      phase: "post",
      execute: async ({ currentDecision }) => ({
        override: true,
        decision: {
          decision: "approval_required",
          requiresApproval: true,
          reasons: ["Post-hook override"],
          source: "hook",
        },
      }),
    });

    const readOnlyTool: ToolDefinition = {
      name: "test_read",
      description: "Test tool",
      inputSchema: z.object({}),
      execute: async () => ({ type: "success", content: "ok" }),
      permission: {
        scope: "repo.read",
        readOnly: true,
      },
    };

    const result = await engine.check(readOnlyTool, {}, mockContext);

    // Post-hook should override the allow policy
    expect(result.decision).toBe("approval_required");
    expect(result.source).toBe("hook");
  });

  // -----------------------------------------------------------------------
  // Permission Mode Tests
  // -----------------------------------------------------------------------

  describe("permission modes", () => {
    const readOnlyTool: ToolDefinition = {
      name: "read_file",
      description: "Read a file",
      inputSchema: z.object({}),
      execute: async () => ({ type: "success", content: "ok" }),
      permission: { scope: "repo.read", readOnly: true },
    };

    const editTool: ToolDefinition = {
      name: "edit_file",
      description: "Edit a file",
      inputSchema: z.object({}),
      execute: async () => ({ type: "success", content: "ok" }),
      permission: { scope: "repo.edit" },
    };

    const writeTool: ToolDefinition = {
      name: "write_file",
      description: "Write a file",
      inputSchema: z.object({}),
      execute: async () => ({ type: "success", content: "ok" }),
      permission: { scope: "repo.edit" },
    };

    const bashTool: ToolDefinition = {
      name: "bash",
      description: "Execute bash command",
      inputSchema: z.object({ command: z.string() }),
      execute: async () => ({ type: "success", content: "ok" }),
      permission: { scope: "repo.edit" },
    };

    const otherTool: ToolDefinition = {
      name: "search",
      description: "Search codebase",
      inputSchema: z.object({}),
      execute: async () => ({ type: "success", content: "ok" }),
      permission: { scope: "repo.read" },
    };

    describe("default mode", () => {
      it("returns default mode initially", () => {
        expect(engine.getMode()).toBe("default");
      });

      it("uses normal policy evaluation in default mode", async () => {
        engine.addPolicy(autoApproveReadOnly);
        const result = await engine.check(readOnlyTool, {}, mockContext);
        expect(result.decision).toBe("allow");
        expect(result.source).toBe("policy");
      });
    });

    describe("bypass mode", () => {
      beforeEach(() => {
        engine.setMode("bypass");
      });

      it("auto-approves read-only tools", async () => {
        const result = await engine.check(readOnlyTool, {}, mockContext);
        expect(result.decision).toBe("allow");
        expect(result.requiresApproval).toBe(false);
      });

      it("auto-approves mutating tools", async () => {
        const result = await engine.check(editTool, {}, mockContext);
        expect(result.decision).toBe("allow");
        expect(result.requiresApproval).toBe(false);
      });

      it("auto-approves bash commands", async () => {
        const result = await engine.check(bashTool, { command: "rm -rf /" }, mockContext);
        expect(result.decision).toBe("allow");
      });

      it("includes bypass reason", async () => {
        const result = await engine.check(editTool, {}, mockContext);
        expect(result.reasons[0]).toContain("Bypass mode");
      });
    });

    describe("plan mode", () => {
      beforeEach(() => {
        engine.setMode("plan");
      });

      it("auto-approves read-only tools", async () => {
        const result = await engine.check(readOnlyTool, {}, mockContext);
        expect(result.decision).toBe("allow");
        expect(result.requiresApproval).toBe(false);
        expect(result.reasons[0]).toContain("Plan mode");
      });

      it("requires approval for mutating tools", async () => {
        const result = await engine.check(editTool, {}, mockContext);
        expect(result.decision).toBe("approval_required");
        expect(result.requiresApproval).toBe(true);
        expect(result.reasons[0]).toContain("Plan mode");
      });

      it("requires approval for bash commands", async () => {
        const result = await engine.check(bashTool, { command: "echo hello" }, mockContext);
        expect(result.decision).toBe("approval_required");
        expect(result.requiresApproval).toBe(true);
      });
    });

    describe("acceptEdits mode", () => {
      beforeEach(() => {
        engine.setMode("acceptEdits");
      });

      it("auto-approves edit_file", async () => {
        const result = await engine.check(editTool, {}, mockContext);
        expect(result.decision).toBe("allow");
        expect(result.requiresApproval).toBe(false);
        expect(result.reasons[0]).toContain("AcceptEdits mode");
      });

      it("auto-approves write_file", async () => {
        const result = await engine.check(writeTool, {}, mockContext);
        expect(result.decision).toBe("allow");
        expect(result.requiresApproval).toBe(false);
      });

      it("auto-approves read_file", async () => {
        const result = await engine.check(readOnlyTool, {}, mockContext);
        expect(result.decision).toBe("allow");
        expect(result.requiresApproval).toBe(false);
      });

      it("requires approval for bash", async () => {
        const result = await engine.check(bashTool, { command: "echo safe" }, mockContext);
        expect(result.decision).toBe("approval_required");
        expect(result.requiresApproval).toBe(true);
        expect(result.reasons[0]).toContain("AcceptEdits mode");
      });

      it("requires approval for shell", async () => {
        const shellTool: ToolDefinition = {
          name: "shell",
          description: "Execute shell command",
          inputSchema: z.object({ command: z.string() }),
          execute: async () => ({ type: "success", content: "ok" }),
          permission: { scope: "repo.edit" },
        };
        const result = await engine.check(shellTool, { command: "ls" }, mockContext);
        expect(result.decision).toBe("approval_required");
      });

      it("falls through to normal evaluation for other tools", async () => {
        engine.addPolicy(autoApproveReadOnly);
        const searchTool: ToolDefinition = {
          name: "search",
          description: "Search",
          inputSchema: z.object({}),
          execute: async () => ({ type: "success", content: "ok" }),
          permission: { scope: "repo.read", readOnly: true },
        };
        const result = await engine.check(searchTool, {}, mockContext);
        // Falls through to normal policy evaluation, autoApproveReadOnly matches
        expect(result.decision).toBe("allow");
        expect(result.source).toBe("policy");
      });
    });

    describe("auto mode", () => {
      it("falls through to normal evaluation without a classifier", async () => {
        engine.setMode("auto");
        engine.addPolicy(autoApproveReadOnly);
        const result = await engine.check(readOnlyTool, {}, mockContext);
        expect(result.decision).toBe("allow");
        expect(result.source).toBe("policy");
      });

      it("allows safe commands via classifier", async () => {
        engine.setMode("auto");
        const classifier = new SafetyClassifier();
        engine.setSafetyClassifier(classifier);

        const result = await engine.check(bashTool, { command: "ls -la" }, mockContext);
        expect(result.decision).toBe("allow");
        expect(result.reasons[0]).toContain("Auto mode");
        expect(result.reasons[0]).toContain("safe");
      });

      it("denies dangerous commands via classifier", async () => {
        engine.setMode("auto");
        const classifier = new SafetyClassifier();
        engine.setSafetyClassifier(classifier);

        const result = await engine.check(bashTool, { command: "rm -rf /" }, mockContext);
        expect(result.decision).toBe("deny");
        expect(result.reasons[0]).toContain("Auto mode");
        expect(result.reasons[0]).toContain("dangerous");
      });

      it("requires approval for risky commands via classifier", async () => {
        engine.setMode("auto");
        const classifier = new SafetyClassifier();
        engine.setSafetyClassifier(classifier);

        const result = await engine.check(bashTool, { command: "npm install lodash" }, mockContext);
        expect(result.decision).toBe("approval_required");
        expect(result.requiresApproval).toBe(true);
        expect(result.reasons[0]).toContain("Auto mode");
        expect(result.reasons[0]).toContain("risky");
      });

      it("falls through for non-command tools even with classifier", async () => {
        engine.setMode("auto");
        const classifier = new SafetyClassifier();
        engine.setSafetyClassifier(classifier);

        // Tool with no command in input — classifier cannot extract command
        const result = await engine.check(otherTool, {}, mockContext);
        // Falls through to default decision
        expect(result.source).toBe("default");
      });

      it("handles string input for command extraction", async () => {
        engine.setMode("auto");
        const classifier = new SafetyClassifier();
        engine.setSafetyClassifier(classifier);

        const result = await engine.check(bashTool, "git status", mockContext);
        expect(result.decision).toBe("allow");
      });
    });

    describe("mode getters and setters", () => {
      it("setMode changes the mode", () => {
        engine.setMode("bypass");
        expect(engine.getMode()).toBe("bypass");
        engine.setMode("plan");
        expect(engine.getMode()).toBe("plan");
      });

      it("reset() resets mode to default", () => {
        engine.setMode("bypass");
        engine.reset();
        expect(engine.getMode()).toBe("default");
      });
    });
  });
});
