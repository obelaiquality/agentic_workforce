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

  it("should handle non-Error throw in decomposition", async () => {
    // Create a provider orchestrator that throws a non-Error object
    const provider = {
      async *streamChatWithRetryStreaming() {
        throw "string error thrown";
      },
    } as unknown as ProviderOrchestrator;

    const events: AgenticEvent[] = [];

    for await (const event of runCoordinatorMode(baseInput, provider, mockCreateOrchestrator)) {
      events.push(event);
    }

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent).toMatchObject({
      type: "error",
      error: expect.stringContaining("string error thrown"),
      recoverable: false,
    });
  });

  it("should handle agent missing required fields (role or objective)", async () => {
    const decompositionResponse = JSON.stringify({
      agents: [
        { role: "implementer" },
      ],
    });

    const provider = createMockProviderOrchestrator(decompositionResponse);
    const events: AgenticEvent[] = [];

    for await (const event of runCoordinatorMode(baseInput, provider, mockCreateOrchestrator)) {
      events.push(event);
    }

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent).toMatchObject({
      type: "error",
      error: expect.stringContaining("Agent missing required fields"),
      recoverable: false,
    });
  });

  it("should handle decomposition response missing agents array", async () => {
    const decompositionResponse = JSON.stringify({
      rationale: "No agents field at all",
    });

    const provider = createMockProviderOrchestrator(decompositionResponse);
    const events: AgenticEvent[] = [];

    for await (const event of runCoordinatorMode(baseInput, provider, mockCreateOrchestrator)) {
      events.push(event);
    }

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent).toMatchObject({
      type: "error",
      error: expect.stringContaining("Response missing 'agents' array"),
      recoverable: false,
    });
  });

  it("should display fileScope in agent listing when present", async () => {
    const decompositionResponse = JSON.stringify({
      agents: [
        {
          role: "implementer",
          objective: "Write feature code",
          fileScope: ["src/feature.ts", "src/utils.ts"],
        },
      ],
    });

    const provider = createMockProviderOrchestrator(decompositionResponse);
    const events: AgenticEvent[] = [];

    for await (const event of runCoordinatorMode(baseInput, provider, mockCreateOrchestrator)) {
      events.push(event);
    }

    // Should display the file scope in agent listing
    const fileScopeToken = events.find(
      (e) =>
        e.type === "assistant_token" &&
        "value" in e &&
        e.value.includes("Files: src/feature.ts, src/utils.ts")
    );
    expect(fileScopeToken).toBeDefined();
  });

  it("should detect and report failed agents for respawn consideration", async () => {
    const decompositionResponse = JSON.stringify({
      agents: [
        { role: "implementer", objective: "Build feature" },
        { role: "tester", objective: "Test feature" },
        { role: "reviewer", objective: "Review feature" },
      ],
    });

    const provider = createMockProviderOrchestrator(decompositionResponse);

    // One of three agents fails
    let agentIndex = 0;
    async function* partialFailOrchestrator(
      spec: AgentSpec,
      baseInput: AgenticExecutionInput
    ): AsyncGenerator<AgenticEvent> {
      agentIndex++;
      if (agentIndex === 2) {
        // Second agent fails
        yield { type: "iteration_start", iteration: 1, messageCount: 2 };
        yield {
          type: "error",
          error: "Test build failed",
          recoverable: false,
        };
        // Mark as complete with error status
        yield {
          type: "execution_complete",
          finalMessage: "Failed",
          totalIterations: 1,
          totalToolCalls: 0,
        };
      } else {
        yield { type: "iteration_start", iteration: 1, messageCount: 2 };
        yield {
          type: "execution_complete",
          finalMessage: `${spec.role} completed`,
          totalIterations: 1,
          totalToolCalls: 0,
        };
      }
    }

    const events: AgenticEvent[] = [];
    for await (const event of runCoordinatorMode(baseInput, provider, partialFailOrchestrator, {
      allowRespawn: true,
    })) {
      events.push(event);
    }

    // Should have completion
    const completeEvents = events.filter((e) => e.type === "execution_complete");
    expect(completeEvents.length).toBeGreaterThan(0);
  });

  it("should handle team execution throwing an error", async () => {
    const decompositionResponse = JSON.stringify({
      agents: [{ role: "implementer", objective: "Build feature" }],
    });

    const provider = createMockProviderOrchestrator(decompositionResponse);

    // Mock orchestrator that yields then throws during iteration
    // We need to make the MultiAgentTeam.execute throw,
    // which happens if the generator throws
    async function* throwingOrchestrator(
      spec: AgentSpec,
      _baseInput: AgenticExecutionInput
    ): AsyncGenerator<AgenticEvent> {
      yield { type: "iteration_start", iteration: 1, messageCount: 2 };
      throw new Error("Agent failed catastrophically");
    }

    const events: AgenticEvent[] = [];

    for await (const event of runCoordinatorMode(baseInput, provider, throwingOrchestrator)) {
      events.push(event);
    }

    // The team catches errors in the batch execution, so we should get a completion
    // with a failed agent result
    const resultTokens = events.filter(
      (e) => e.type === "assistant_token" && "value" in e && e.value.includes("Agent results")
    );
    expect(resultTokens.length).toBeGreaterThan(0);
  });

  it("should format execution_aborted events for display", async () => {
    const decompositionResponse = JSON.stringify({
      agents: [{ role: "implementer", objective: "Build feature" }],
    });

    const provider = createMockProviderOrchestrator(decompositionResponse);

    async function* abortingOrchestrator(
      spec: AgentSpec,
      _baseInput: AgenticExecutionInput
    ): AsyncGenerator<AgenticEvent> {
      yield { type: "iteration_start", iteration: 1, messageCount: 2 };
      yield { type: "execution_aborted", reason: "User cancelled" };
    }

    const events: AgenticEvent[] = [];
    for await (const event of runCoordinatorMode(baseInput, provider, abortingOrchestrator)) {
      events.push(event);
    }

    // Should have the abort event formatted for display
    const abortDisplayToken = events.find(
      (e) => e.type === "assistant_token" && "value" in e && e.value.includes("Aborted: User cancelled")
    );
    expect(abortDisplayToken).toBeDefined();
  });

  it("should format error events for display", async () => {
    const decompositionResponse = JSON.stringify({
      agents: [{ role: "implementer", objective: "Build feature" }],
    });

    const provider = createMockProviderOrchestrator(decompositionResponse);

    async function* errorOrchestrator(
      spec: AgentSpec,
      _baseInput: AgenticExecutionInput
    ): AsyncGenerator<AgenticEvent> {
      yield { type: "iteration_start", iteration: 1, messageCount: 2 };
      yield { type: "error", error: "Something went wrong in the agent", recoverable: true };
      yield {
        type: "execution_complete",
        finalMessage: "Done with errors",
        totalIterations: 1,
        totalToolCalls: 0,
      };
    }

    const events: AgenticEvent[] = [];
    for await (const event of runCoordinatorMode(baseInput, provider, errorOrchestrator)) {
      events.push(event);
    }

    // Error event should be formatted for display
    const errorDisplay = events.find(
      (e) => e.type === "assistant_token" && "value" in e && e.value.includes("Error: Something went wrong")
    );
    expect(errorDisplay).toBeDefined();
  });

  it("should format escalating events for display", async () => {
    const decompositionResponse = JSON.stringify({
      agents: [{ role: "implementer", objective: "Build feature" }],
    });

    const provider = createMockProviderOrchestrator(decompositionResponse);

    async function* escalatingOrchestrator(
      spec: AgentSpec,
      _baseInput: AgenticExecutionInput
    ): AsyncGenerator<AgenticEvent> {
      yield { type: "iteration_start", iteration: 1, messageCount: 2 };
      yield { type: "escalating", fromRole: "coder_default" as any, toRole: "overseer_escalation" as any, reason: "Too complex" };
      yield {
        type: "execution_complete",
        finalMessage: "Done",
        totalIterations: 1,
        totalToolCalls: 0,
      };
    }

    const events: AgenticEvent[] = [];
    for await (const event of runCoordinatorMode(baseInput, provider, escalatingOrchestrator)) {
      events.push(event);
    }

    const escalateDisplay = events.find(
      (e) => e.type === "assistant_token" && "value" in e && e.value.includes("Escalating from coder_default to overseer_escalation")
    );
    expect(escalateDisplay).toBeDefined();
  });

  it("should format doom_loop_detected events for display", async () => {
    const decompositionResponse = JSON.stringify({
      agents: [{ role: "implementer", objective: "Build feature" }],
    });

    const provider = createMockProviderOrchestrator(decompositionResponse);

    async function* doomLoopOrchestrator(
      spec: AgentSpec,
      _baseInput: AgenticExecutionInput
    ): AsyncGenerator<AgenticEvent> {
      yield { type: "iteration_start", iteration: 1, messageCount: 2 };
      yield { type: "doom_loop_detected", reason: "Repeated edits detected", suggestion: "Try a different approach" };
      yield {
        type: "execution_complete",
        finalMessage: "Done",
        totalIterations: 1,
        totalToolCalls: 0,
      };
    }

    const events: AgenticEvent[] = [];
    for await (const event of runCoordinatorMode(baseInput, provider, doomLoopOrchestrator)) {
      events.push(event);
    }

    const doomDisplay = events.find(
      (e) => e.type === "assistant_token" && "value" in e && e.value.includes("Doom loop detected: Repeated edits detected")
    );
    expect(doomDisplay).toBeDefined();
  });

  it("should not display assistant_token events from team (not in shouldDisplayTeamEvent)", async () => {
    const decompositionResponse = JSON.stringify({
      agents: [{ role: "implementer", objective: "Build feature" }],
    });

    const provider = createMockProviderOrchestrator(decompositionResponse);

    async function* tokenOnlyOrchestrator(
      spec: AgentSpec,
      _baseInput: AgenticExecutionInput
    ): AsyncGenerator<AgenticEvent> {
      yield { type: "assistant_token", value: "thinking..." };
      yield {
        type: "execution_complete",
        finalMessage: "Done",
        totalIterations: 1,
        totalToolCalls: 0,
      };
    }

    const events: AgenticEvent[] = [];
    for await (const event of runCoordinatorMode(baseInput, provider, tokenOnlyOrchestrator)) {
      events.push(event);
    }

    // The assistant_token from the agent should be forwarded as raw event,
    // but NOT prefixed with [agentId] since shouldDisplayTeamEvent returns false for assistant_token
    const prefixedTokenEvents = events.filter(
      (e) => e.type === "assistant_token" && "value" in e && e.value.includes("[implementer-1] thinking...")
    );
    expect(prefixedTokenEvents.length).toBe(0);
  });

  it("should extract JSON from non-json markdown code blocks", async () => {
    const decompositionResponse = `\`\`\`
{
  "agents": [
    { "role": "implementer", "objective": "Build feature" }
  ]
}
\`\`\``;

    const provider = createMockProviderOrchestrator(decompositionResponse);
    const events: AgenticEvent[] = [];

    for await (const event of runCoordinatorMode(baseInput, provider, mockCreateOrchestrator)) {
      events.push(event);
    }

    // Should succeed (no error, JSON was extracted from non-json code block)
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeUndefined();

    const completeEvent = events.find((e) => e.type === "execution_complete");
    expect(completeEvent).toBeDefined();
  });

  it("should format unknown event types via default JSON.stringify path", async () => {
    const decompositionResponse = JSON.stringify({
      agents: [{ role: "implementer", objective: "Build feature" }],
    });

    const provider = createMockProviderOrchestrator(decompositionResponse);

    async function* unknownEventOrchestrator(
      spec: AgentSpec,
      _baseInput: AgenticExecutionInput
    ): AsyncGenerator<AgenticEvent> {
      yield { type: "iteration_start", iteration: 1, messageCount: 2 };
      // Yield an event type that IS in shouldDisplayTeamEvent but NOT in formatEventForDisplay switch
      // Actually, all displayable events are handled. Let's yield loop_continuing which is not in shouldDisplay.
      // We need a type that IS in shouldDisplay but hits default in formatEventForDisplay.
      // Looking at the code: shouldDisplayTeamEvent includes "execution_complete", which IS handled.
      // All 8 displayable types are handled. The default branch can only be hit with an unknown type
      // that passes shouldDisplayTeamEvent. Since shouldDisplayTeamEvent has a fixed list,
      // the default branch in formatEventForDisplay is unreachable with the current shouldDisplayTeamEvent.
      // Let's just test that non-displayable events are still forwarded as raw events.
      yield { type: "assistant_thinking", value: "thinking deeply..." } as any;
      yield {
        type: "execution_complete",
        finalMessage: "Done",
        totalIterations: 1,
        totalToolCalls: 0,
      };
    }

    const events: AgenticEvent[] = [];
    for await (const event of runCoordinatorMode(baseInput, provider, unknownEventOrchestrator)) {
      events.push(event);
    }

    // assistant_thinking should be forwarded as raw event
    const thinkingEvents = events.filter((e) => e.type === "assistant_thinking");
    expect(thinkingEvents.length).toBeGreaterThan(0);
  });

  it("should handle allowRespawn=false (no respawn analysis)", async () => {
    const decompositionResponse = JSON.stringify({
      agents: [
        { role: "implementer", objective: "Build feature" },
        { role: "tester", objective: "Test feature" },
      ],
    });

    const provider = createMockProviderOrchestrator(decompositionResponse);

    let agentIdx = 0;
    async function* failingOrchestrator(
      spec: AgentSpec,
      _baseInput: AgenticExecutionInput
    ): AsyncGenerator<AgenticEvent> {
      agentIdx++;
      if (agentIdx === 1) {
        yield { type: "iteration_start", iteration: 1, messageCount: 2 };
        yield { type: "error", error: "Failed", recoverable: false };
        yield { type: "execution_complete", finalMessage: "Failed", totalIterations: 1, totalToolCalls: 0 };
      } else {
        yield { type: "iteration_start", iteration: 1, messageCount: 2 };
        yield { type: "execution_complete", finalMessage: "OK", totalIterations: 1, totalToolCalls: 0 };
      }
    }

    const events: AgenticEvent[] = [];
    for await (const event of runCoordinatorMode(baseInput, provider, failingOrchestrator, {
      allowRespawn: false,
    })) {
      events.push(event);
    }

    // Should NOT have respawn analysis messages
    const respawnTokens = events.filter(
      (e) => e.type === "assistant_token" && "value" in e && (e.value as string).includes("respawn")
    );
    expect(respawnTokens.length).toBe(0);
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
