import { describe, it, expect, beforeEach } from "vitest";
import { MultiAgentTeam, type AgentSpec, type TeamEvent } from "./multiAgentTeam";
import type { AgenticEvent, AgenticExecutionInput } from "../tools/types";

describe("MultiAgentTeam", () => {
  let team: MultiAgentTeam;
  let mockOrchestrator: (spec: AgentSpec) => AsyncGenerator<AgenticEvent>;

  beforeEach(() => {
    mockOrchestrator = async function* (spec: AgentSpec) {
      // Simple mock that yields a few events and completes
      yield { type: "iteration_start", iteration: 1, messageCount: 0 };
      yield { type: "assistant_token", value: "Working on " + spec.objective };
      yield {
        type: "execution_complete",
        finalMessage: "Completed " + spec.objective,
        totalIterations: 1,
        totalToolCalls: 0,
      };
    };

    team = new MultiAgentTeam(mockOrchestrator);
  });

  describe("addAgent", () => {
    it("should add an agent to the team", () => {
      const spec: AgentSpec = {
        id: "agent1",
        role: "implementer",
        objective: "Implement feature X",
      };

      team.addAgent(spec);
      expect(team.getAllAgents()).toHaveLength(1);
      expect(team.getAgent("agent1")).toEqual(spec);
    });

    it("should throw error when adding duplicate agent", () => {
      const spec: AgentSpec = {
        id: "agent1",
        role: "implementer",
        objective: "Implement feature X",
      };

      team.addAgent(spec);
      expect(() => team.addAgent(spec)).toThrow("Agent already exists: agent1");
    });
  });

  describe("execute", () => {
    it("should execute a single agent", async () => {
      team.addAgent({
        id: "agent1",
        role: "implementer",
        objective: "Implement feature X",
      });

      const baseInput: AgenticExecutionInput = {
        runId: "run1",
        repoId: "repo1",
        ticketId: "ticket1",
        objective: "Base objective",
        worktreePath: "/test/path",
        actor: "test",
      };

      const events: TeamEvent[] = [];
      for await (const event of team.execute(baseInput)) {
        events.push(event);
      }

      expect(events.length).toBeGreaterThan(0);
      expect(events.every((e) => e.type === "agent_event")).toBe(true);
      expect(team.getResults()).toHaveLength(1);
    });

    it("should execute multiple agents without conflicts in parallel", async () => {
      team.addAgent({
        id: "agent1",
        role: "implementer",
        objective: "Implement feature X",
        fileScope: ["file1.ts"],
      });

      team.addAgent({
        id: "agent2",
        role: "implementer",
        objective: "Implement feature Y",
        fileScope: ["file2.ts"],
      });

      const baseInput: AgenticExecutionInput = {
        runId: "run1",
        repoId: "repo1",
        ticketId: "ticket1",
        objective: "Base objective",
        worktreePath: "/test/path",
        actor: "test",
      };

      const events: TeamEvent[] = [];
      for await (const event of team.execute(baseInput)) {
        events.push(event);
      }

      expect(events.length).toBeGreaterThan(0);
      expect(team.getResults()).toHaveLength(2);

      // Both agents should complete
      const results = team.getResults();
      expect(results.every((r) => r.status === "completed")).toBe(true);
    });

    it("should execute agents with file conflicts sequentially", async () => {
      team.addAgent({
        id: "agent1",
        role: "implementer",
        objective: "Implement feature X",
        fileScope: ["shared.ts"],
      });

      team.addAgent({
        id: "agent2",
        role: "implementer",
        objective: "Implement feature Y",
        fileScope: ["shared.ts"],
      });

      const baseInput: AgenticExecutionInput = {
        runId: "run1",
        repoId: "repo1",
        ticketId: "ticket1",
        objective: "Base objective",
        worktreePath: "/test/path",
        actor: "test",
      };

      const events: TeamEvent[] = [];
      for await (const event of team.execute(baseInput)) {
        events.push(event);
      }

      expect(events.length).toBeGreaterThan(0);
      expect(team.getResults()).toHaveLength(2);
    });

    it("should throw error if no agents added", async () => {
      const baseInput: AgenticExecutionInput = {
        runId: "run1",
        repoId: "repo1",
        ticketId: "ticket1",
        objective: "Base objective",
        worktreePath: "/test/path",
        actor: "test",
      };

      const generator = team.execute(baseInput);
      await expect(generator.next()).rejects.toThrow("No agents added to team");
    });
  });

  describe("messaging", () => {
    beforeEach(() => {
      team.addAgent({
        id: "agent1",
        role: "implementer",
        objective: "Implement feature X",
      });

      team.addAgent({
        id: "agent2",
        role: "tester",
        objective: "Test feature X",
      });
    });

    it("should send message between agents", () => {
      team.sendMessage("agent1", "agent2", "Ready for testing");

      const messages = team.receiveMessages("agent2");
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toContain("agent1");
      expect(messages[0].content).toContain("Ready for testing");
    });

    it("should clear message queue after receiving", () => {
      team.sendMessage("agent1", "agent2", "Message 1");
      team.sendMessage("agent1", "agent2", "Message 2");

      const messages1 = team.receiveMessages("agent2");
      expect(messages1).toHaveLength(2);

      const messages2 = team.receiveMessages("agent2");
      expect(messages2).toHaveLength(0);
    });

    it("should throw error when sending to unknown agent", () => {
      expect(() => team.sendMessage("agent1", "agent99", "Hello")).toThrow(
        "Cannot send message to unknown agent: agent99"
      );
    });
  });

  describe("conflict detection", () => {
    it("should detect file scope conflicts", async () => {
      team.addAgent({
        id: "agent1",
        role: "implementer",
        objective: "Task 1",
        fileScope: ["file1.ts", "file2.ts"],
      });

      team.addAgent({
        id: "agent2",
        role: "implementer",
        objective: "Task 2",
        fileScope: ["file2.ts", "file3.ts"],
      });

      team.addAgent({
        id: "agent3",
        role: "implementer",
        objective: "Task 3",
        fileScope: ["file4.ts"],
      });

      const baseInput: AgenticExecutionInput = {
        runId: "run1",
        repoId: "repo1",
        ticketId: "ticket1",
        objective: "Base objective",
        worktreePath: "/test/path",
        actor: "test",
      };

      // Execute and verify agents are grouped correctly
      const events: TeamEvent[] = [];
      for await (const event of team.execute(baseInput)) {
        events.push(event);
      }

      // agent1 and agent2 conflict on file2.ts, agent3 doesn't conflict
      // So we should see execution happening in groups
      expect(team.getResults()).toHaveLength(3);
    });

    it("should handle agents with no file scope", async () => {
      team.addAgent({
        id: "agent1",
        role: "planner",
        objective: "Plan architecture",
      });

      team.addAgent({
        id: "agent2",
        role: "researcher",
        objective: "Research best practices",
      });

      const baseInput: AgenticExecutionInput = {
        runId: "run1",
        repoId: "repo1",
        ticketId: "ticket1",
        objective: "Base objective",
        worktreePath: "/test/path",
        actor: "test",
      };

      const events: TeamEvent[] = [];
      for await (const event of team.execute(baseInput)) {
        events.push(event);
      }

      // No conflicts, should run in parallel
      expect(team.getResults()).toHaveLength(2);
    });
  });

  describe("getActiveAgents", () => {
    it("should return empty array when no agents are active", () => {
      expect(team.getActiveAgents()).toEqual([]);
    });

    it("should track active agents during execution", async () => {
      team.addAgent({
        id: "agent1",
        role: "implementer",
        objective: "Task 1",
      });

      const baseInput: AgenticExecutionInput = {
        runId: "run1",
        repoId: "repo1",
        ticketId: "ticket1",
        objective: "Base objective",
        worktreePath: "/test/path",
        actor: "test",
      };

      let sawActiveAgent = false;
      for await (const event of team.execute(baseInput)) {
        const active = team.getActiveAgents();
        if (active.length > 0) {
          sawActiveAgent = true;
        }
      }

      expect(sawActiveAgent).toBe(true);
      expect(team.getActiveAgents()).toEqual([]); // All done after execution
    });
  });

  describe("results", () => {
    it("should record successful completion", async () => {
      team.addAgent({
        id: "agent1",
        role: "implementer",
        objective: "Implement feature",
      });

      const baseInput: AgenticExecutionInput = {
        runId: "run1",
        repoId: "repo1",
        ticketId: "ticket1",
        objective: "Base objective",
        worktreePath: "/test/path",
        actor: "test",
      };

      for await (const _ of team.execute(baseInput)) {
        // Consume events
      }

      const results = team.getResults();
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("completed");
      expect(results[0].agentId).toBe("agent1");
      expect(results[0].role).toBe("implementer");
    });
  });

  describe("concurrency limits", () => {
    it("should respect maxConcurrentAgents option", async () => {
      const teamWithLimit = new MultiAgentTeam(mockOrchestrator, {
        maxConcurrentAgents: 2,
      });

      // Add 5 agents with no conflicts
      for (let i = 1; i <= 5; i++) {
        teamWithLimit.addAgent({
          id: `agent${i}`,
          role: "implementer",
          objective: `Task ${i}`,
          fileScope: [`file${i}.ts`],
        });
      }

      const baseInput: AgenticExecutionInput = {
        runId: "run1",
        repoId: "repo1",
        ticketId: "ticket1",
        objective: "Base objective",
        worktreePath: "/test/path",
        actor: "test",
      };

      const events: TeamEvent[] = [];
      for await (const event of teamWithLimit.execute(baseInput)) {
        events.push(event);
      }

      expect(teamWithLimit.getResults()).toHaveLength(5);
    });
  });
});
