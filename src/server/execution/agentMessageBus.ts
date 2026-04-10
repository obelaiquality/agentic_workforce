import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MessageType =
  | "FileUpdate"
  | "DiscoveryResult"
  | "BlockageReport"
  | "ReviewRequest"
  | "Custom";

export interface AgentMessage {
  id: string;
  type: MessageType;
  from: string;       // Agent ID
  to: string | "*";   // Target agent ID or "*" for broadcast
  payload: unknown;
  priority: "low" | "normal" | "high";
  timestamp: string;
}

/** Maximum messages per agent queue before FIFO eviction */
const MAX_QUEUE_SIZE = 100;

/** Priority ordering for sorting (higher = delivered first) */
const PRIORITY_ORDER: Record<AgentMessage["priority"], number> = {
  high: 3,
  normal: 2,
  low: 1,
};

// ---------------------------------------------------------------------------
// Agent Message Bus
// ---------------------------------------------------------------------------

/**
 * In-process message bus for inter-agent communication.
 *
 * Supports point-to-point messaging, broadcast, typed subscriptions,
 * priority ordering, and bounded queues with FIFO eviction.
 */
export class AgentMessageBus {
  private queues = new Map<string, AgentMessage[]>();
  private subscribers = new Map<
    string,
    Map<MessageType, Array<(msg: AgentMessage) => void>>
  >();

  /**
   * Send a message to a specific agent or broadcast to all.
   * Returns the generated message ID.
   */
  send(message: Omit<AgentMessage, "id" | "timestamp">): string {
    const id = randomUUID();
    const fullMessage: AgentMessage = {
      ...message,
      id,
      timestamp: new Date().toISOString(),
    };

    if (message.to === "*") {
      // Broadcast: enqueue for all registered agents (except sender)
      for (const agentId of this.queues.keys()) {
        if (agentId !== message.from) {
          this.enqueue(agentId, fullMessage);
        }
      }

      // Notify all subscribers
      for (const [agentId, typeSubs] of this.subscribers) {
        if (agentId === message.from) continue;
        const handlers = typeSubs.get(message.type);
        if (handlers) {
          for (const handler of handlers) {
            handler(fullMessage);
          }
        }
      }
    } else {
      // Point-to-point
      this.enqueue(message.to, fullMessage);

      // Notify subscribers for the target agent
      const typeSubs = this.subscribers.get(message.to);
      if (typeSubs) {
        const handlers = typeSubs.get(message.type);
        if (handlers) {
          for (const handler of handlers) {
            handler(fullMessage);
          }
        }
      }
    }

    return id;
  }

  /**
   * Subscribe to messages of a specific type for a given agent.
   * Returns an unsubscribe function.
   */
  subscribe(
    agentId: string,
    type: MessageType,
    handler: (msg: AgentMessage) => void,
  ): () => void {
    if (!this.subscribers.has(agentId)) {
      this.subscribers.set(agentId, new Map());
    }

    const typeSubs = this.subscribers.get(agentId)!;
    if (!typeSubs.has(type)) {
      typeSubs.set(type, []);
    }

    const handlers = typeSubs.get(type)!;
    handlers.push(handler);

    // Ensure the agent has a queue
    if (!this.queues.has(agentId)) {
      this.queues.set(agentId, []);
    }

    // Return unsubscribe function
    return () => {
      const idx = handlers.indexOf(handler);
      if (idx >= 0) {
        handlers.splice(idx, 1);
      }
    };
  }

  /**
   * Get queued messages for an agent, optionally filtered by type.
   * Messages are returned in priority order (high first).
   * Does not remove messages from the queue.
   */
  getMessages(agentId: string, type?: MessageType): AgentMessage[] {
    const queue = this.queues.get(agentId) || [];
    const filtered = type ? queue.filter((m) => m.type === type) : [...queue];

    // Sort by priority (high → normal → low), then by timestamp (oldest first)
    filtered.sort((a, b) => {
      const priorityDiff = PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return a.timestamp.localeCompare(b.timestamp);
    });

    return filtered;
  }

  /**
   * Clear all messages for an agent.
   */
  clearMessages(agentId: string): void {
    this.queues.set(agentId, []);
  }

  /**
   * Broadcast a message from one agent to all other agents.
   * Convenience wrapper around send() with to="*".
   */
  broadcast(
    from: string,
    type: MessageType,
    payload: unknown,
    priority: AgentMessage["priority"] = "normal",
  ): void {
    this.send({ from, to: "*", type, payload, priority });
  }

  /**
   * Register an agent so it can receive messages.
   * Idempotent — safe to call multiple times.
   */
  registerAgent(agentId: string): void {
    if (!this.queues.has(agentId)) {
      this.queues.set(agentId, []);
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Enqueue a message for an agent, enforcing MAX_QUEUE_SIZE with FIFO eviction.
   */
  private enqueue(agentId: string, message: AgentMessage): void {
    if (!this.queues.has(agentId)) {
      this.queues.set(agentId, []);
    }

    const queue = this.queues.get(agentId)!;
    queue.push(message);

    // FIFO eviction: remove oldest messages if over limit
    while (queue.length > MAX_QUEUE_SIZE) {
      queue.shift();
    }
  }
}
