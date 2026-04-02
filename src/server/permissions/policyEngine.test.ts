import { describe, it, expect, beforeEach } from "vitest";
import { PermissionPolicyEngine } from "./policyEngine";
import {
  autoApproveReadOnly,
  denyDangerousCommands,
  autoApproveInTestMode,
  requireApprovalForInstall,
} from "./defaultPolicies";
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
});
