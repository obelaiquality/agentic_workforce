import { describe, it, expect, vi, beforeEach } from "vitest";
import { teamTools, sendMessageTool, listPeersTool, spawnAgentTool } from "./team";
import type { ToolContext, TeamContext } from "../types";

describe("team tool definitions", () => {
  let mockContext: ToolContext;
  let mockTeamContext: TeamContext;

  beforeEach(() => {
    mockTeamContext = {
      teamId: "team-1",
      agentId: "agent-planner",
      sendMessage: vi.fn(),
      receiveMessages: vi.fn(() => []),
    };

    mockContext = {
      runId: "test-run",
      repoId: "test-repo",
      ticketId: "test-ticket",
      worktreePath: "/tmp/test-project",
      actor: "agent:coder_default",
      stage: "build",
      conversationHistory: [],
      createApproval: vi.fn(async () => ({ id: "approval-1" })),
      recordEvent: vi.fn(async () => {}),
    };
  });

  describe("teamTools array", () => {
    it("exports 3 tools", () => {
      expect(teamTools).toHaveLength(3);
    });

    it("each tool has alwaysLoad: false (deferred)", () => {
      for (const tool of teamTools) {
        expect(tool.alwaysLoad).toBe(false);
      }
    });
  });

  describe("send_message", () => {
    it("has correct name and permission metadata", () => {
      expect(sendMessageTool.name).toBe("send_message");
      expect(sendMessageTool.permission.scope).toBe("meta");
      expect(sendMessageTool.permission.readOnly).toBe(false);
    });

    it("returns error when no team context is present", async () => {
      const result = await sendMessageTool.execute(
        { to_agent: "agent-impl", message: "Hello" },
        mockContext,
      );

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error).toContain("multi-agent team context");
      }
    });

    it("sends message and returns success with team context", async () => {
      mockContext.teamContext = mockTeamContext;

      const result = await sendMessageTool.execute(
        { to_agent: "agent-impl", message: "Please review utils.ts" },
        mockContext,
      );

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toContain("agent-impl");
        expect(result.content).toContain("Please review utils.ts");
        expect(result.metadata?.recipient).toBe("agent-impl");
        expect(result.metadata?.sender).toBe("agent-planner");
      }
      expect(mockTeamContext.sendMessage).toHaveBeenCalledWith(
        "agent-impl",
        "Please review utils.ts",
      );
    });
  });

  describe("list_peers", () => {
    it("has correct name and permission metadata", () => {
      expect(listPeersTool.name).toBe("list_peers");
      expect(listPeersTool.permission.scope).toBe("meta");
      expect(listPeersTool.permission.readOnly).toBe(true);
    });

    it("returns error when no team context is present", async () => {
      const result = await listPeersTool.execute({}, mockContext);

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error).toContain("multi-agent team context");
      }
    });

    it("returns success with team context", async () => {
      mockContext.teamContext = mockTeamContext;

      const result = await listPeersTool.execute({}, mockContext);

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.metadata?.currentAgent).toBe("agent-planner");
      }
    });
  });

  describe("spawn_agent", () => {
    it("has correct name and permission metadata", () => {
      expect(spawnAgentTool.name).toBe("spawn_agent");
      expect(spawnAgentTool.permission.scope).toBe("meta");
      expect(spawnAgentTool.permission.requiresApproval).toBe(true);
    });

    it("returns error when no team context is present", async () => {
      const result = await spawnAgentTool.execute(
        { objective: "Write tests", role: "tester" },
        mockContext,
      );

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error).toContain("multi-agent team context");
      }
    });

    it("returns spawn details with team context", async () => {
      mockContext.teamContext = mockTeamContext;

      const result = await spawnAgentTool.execute(
        {
          objective: "Write unit tests for utils module",
          role: "tester",
          file_scope: ["src/utils.ts", "src/utils.test.ts"],
        },
        mockContext,
      );

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toContain("tester");
        expect(result.content).toContain("Write unit tests for utils module");
        expect(result.content).toContain("src/utils.ts");
        expect(result.metadata?.role).toBe("tester");
        expect(result.metadata?.objective).toBe("Write unit tests for utils module");
      }
    });
  });
});
