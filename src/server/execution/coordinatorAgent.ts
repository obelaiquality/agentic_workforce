import type { ModelRole } from "../../shared/contracts";
import type { AgenticEvent, AgenticExecutionInput } from "../tools/types";
import type { ProviderOrchestrator } from "../services/providerOrchestrator";
import { MultiAgentTeam, type AgentSpec } from "./multiAgentTeam";
import { AgenticOrchestrator } from "./agenticOrchestrator";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CoordinatorOptions {
  /** Maximum number of agents to spawn (default: 5) */
  maxAgents?: number;
  /** Maximum number of concurrent agents (default: 3) */
  maxConcurrent?: number;
  /** Allow respawning failed agents (default: true) */
  allowRespawn?: boolean;
  /** Conflict resolution strategy (default: "first_wins") */
  conflictResolution?: "first_wins" | "merge" | "integrator";
}

interface DecompositionResponse {
  agents: Array<{
    role: "planner" | "implementer" | "tester" | "reviewer" | "researcher";
    objective: string;
    fileScope?: string[];
  }>;
  rationale?: string;
}

// ---------------------------------------------------------------------------
// Coordinator Agent
// ---------------------------------------------------------------------------

/**
 * LLM-driven meta-agent that decomposes tasks and delegates to sub-agents.
 *
 * Flow:
 * 1. Use LLM to analyze the task and decide how to decompose it
 * 2. Create a MultiAgentTeam with the agent specs
 * 3. Execute the team and monitor progress
 * 4. Optionally spawn additional agents if needed
 * 5. Integrate and summarize final results
 */
