import { spawn, ChildProcess } from "node:child_process";
import path from "node:path";
import { createLogger } from "../logger";
import { getServerConfigByLanguage, getServerConfigForFile, LSP_SERVER_CONFIGS, isLspCommandAvailable } from "./serverConfigs";

const log = createLogger("LSP");

// ---------------------------------------------------------------------------
// LSP Types
// ---------------------------------------------------------------------------

export interface LSPDiagnostic {
  file: string;
  line: number;
  character: number;
  severity: "error" | "warning" | "info" | "hint";
  message: string;
  source?: string;
  code?: string | number;
}

export interface LSPLocation {
  file: string;
  line: number;
  character: number;
}

export interface LSPSymbol {
  name: string;
  kind: string;
  file: string;
  line: number;
  character: number;
}

export interface LSPServerStatusSnapshot {
  language: string;
  command: string[];
  extensions: string[];
  capabilities: {
    diagnostics?: boolean;
    definition?: boolean;
    references?: boolean;
    documentSymbol?: boolean;
  };
  binaryAvailable: boolean;
  running: boolean;
  initialized: boolean;
  worktreePath: string | null;
  processId: number | null;
}

// ---------------------------------------------------------------------------
// LSP JSON-RPC 2.0 Types
// ---------------------------------------------------------------------------

interface LSPRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

interface LSPResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface LSPNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

// ---------------------------------------------------------------------------
// Server State
// ---------------------------------------------------------------------------

interface ServerState {
  process: ChildProcess;
  requestId: number;
  pending: Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>;
  buffer: string;
  worktreePath: string;
  initialized: boolean;
  diagnosticsMap: Map<string, LSPDiagnostic[]>;
}

// ---------------------------------------------------------------------------
// LSP Client
// ---------------------------------------------------------------------------

export class LSPClient {
  private servers = new Map<string, ServerState>();
  fileVersions = new Map<string, number>();

