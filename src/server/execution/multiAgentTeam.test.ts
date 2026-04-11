import { describe, it, expect, beforeEach } from "vitest";
import { MultiAgentTeam, createTeamContext, type AgentSpec, type TeamEvent } from "./multiAgentTeam";
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

  describe("agent error handling", () => {
    it("records failed status when agent generator throws", async () => {
      const errorOrchestrator = async function* (_spec: AgentSpec): AsyncGenerator<AgenticEvent> {
        yield { type: "iteration_start", iteration: 1, messageCount: 0 };
        throw new Error("Agent crashed");
      };

      const errorTeam = new MultiAgentTeam(errorOrchestrator);
      errorTeam.addAgent({
        id: "crasher",
        role: "implementer",
        objective: "Will crash",
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
      for await (const event of errorTeam.execute(baseInput)) {
        events.push(event);
      }

      const results = errorTeam.getResults();
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("failed");
      expect(results[0].summary).toContain("Agent crashed");
    });
  });

  describe("finalizeAgent with execution_aborted", () => {
    it("records aborted status when agent yields execution_aborted as last event", async () => {
      const abortOrchestrator = async function* (_spec: AgentSpec): AsyncGenerator<AgenticEvent> {
        yield { type: "iteration_start", iteration: 1, messageCount: 0 };
        yield {
          type: "execution_aborted",
          reason: "User requested abort",
          totalIterations: 1,
          totalToolCalls: 0,
        };
      };

      const abortTeam = new MultiAgentTeam(abortOrchestrator);
      abortTeam.addAgent({
        id: "aborter",
        role: "implementer",
        objective: "Will abort",
      });

      const baseInput: AgenticExecutionInput = {
        runId: "run1",
        repoId: "repo1",
        ticketId: "ticket1",
        objective: "Base objective",
        worktreePath: "/test/path",
        actor: "test",
      };

      for await (const _ of abortTeam.execute(baseInput)) {
        // consume
      }

      const results = abortTeam.getResults();
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("aborted");
      expect(results[0].summary).toBe("User requested abort");
    });
  });

  describe("finalizeAgent with error event", () => {
    it("records failed status when agent yields error as last event", async () => {
      const errOrchestrator = async function* (_spec: AgentSpec): AsyncGenerator<AgenticEvent> {
        yield { type: "iteration_start", iteration: 1, messageCount: 0 };
        yield {
          type: "error",
          error: "Something went wrong internally",
          recoverable: false,
        };
      };

      const errTeam = new MultiAgentTeam(errOrchestrator);
      errTeam.addAgent({
        id: "erring",
        role: "tester",
        objective: "Will error",
      });

      const baseInput: AgenticExecutionInput = {
        runId: "run1",
        repoId: "repo1",
        ticketId: "ticket1",
        objective: "Base objective",
        worktreePath: "/test/path",
        actor: "test",
      };

      for await (const _ of errTeam.execute(baseInput)) {
        // consume
      }

      const results = errTeam.getResults();
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("failed");
      expect(results[0].summary).toBe("Something went wrong internally");
    });
  });

  describe("finalizeAgent with no finalEvent", () => {
    it("records completed with default summary when generator yields no events", async () => {
      const emptyOrchestrator = async function* (_spec: AgentSpec): AsyncGenerator<AgenticEvent> {
        // yields nothing, immediately returns
      };

      const emptyTeam = new MultiAgentTeam(emptyOrchestrator);
      emptyTeam.addAgent({
        id: "empty",
        role: "planner",
        objective: "Plan nothing",
      });

      const baseInput: AgenticExecutionInput = {
        runId: "run1",
        repoId: "repo1",
        ticketId: "ticket1",
        objective: "Base objective",
        worktreePath: "/test/path",
        actor: "test",
      };

      for await (const _ of emptyTeam.execute(baseInput)) {
        // consume
      }

      const results = emptyTeam.getResults();
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("completed");
      expect(results[0].summary).toBe("Agent completed successfully");
    });
  });

  describe("trackFileChanges", () => {
    it("tracks file changes from tool_use_started events with path", async () => {
      const fileOrchestrator = async function* (_spec: AgentSpec): AsyncGenerator<AgenticEvent> {
        yield {
          type: "tool_use_started",
          name: "write_file",
          input: { path: "/src/newFile.ts" },
          toolCallId: "tc-1",
        };
        yield {
          type: "execution_complete",
          finalMessage: "Done",
          totalIterations: 1,
          totalToolCalls: 1,
        };
      };

      const fileTeam = new MultiAgentTeam(fileOrchestrator);
      fileTeam.addAgent({
        id: "writer",
        role: "implementer",
        objective: "Write files",
      });

      const baseInput: AgenticExecutionInput = {
        runId: "run1",
        repoId: "repo1",
        ticketId: "ticket1",
        objective: "Base objective",
        worktreePath: "/test/path",
        actor: "test",
      };

      for await (const _ of fileTeam.execute(baseInput)) {
        // consume
      }

      const results = fileTeam.getResults();
      expect(results).toHaveLength(1);
      expect(results[0].filesChanged).toContain("/src/newFile.ts");
    });

    it("tracks file changes from tool_use_started events with file key", async () => {
      const fileOrchestrator = async function* (_spec: AgentSpec): AsyncGenerator<AgenticEvent> {
        yield {
          type: "tool_use_started",
          name: "edit_file",
          input: { file: "/src/existing.ts" },
          toolCallId: "tc-1",
        };
        yield {
          type: "execution_complete",
          finalMessage: "Done",
          totalIterations: 1,
          totalToolCalls: 1,
        };
      };

      const fileTeam = new MultiAgentTeam(fileOrchestrator);
      fileTeam.addAgent({
        id: "editor",
        role: "implementer",
        objective: "Edit files",
      });

      const baseInput: AgenticExecutionInput = {
        runId: "run1",
        repoId: "repo1",
        ticketId: "ticket1",
        objective: "Base objective",
        worktreePath: "/test/path",
        actor: "test",
      };

      for await (const _ of fileTeam.execute(baseInput)) {
        // consume
      }

      const results = fileTeam.getResults();
      expect(results).toHaveLength(1);
      expect(results[0].filesChanged).toContain("/src/existing.ts");
    });

    it("does not track non-file-modifying tools", async () => {
      const readOrchestrator = async function* (_spec: AgentSpec): AsyncGenerator<AgenticEvent> {
        yield {
          type: "tool_use_started",
          name: "read_file",
          input: { path: "/src/read.ts" },
          toolCallId: "tc-1",
        };
        yield {
          type: "execution_complete",
          finalMessage: "Done",
          totalIterations: 1,
          totalToolCalls: 1,
        };
      };

      const readTeam = new MultiAgentTeam(readOrchestrator);
      readTeam.addAgent({
        id: "reader",
        role: "researcher",
        objective: "Read files",
      });

      const baseInput: AgenticExecutionInput = {
        runId: "run1",
        repoId: "repo1",
        ticketId: "ticket1",
        objective: "Base objective",
        worktreePath: "/test/path",
        actor: "test",
      };

      for await (const _ of readTeam.execute(baseInput)) {
        // consume
      }

      const results = readTeam.getResults();
      expect(results).toHaveLength(1);
      expect(results[0].filesChanged).toHaveLength(0);
    });

    it("does not track when tool has no file path", async () => {
      const noPathOrchestrator = async function* (_spec: AgentSpec): AsyncGenerator<AgenticEvent> {
        yield {
          type: "tool_use_started",
          name: "bash",
          input: { command: "echo hello" },
          toolCallId: "tc-1",
        };
        yield {
          type: "execution_complete",
          finalMessage: "Done",
          totalIterations: 1,
          totalToolCalls: 1,
        };
      };

      const noPathTeam = new MultiAgentTeam(noPathOrchestrator);
      noPathTeam.addAgent({
        id: "basher",
        role: "implementer",
        objective: "Run bash",
      });

      const baseInput: AgenticExecutionInput = {
        runId: "run1",
        repoId: "repo1",
        ticketId: "ticket1",
        objective: "Base objective",
        worktreePath: "/test/path",
        actor: "test",
      };

      for await (const _ of noPathTeam.execute(baseInput)) {
        // consume
      }

      const results = noPathTeam.getResults();
      expect(results).toHaveLength(1);
      expect(results[0].filesChanged).toHaveLength(0);
    });

    it("does not track non-tool_use_started events", async () => {
      const tokenOrchestrator = async function* (_spec: AgentSpec): AsyncGenerator<AgenticEvent> {
        yield { type: "assistant_token", value: "some output" };
        yield {
          type: "execution_complete",
          finalMessage: "Done",
          totalIterations: 1,
          totalToolCalls: 0,
        };
      };

      const tokenTeam = new MultiAgentTeam(tokenOrchestrator);
      tokenTeam.addAgent({
        id: "talker",
        role: "planner",
        objective: "Just talk",
      });

      const baseInput: AgenticExecutionInput = {
        runId: "run1",
        repoId: "repo1",
        ticketId: "ticket1",
        objective: "Base objective",
        worktreePath: "/test/path",
        actor: "test",
      };

      for await (const _ of tokenTeam.execute(baseInput)) {
        // consume
      }

      const results = tokenTeam.getResults();
      expect(results).toHaveLength(1);
      expect(results[0].filesChanged).toHaveLength(0);
    });
  });

  describe("receiveMessages for unknown agent", () => {
    it("returns empty array for agent with no queue", () => {
      const team2 = new MultiAgentTeam(mockOrchestrator);
      // Don't add any agents, so no queues exist
      const messages = team2.receiveMessages("nonexistent");
      expect(messages).toHaveLength(0);
    });
  });
});

