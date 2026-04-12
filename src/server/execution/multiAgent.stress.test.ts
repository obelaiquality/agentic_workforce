/**
 * Stress test for multi-agent coordination.
 *
 * Verifies:
 * - File edit serialization (no race conditions when agents share files)
 * - Task graph scheduling with dependencies (conflict-based grouping)
 * - Agent message bus routing
 * - Concurrency limit enforcement
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  MultiAgentTeam,
  createTeamContext,
  type AgentSpec,
  type TeamEvent,
} from "./multiAgentTeam";
import type { AgenticEvent, AgenticExecutionInput } from "../tools/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_INPUT: AgenticExecutionInput = {
  runId: "stress-run-001",
  repoId: "repo-stress",
  ticketId: "ticket-stress",
  objective: "Stress test objective",
  worktreePath: "/tmp/stress-test",
  actor: "stress-tester",
};

async function collectTeamEvents(gen: AsyncGenerator<TeamEvent>): Promise<TeamEvent[]> {
  const events: TeamEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

/**
 * Build a mock orchestrator that emits file-modifying tool events and tracks
 * concurrent execution via a shared counter.
 */
function createConcurrencyTrackingOrchestrator(
  concurrencyTracker: { current: number; max: number },
  delayMs = 10,
) {
  return async function* (spec: AgentSpec): AsyncGenerator<AgenticEvent> {
    concurrencyTracker.current++;
    if (concurrencyTracker.current > concurrencyTracker.max) {
      concurrencyTracker.max = concurrencyTracker.current;
    }

    yield { type: "iteration_start", iteration: 1, messageCount: 0 };

    // Emit a file-modifying tool use for each file in scope
    for (const file of spec.fileScope || []) {
      yield {
        type: "tool_use_started",
        id: `tc-${spec.id}-${file}`,
        name: "write_file",
        input: { path: file },
      };
    }

    // Simulate some async work
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    yield {
      type: "execution_complete",
      finalMessage: `Agent ${spec.id} completed`,
      totalIterations: 1,
      totalToolCalls: spec.fileScope?.length || 0,
    };

    concurrencyTracker.current--;
  };
}

/**
 * Create an orchestrator that records execution order.
 */
