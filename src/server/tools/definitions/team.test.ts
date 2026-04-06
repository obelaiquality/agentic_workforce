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
      getAllAgents: vi.fn(() => [
        {
          id: "agent-planner",
          role: "planner",
          objective: "Plan the work",
          fileScope: [],
        },
        {
          id: "agent-impl",
          role: "implementer",
          objective: "Implement features",
          fileScope: ["src/utils.ts"],
        },
        {
          id: "agent-tester",
          role: "tester",
          objective: "Write tests",
          fileScope: ["src/utils.test.ts"],
        },
      ]),
      getActiveAgents: vi.fn(() => ["agent-planner", "agent-impl"]),
      addAgent: vi.fn(),
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

    it("returns success with team context and lists all peers", async () => {
      mockContext.teamContext = mockTeamContext;

      const result = await listPeersTool.execute({}, mockContext);

      expect(result.type).toBe("success");
      if (result.type === "success") {
        // Should call the team methods
        expect(mockTeamContext.getAllAgents).toHaveBeenCalled();
        expect(mockTeamContext.getActiveAgents).toHaveBeenCalled();

        // Should contain peer info (excluding the current agent)
        expect(result.content).toContain("agent-impl");
        expect(result.content).toContain("agent-tester");
        expect(result.content).not.toContain("agent-planner"); // Current agent should be excluded

        // Should show active status
        expect(result.content).toContain("active");
        expect(result.content).toContain("idle");

        // Metadata should include peers
        expect(result.metadata?.peers).toHaveLength(2); // Excluding current agent
      }
    });

    it("returns empty message when no other agents exist", async () => {
      mockContext.teamContext = {
        ...mockTeamContext,
        getAllAgents: vi.fn(() => [
          {
            id: "agent-planner",
            role: "planner",
            objective: "Solo work",
            fileScope: [],
          },
        ]),
      };

      const result = await listPeersTool.execute({}, mockContext);

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toContain("No other agents in the team");
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

    it("spawns agent and adds to team", async () => {
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
        // Should call addAgent with proper spec
        expect(mockTeamContext.addAgent).toHaveBeenCalledWith(
          expect.objectContaining({
            id: expect.stringMatching(/^tester-\d+$/),
            role: "tester",
            objective: "Write unit tests for utils module",
            fileScope: ["src/utils.ts", "src/utils.test.ts"],
          })
        );

        // Should return details in content
        expect(result.content).toContain("tester");
        expect(result.content).toContain("Write unit tests for utils module");
        expect(result.content).toContain("src/utils.ts");

        // Should return metadata
        expect(result.metadata?.agentId).toMatch(/^tester-\d+$/);
        expect(result.metadata?.role).toBe("tester");
        expect(result.metadata?.objective).toBe("Write unit tests for utils module");
        expect(result.metadata?.fileScope).toEqual(["src/utils.ts", "src/utils.test.ts"]);
      }
    });

    it("spawns agent without file scope", async () => {
      mockContext.teamContext = mockTeamContext;

      const result = await spawnAgentTool.execute(
        {
          objective: "Research best practices",
          role: "researcher",
        },
        mockContext,
      );

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(mockTeamContext.addAgent).toHaveBeenCalledWith(
          expect.objectContaining({
            id: expect.stringMatching(/^researcher-\d+$/),
            role: "researcher",
            objective: "Research best practices",
            fileScope: undefined,
          })
        );

        expect(result.content).toContain("none"); // file scope should be "none"
      }
    });
  });
});
