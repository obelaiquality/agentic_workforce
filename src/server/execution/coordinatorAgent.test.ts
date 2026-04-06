import { describe, it, expect, vi, beforeEach } from "vitest";
import { runCoordinatorMode } from "./coordinatorAgent";
import type { AgenticExecutionInput, AgenticEvent } from "../tools/types";
import type { ProviderOrchestrator } from "../services/providerOrchestrator";
import type { AgentSpec } from "./multiAgentTeam";

// ---------------------------------------------------------------------------
// Mock Provider Orchestrator
// ---------------------------------------------------------------------------

function createMockProviderOrchestrator(
  decompositionResponse: string,
  integrationResponse: string = "Task completed successfully."
): ProviderOrchestrator {
  let callCount = 0;

  return {
    async *streamChatWithRetryStreaming(
      runId: string,
      messages: Array<{ role: string; content: string }>,
      tokenCallback: (token: string) => void,
      options?: unknown
    ) {
      callCount++;

      // First call is decomposition, second is integration
      const response = callCount === 1 ? decompositionResponse : integrationResponse;

      // Simulate streaming tokens (yield entire response as one token event)
      yield { type: "token" as const, value: response };

      yield {
        type: "done" as const,
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      };
    },
  } as unknown as ProviderOrchestrator;
}

// ---------------------------------------------------------------------------
// Mock Orchestrator Factory
// ---------------------------------------------------------------------------

