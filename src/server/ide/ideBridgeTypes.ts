import type { AgenticEvent } from "../../shared/contracts";

/**
 * JSON-RPC 2.0 envelope for IDE bridge communication.
 */
export interface IdeBridgeMessage {
  jsonrpc: "2.0";
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * Events pushed from the server to connected IDE clients.
 */
export type IdeBridgeEvent =
  | { type: "agent_event"; payload: AgenticEvent }
  | { type: "file_changed"; path: string; action: "created" | "modified" | "deleted" }
  | { type: "approval_needed"; approvalId: string; toolName: string; toolInput: unknown; message: string }
  | { type: "approval_resolved"; approvalId: string; decision: "approve" | "deny" }
  | { type: "session_status"; status: "connected" | "running" | "idle" | "error" };

/**
 * Represents a connected IDE session.
 */
export interface IdeSession {
  id: string;
  clientType: "vscode" | "jetbrains" | "generic";
  connectedAt: string;
  lastActivityAt: string;
  token: string;
}
