import type { HookEventType, HookType, HookRecord } from "../../shared/contracts";

export interface HookExecutionInput {
  hookId: string;
  eventType: HookEventType;
  eventPayload: Record<string, unknown>;
  context: {
    runId: string;
    projectId: string;
    ticketId?: string;
    stage: string;
  };
}

export interface HookExecutionOutput {
  success: boolean;
  systemMessage?: string;
  continue: boolean;
  permissionDecision?: "allow" | "deny" | "approval_required";
  updatedInput?: Record<string, unknown>;
  error?: string;
  durationMs: number;
}
