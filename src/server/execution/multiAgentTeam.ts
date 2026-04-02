import type { AgenticEvent, AgenticExecutionInput, ConversationMessage, ToolContext } from "../tools/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentSpec {
  id: string;
  role: "planner" | "implementer" | "tester" | "reviewer" | "researcher";
  objective: string;
  /** Files this agent is responsible for (for conflict detection) */
  fileScope?: string[];
}

export interface TeamEvent {
  type: "agent_event";
  agentId: string;
  event: AgenticEvent;
}

export interface TeamResult {
  agentId: string;
  role: string;
  status: "completed" | "failed" | "aborted";
  summary: string;
  filesChanged: string[];
  iterations: number;
}

export interface MultiAgentTeamOptions {
  /** Maximum number of agents to run concurrently (default: 3) */
  maxConcurrentAgents?: number;
  /** How to resolve file conflicts between agents (default: "first_wins") */
  conflictResolution?: "first_wins" | "merge" | "integrator";
}

// ---------------------------------------------------------------------------
// Multi-Agent Team Coordinator
// ---------------------------------------------------------------------------

export class MultiAgentTeam {
  private agents = new Map<string, AgentSpec>();
  private messageQueues = new Map<string, ConversationMessage[]>();
  private results = new Map<string, TeamResult>();
  private activeAgents = new Set<string>();
  private filesChanged = new Map<string, string>(); // file -> agentId

  constructor(
    private readonly createOrchestrator: (spec: AgentSpec) => AsyncGenerator<AgenticEvent>,
    private readonly options: MultiAgentTeamOptions = {}
  ) {
    this.options.maxConcurrentAgents = options.maxConcurrentAgents || 3;
    this.options.conflictResolution = options.conflictResolution || "first_wins";
  }

  /**
   * Add an agent to the team.
   */
  addAgent(spec: AgentSpec): void {
    if (this.agents.has(spec.id)) {
      throw new Error(`Agent already exists: ${spec.id}`);
    }

    this.agents.set(spec.id, spec);
    this.messageQueues.set(spec.id, []);
  }

  /**
   * Execute all agents in the team.
   * Groups agents by file scope overlap and runs non-overlapping agents in parallel.
   */
  async *execute(baseInput: AgenticExecutionInput): AsyncGenerator<TeamEvent> {
    if (this.agents.size === 0) {
      throw new Error("No agents added to team");
    }

    // Detect file conflicts
    const conflicts = this.detectConflicts();

    // Build execution groups (agents with overlapping files run sequentially)
    const groups = this.buildExecutionGroups(conflicts);

    // Execute groups sequentially, agents within groups in parallel
    for (const group of groups) {
      yield* this.executeGroup(group, baseInput);
    }
  }