async function* mockCreateOrchestrator(
  spec: AgentSpec,
  baseInput: AgenticExecutionInput
): AsyncGenerator<AgenticEvent> {
  yield { type: "iteration_start", iteration: 1, messageCount: 2 };
  yield { type: "tool_use_started", id: "tool1", name: "read_file", input: { path: "test.ts" } };
  yield {
    type: "tool_result",
    id: "tool1",
    name: "read_file",
    result: { type: "success", content: "file content" },
    durationMs: 100,
  };
  yield {
    type: "execution_complete",
    finalMessage: `${spec.role} completed: ${spec.objective}`,
    totalIterations: 1,
    totalToolCalls: 1,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("coordinatorAgent", () => {
  let baseInput: AgenticExecutionInput;

  beforeEach(() => {
    baseInput = {
      runId: "test-run-123",
      repoId: "repo-1",
      ticketId: "ticket-1",
      projectId: "repo-1",
      objective: "Build a new feature",
      worktreePath: "/tmp/worktree",
      actor: "test-user",
      maxIterations: 50,
    };
  });

  it("should decompose task and execute team", async () => {
    const decompositionResponse = JSON.stringify({
      agents: [
        { role: "planner", objective: "Create implementation plan" },
        { role: "implementer", objective: "Write the code", fileScope: ["src/feature.ts"] },
      ],
      rationale: "Simple two-step workflow",
    });

    const provider = createMockProviderOrchestrator(decompositionResponse);
    const events: AgenticEvent[] = [];

    for await (const event of runCoordinatorMode(baseInput, provider, mockCreateOrchestrator)) {
      events.push(event);
    }

    // Should have decomposition announcement
    const decompositionTokens = events.filter((e) => e.type === "assistant_token");
    expect(decompositionTokens.length).toBeGreaterThan(0);

    // Should have execution complete event
    const completeEvent = events.find((e) => e.type === "execution_complete");
    expect(completeEvent).toBeDefined();
    expect(completeEvent).toMatchObject({
      type: "execution_complete",
      totalIterations: expect.any(Number),
      totalToolCalls: expect.any(Number),
    });
  });

  it("should respect maxAgents limit", async () => {
    const decompositionResponse = JSON.stringify({
      agents: [
        { role: "planner", objective: "Plan" },
        { role: "implementer", objective: "Implement" },
        { role: "tester", objective: "Test" },
        { role: "reviewer", objective: "Review" },
        { role: "researcher", objective: "Research" },
        { role: "implementer", objective: "Extra agent (should be cut)" },
      ],
    });

    const provider = createMockProviderOrchestrator(decompositionResponse);
    const events: AgenticEvent[] = [];

    for await (const event of runCoordinatorMode(baseInput, provider, mockCreateOrchestrator, {
      maxAgents: 3,
    })) {
      events.push(event);
    }

    // Check that we got a warning about limiting agents
    const limitWarning = events.find(
      (e) => e.type === "assistant_token" && "value" in e && e.value.includes("limiting to 3")
    );
    expect(limitWarning).toBeDefined();

    // Only 3 agents should have executed (2 iterations each = 6 total)
    const iterationStarts = events.filter((e) => e.type === "iteration_start");
    expect(iterationStarts.length).toBe(3);
  });

  it("should handle decomposition failure", async () => {
    const decompositionResponse = "Not valid JSON";

    const provider = createMockProviderOrchestrator(decompositionResponse);
    const events: AgenticEvent[] = [];

    for await (const event of runCoordinatorMode(baseInput, provider, mockCreateOrchestrator)) {
      events.push(event);
    }

    // Should have error event
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent).toMatchObject({
      type: "error",
      error: expect.stringContaining("Failed to parse decomposition response"),
      recoverable: false,
    });
  });

  it("should handle empty agent list", async () => {
    const decompositionResponse = JSON.stringify({
      agents: [],
      rationale: "Task is too simple",
    });

    const provider = createMockProviderOrchestrator(decompositionResponse);
    const events: AgenticEvent[] = [];

    for await (const event of runCoordinatorMode(baseInput, provider, mockCreateOrchestrator)) {
      events.push(event);
    }

    // Should have error event
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent).toMatchObject({
      type: "error",
      error: expect.stringContaining("failed to decompose task"),
      recoverable: false,
    });
  });

  it("should extract JSON from markdown code blocks", async () => {
    const decompositionResponse = `Here's my analysis:

\`\`\`json
{
  "agents": [
    { "role": "implementer", "objective": "Build feature" }
  ],
  "rationale": "Single agent is sufficient"
}
\`\`\`

Hope this helps!`;

    const provider = createMockProviderOrchestrator(decompositionResponse);
    const events: AgenticEvent[] = [];

    for await (const event of runCoordinatorMode(baseInput, provider, mockCreateOrchestrator)) {
      events.push(event);
    }

    // Should succeed (no error)
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeUndefined();

    // Should have completion
    const completeEvent = events.find((e) => e.type === "execution_complete");
    expect(completeEvent).toBeDefined();
  });

  it("should forward team events to client", async () => {
    const decompositionResponse = JSON.stringify({
      agents: [{ role: "implementer", objective: "Write code" }],
    });

    const provider = createMockProviderOrchestrator(decompositionResponse);
    const events: AgenticEvent[] = [];

    for await (const event of runCoordinatorMode(baseInput, provider, mockCreateOrchestrator)) {
      events.push(event);
    }

    // Should have iteration_start from the agent
    const iterationStart = events.find((e) => e.type === "iteration_start");
    expect(iterationStart).toBeDefined();

    // Should have tool_use_started from the agent
    const toolUse = events.find((e) => e.type === "tool_use_started");
    expect(toolUse).toBeDefined();

    // Should have tool_result from the agent
    const toolResult = events.find((e) => e.type === "tool_result");
    expect(toolResult).toBeDefined();
  });

  it("should respect maxConcurrent option", async () => {
    const decompositionResponse = JSON.stringify({
      agents: [
        { role: "planner", objective: "Plan" },
        { role: "implementer", objective: "Implement" },
        { role: "tester", objective: "Test" },
      ],
    });

    const provider = createMockProviderOrchestrator(decompositionResponse);
    const events: AgenticEvent[] = [];

    // Mock orchestrator that takes longer to run
    async function* slowOrchestrator(
      spec: AgentSpec,
      baseInput: AgenticExecutionInput
    ): AsyncGenerator<AgenticEvent> {
      yield { type: "iteration_start", iteration: 1, messageCount: 2 };
      // Simulate some work
      await new Promise((resolve) => setTimeout(resolve, 10));
      yield {
        type: "execution_complete",
        finalMessage: `${spec.role} completed`,
        totalIterations: 1,
        totalToolCalls: 0,
      };
    }

    for await (const event of runCoordinatorMode(baseInput, provider, slowOrchestrator, {
      maxConcurrent: 2,
    })) {
      events.push(event);
    }

    // Should complete successfully
    const completeEvent = events.find((e) => e.type === "execution_complete");
    expect(completeEvent).toBeDefined();
  });

  it("should include file scopes in agent specs", async () => {
    const decompositionResponse = JSON.stringify({
      agents: [
        {
          role: "implementer",
          objective: "Update feature",
          fileScope: ["src/feature.ts", "src/feature.test.ts"],
        },
      ],
    });

    const provider = createMockProviderOrchestrator(decompositionResponse);
    let capturedSpec: AgentSpec | null = null;

    async function* capturingOrchestrator(
      spec: AgentSpec,
      baseInput: AgenticExecutionInput
    ): AsyncGenerator<AgenticEvent> {
      capturedSpec = spec;
      yield {
        type: "execution_complete",
        finalMessage: "Done",
        totalIterations: 1,
        totalToolCalls: 0,
      };
    }

    const events: AgenticEvent[] = [];
    for await (const event of runCoordinatorMode(baseInput, provider, capturingOrchestrator)) {
      events.push(event);
    }

    expect(capturedSpec).toBeDefined();
    expect(capturedSpec?.fileScope).toEqual(["src/feature.ts", "src/feature.test.ts"]);
  });

  it("should handle team execution errors gracefully", async () => {
    const decompositionResponse = JSON.stringify({
      agents: [{ role: "implementer", objective: "Build feature" }],
    });

    const provider = createMockProviderOrchestrator(decompositionResponse);

    // Mock orchestrator that throws an error
    async function* errorOrchestrator(
      spec: AgentSpec,
      baseInput: AgenticExecutionInput
    ): AsyncGenerator<AgenticEvent> {
      yield { type: "iteration_start", iteration: 1, messageCount: 2 };
      throw new Error("Agent failed catastrophically");
    }

    const events: AgenticEvent[] = [];

    for await (const event of runCoordinatorMode(baseInput, provider, errorOrchestrator)) {
      events.push(event);
    }

    // Team doesn't throw errors, it captures them in results
    // Should have completion event showing the team finished
    const completeEvent = events.find((e) => e.type === "execution_complete");
    expect(completeEvent).toBeDefined();

    // Check that agent results are reported (via assistant_token events)
    const resultTokens = events.filter(
      (e) => e.type === "assistant_token" && "value" in e && e.value.includes("Agent results")
    );
    expect(resultTokens.length).toBeGreaterThan(0);
  });

  it("should generate final summary via LLM", async () => {
    const decompositionResponse = JSON.stringify({
      agents: [{ role: "implementer", objective: "Build feature" }],
    });

    const integrationSummary = "Feature implemented successfully. All tests passing.";

    const provider = createMockProviderOrchestrator(decompositionResponse, integrationSummary);
    const events: AgenticEvent[] = [];

    for await (const event of runCoordinatorMode(baseInput, provider, mockCreateOrchestrator)) {
      events.push(event);
    }

    // Should have the summary in the final completion event
    const completeEvents = events.filter((e) => e.type === "execution_complete");
    // There should be 2 complete events: one from the agent, one from the coordinator
    expect(completeEvents.length).toBe(2);

    // The last one should be from the coordinator with the integration summary
    const coordinatorComplete = completeEvents[completeEvents.length - 1];
    expect((coordinatorComplete as any)?.finalMessage).toBe(integrationSummary);
  });
});
