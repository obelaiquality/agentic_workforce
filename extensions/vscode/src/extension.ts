import * as vscode from "vscode";
import { StatusBarProvider } from "./statusBarProvider";

/**
 * Session state stored in extension context.
 */
interface SessionState {
  sessionId: string;
  token: string;
  serverUrl: string;
}

const DEFAULT_SERVER_URL = "http://127.0.0.1:8787";

let statusBar: StatusBarProvider;
let currentSession: SessionState | null = null;

export function activate(context: vscode.ExtensionContext) {
  statusBar = new StatusBarProvider();
  context.subscriptions.push(statusBar);

  // Restore session from global state if available
  const saved = context.globalState.get<SessionState>("agenticWorkforce.session");
  if (saved) {
    currentSession = saved;
    statusBar.setConnected();
  }

  // ── Connect command ────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("agenticWorkforce.connect", async () => {
      if (currentSession) {
        const choice = await vscode.window.showInformationMessage(
          "Already connected to Agentic Workforce. Reconnect?",
          "Reconnect",
          "Cancel",
        );
        if (choice !== "Reconnect") {
          return;
        }
        await disconnectSession(context);
      }

      const serverUrl = await vscode.window.showInputBox({
        prompt: "Agentic Workforce server URL",
        value: DEFAULT_SERVER_URL,
        placeHolder: DEFAULT_SERVER_URL,
      });

      if (!serverUrl) {
        return;
      }

      statusBar.setConnecting();

      try {
        const response = await fetch(`${serverUrl}/api/ide/connect`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientType: "vscode" }),
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Server returned ${response.status}: ${text}`);
        }

        const data = (await response.json()) as {
          sessionId: string;
          token: string;
          clientType: string;
        };

        currentSession = {
          sessionId: data.sessionId,
          token: data.token,
          serverUrl,
        };

        await context.globalState.update("agenticWorkforce.session", currentSession);
        statusBar.setConnected();
        vscode.window.showInformationMessage("Connected to Agentic Workforce");
      } catch (error) {
        statusBar.setDisconnected();
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to connect: ${message}`);
      }
    }),
  );

  // ── Disconnect command ─────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("agenticWorkforce.disconnect", async () => {
      if (!currentSession) {
        vscode.window.showInformationMessage("Not connected to Agentic Workforce");
        return;
      }

      await disconnectSession(context);
      vscode.window.showInformationMessage("Disconnected from Agentic Workforce");
    }),
  );

  // ── Show Panel command (placeholder) ───────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("agenticWorkforce.showPanel", () => {
      if (!currentSession) {
        vscode.window.showWarningMessage(
          "Connect to Agentic Workforce first (Agentic Workforce: Connect)",
        );
        return;
      }

      vscode.window.showInformationMessage(
        `Agentic Workforce panel (session: ${currentSession.sessionId.slice(0, 8)}...)`,
      );
    }),
  );
}

async function disconnectSession(context: vscode.ExtensionContext) {
  if (!currentSession) {
    return;
  }

  try {
    await fetch(
      `${currentSession.serverUrl}/api/ide/disconnect?token=${currentSession.token}`,
      { method: "DELETE" },
    );
  } catch {
    // Server may be unreachable; clean up locally anyway
  }

  currentSession = null;
  await context.globalState.update("agenticWorkforce.session", undefined);
  statusBar.setDisconnected();
}

export function deactivate() {
  // Extension cleanup is handled by VS Code disposing subscriptions
}
