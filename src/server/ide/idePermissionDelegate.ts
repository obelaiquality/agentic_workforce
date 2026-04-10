import crypto from "node:crypto";
import type { IdeBridgeServer } from "./ideBridgeServer";

/**
 * Delegates approval requests to a connected IDE session.
 *
 * When the agentic execution pipeline needs approval for a tool invocation,
 * this delegate sends an "approval_needed" event to the IDE and waits for
 * the user to respond with "approve" or "deny" (or times out).
 */
export class IdePermissionDelegate {
  private bridgeServer: IdeBridgeServer;

  constructor(bridgeServer: IdeBridgeServer) {
    this.bridgeServer = bridgeServer;
  }

  /**
   * Request approval from a connected IDE session.
   *
   * Sends an `approval_needed` event and waits for a matching
   * `approval_resolved` response. Returns "timeout" if no response
   * arrives within the specified timeout.
   *
   * @param params.sessionId   - Target IDE session
   * @param params.toolName    - Name of the tool requesting approval
   * @param params.toolInput   - Input arguments for the tool
   * @param params.message     - Human-readable description of the action
   * @param params.timeoutMs   - Max wait time (default 30 seconds)
   */
  async requestApproval(params: {
    sessionId: string;
    toolName: string;
    toolInput: unknown;
    message: string;
    timeoutMs?: number;
  }): Promise<"approve" | "deny" | "timeout"> {
    const approvalId = crypto.randomUUID();
    const timeoutMs = params.timeoutMs ?? 30_000;

    // Send the approval request to the IDE
    this.bridgeServer.sendToSession(params.sessionId, {
      type: "approval_needed",
      approvalId,
      toolName: params.toolName,
      toolInput: params.toolInput,
      message: params.message,
    });

    // Wait for a response or timeout
    return new Promise<"approve" | "deny" | "timeout">((resolve) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.bridgeServer.removeApprovalCallback(approvalId);
          resolve("timeout");
        }
      }, timeoutMs);

      this.bridgeServer.onApprovalDecision(approvalId, (decision) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(decision);
        }
      });
    });
  }

  /**
   * Check if any IDE session is available for approval delegation.
   */
  hasConnectedIde(): boolean {
    return this.bridgeServer.hasConnectedSessions();
  }
}
