import { z } from "zod";
import type { ToolDefinition } from "../types";
import { getSubtaskService } from "./taskDecomposition";

const claimSubtaskSchema = z.object({
  subtask_id: z.string().describe("ID of the subtask to claim"),
  expiry_ms: z
    .number()
    .optional()
    .describe("Claim expiry in milliseconds (default: 300000 = 5 minutes)"),
});

export const claimSubtaskTool: ToolDefinition<z.infer<typeof claimSubtaskSchema>> = {
  name: "claim_subtask",
  description: `Claim a subtask for the calling agent, preventing other agents from working on it concurrently.

Use when:
- You are about to start work on a subtask in a multi-agent team
- You want to ensure no other agent picks up the same subtask

Claims expire after 5 minutes by default. Reclaim before expiry to extend.
If a claim has expired, any agent can re-claim the subtask.`,
  inputSchema: claimSubtaskSchema,
  permission: { scope: "meta", readOnly: false },
  alwaysLoad: true,
  concurrencySafe: true,
  searchHints: ["claim", "lock", "reserve", "subtask", "agent"],

  async execute(input, ctx) {
    const agentId = ctx.teamContext?.agentId ?? ctx.actor;
    const result = await getSubtaskService().claimSubtask({
      parentTicketId: ctx.ticketId,
      subtaskId: input.subtask_id,
      agentId,
      expiryMs: input.expiry_ms,
    });

    if (!result.success) {
      const detail =
        result.reason === "not_found"
          ? `Subtask "${input.subtask_id}" not found`
          : `Subtask "${input.subtask_id}" is already claimed by ${result.subtask?.claimedBy}`;
      return { type: "error", error: detail };
    }

    return {
      type: "success",
      content: `Subtask "${result.subtask!.title}" (${input.subtask_id}) claimed by ${agentId}. Claim expires at ${result.subtask!.claimExpiry}.`,
      metadata: {
        subtaskId: input.subtask_id,
        claimedBy: agentId,
        claimExpiry: result.subtask!.claimExpiry,
        version: result.subtask!.version,
      },
    };
  },
};

const releaseSubtaskSchema = z.object({
  subtask_id: z.string().describe("ID of the subtask to release"),
});

export const releaseSubtaskTool: ToolDefinition<z.infer<typeof releaseSubtaskSchema>> = {
  name: "release_subtask",
  description: `Release a previously claimed subtask, allowing other agents to claim it.

Use when:
- You have finished working on a subtask
- You need to hand off a subtask to another agent
- You can no longer continue work on the subtask

Only the claiming agent can release a subtask (unless the claim has expired).`,
  inputSchema: releaseSubtaskSchema,
  permission: { scope: "meta", readOnly: false },
  alwaysLoad: true,
  concurrencySafe: true,
  searchHints: ["release", "unlock", "unclaim", "subtask", "agent"],

  async execute(input, ctx) {
    const agentId = ctx.teamContext?.agentId ?? ctx.actor;
    const subtask = await getSubtaskService().releaseClaimSubtask({
      parentTicketId: ctx.ticketId,
      subtaskId: input.subtask_id,
      agentId,
    });

    if (!subtask) {
      return {
        type: "error",
        error: `Cannot release subtask "${input.subtask_id}": not found or claimed by another agent`,
      };
    }

    return {
      type: "success",
      content: `Subtask "${subtask.title}" (${input.subtask_id}) released by ${agentId}.`,
      metadata: {
        subtaskId: input.subtask_id,
        releasedBy: agentId,
        version: subtask.version,
      },
    };
  },
};

export const taskClaimTools: ToolDefinition[] = [claimSubtaskTool, releaseSubtaskTool];