describe("createTeamContext", () => {
  it("returns a context object with all team operations", () => {
    const orchestrator = async function* (_spec: AgentSpec): AsyncGenerator<AgenticEvent> {
      yield {
        type: "execution_complete",
        finalMessage: "Done",
        totalIterations: 1,
        totalToolCalls: 0,
      };
    };

    const team = new MultiAgentTeam(orchestrator);
    team.addAgent({ id: "agent1", role: "implementer", objective: "Task 1" });
    team.addAgent({ id: "agent2", role: "tester", objective: "Task 2" });

    const ctx = createTeamContext(team, "agent1");

    expect(ctx.teamId).toBe("default");
    expect(ctx.agentId).toBe("agent1");
  });

  it("sendMessage delegates to team.sendMessage", () => {
    const orchestrator = async function* (_spec: AgentSpec): AsyncGenerator<AgenticEvent> {
      yield {
        type: "execution_complete",
        finalMessage: "Done",
        totalIterations: 1,
        totalToolCalls: 0,
      };
    };

    const team = new MultiAgentTeam(orchestrator);
    team.addAgent({ id: "agent1", role: "implementer", objective: "Task 1" });
    team.addAgent({ id: "agent2", role: "tester", objective: "Task 2" });

    const ctx = createTeamContext(team, "agent1");

    // Send message from agent1 to agent2
    ctx.sendMessage("agent2", "Hello from context");

    const messages = team.receiveMessages("agent2");
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toContain("agent1");
    expect(messages[0].content).toContain("Hello from context");
  });

  it("receiveMessages delegates to team.receiveMessages", () => {
    const orchestrator = async function* (_spec: AgentSpec): AsyncGenerator<AgenticEvent> {
      yield {
        type: "execution_complete",
        finalMessage: "Done",
        totalIterations: 1,
        totalToolCalls: 0,
      };
    };

    const team = new MultiAgentTeam(orchestrator);
    team.addAgent({ id: "agent1", role: "implementer", objective: "Task 1" });
    team.addAgent({ id: "agent2", role: "tester", objective: "Task 2" });

    const ctx = createTeamContext(team, "agent1");

    // Send a message to agent1 first
    team.sendMessage("agent2", "agent1", "Hey there");

    const msgs = ctx.receiveMessages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toContain("Hey there");
  });

  it("getAllAgents delegates to team.getAllAgents", () => {
    const orchestrator = async function* (_spec: AgentSpec): AsyncGenerator<AgenticEvent> {
      yield {
        type: "execution_complete",
        finalMessage: "Done",
        totalIterations: 1,
        totalToolCalls: 0,
      };
    };

    const team = new MultiAgentTeam(orchestrator);
    team.addAgent({ id: "agent1", role: "implementer", objective: "Task 1" });
    team.addAgent({ id: "agent2", role: "tester", objective: "Task 2" });

    const ctx = createTeamContext(team, "agent1");

    const agents = ctx.getAllAgents();
    expect(agents).toHaveLength(2);
    expect(agents.map((a) => a.id)).toContain("agent1");
    expect(agents.map((a) => a.id)).toContain("agent2");
  });

  it("getActiveAgents delegates to team.getActiveAgents", () => {
    const orchestrator = async function* (_spec: AgentSpec): AsyncGenerator<AgenticEvent> {
      yield {
        type: "execution_complete",
        finalMessage: "Done",
        totalIterations: 1,
        totalToolCalls: 0,
      };
    };

    const team = new MultiAgentTeam(orchestrator);
    team.addAgent({ id: "agent1", role: "implementer", objective: "Task 1" });

    const ctx = createTeamContext(team, "agent1");

    // No agents executing yet
    expect(ctx.getActiveAgents()).toEqual([]);
  });

  it("addAgent delegates to team.addAgent", () => {
    const orchestrator = async function* (_spec: AgentSpec): AsyncGenerator<AgenticEvent> {
      yield {
        type: "execution_complete",
        finalMessage: "Done",
        totalIterations: 1,
        totalToolCalls: 0,
      };
    };

    const team = new MultiAgentTeam(orchestrator);
    team.addAgent({ id: "agent1", role: "implementer", objective: "Task 1" });

    const ctx = createTeamContext(team, "agent1");

    ctx.addAgent({ id: "agent3", role: "reviewer", objective: "Review code" });

    const agents = team.getAllAgents();
    expect(agents).toHaveLength(2);
    expect(agents.map((a) => a.id)).toContain("agent3");
  });
});