function createOrderTrackingOrchestrator(executionOrder: string[]) {
  return async function* (spec: AgentSpec): AsyncGenerator<AgenticEvent> {
    executionOrder.push(`start:${spec.id}`);

    yield { type: "iteration_start", iteration: 1, messageCount: 0 };

    for (const file of spec.fileScope || []) {
      yield {
        type: "tool_use_started",
        id: `tc-${spec.id}-${file}`,
        name: "edit_file",
        input: { path: file },
      };
    }

    // Small delay to allow other agents in the same group to start
    await new Promise((resolve) => setTimeout(resolve, 5));

    yield {
      type: "execution_complete",
      finalMessage: `Done: ${spec.id}`,
      totalIterations: 1,
      totalToolCalls: spec.fileScope?.length || 0,
    };

    executionOrder.push(`end:${spec.id}`);
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MultiAgentTeam stress tests", () => {
  describe("file edit serialization", () => {
    it("agents editing the same file are placed in different groups (sequential execution)", async () => {
      const executionOrder: string[] = [];
      const orchestrator = createOrderTrackingOrchestrator(executionOrder);

      const team = new MultiAgentTeam(orchestrator);

      // 3 agents all wanting to edit the same file
      team.addAgent({
        id: "agent-A",
        role: "implementer",
        objective: "Edit shared config",
        fileScope: ["config.ts"],
      });
      team.addAgent({
        id: "agent-B",
        role: "implementer",
        objective: "Edit shared config too",
        fileScope: ["config.ts"],
      });
      team.addAgent({
        id: "agent-C",
        role: "implementer",
        objective: "Also edit shared config",
        fileScope: ["config.ts"],
      });

      await collectTeamEvents(team.execute(BASE_INPUT));

      const results = team.getResults();
      expect(results).toHaveLength(3);
      expect(results.every((r) => r.status === "completed")).toBe(true);

      // Verify sequential execution: each agent must finish before the next starts.
      // With 3 conflicting agents, each goes in its own group and runs one at a time.
      for (let i = 0; i < executionOrder.length - 2; i++) {
        if (executionOrder[i].startsWith("start:") && executionOrder[i + 1].startsWith("start:")) {
          // Two consecutive starts means they were in the same group (parallel).
          // For fully conflicting agents, we expect start/end pairs to alternate.
          // However, the implementation groups non-conflicting agents together,
          // so with full conflicts each agent gets its own group.
          // The key invariant: no two agents editing the same file execute simultaneously.
        }
      }

      // Stronger check: verify no two agents with overlapping files have overlapping execution windows
      const startTimes = new Map<string, number>();
      const endTimes = new Map<string, number>();
      for (let i = 0; i < executionOrder.length; i++) {
        const [action, id] = executionOrder[i].split(":");
        if (action === "start") startTimes.set(id, i);
        if (action === "end") endTimes.set(id, i);
      }

      // For agents sharing config.ts, their execution windows must not overlap
      const agents = ["agent-A", "agent-B", "agent-C"];
      for (let i = 0; i < agents.length; i++) {
        for (let j = i + 1; j < agents.length; j++) {
          const startI = startTimes.get(agents[i])!;
          const endI = endTimes.get(agents[i])!;
          const startJ = startTimes.get(agents[j])!;
          const endJ = endTimes.get(agents[j])!;

          // No overlap: one must end before the other starts
          const noOverlap = endI < startJ || endJ < startI;
          expect(noOverlap).toBe(true);
        }
      }
    });

    it("agents editing different files can execute concurrently", async () => {
      const concurrencyTracker = { current: 0, max: 0 };
      const orchestrator = createConcurrencyTrackingOrchestrator(concurrencyTracker, 50);

      const team = new MultiAgentTeam(orchestrator, { maxConcurrentAgents: 5 });

      // 5 agents, each editing a unique file
      for (let i = 0; i < 5; i++) {
        team.addAgent({
          id: `agent-${i}`,
          role: "implementer",
          objective: `Task ${i}`,
          fileScope: [`unique-file-${i}.ts`],
        });
      }

      await collectTeamEvents(team.execute(BASE_INPUT));

      const results = team.getResults();
      expect(results).toHaveLength(5);
      expect(results.every((r) => r.status === "completed")).toBe(true);

      // With no conflicts and maxConcurrent=5, all agents should run concurrently
      expect(concurrencyTracker.max).toBeGreaterThan(1);
    });

    it("tracks file changes correctly across multiple concurrent agents", async () => {
      const orchestrator = async function* (spec: AgentSpec): AsyncGenerator<AgenticEvent> {
        yield { type: "iteration_start", iteration: 1, messageCount: 0 };

        for (const file of spec.fileScope || []) {
          yield {
            type: "tool_use_started",
            id: `tc-${spec.id}-${file}`,
            name: "write_file",
            input: { path: file },
          };
        }

        yield {
          type: "execution_complete",
          finalMessage: `Done: ${spec.id}`,
          totalIterations: 1,
          totalToolCalls: spec.fileScope?.length || 0,
        };
      };

      const team = new MultiAgentTeam(orchestrator);

      team.addAgent({
        id: "agent-X",
        role: "implementer",
        objective: "Write files A and B",
        fileScope: ["fileA.ts", "fileB.ts"],
      });

      team.addAgent({
        id: "agent-Y",
        role: "implementer",
        objective: "Write files C and D",
        fileScope: ["fileC.ts", "fileD.ts"],
      });

      await collectTeamEvents(team.execute(BASE_INPUT));

      const results = team.getResults();
      const agentXResult = results.find((r) => r.agentId === "agent-X")!;
      const agentYResult = results.find((r) => r.agentId === "agent-Y")!;

      expect(agentXResult.filesChanged).toContain("fileA.ts");
      expect(agentXResult.filesChanged).toContain("fileB.ts");
      expect(agentYResult.filesChanged).toContain("fileC.ts");
      expect(agentYResult.filesChanged).toContain("fileD.ts");
    });
  });

  describe("task graph scheduling with dependencies", () => {
    it("groups non-conflicting agents together and separates conflicting ones", async () => {
      const executionOrder: string[] = [];
      const orchestrator = createOrderTrackingOrchestrator(executionOrder);

      const team = new MultiAgentTeam(orchestrator);

      // Agent1 and Agent2 conflict on sharedA.ts
      // Agent3 doesn't conflict with anyone
      // Agent4 conflicts with Agent2 on sharedB.ts
      team.addAgent({ id: "a1", role: "implementer", objective: "T1", fileScope: ["sharedA.ts"] });
      team.addAgent({ id: "a2", role: "implementer", objective: "T2", fileScope: ["sharedA.ts", "sharedB.ts"] });
      team.addAgent({ id: "a3", role: "implementer", objective: "T3", fileScope: ["unique.ts"] });
      team.addAgent({ id: "a4", role: "implementer", objective: "T4", fileScope: ["sharedB.ts"] });

      await collectTeamEvents(team.execute(BASE_INPUT));

      expect(team.getResults()).toHaveLength(4);
      expect(team.getResults().every((r) => r.status === "completed")).toBe(true);

      // a1 and a2 conflict, a2 and a4 conflict
      // a3 and a1 do not conflict, a3 and a4 do not conflict
      // So a grouping like [{a1, a3, a4}, {a2}] or [{a1, a3}, {a2, ...}] is valid
      // The key invariant: conflicting agents never execute in parallel
      const startTimes = new Map<string, number>();
      const endTimes = new Map<string, number>();
      for (let i = 0; i < executionOrder.length; i++) {
        const [action, id] = executionOrder[i].split(":");
        if (action === "start") startTimes.set(id, i);
        if (action === "end") endTimes.set(id, i);
      }

      // a1 and a2 must not overlap
      const s1 = startTimes.get("a1")!, e1 = endTimes.get("a1")!;
      const s2 = startTimes.get("a2")!, e2 = endTimes.get("a2")!;
      expect(e1 < s2 || e2 < s1).toBe(true);

      // a2 and a4 must not overlap
      const s4 = startTimes.get("a4")!, e4 = endTimes.get("a4")!;
      expect(e2 < s4 || e4 < s2).toBe(true);
    });

    it("handles transitive dependency chains", async () => {
      const executionOrder: string[] = [];
      const orchestrator = createOrderTrackingOrchestrator(executionOrder);

      const team = new MultiAgentTeam(orchestrator);

      // Chain: A <-> B (via f1) and B <-> C (via f2)
      // A and C do not directly conflict but B conflicts with both
      team.addAgent({ id: "chainA", role: "implementer", objective: "T-A", fileScope: ["f1.ts"] });
      team.addAgent({ id: "chainB", role: "implementer", objective: "T-B", fileScope: ["f1.ts", "f2.ts"] });
      team.addAgent({ id: "chainC", role: "implementer", objective: "T-C", fileScope: ["f2.ts"] });

      await collectTeamEvents(team.execute(BASE_INPUT));

      expect(team.getResults()).toHaveLength(3);

      // B conflicts with both A and C, so B must be isolated
      const startTimes = new Map<string, number>();
      const endTimes = new Map<string, number>();
      for (let i = 0; i < executionOrder.length; i++) {
        const [action, id] = executionOrder[i].split(":");
        if (action === "start") startTimes.set(id, i);
        if (action === "end") endTimes.set(id, i);
      }

      // chainB must not overlap with chainA or chainC
      const sA = startTimes.get("chainA")!, eA = endTimes.get("chainA")!;
      const sB = startTimes.get("chainB")!, eB = endTimes.get("chainB")!;
      const sC = startTimes.get("chainC")!, eC = endTimes.get("chainC")!;

      expect(eA < sB || eB < sA).toBe(true);
      expect(eC < sB || eB < sC).toBe(true);
    });
  });

  describe("agent message bus", () => {
    it("correctly routes messages between 5 agents", () => {
      const orchestrator = async function* (_spec: AgentSpec): AsyncGenerator<AgenticEvent> {
        yield { type: "execution_complete", finalMessage: "Done", totalIterations: 1, totalToolCalls: 0 };
      };

      const team = new MultiAgentTeam(orchestrator);

      for (let i = 1; i <= 5; i++) {
        team.addAgent({
          id: `agent-${i}`,
          role: "implementer",
          objective: `Task ${i}`,
        });
      }

      // Agent 1 sends to agents 2, 3, 4, 5
      team.sendMessage("agent-1", "agent-2", "Hello from 1 to 2");
      team.sendMessage("agent-1", "agent-3", "Hello from 1 to 3");
      team.sendMessage("agent-1", "agent-4", "Hello from 1 to 4");
      team.sendMessage("agent-1", "agent-5", "Hello from 1 to 5");

      // Agent 3 sends to agent 1
      team.sendMessage("agent-3", "agent-1", "Reply from 3 to 1");

      // Agent 5 sends to agent 2
      team.sendMessage("agent-5", "agent-2", "Cross-message 5 to 2");

      // Verify routing
      const agent1Msgs = team.receiveMessages("agent-1");
      expect(agent1Msgs).toHaveLength(1);
      expect(agent1Msgs[0].content).toContain("Reply from 3 to 1");

      const agent2Msgs = team.receiveMessages("agent-2");
      expect(agent2Msgs).toHaveLength(2);
      expect(agent2Msgs[0].content).toContain("Hello from 1 to 2");
      expect(agent2Msgs[1].content).toContain("Cross-message 5 to 2");

      const agent3Msgs = team.receiveMessages("agent-3");
      expect(agent3Msgs).toHaveLength(1);
      expect(agent3Msgs[0].content).toContain("Hello from 1 to 3");

      // Agent 4 should have exactly 1 message
      expect(team.receiveMessages("agent-4")).toHaveLength(1);

      // Agent 5 should have exactly 1 message
      expect(team.receiveMessages("agent-5")).toHaveLength(1);

      // Second receive should return empty (queue cleared)
      expect(team.receiveMessages("agent-1")).toHaveLength(0);
      expect(team.receiveMessages("agent-2")).toHaveLength(0);
    });

    it("messages received via createTeamContext are correctly routed", () => {
      const orchestrator = async function* (_spec: AgentSpec): AsyncGenerator<AgenticEvent> {
        yield { type: "execution_complete", finalMessage: "Done", totalIterations: 1, totalToolCalls: 0 };
      };

      const team = new MultiAgentTeam(orchestrator);
      team.addAgent({ id: "sender", role: "planner", objective: "Plan" });
      team.addAgent({ id: "receiver", role: "implementer", objective: "Implement" });

      const senderCtx = createTeamContext(team, "sender");
      const receiverCtx = createTeamContext(team, "receiver");

      senderCtx.sendMessage("receiver", "Please implement feature X");

      const received = receiverCtx.receiveMessages();
      expect(received).toHaveLength(1);
      expect(received[0].content).toContain("sender");
      expect(received[0].content).toContain("Please implement feature X");
    });

    it("rejects messages to unknown agents", () => {
      const orchestrator = async function* (_spec: AgentSpec): AsyncGenerator<AgenticEvent> {
        yield { type: "execution_complete", finalMessage: "Done", totalIterations: 1, totalToolCalls: 0 };
      };

      const team = new MultiAgentTeam(orchestrator);
      team.addAgent({ id: "sender", role: "planner", objective: "Plan" });

      expect(() => team.sendMessage("sender", "ghost-agent", "Hello")).toThrow(
        "Cannot send message to unknown agent: ghost-agent",
      );
    });
  });

  describe("concurrency limit enforcement", () => {
    it("respects maxConcurrentAgents=2 with 5 non-conflicting agents", async () => {
      const concurrencyTracker = { current: 0, max: 0 };
      const orchestrator = createConcurrencyTrackingOrchestrator(concurrencyTracker, 30);

      const team = new MultiAgentTeam(orchestrator, { maxConcurrentAgents: 2 });

      for (let i = 0; i < 5; i++) {
        team.addAgent({
          id: `limited-${i}`,
          role: "implementer",
          objective: `Task ${i}`,
          fileScope: [`limited-file-${i}.ts`],
        });
      }

      await collectTeamEvents(team.execute(BASE_INPUT));

      expect(team.getResults()).toHaveLength(5);
      expect(team.getResults().every((r) => r.status === "completed")).toBe(true);

      // Max concurrent should not exceed 2
      expect(concurrencyTracker.max).toBeLessThanOrEqual(2);
    });

    it("respects maxConcurrentAgents=1 (fully sequential)", async () => {
      const concurrencyTracker = { current: 0, max: 0 };
      const orchestrator = createConcurrencyTrackingOrchestrator(concurrencyTracker, 10);

      const team = new MultiAgentTeam(orchestrator, { maxConcurrentAgents: 1 });

      for (let i = 0; i < 3; i++) {
        team.addAgent({
          id: `serial-${i}`,
          role: "implementer",
          objective: `Task ${i}`,
          fileScope: [`serial-file-${i}.ts`],
        });
      }

      await collectTeamEvents(team.execute(BASE_INPUT));

      expect(team.getResults()).toHaveLength(3);
      expect(concurrencyTracker.max).toBe(1);
    });
  });

  describe("error handling under stress", () => {
    it("handles agent failures gracefully while other agents continue", async () => {
      let callCount = 0;

      const mixedOrchestrator = async function* (spec: AgentSpec): AsyncGenerator<AgenticEvent> {
        callCount++;
        yield { type: "iteration_start", iteration: 1, messageCount: 0 };

        if (spec.id === "fail-agent") {
          throw new Error("Agent crashed under stress");
        }

        yield {
          type: "execution_complete",
          finalMessage: `OK: ${spec.id}`,
          totalIterations: 1,
          totalToolCalls: 0,
        };
      };

      const team = new MultiAgentTeam(mixedOrchestrator, { maxConcurrentAgents: 3 });

      team.addAgent({ id: "ok-1", role: "implementer", objective: "T1", fileScope: ["f1.ts"] });
      team.addAgent({ id: "fail-agent", role: "implementer", objective: "T2", fileScope: ["f2.ts"] });
      team.addAgent({ id: "ok-2", role: "implementer", objective: "T3", fileScope: ["f3.ts"] });

      await collectTeamEvents(team.execute(BASE_INPUT));

      const results = team.getResults();
      expect(results).toHaveLength(3);

      const failed = results.find((r) => r.agentId === "fail-agent")!;
      expect(failed.status).toBe("failed");
      expect(failed.summary).toContain("Agent crashed under stress");

      const ok1 = results.find((r) => r.agentId === "ok-1")!;
      const ok2 = results.find((r) => r.agentId === "ok-2")!;
      expect(ok1.status).toBe("completed");
      expect(ok2.status).toBe("completed");
    });

    it("handles all agents failing", async () => {
      const failOrchestrator = async function* (_spec: AgentSpec): AsyncGenerator<AgenticEvent> {
        yield { type: "iteration_start", iteration: 1, messageCount: 0 };
        throw new Error("Everyone fails");
      };

      const team = new MultiAgentTeam(failOrchestrator);
      team.addAgent({ id: "f1", role: "implementer", objective: "T1" });
      team.addAgent({ id: "f2", role: "implementer", objective: "T2" });
      team.addAgent({ id: "f3", role: "implementer", objective: "T3" });

      await collectTeamEvents(team.execute(BASE_INPUT));

      const results = team.getResults();
      expect(results).toHaveLength(3);
      expect(results.every((r) => r.status === "failed")).toBe(true);
    });
  });

  describe("active agents tracking", () => {
    it("reports no active agents after all complete", async () => {
      const orchestrator = async function* (_spec: AgentSpec): AsyncGenerator<AgenticEvent> {
        yield { type: "iteration_start", iteration: 1, messageCount: 0 };
        yield { type: "execution_complete", finalMessage: "Done", totalIterations: 1, totalToolCalls: 0 };
      };

      const team = new MultiAgentTeam(orchestrator);
      for (let i = 0; i < 4; i++) {
        team.addAgent({ id: `active-${i}`, role: "implementer", objective: `T${i}` });
      }

      await collectTeamEvents(team.execute(BASE_INPUT));
      expect(team.getActiveAgents()).toEqual([]);
    });
  });
});
