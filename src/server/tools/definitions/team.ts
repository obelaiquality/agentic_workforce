import { z } from "zod";
import type { ToolDefinition, ToolContext, ToolResult } from "../types";

/**
 * Multi-agent team collaboration tools.
 * These tools are only available when an agent is part of a multi-agent team.
 */

/**
 * Tool: send_message
 * Send a message to another agent in the team.
 */
export const sendMessageTool: ToolDefinition = {
  name: "send_message",
  description: `Send a message to another agent in your team.

Use this to:
- Coordinate work with other agents
- Request information from specialists
- Share findings or results
- Notify about completed tasks

The recipient agent will see your message in their conversation context.`,

  inputSchema: z.object({
    to_agent: z.string().describe("ID of the agent to send the message to"),
    message: z.string().describe("The message content"),
  }),

  permission: {
    scope: "meta",
    readOnly: false,
  },

  alwaysLoad: false,
  concurrencySafe: true,
  searchHints: ["message", "send", "communicate", "notify", "team", "agent", "coordinate"],

  isEnabled: (ctx) => ctx.teamContext !== undefined,

  execute: async (input, ctx) => {
    if (!ctx.teamContext) {
      return {
        type: "error",
        error: "This tool is only available in multi-agent team context",
      };
    }

    try {
      ctx.teamContext.sendMessage(input.to_agent, input.message);

      return {
        type: "success",
        content: `Message sent to agent "${input.to_agent}": ${input.message}`,
        metadata: {
          recipient: input.to_agent,
          sender: ctx.teamContext.agentId,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        type: "error",
        error: `Failed to send message: ${message}`,
      };
    }
  },
};

/**
 * Tool: list_peers
 * List other agents in the team.
 */
export const listPeersTool: ToolDefinition = {
  name: "list_peers",
  description: `List other agents in your team.

Returns:
- Agent IDs
- Agent roles (planner, implementer, tester, reviewer, researcher)
- Agent objectives
- File scopes (if defined)

Use this to understand who else is working on the project and what they're responsible for.`,

  inputSchema: z.object({}),

  permission: {
    scope: "meta",
    readOnly: true,
  },

  alwaysLoad: false,
  concurrencySafe: true,
  searchHints: ["list", "peers", "agents", "team", "who", "members"],

  isEnabled: (ctx) => ctx.teamContext !== undefined,

  execute: async (input, ctx) => {
    if (!ctx.teamContext) {
      return {
        type: "error",
        error: "This tool is only available in multi-agent team context",
      };
    }

    const allAgents = ctx.teamContext.getAllAgents();
    const activeAgents = new Set(ctx.teamContext.getActiveAgents());
    const peers = allAgents
      .filter((a) => a.id !== ctx.teamContext!.agentId)
      .map((a) => ({
        id: a.id,
        role: a.role,
        objective: a.objective,
        fileScope: a.fileScope || [],
        active: activeAgents.has(a.id),
      }));

    return {
      type: "success",
      content:
        peers.length > 0
          ? `Team members:\n${peers
              .map(
                (p) =>
                  `- ${p.id} (${p.role}, ${p.active ? "active" : "idle"}): ${p.objective}${
                    p.fileScope.length ? `\n  Files: ${p.fileScope.join(", ")}` : ""
                  }`
              )
              .join("\n")}`
          : "No other agents in the team.",
      metadata: { peers },
    };
  },
};

/**
 * Tool: spawn_agent
 * Spawn a new agent for a subtask.
 */
export const spawnAgentTool: ToolDefinition = {
  name: "spawn_agent",
  description: `Spawn a new agent to work on a subtask.

Use this when:
- You need specialized help (e.g., spawn a tester to verify your changes)
- A subtask can be delegated and worked on independently
- You want parallel work on different components

The spawned agent will work independently and can communicate with you via messages.

WARNING: Use sparingly - spawning too many agents can lead to coordination overhead.`,

  inputSchema: z.object({
    objective: z.string().describe("The objective/task for the new agent"),
    role: z.enum(["planner", "implementer", "tester", "reviewer", "researcher"]).describe("Role of the new agent"),
    file_scope: z.array(z.string()).optional().describe("Optional list of files the agent should focus on"),
  }),

  permission: {
    scope: "meta",
    readOnly: false,
    requiresApproval: true, // Spawning agents should be approved
  },

  alwaysLoad: false,
  concurrencySafe: false, // Spawning agents affects global state
  searchHints: ["spawn", "create", "new agent", "delegate", "subtask", "parallel"],

  isEnabled: (ctx) => ctx.teamContext !== undefined,

  execute: async (input, ctx) => {
    if (!ctx.teamContext) {
      return {
        type: "error",
        error: "This tool is only available in multi-agent team context",
      };
    }

    const spec = {
      id: `${input.role}-${Date.now()}`,
      role: input.role,
      objective: input.objective,
      fileScope: input.file_scope,
    };

    ctx.teamContext.addAgent(spec);

    return {
      type: "success",
      content: `Agent spawned:\n  ID: ${spec.id}\n  Role: ${input.role}\n  Objective: ${input.objective}\n  File scope: ${input.file_scope?.join(", ") || "none"}`,
      metadata: {
        agentId: spec.id,
        role: input.role,
        objective: input.objective,
        fileScope: input.file_scope,
      },
    };
  },
};

export const teamTools: ToolDefinition[] = [sendMessageTool, listPeersTool, spawnAgentTool];