export async function* runCoordinatorMode(
  input: AgenticExecutionInput,
  providerOrchestrator: ProviderOrchestrator,
  createOrchestrator: (spec: AgentSpec, baseInput: AgenticExecutionInput) => AsyncGenerator<AgenticEvent>,
  options?: CoordinatorOptions
): AsyncGenerator<AgenticEvent> {
  const opts = {
    maxAgents: options?.maxAgents ?? 5,
    maxConcurrent: options?.maxConcurrent ?? 3,
    allowRespawn: options?.allowRespawn ?? true,
    conflictResolution: options?.conflictResolution ?? "first_wins" as const,
  };

  yield {
    type: "assistant_token",
    value: "[Coordinator Mode] Analyzing task and planning decomposition...\n",
  };

  // Step 1: Use LLM to decompose the task
  let agentSpecs: AgentSpec[] = [];
  try {
    const decomposition = await decomposeTask(input.objective, providerOrchestrator, input.runId);

    if (decomposition.agents.length === 0) {
      yield {
        type: "error",
        error: "Coordinator failed to decompose task into agents",
        recoverable: false,
      };
      return;
    }

    if (decomposition.agents.length > opts.maxAgents) {
      yield {
        type: "assistant_token",
        value: `[Coordinator] LLM proposed ${decomposition.agents.length} agents, limiting to ${opts.maxAgents}\n`,
      };
      decomposition.agents = decomposition.agents.slice(0, opts.maxAgents);
    }

    // Create agent specs with unique IDs
    agentSpecs = decomposition.agents.map((agent, idx) => ({
      id: `${agent.role}-${idx + 1}`,
      role: agent.role,
      objective: agent.objective,
      fileScope: agent.fileScope,
    }));

    yield {
      type: "assistant_token",
      value: `[Coordinator] Decomposed task into ${agentSpecs.length} agents:\n${agentSpecs
        .map(
          (spec) =>
            `  - ${spec.id} (${spec.role}): ${spec.objective}${
              spec.fileScope?.length ? `\n    Files: ${spec.fileScope.join(", ")}` : ""
            }`
        )
        .join("\n")}\n\n`,
    };

    if (decomposition.rationale) {
      yield {
        type: "assistant_token",
        value: `[Coordinator] Rationale: ${decomposition.rationale}\n\n`,
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    yield {
      type: "error",
      error: `Task decomposition failed: ${message}`,
      recoverable: false,
    };
    return;
  }

  // Step 2: Create the team
  const team = new MultiAgentTeam(
    (spec: AgentSpec) => createOrchestrator(spec, input),
    {
      maxConcurrentAgents: opts.maxConcurrent,
      conflictResolution: opts.conflictResolution,
    }
  );

  for (const spec of agentSpecs) {
    team.addAgent(spec);
  }

  yield {
    type: "assistant_token",
    value: "[Coordinator] Starting team execution...\n\n",
  };

  // Step 3: Execute the team and forward events
  let totalIterations = 0;
  let totalToolCalls = 0;
  const eventCounts = new Map<string, number>();

  try {
    for await (const teamEvent of team.execute(input)) {
      // Track events per agent
      const count = eventCounts.get(teamEvent.agentId) || 0;
      eventCounts.set(teamEvent.agentId, count + 1);

      // Aggregate stats from agent events
      if (teamEvent.event.type === "iteration_start") {
        totalIterations++;
      } else if (teamEvent.event.type === "tool_use_started") {
        totalToolCalls++;
      }

      // Forward team event as assistant token (for visibility)
      if (shouldDisplayTeamEvent(teamEvent.event)) {
        yield {
          type: "assistant_token",
          value: `[${teamEvent.agentId}] ${formatEventForDisplay(teamEvent.event)}\n`,
        };
      }

      // Also forward the raw event (for clients that want detailed tracking)
      yield teamEvent.event;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    yield {
      type: "error",
      error: `Team execution failed: ${message}`,
      recoverable: false,
    };
    return;
  }

  // Step 4: Get results from all agents
  const results = team.getResults();

  yield {
    type: "assistant_token",
    value: "\n[Coordinator] Team execution complete. Agent results:\n",
  };

  for (const result of results) {
    yield {
      type: "assistant_token",
      value: `  - ${result.agentId} (${result.role}): ${result.status}\n    ${result.summary}\n    Files changed: ${result.filesChanged.join(", ") || "none"}\n`,
    };
  }

  // Step 5: Check if respawn is needed
  const failedAgents = results.filter((r) => r.status === "failed");
  if (opts.allowRespawn && failedAgents.length > 0 && failedAgents.length < results.length / 2) {
    yield {
      type: "assistant_token",
      value: `\n[Coordinator] ${failedAgents.length} agent(s) failed. Analyzing if respawn is needed...\n`,
    };

    // Simple heuristic: respawn if less than half failed
    // In a real system, you'd use the LLM to decide whether to respawn
    for (const failed of failedAgents) {
      yield {
        type: "assistant_token",
        value: `[Coordinator] Not respawning ${failed.agentId} (respawn logic not yet implemented)\n`,
      };
    }
  }

  // Step 6: Integrate results using LLM
  const finalSummary = await integrateResults(results, input.objective, providerOrchestrator, input.runId);

  yield {
    type: "assistant_token",
    value: `\n[Coordinator] Final Summary:\n${finalSummary}\n`,
  };

  yield {
    type: "execution_complete",
    finalMessage: finalSummary,
    totalIterations,
    totalToolCalls,
  };
}

// ---------------------------------------------------------------------------
// Helper: Task Decomposition via LLM
// ---------------------------------------------------------------------------

async function decomposeTask(
  objective: string,
  providerOrchestrator: ProviderOrchestrator,
  runId: string
): Promise<DecompositionResponse> {
  const prompt = buildDecompositionPrompt(objective);

  const messages = [
    { role: "system" as const, content: prompt },
    { role: "user" as const, content: objective },
  ];

  let responseText = "";

  const streamEvents = providerOrchestrator.streamChatWithRetryStreaming(
    runId,
    messages,
    (token) => {
      responseText += token;
    },
    {
      modelRole: "overseer_escalation", // Use the most capable model for coordination
      querySource: "execution",
    }
  );

  // Consume the stream
  for await (const event of streamEvents) {
    if (event.type === "token") {
      responseText += event.value;
    }
  }

  // Parse the JSON response
  try {
    // Extract JSON from markdown code blocks if present
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/) || responseText.match(/```\s*([\s\S]*?)\s*```/);
    const jsonText = jsonMatch ? jsonMatch[1] : responseText;

    const parsed = JSON.parse(jsonText.trim()) as DecompositionResponse;

    // Validate the response structure
    if (!Array.isArray(parsed.agents)) {
      throw new Error("Response missing 'agents' array");
    }

    for (const agent of parsed.agents) {
      if (!agent.role || !agent.objective) {
        throw new Error("Agent missing required fields (role, objective)");
      }
    }

    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse decomposition response: ${message}\nResponse: ${responseText.slice(0, 500)}`);
  }
}

function buildDecompositionPrompt(objective: string): string {
  return `You are a task decomposition expert for multi-agent software development workflows.

Your job is to analyze the given objective and break it down into sub-tasks that can be delegated to specialized agents.

Available agent roles:
- **planner**: Analyzes requirements, researches the codebase, creates implementation plans
- **implementer**: Writes code, creates new features, modifies existing functionality
- **tester**: Writes tests, runs verification, ensures code quality
- **reviewer**: Reviews code changes, checks for issues, suggests improvements
- **researcher**: Investigates APIs, reads documentation, explores patterns

Guidelines:
1. **Keep it simple**: Aim for 2-4 agents unless the task is very complex
2. **Clear objectives**: Each agent should have a specific, measurable goal
3. **File scope**: Specify which files each agent should focus on to avoid conflicts
4. **Logical order**: Consider dependencies (e.g., planner before implementer)
5. **Don't over-decompose**: Simple tasks might only need 1-2 agents

Output format (JSON):
\`\`\`json
{
  "agents": [
    {
      "role": "planner|implementer|tester|reviewer|researcher",
      "objective": "Clear, specific objective for this agent",
      "fileScope": ["optional", "list", "of", "file", "paths"]
    }
  ],
  "rationale": "Optional brief explanation of the decomposition strategy"
}
\`\`\`

Analyze the following objective and provide your decomposition:`;
}

// ---------------------------------------------------------------------------
// Helper: Result Integration via LLM
// ---------------------------------------------------------------------------

async function integrateResults(
  results: Array<{ agentId: string; role: string; status: string; summary: string; filesChanged: string[] }>,
  objective: string,
  providerOrchestrator: ProviderOrchestrator,
  runId: string
): Promise<string> {
  const prompt = `You are a coordinator agent reviewing the results from a multi-agent team.

Original objective: ${objective}

Agent results:
${results.map((r) => `- ${r.agentId} (${r.role}): ${r.status}\n  ${r.summary}\n  Files changed: ${r.filesChanged.join(", ") || "none"}`).join("\n")}

Provide a concise final summary (2-3 sentences) that:
1. Confirms whether the objective was achieved
2. Highlights key changes made
3. Notes any issues or incomplete work

Return only the summary text, no preamble.`;

  const messages = [
    { role: "system" as const, content: prompt },
    { role: "user" as const, content: "Summarize the team's results." },
  ];

  let responseText = "";

  const streamEvents = providerOrchestrator.streamChatWithRetryStreaming(
    runId,
    messages,
    (token) => {
      responseText += token;
    },
    {
      modelRole: "overseer_escalation",
      querySource: "execution",
    }
  );

  // Consume the stream
  for await (const event of streamEvents) {
    if (event.type === "token") {
      responseText += event.value;
    }
  }

  return responseText.trim();
}

// ---------------------------------------------------------------------------
// Helper: Event Display Formatting
// ---------------------------------------------------------------------------

function shouldDisplayTeamEvent(event: AgenticEvent): boolean {
  // Don't display every token, only significant events
  return (
    event.type === "iteration_start" ||
    event.type === "tool_use_started" ||
    event.type === "tool_result" ||
    event.type === "execution_complete" ||
    event.type === "execution_aborted" ||
    event.type === "error" ||
    event.type === "escalating" ||
    event.type === "doom_loop_detected"
  );
}

function formatEventForDisplay(event: AgenticEvent): string {
  switch (event.type) {
    case "iteration_start":
      return `Iteration ${event.iteration}`;
    case "tool_use_started":
      return `Using tool: ${event.name}`;
    case "tool_result":
      return `Tool result: ${event.result.type}`;
    case "execution_complete":
      return `Completed in ${event.totalIterations} iterations`;
    case "execution_aborted":
      return `Aborted: ${event.reason}`;
    case "error":
      return `Error: ${event.error.slice(0, 100)}`;
    case "escalating":
      return `Escalating from ${event.fromRole} to ${event.toRole}`;
    case "doom_loop_detected":
      return `Doom loop detected: ${event.reason}`;
    default:
      return JSON.stringify(event).slice(0, 100);
  }
}