  /**
   * Send a message from one agent to another.
   */
  sendMessage(fromId: string, toId: string, content: string): void {
    if (!this.agents.has(toId)) {
      throw new Error(`Cannot send message to unknown agent: ${toId}`);
    }

    const queue = this.messageQueues.get(toId);
    if (queue) {
      queue.push({
        role: "user",
        content: `[Message from agent "${fromId}"]: ${content}`,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Get pending messages for an agent (and clear the queue).
   */
  receiveMessages(agentId: string): ConversationMessage[] {
    const queue = this.messageQueues.get(agentId) || [];
    this.messageQueues.set(agentId, []);
    return queue;
  }

  /**
   * Get results from all completed agents.
   */
  getResults(): TeamResult[] {
    return Array.from(this.results.values());
  }

  /**
   * Get list of active agents.
   */
  getActiveAgents(): string[] {
    return Array.from(this.activeAgents);
  }

  /**
   * Get agent spec by ID.
   */
  getAgent(agentId: string): AgentSpec | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get all agents in the team.
   */
  getAllAgents(): AgentSpec[] {
    return Array.from(this.agents.values());
  }

  // ---------------------------------------------------------------------------
  // Private Methods
  // ---------------------------------------------------------------------------

  /**
   * Detect file scope conflicts between agents.
   */
  private detectConflicts(): Array<{ agent1: string; agent2: string; overlappingFiles: string[] }> {
    const conflicts: Array<{ agent1: string; agent2: string; overlappingFiles: string[] }> = [];
    const agents = Array.from(this.agents.values());

    for (let i = 0; i < agents.length; i++) {
      for (let j = i + 1; j < agents.length; j++) {
        const agent1 = agents[i];
        const agent2 = agents[j];

        const scope1 = new Set(agent1.fileScope || []);
        const scope2 = new Set(agent2.fileScope || []);

        const overlapping = Array.from(scope1).filter((file) => scope2.has(file));

        if (overlapping.length > 0) {
          conflicts.push({
            agent1: agent1.id,
            agent2: agent2.id,
            overlappingFiles: overlapping,
          });
        }
      }
    }

    return conflicts;
  }

  /**
   * Build execution groups based on file conflicts.
   * Agents in the same group can run in parallel (no file overlap).
   * Groups run sequentially.
   */
  private buildExecutionGroups(
    conflicts: Array<{ agent1: string; agent2: string; overlappingFiles: string[] }>
  ): string[][] {
    const agentIds = Array.from(this.agents.keys());

    // If no conflicts, all agents can run in parallel (in one group)
    if (conflicts.length === 0) {
      return [agentIds];
    }

    // Build conflict graph (agent -> conflicting agents)
    const conflictGraph = new Map<string, Set<string>>();
    for (const agentId of agentIds) {
      conflictGraph.set(agentId, new Set());
    }

    for (const conflict of conflicts) {
      conflictGraph.get(conflict.agent1)!.add(conflict.agent2);
      conflictGraph.get(conflict.agent2)!.add(conflict.agent1);
    }

    // Greedy coloring algorithm to group non-conflicting agents
    const groups: string[][] = [];
    const assigned = new Set<string>();

    for (const agentId of agentIds) {
      if (assigned.has(agentId)) continue;

      // Find existing group where this agent doesn't conflict
      let placed = false;
      for (const group of groups) {
        const conflicts = conflictGraph.get(agentId)!;
        const hasConflict = group.some((otherId) => conflicts.has(otherId));

        if (!hasConflict) {
          group.push(agentId);
          assigned.add(agentId);
          placed = true;
          break;
        }
      }

      // If no group found, create new group
      if (!placed) {
        groups.push([agentId]);
        assigned.add(agentId);
      }
    }

    return groups;
  }

  /**
   * Execute a group of agents in parallel.
   */
  private async *executeGroup(agentIds: string[], baseInput: AgenticExecutionInput): AsyncGenerator<TeamEvent> {
    const maxConcurrent = this.options.maxConcurrentAgents || 3;

    // Split into batches to respect concurrency limit
    const batches: string[][] = [];
    for (let i = 0; i < agentIds.length; i += maxConcurrent) {
      batches.push(agentIds.slice(i, i + maxConcurrent));
    }

    for (const batch of batches) {
      yield* this.executeBatch(batch, baseInput);
    }
  }

  /**
   * Execute a batch of agents in parallel (up to maxConcurrentAgents).
   * Uses Promise.race to block until any generator produces a value,
   * eliminating CPU waste from polling.
   */
  private async *executeBatch(agentIds: string[], baseInput: AgenticExecutionInput): AsyncGenerator<TeamEvent> {
    // Create generators for each agent
    const generators = agentIds.map((agentId) => {
      const spec = this.agents.get(agentId)!;
      return {
        agentId,
        spec,
        generator: this.createOrchestrator(spec),
        done: false,
        lastEvent: undefined as AgenticEvent | undefined,
      };
    });

    // Track active agents
    for (const { agentId } of generators) {
      this.activeAgents.add(agentId);
    }

    // Pending promises from each active generator
    type PendingResult = {
      index: number;
      result: IteratorResult<AgenticEvent>;
    };

    // Initialize pending next() calls for all generators
    const pending = new Map<number, Promise<PendingResult>>();

    function requestNext(gen: (typeof generators)[number], index: number) {
      const promise = gen.generator
        .next()
        .then((result) => ({ index, result }))
        .catch((err) => ({ index, result: { done: true, value: err } as IteratorResult<AgenticEvent> & { __error?: unknown } }));
      pending.set(index, promise);
    }

    // Kick off initial .next() for each generator
    for (let i = 0; i < generators.length; i++) {
      requestNext(generators[i], i);
    }

    // Multiplex events using Promise.race
    while (pending.size > 0) {
      const { index, result } = await Promise.race(pending.values());
      const gen = generators[index];

      // Remove the resolved promise from pending
      pending.delete(index);

      // Check if the generator threw (error was caught and wrapped)
      if (result.done && result.value instanceof Error) {
        gen.done = true;
        this.activeAgents.delete(gen.agentId);

        this.results.set(gen.agentId, {
          agentId: gen.agentId,
          role: gen.spec.role,
          status: "failed",
          summary: `Agent failed: ${result.value.message}`,
          filesChanged: [],
          iterations: 0,
        });
        continue;
      }

      if (result.done) {
        gen.done = true;
        this.activeAgents.delete(gen.agentId);
        this.finalizeAgent(gen.agentId, gen.lastEvent);
        continue;
      }

      gen.lastEvent = result.value;

      // Emit event with agent context
      yield {
        type: "agent_event",
        agentId: gen.agentId,
        event: result.value,
      };

      // Track file changes
      this.trackFileChanges(gen.agentId, result.value);

      // Request the next value from this generator
      requestNext(gen, index);
    }
  }

  /**
   * Track file changes from agent events.
   */
  private trackFileChanges(agentId: string, event: AgenticEvent): void {
    // Track tool uses that modify files
    if (event.type === "tool_use_started") {
      const fileModifyingTools = ["write_file", "edit_file", "apply_patch", "bash"];
      if (fileModifyingTools.includes(event.name)) {
        const input = event.input as { path?: string; file?: string };
        const filePath = input.path || input.file;
        if (filePath) {
          this.filesChanged.set(filePath, agentId);
        }
      }
    }
  }

  /**
   * Finalize an agent's execution.
   */
  private finalizeAgent(agentId: string, finalEvent: AgenticEvent | undefined): void {
    const spec = this.agents.get(agentId);
    if (!spec) return;

    let status: "completed" | "failed" | "aborted" = "completed";
    let summary = "Agent completed successfully";
    let iterations = 0;

    if (finalEvent && finalEvent.type === "execution_complete") {
      status = "completed";
      summary = finalEvent.finalMessage;
      iterations = finalEvent.totalIterations;
    } else if (finalEvent && finalEvent.type === "execution_aborted") {
      status = "aborted";
      summary = finalEvent.reason;
    } else if (finalEvent && finalEvent.type === "error") {
      status = "failed";
      summary = finalEvent.error;
    }

    // Get files changed by this agent
    const filesChanged = Array.from(this.filesChanged.entries())
      .filter(([_, agentIdForFile]) => agentIdForFile === agentId)
      .map(([file]) => file);

    this.results.set(agentId, {
      agentId,
      role: spec.role,
      status,
      summary,
      filesChanged,
      iterations,
    });
  }
}

// ---------------------------------------------------------------------------
// Helper: Create team context for agent tool context
// ---------------------------------------------------------------------------

export function createTeamContext(team: MultiAgentTeam, agentId: string) {
  return {
    teamId: "default",
    agentId,
    sendMessage: (toAgent: string, message: string) => {
      team.sendMessage(agentId, toAgent, message);
    },
    receiveMessages: () => {
      return team.receiveMessages(agentId);
    },
  };
}
