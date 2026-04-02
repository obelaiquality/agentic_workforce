/**
 * Example: Multi-Agent Team Coordination
 *
 * This file demonstrates how to use the MultiAgentTeam system to coordinate
 * multiple agents working on different aspects of a project.
 */

import { MultiAgentTeam, type AgentSpec } from "./multiAgentTeam";
import type { AgenticEvent, AgenticExecutionInput } from "../tools/types";

/**
 * Example 1: Feature Implementation Team
 *
 * Three agents working together:
 * - Planner: Creates architecture and task breakdown
 * - Implementer: Implements the feature
 * - Tester: Writes and runs tests
 */
export async function runFeatureImplementationTeam() {
  // Mock orchestrator for demonstration
  const createMockOrchestrator = (spec: AgentSpec) => {
    return (async function* () {
      yield { type: "iteration_start", iteration: 1, messageCount: 0 } as AgenticEvent;
      yield { type: "assistant_token", value: `Agent ${spec.id} working on: ${spec.objective}` } as AgenticEvent;

      // Simulate some work
      await new Promise((resolve) => setTimeout(resolve, 100));

      yield {
        type: "execution_complete",
        finalMessage: `Agent ${spec.id} completed: ${spec.objective}`,
        totalIterations: 1,
        totalToolCalls: 3,
      } as AgenticEvent;
    })();
  };

  const team = new MultiAgentTeam(createMockOrchestrator, {
    maxConcurrentAgents: 2,
    conflictResolution: "first_wins",
  });

  // Add planner agent (no file scope - planning phase)
  team.addAgent({
    id: "planner",
    role: "planner",
    objective: "Create architecture for user authentication feature",
  });

  // Add implementer agent (works on specific files)
  team.addAgent({
    id: "implementer",
    role: "implementer",
    objective: "Implement user authentication API endpoints",
    fileScope: ["src/api/auth.ts", "src/middleware/auth.ts"],
  });

  // Add tester agent (works on test files)
  team.addAgent({
    id: "tester",
    role: "tester",
    objective: "Write integration tests for authentication",
    fileScope: ["src/__tests__/auth.test.ts"],
  });

  const baseInput: AgenticExecutionInput = {
    runId: "run-001",
    repoId: "repo-001",
    ticketId: "FEAT-123",
    objective: "Implement user authentication",
    worktreePath: "/path/to/repo",
    actor: "system",
  };

  console.log("Starting Feature Implementation Team...\n");

  // Execute team and collect events
  for await (const teamEvent of team.execute(baseInput)) {
    const { agentId, event } = teamEvent;

    if (event.type === "iteration_start") {
      console.log(`[${agentId}] Starting iteration ${event.iteration}`);
    } else if (event.type === "assistant_token") {
      console.log(`[${agentId}] ${event.value}`);
    } else if (event.type === "execution_complete") {
      console.log(`[${agentId}] ✓ ${event.finalMessage}`);
    }
  }

  // Print results
  console.log("\n=== Team Results ===");
  const results = team.getResults();
  for (const result of results) {
    console.log(`\nAgent: ${result.agentId} (${result.role})`);
    console.log(`Status: ${result.status}`);
    console.log(`Summary: ${result.summary}`);
    console.log(`Files changed: ${result.filesChanged.join(", ") || "none"}`);
    console.log(`Iterations: ${result.iterations}`);
  }
}

/**
 * Example 2: Parallel Refactoring Team
 *
 * Multiple implementers working on different modules simultaneously.
 * No file conflicts, so they all run in parallel.
 */
export async function runParallelRefactoringTeam() {
  const createMockOrchestrator = (spec: AgentSpec) => {
    return (async function* () {
      yield { type: "iteration_start", iteration: 1, messageCount: 0 } as AgenticEvent;
      yield { type: "assistant_token", value: `Refactoring ${spec.fileScope?.join(", ")}` } as AgenticEvent;

      await new Promise((resolve) => setTimeout(resolve, 50));

      yield {
        type: "execution_complete",
        finalMessage: `Refactoring complete`,
        totalIterations: 1,
        totalToolCalls: 5,
      } as AgenticEvent;
    })();
  };

  const team = new MultiAgentTeam(createMockOrchestrator, {
    maxConcurrentAgents: 4,
  });

  // Each agent refactors a different module
  const modules = [
    { name: "user-service", files: ["src/services/userService.ts"] },
    { name: "auth-service", files: ["src/services/authService.ts"] },
    { name: "data-layer", files: ["src/db/queries.ts"] },
    { name: "api-routes", files: ["src/api/routes.ts"] },
  ];

  for (const module of modules) {
    team.addAgent({
      id: `refactor-${module.name}`,
      role: "implementer",
      objective: `Refactor ${module.name} to use dependency injection`,
      fileScope: module.files,
    });
  }

  const baseInput: AgenticExecutionInput = {
    runId: "run-002",
    repoId: "repo-001",
    ticketId: "REFACTOR-456",
    objective: "Refactor services to use dependency injection",
    worktreePath: "/path/to/repo",
    actor: "system",
  };

  console.log("Starting Parallel Refactoring Team...\n");
  console.log(`Agents: ${team.getAllAgents().length}`);
  console.log("No file conflicts - agents will run in parallel\n");

  let eventCount = 0;
  for await (const teamEvent of team.execute(baseInput)) {
    eventCount++;
    if (teamEvent.event.type === "execution_complete") {
      console.log(`✓ ${teamEvent.agentId} completed`);
    }
  }

  console.log(`\nProcessed ${eventCount} events`);
  console.log(`All ${team.getResults().length} agents completed successfully`);
}

