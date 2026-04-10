import * as vscode from "vscode";

/**
 * Manages a status bar item that shows the IDE bridge connection status.
 */
export class StatusBarProvider implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.statusBarItem.command = "agenticWorkforce.showPanel";
    this.setDisconnected();
    this.statusBarItem.show();
  }

  setConnected(): void {
    this.statusBarItem.text = "$(plug) Agentic: Connected";
    this.statusBarItem.tooltip = "Agentic Workforce - Connected (click to open panel)";
    this.statusBarItem.backgroundColor = undefined;
  }

  setDisconnected(): void {
    this.statusBarItem.text = "$(debug-disconnect) Agentic: Disconnected";
    this.statusBarItem.tooltip = "Agentic Workforce - Disconnected (click to connect)";
    this.statusBarItem.command = "agenticWorkforce.connect";
    this.statusBarItem.backgroundColor = undefined;
  }

  setConnecting(): void {
    this.statusBarItem.text = "$(sync~spin) Agentic: Connecting...";
    this.statusBarItem.tooltip = "Agentic Workforce - Connecting...";
    this.statusBarItem.backgroundColor = undefined;
  }

  setError(message?: string): void {
    this.statusBarItem.text = "$(error) Agentic: Error";
    this.statusBarItem.tooltip = `Agentic Workforce - Error${message ? `: ${message}` : ""}`;
    this.statusBarItem.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.errorBackground",
    );
  }

  dispose(): void {
    this.statusBarItem.dispose();
  }
}