  /**
   * Start a language server for a given language.
   */
  async startServer(language: string, worktreePath: string): Promise<void> {
    if (this.servers.has(language)) {
      // Server already running
      return;
    }

    const config = getServerConfigByLanguage(language);
    if (!config) {
      throw new Error(`No LSP server config found for language: ${language}`);
    }

    const [command, ...args] = config.command;
    const proc = spawn(command, args, {
      cwd: worktreePath,
      env: { ...process.env, ...config.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const state: ServerState = {
      process: proc,
      requestId: 0,
      pending: new Map(),
      buffer: "",
      worktreePath,
      initialized: false,
      diagnosticsMap: new Map(),
    };

    this.servers.set(language, state);

    // Handle stdout (LSP messages)
    proc.stdout?.on("data", (chunk: Buffer) => {
      this.handleServerOutput(language, chunk.toString("utf8"));
    });

    // Handle stderr (logs)
    proc.stderr?.on("data", (chunk: Buffer) => {
      // Log server errors silently (could be verbose debug output)
      log.error(`[${language}] ${chunk.toString("utf8")}`);
    });

    // Handle process exit
    proc.on("exit", (code, signal) => {
      log.error(`[${language}] Server exited with code ${code}, signal ${signal}`);
      this.cleanupServer(language, new Error(`Server crashed (exit code ${code})`));
    });

    proc.on("error", (err) => {
      log.error(`[${language}] Server error:`, err);
      this.cleanupServer(language, err);
    });

    // Initialize the server
    await this.initialize(language, worktreePath);
  }

  /**
   * Stop a language server.
   */
  async stopServer(language: string): Promise<void> {
    const state = this.servers.get(language);
    if (!state) return;

    // Send shutdown request
    try {
      await this.request(language, "shutdown", null);
      await this.notify(language, "exit", null);
    } catch (err) {
      // Ignore errors during shutdown
    }

    this.cleanupServer(language);
  }

  /**
   * Get diagnostics for a file.
   * First ensures the file is opened in the server.
   */
  async getDiagnostics(filePath: string): Promise<LSPDiagnostic[]> {
    const config = getServerConfigForFile(filePath);
    if (!config) {
      return [];
    }

    const state = this.servers.get(config.language);
    if (!state || !state.initialized) {
      return [];
    }

    // Ensure file is opened
    await this.ensureFileOpen(filePath);

    // Return cached diagnostics (updated via publishDiagnostics notification)
    return state.diagnosticsMap.get(filePath) || [];
  }

  /**
   * Get definition location for a symbol at a position.
   */
  async getDefinition(filePath: string, line: number, character: number): Promise<LSPLocation | null> {
    const config = getServerConfigForFile(filePath);
    if (!config) {
      return null;
    }

    const state = this.servers.get(config.language);
    if (!state || !state.initialized) {
      return null;
    }

    await this.ensureFileOpen(filePath);

    const result = await this.request(config.language, "textDocument/definition", {
      textDocument: { uri: this.fileToUri(filePath) },
      position: { line, character },
    });

    return this.parseLocation(result);
  }

  /**
   * Get all references to a symbol at a position.
   */
  async getReferences(filePath: string, line: number, character: number): Promise<LSPLocation[]> {
    const config = getServerConfigForFile(filePath);
    if (!config) {
      return [];
    }

    const state = this.servers.get(config.language);
    if (!state || !state.initialized) {
      return [];
    }

    await this.ensureFileOpen(filePath);

    const result = await this.request(config.language, "textDocument/references", {
      textDocument: { uri: this.fileToUri(filePath) },
      position: { line, character },
      context: { includeDeclaration: true },
    });

    return this.parseLocations(result);
  }

  /**
   * Get document symbols (functions, classes, etc.) for a file.
   */
  async getDocumentSymbols(filePath: string): Promise<LSPSymbol[]> {
    const config = getServerConfigForFile(filePath);
    if (!config) {
      return [];
    }

    const state = this.servers.get(config.language);
    if (!state || !state.initialized) {
      return [];
    }

    await this.ensureFileOpen(filePath);

    const result = await this.request(config.language, "textDocument/documentSymbol", {
      textDocument: { uri: this.fileToUri(filePath) },
    });

    return this.parseSymbols(result, filePath);
  }

  /**
   * Notify the LSP server that a file's content has changed.
   * Sends a textDocument/didChange notification with full content replacement.
   * No-op when no LSP server is running for the file's language.
   */
  async notifyFileChanged(filePath: string, newContent: string): Promise<void> {
    const config = getServerConfigForFile(filePath);
    if (!config) return;

    const state = this.servers.get(config.language);
    if (!state || !state.initialized) return;

    const uri = this.fileToUri(filePath);
    const currentVersion = (this.fileVersions.get(uri) ?? 0) + 1;
    this.fileVersions.set(uri, currentVersion);

    await this.notify(config.language, "textDocument/didChange", {
      textDocument: { uri, version: currentVersion },
      contentChanges: [{ text: newContent }],
    });
  }

  /**
   * Notify the LSP server that a file was saved.
   * Only sends if the file was previously opened (has a tracked version).
   */
  async notifyFileSaved(filePath: string): Promise<void> {
    const config = getServerConfigForFile(filePath);
    if (!config) return;

    const state = this.servers.get(config.language);
    if (!state || !state.initialized) return;

    const uri = this.fileToUri(filePath);

    // Only send didSave if the file was previously opened/changed
    if (!this.fileVersions.has(uri)) return;

    await this.notify(config.language, "textDocument/didSave", {
      textDocument: { uri },
    });
  }

  /**
   * Stop all running servers.
   */
  async stopAll(): Promise<void> {
    const languages = Array.from(this.servers.keys());
    await Promise.all(languages.map((lang) => this.stopServer(lang)));
  }

  /**
   * Get status for every supported language server.
   */
  async getServerStatuses(): Promise<LSPServerStatusSnapshot[]> {
    return Promise.all(
      LSP_SERVER_CONFIGS.map(async (config) => {
        const state = this.servers.get(config.language);
        return {
          language: config.language,
          command: config.command,
          extensions: config.extensions,
          capabilities: config.capabilities ?? {},
          binaryAvailable: await isLspCommandAvailable(config.command[0]),
          running: Boolean(state),
          initialized: state?.initialized ?? false,
          worktreePath: state?.worktreePath ?? null,
          processId: state?.process.pid ?? null,
        };
      })
    );
  }

  // ---------------------------------------------------------------------------
  // Private Methods
  // ---------------------------------------------------------------------------

  /**
   * Initialize the LSP server with handshake.
   */
  private async initialize(language: string, worktreePath: string): Promise<void> {
    const result = await this.request(language, "initialize", {
      processId: process.pid,
      rootUri: this.fileToUri(worktreePath),
      capabilities: {
        textDocument: {
          synchronization: {
            didOpen: true,
            didChange: true,
            didSave: true,
          },
          diagnostic: {},
          definition: { linkSupport: true },
          references: {},
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
        },
      },
    });

    const state = this.servers.get(language);
    if (state) {
      state.initialized = true;
    }

    // Send initialized notification
    await this.notify(language, "initialized", {});
  }

  /**
   * Ensure a file is opened in the language server.
   */
  private async ensureFileOpen(filePath: string): Promise<void> {
    const config = getServerConfigForFile(filePath);
    if (!config) return;

    // Check if already opened (simplified: we don't track open files, just send didOpen)
    // In a production system, you'd track which files are open
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(filePath, "utf8");

    await this.notify(config.language, "textDocument/didOpen", {
      textDocument: {
        uri: this.fileToUri(filePath),
        languageId: config.language,
        version: 1,
        text: content,
      },
    });
  }

  /**
   * Send a JSON-RPC notification (no response expected).
   */
  private async notify(language: string, method: string, params: unknown): Promise<void> {
    const state = this.servers.get(language);
    if (!state) {
      throw new Error(`Language server not running: ${language}`);
    }

    const notification: LSPNotification = {
      jsonrpc: "2.0",
      method,
      params,
    };

    this.sendMessage(state, notification);
  }

  /**
   * Send a JSON-RPC request and await response.
   */
  private async request(language: string, method: string, params: unknown): Promise<unknown> {
    const state = this.servers.get(language);
    if (!state) {
      throw new Error(`Language server not running: ${language}`);
    }

    const id = ++state.requestId;
    const request: LSPRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      state.pending.set(id, { resolve, reject });
      this.sendMessage(state, request);

      // Add timeout
      setTimeout(() => {
        if (state.pending.has(id)) {
          state.pending.delete(id);
          reject(new Error(`LSP request timeout: ${method}`));
        }
      }, 30000); // 30 second timeout
    });
  }

  /**
   * Send a JSON-RPC message to the server.
   */
  private sendMessage(state: ServerState, message: LSPRequest | LSPNotification): void {
    const content = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(content, "utf8")}\r\n\r\n`;
    state.process.stdin?.write(header + content);
  }

  /**
   * Handle output from the language server.
   */
  private handleServerOutput(language: string, chunk: string): void {
    const state = this.servers.get(language);
    if (!state) return;

    state.buffer += chunk;

    // Parse messages (can have multiple in buffer)
    while (true) {
      const headerMatch = state.buffer.match(/Content-Length: (\d+)\r\n\r\n/);
      if (!headerMatch) break;

      const contentLength = parseInt(headerMatch[1], 10);
      const headerEnd = headerMatch.index! + headerMatch[0].length;
      const contentEnd = headerEnd + contentLength;

      if (state.buffer.length < contentEnd) {
        // Not enough data yet
        break;
      }

      const content = state.buffer.substring(headerEnd, contentEnd);
      state.buffer = state.buffer.substring(contentEnd);

      try {
        const message = JSON.parse(content);
        this.handleMessage(language, message, state);
      } catch (err) {
        log.error(`[${language}] Failed to parse message:`, err);
      }
    }
  }

  /**
   * Handle a parsed LSP message.
   */
  private handleMessage(language: string, message: unknown, state: ServerState): void {
    const msg = message as { id?: number; method?: string; result?: unknown; error?: unknown; params?: unknown };

    // Response to a request
    if (msg.id !== undefined && msg.result !== undefined) {
      const pending = state.pending.get(msg.id);
      if (pending) {
        state.pending.delete(msg.id);
        pending.resolve(msg.result);
      }
    } else if (msg.id !== undefined && msg.error !== undefined) {
      const pending = state.pending.get(msg.id);
      if (pending) {
        state.pending.delete(msg.id);
        const err = msg.error as { message?: string };
        pending.reject(new Error(err.message || "LSP request failed"));
      }
    }
    // Notification from server
    else if (msg.method === "textDocument/publishDiagnostics") {
      this.handleDiagnostics(state, msg.params);
    }
  }

  /**
   * Handle diagnostics notification from server.
   */
  private handleDiagnostics(state: ServerState, params: unknown): void {
    const p = params as { uri?: string; diagnostics?: unknown[] };
    if (!p.uri || !Array.isArray(p.diagnostics)) return;

    const filePath = this.uriToFile(p.uri);
    const diagnostics: LSPDiagnostic[] = p.diagnostics.map((d: any) => ({
      file: filePath,
      line: d.range?.start?.line ?? 0,
      character: d.range?.start?.character ?? 0,
      severity: this.mapSeverity(d.severity),
      message: d.message || "",
      source: d.source,
      code: d.code,
    }));

    state.diagnosticsMap.set(filePath, diagnostics);
  }

  /**
   * Map LSP severity numbers to our string types.
   */
  private mapSeverity(severity?: number): "error" | "warning" | "info" | "hint" {
    switch (severity) {
      case 1:
        return "error";
      case 2:
        return "warning";
      case 3:
        return "info";
      case 4:
        return "hint";
      default:
        return "info";
    }
  }

  /**
   * Parse a single location from LSP result.
   */
  private parseLocation(result: unknown): LSPLocation | null {
    if (!result) return null;

    // Can be a single Location or an array
    const loc = Array.isArray(result) ? result[0] : result;
    if (!loc || typeof loc !== "object") return null;

    const l = loc as { uri?: string; range?: { start?: { line?: number; character?: number } } };
    if (!l.uri || !l.range?.start) return null;

    return {
      file: this.uriToFile(l.uri),
      line: l.range.start.line ?? 0,
      character: l.range.start.character ?? 0,
    };
  }

  /**
   * Parse an array of locations from LSP result.
   */
  private parseLocations(result: unknown): LSPLocation[] {
    if (!Array.isArray(result)) return [];

    return result
      .map((item) => {
        const loc = this.parseLocation(item);
        return loc;
      })
      .filter((loc): loc is LSPLocation => loc !== null);
  }

  /**
   * Parse document symbols from LSP result.
   */
  private parseSymbols(result: unknown, filePath: string): LSPSymbol[] {
    if (!Array.isArray(result)) return [];

    const symbols: LSPSymbol[] = [];

    const parseSymbol = (sym: any): void => {
      if (!sym || typeof sym !== "object") return;

      const range = sym.range || sym.location?.range;
      if (sym.name && range?.start) {
        symbols.push({
          name: sym.name,
          kind: this.mapSymbolKind(sym.kind),
          file: filePath,
          line: range.start.line ?? 0,
          character: range.start.character ?? 0,
        });
      }

      // Recursively parse children
      if (Array.isArray(sym.children)) {
        sym.children.forEach(parseSymbol);
      }
    };

    result.forEach(parseSymbol);
    return symbols;
  }

  /**
   * Map LSP symbol kind numbers to strings.
   */
  private mapSymbolKind(kind?: number): string {
    const kinds = [
      "File",
      "Module",
      "Namespace",
      "Package",
      "Class",
      "Method",
      "Property",
      "Field",
      "Constructor",
      "Enum",
      "Interface",
      "Function",
      "Variable",
      "Constant",
      "String",
      "Number",
      "Boolean",
      "Array",
      "Object",
      "Key",
      "Null",
      "EnumMember",
      "Struct",
      "Event",
      "Operator",
      "TypeParameter",
    ];
    return kind && kind > 0 && kind <= kinds.length ? kinds[kind - 1] : "Unknown";
  }

  /**
   * Convert file path to URI.
   */
  private fileToUri(filePath: string): string {
    const absolutePath = path.resolve(filePath);
    return `file://${absolutePath}`;
  }

  /**
   * Convert URI to file path.
   */
  private uriToFile(uri: string): string {
    return uri.replace(/^file:\/\//, "");
  }

  /**
   * Clean up a server and reject all pending requests.
   */
  private cleanupServer(language: string, error?: Error): void {
    const state = this.servers.get(language);
    if (!state) return;

    // Reject all pending requests
    const err = error || new Error("Server stopped");
    for (const pending of state.pending.values()) {
      pending.reject(err);
    }
    state.pending.clear();

    // Kill process if still running
    try {
      state.process.kill();
    } catch {
      // Ignore
    }

    this.servers.delete(language);
  }
}