/**
 * Example 3: Sequential Pipeline with File Conflicts
 *
 * Three agents working on the same file in sequence:
 * 1. Implementer adds new feature
 * 2. Reviewer checks the code
 * 3. Tester adds tests
 */
export async function runSequentialPipelineTeam() {
  const createMockOrchestrator = (spec: AgentSpec) => {
    return (async function* () {
      yield { type: "iteration_start", iteration: 1, messageCount: 0 } as AgenticEvent;
      yield { type: "assistant_token", value: `${spec.role} working...` } as AgenticEvent;

      await new Promise((resolve) => setTimeout(resolve, 50));

      yield {
        type: "execution_complete",
        finalMessage: `${spec.role} completed successfully`,
        totalIterations: 1,
        totalToolCalls: 2,
      } as AgenticEvent;
    })();
  };

  const team = new MultiAgentTeam(createMockOrchestrator, {
    maxConcurrentAgents: 1, // Force sequential
    conflictResolution: "first_wins",
  });

  // All agents work on the same file - must run sequentially
  const sharedFile = "src/features/payment.ts";

  team.addAgent({
    id: "implementer",
    role: "implementer",
    objective: "Add payment validation logic",
    fileScope: [sharedFile],
  });

  team.addAgent({
    id: "reviewer",
    role: "reviewer",
    objective: "Review payment validation implementation",
    fileScope: [sharedFile],
  });

  team.addAgent({
    id: "tester",
    role: "tester",
    objective: "Add unit tests for payment validation",
    fileScope: [sharedFile],
  });

  const baseInput: AgenticExecutionInput = {
    runId: "run-003",
    repoId: "repo-001",
    ticketId: "FEAT-789",
    objective: "Add payment validation with tests",
    worktreePath: "/path/to/repo",
    actor: "system",
  };

  console.log("Starting Sequential Pipeline Team...\n");
  console.log("All agents work on the same file - will run sequentially\n");

  const timeline: Array<{ time: number; agentId: string; event: string }> = [];
  const startTime = Date.now();

  for await (const teamEvent of team.execute(baseInput)) {
    const elapsed = Date.now() - startTime;

    if (teamEvent.event.type === "iteration_start") {
      timeline.push({ time: elapsed, agentId: teamEvent.agentId, event: "started" });
      console.log(`[${elapsed}ms] ${teamEvent.agentId} started`);
    } else if (teamEvent.event.type === "execution_complete") {
      timeline.push({ time: elapsed, agentId: teamEvent.agentId, event: "completed" });
      console.log(`[${elapsed}ms] ${teamEvent.agentId} completed`);
    }
  }

  console.log("\n=== Timeline ===");
  for (const entry of timeline) {
    console.log(`${entry.time.toString().padStart(6)}ms | ${entry.agentId.padEnd(15)} | ${entry.event}`);
  }
}

/**
 * Example 4: Inter-Agent Messaging
 *
 * Demonstrating agents communicating with each other.
 */
export async function runMessagingExample() {
  const team = new MultiAgentTeam(
    (spec: AgentSpec) => {
      return (async function* () {
        yield { type: "iteration_start", iteration: 1, messageCount: 0 } as AgenticEvent;

        // Simulate work
        await new Promise((resolve) => setTimeout(resolve, 50));

        yield {
          type: "execution_complete",
          finalMessage: "Done",
          totalIterations: 1,
          totalToolCalls: 0,
        } as AgenticEvent;
      })();
    },
    { maxConcurrentAgents: 2 }
  );

  team.addAgent({
    id: "researcher",
    role: "researcher",
    objective: "Research authentication best practices",
  });

  team.addAgent({
    id: "implementer",
    role: "implementer",
    objective: "Implement authentication",
  });

  // Demonstrate messaging
  console.log("=== Inter-Agent Messaging Example ===\n");

  // Researcher sends findings to implementer
  team.sendMessage("researcher", "implementer", "Recommendation: Use bcrypt with 12 rounds for password hashing");
  team.sendMessage("researcher", "implementer", "Recommendation: Implement rate limiting on login endpoint");

  // Check implementer's messages
  const messages = team.receiveMessages("implementer");
  console.log(`Implementer received ${messages.length} messages:`);
  for (const msg of messages) {
    console.log(`- ${msg.content}`);
  }

  // Messages are cleared after receiving
  const noMessages = team.receiveMessages("implementer");
  console.log(`\nImplementer has ${noMessages.length} pending messages (cleared after receive)`);
}

// Run examples if this file is executed directly
if (require.main === module) {
  (async () => {
    console.log("=== Multi-Agent Team Examples ===\n");

    console.log("Example 1: Feature Implementation Team");
    console.log("=========================================");
    await runFeatureImplementationTeam();

    console.log("\n\nExample 2: Parallel Refactoring Team");
    console.log("=========================================");
    await runParallelRefactoringTeam();

    console.log("\n\nExample 3: Sequential Pipeline Team");
    console.log("=========================================");
    await runSequentialPipelineTeam();

    console.log("\n\nExample 4: Inter-Agent Messaging");
    console.log("=========================================");
    await runMessagingExample();
  })();
}
