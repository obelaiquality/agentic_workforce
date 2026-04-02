import { spawn, type ChildProcess } from "child_process";
import type {
  MCPServerConfig,
  MCPServerStatus,
  MCPToolDescriptor,
  MCPResourceDescriptor,
  MCPConnection,
  JsonRpcRequest,
  JsonRpcResponse,
  MCPInitializeParams,
  MCPInitializeResult,
  MCPToolInfo,
  MCPToolCallParams,
  MCPToolCallResult,
  MCPResourceInfo,
  MCPResourceReadParams,
  MCPResourceReadResult,
  PendingRequest,
} from "./types";
import { publishEvent } from "../eventBus";
import { createLogger } from "../logger";

const log = createLogger("MCP");

// ---------------------------------------------------------------------------
// Health Monitoring Types
// ---------------------------------------------------------------------------

export type MCPHealthStatus = "healthy" | "degraded" | "restarting" | "failed";

export interface MCPHealthState {
  status: MCPHealthStatus;
  consecutiveFailures: number;
  restartAttempts: number;
  intervalHandle: ReturnType<typeof setInterval> | null;
  lastCheckTime?: number;
}

// ---------------------------------------------------------------------------
// MCP Client — manages connections to MCP servers via stdio transport
// ---------------------------------------------------------------------------

export class MCPClient {
  private connections = new Map<string, MCPConnection>();
  private healthMonitors = new Map<string, MCPHealthState>();
  private readonly requestTimeout = 30000; // 30 seconds
  private readonly initializeTimeout = 10000; // 10 seconds
  private static readonly HEALTH_CHECK_TIMEOUT = 5000;
  private static readonly MAX_CONSECUTIVE_FAILURES = 3;
  private static readonly MAX_RESTART_ATTEMPTS = 5;
  private static readonly BASE_BACKOFF_MS = 5000;
  private static readonly MAX_BACKOFF_MS = 60000;

  /**
   * Connect to an MCP server.
   * Currently only supports stdio transport.
   */
  async connect(config: MCPServerConfig): Promise<void> {
    if (this.connections.has(config.id)) {
      throw new Error(`Already connected to server: ${config.id}`);
    }

    if (config.transport !== "stdio") {
      throw new Error(`Unsupported transport: ${config.transport}. Only stdio is currently supported.`);
    }

    if (!config.command) {
      throw new Error(`Command is required for stdio transport`);
    }

    // Initialize connection state
    const connection: MCPConnection = {
      serverId: config.id,
      config,
      connected: false,
      tools: [],
      resources: [],
      nextRequestId: 1,
      pendingRequests: new Map(),
    };

    this.connections.set(config.id, connection);

    try {
      // Spawn the server process
      const childProcess = spawn(config.command, config.args || [], {
        env: { ...process.env, ...config.env },
        stdio: ["pipe", "pipe", "pipe"],
      });

      if (!childProcess.pid) {
        throw new Error("Failed to spawn MCP server process");
      }

      connection.process = {
        pid: childProcess.pid,
        stdin: childProcess.stdin,
        stdout: childProcess.stdout,
        stderr: childProcess.stderr,
      };

      // Track whether we've successfully connected
      let connectionEstablished = false;

      // Set up stdout/stderr handlers
      let stdoutBuffer = "";
      childProcess.stdout.on("data", (chunk) => {
        stdoutBuffer += chunk.toString();
        // Process complete JSON-RPC messages (newline-delimited)
        const lines = stdoutBuffer.split("\n");
        stdoutBuffer = lines.pop() || "";
        for (const line of lines) {
          if (line.trim()) {
            this.handleMessage(config.id, line.trim());
          }
        }
      });

      childProcess.stderr.on("data", (chunk) => {
        // Log stderr for debugging
        log.error(`[${config.id}] stderr:`, chunk.toString());
      });

      // Set up persistent error handler (prevents unhandled error crashes)
      let spawnError: Error | null = null;
      childProcess.on("error", (err) => {
        spawnError = err;
        connection.error = `Process error: ${err.message}`;
        connection.connected = false;
        this.rejectAllPending(config.id, err);
      });

      // Wait briefly for spawn errors (e.g. ENOENT for missing command)
      await new Promise<void>((resolve, reject) => {
        setTimeout(() => {
          if (spawnError) {
            this.connections.delete(config.id);
            reject(spawnError);
          } else {
            resolve();
          }
        }, 200);
      });

      childProcess.on("exit", (code, signal) => {
        connection.error = `Process exited with code ${code}, signal ${signal}`;
        connection.connected = false;
        this.rejectAllPending(config.id, new Error(connection.error));
      });

      // Send initialize request
      const initializeParams: MCPInitializeParams = {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "agentic-workforce",
          version: "1.0.0",
        },
      };

      const initResult = await this.sendRequest<MCPInitializeResult>(
        config.id,
        "initialize",
        initializeParams,
        this.initializeTimeout
      );

      connection.serverInfo = initResult.serverInfo;
      connection.capabilities = initResult.capabilities;

      // Send initialized notification
      this.sendNotification(config.id, "notifications/initialized", {});

      connection.connected = true;
      connection.lastConnected = new Date().toISOString();
      connectionEstablished = true;

      // List available tools and resources
      if (initResult.capabilities.tools) {
        const toolsResult = await this.sendRequest<{ tools: MCPToolInfo[] }>(
          config.id,
          "tools/list",
          {}
        );
        connection.tools = toolsResult.tools.map((t) => ({
          serverId: config.id,
          name: t.name,
          description: t.description || "",
          inputSchema: t.inputSchema,
        }));
      }

      if (initResult.capabilities.resources) {
        const resourcesResult = await this.sendRequest<{ resources: MCPResourceInfo[] }>(
          config.id,
          "resources/list",
          {}
        );
        connection.resources = resourcesResult.resources.map((r) => ({
          serverId: config.id,
          uri: r.uri,
          name: r.name,
          description: r.description,
          mimeType: r.mimeType,
        }));
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      connection.error = errorMessage;
      connection.connected = false;

      // Clean up process if it was started
      if (connection.process) {
        try {
          process.kill(connection.process.pid, "SIGTERM");
        } catch (killErr) {
          // Process might already be dead
        }
      }

      throw new Error(`Failed to connect to MCP server ${config.id}: ${errorMessage}`);
    }
  }

  /**
   * Disconnect from an MCP server.
   */
  async disconnect(serverId: string): Promise<void> {
    const connection = this.connections.get(serverId);
    if (!connection) {
      return; // Already disconnected
    }

    // Reject all pending requests
    this.rejectAllPending(serverId, new Error("Server disconnecting"));

    // Kill the process
    if (connection.process) {
      try {
        process.kill(connection.process.pid, "SIGTERM");
        // Give it a moment to shut down gracefully
        await new Promise((resolve) => setTimeout(resolve, 1000));
        // Force kill if still alive
        try {
          process.kill(connection.process.pid, "SIGKILL");
        } catch {
          // Process already dead
        }
      } catch (err) {
        // Process might already be dead
      }
    }

    this.connections.delete(serverId);
  }

  /**
   * List tools from a connected server.
   */
  async listTools(serverId: string): Promise<MCPToolDescriptor[]> {
    const connection = this.connections.get(serverId);
    if (!connection || !connection.connected) {
      throw new Error(`Not connected to server: ${serverId}`);
    }
    return connection.tools;
  }

  /**
   * List resources from a connected server.
   */
  async listResources(serverId: string): Promise<MCPResourceDescriptor[]> {
    const connection = this.connections.get(serverId);
    if (!connection || !connection.connected) {
      throw new Error(`Not connected to server: ${serverId}`);
    }
    return connection.resources;
  }

  /**
   * Call a tool on a connected server.
   */
  async callTool(serverId: string, toolName: string, args: unknown): Promise<unknown> {
    const connection = this.connections.get(serverId);
    if (!connection || !connection.connected) {
      throw new Error(`Not connected to server: ${serverId}`);
    }

    const params: MCPToolCallParams = {
      name: toolName,
      arguments: args,
    };

    const result = await this.sendRequest<MCPToolCallResult>(serverId, "tools/call", params);

    if (result.isError) {
      const errorText = result.content.find((c) => c.type === "text")?.text || "Unknown error";
      throw new Error(errorText);
    }

    // Combine text content
    const textContent = result.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");

    return textContent || result.content;
  }

  /**
   * Read a resource from a connected server.
   */
  async readResource(
    serverId: string,
    uri: string
  ): Promise<{ content: string; mimeType?: string }> {
    const connection = this.connections.get(serverId);
    if (!connection || !connection.connected) {
      throw new Error(`Not connected to server: ${serverId}`);
    }

    const params: MCPResourceReadParams = { uri };
    const result = await this.sendRequest<MCPResourceReadResult>(serverId, "resources/read", params);

    if (result.contents.length === 0) {
      throw new Error(`No content returned for resource: ${uri}`);
    }

    const content = result.contents[0];
    return {
      content: content.text || content.blob || "",
      mimeType: content.mimeType,
    };
  }

  /**
   * Check if a server is alive by sending a ping request.
   * Returns true if the server responds within 5 seconds, false otherwise.
   */
  async healthCheck(serverId: string): Promise<boolean> {
    const connection = this.connections.get(serverId);
    if (!connection || !connection.process) {
      return false;
    }

    // Check if the process is alive
    try {
      process.kill(connection.process.pid, 0);
    } catch {
      return false;
    }

    // Try to send a ping request and wait for response
    try {
      await this.sendRequest(serverId, "ping", {}, MCPClient.HEALTH_CHECK_TIMEOUT);
      return true;
    } catch {
      // If ping fails, fall back to just checking if process is alive
      try {
        process.kill(connection.process.pid, 0);
        return true;
      } catch {
        return false;
      }
    }
  }

  /**
   * Start periodic health monitoring for a server.
   * Checks health at the given interval and attempts auto-restart on failures.
   */
  startHealthMonitor(serverId: string, intervalMs = 30000): void {
    // Clean up existing monitor if any
    this.stopHealthMonitor(serverId);

    const state: MCPHealthState = {
      status: "healthy",
      consecutiveFailures: 0,
      restartAttempts: 0,
      intervalHandle: null,
    };

    state.intervalHandle = setInterval(async () => {
      state.lastCheckTime = Date.now();
      const alive = await this.healthCheck(serverId);

      if (alive) {
        state.consecutiveFailures = 0;
        if (state.status === "degraded") {
          state.status = "healthy";
        }
        return;
      }

      state.consecutiveFailures++;

      if (state.consecutiveFailures < MCPClient.MAX_CONSECUTIVE_FAILURES) {
        state.status = "degraded";
        return;
      }

      // 3 consecutive failures — attempt auto-restart
      publishEvent("mcp", "mcp.server.unhealthy", { serverId, consecutiveFailures: state.consecutiveFailures });

      if (state.restartAttempts >= MCPClient.MAX_RESTART_ATTEMPTS) {
        state.status = "failed";
        publishEvent("mcp", "mcp.server.failed", { serverId, restartAttempts: state.restartAttempts });
        this.stopHealthMonitor(serverId);
        // Keep the state so getServerHealth still works
        this.healthMonitors.set(serverId, state);
        return;
      }

      state.status = "restarting";
      state.restartAttempts++;

      // Exponential backoff: 5s, 10s, 20s, 40s, 60s (capped)
      const backoffMs = Math.min(
        MCPClient.BASE_BACKOFF_MS * Math.pow(2, state.restartAttempts - 1),
        MCPClient.MAX_BACKOFF_MS
      );

      await new Promise((resolve) => setTimeout(resolve, backoffMs));

      try {
        const connection = this.connections.get(serverId);
        if (!connection) return;

        // Disconnect and reconnect
        await this.disconnect(serverId);
        await this.connect(connection.config);

        state.status = "healthy";
        state.consecutiveFailures = 0;
        publishEvent("mcp", "mcp.server.restarted", { serverId, attempt: state.restartAttempts });
      } catch {
        // Restart failed, will retry on next check
        state.status = "degraded";
      }
    }, intervalMs);

    this.healthMonitors.set(serverId, state);
  }

  /**
   * Stop health monitoring for a server.
   */
  stopHealthMonitor(serverId: string): void {
    const state = this.healthMonitors.get(serverId);
    if (state?.intervalHandle) {
      clearInterval(state.intervalHandle);
      state.intervalHandle = null;
    }
  }

  /**
   * Get the current health status of a server.
   */
  getServerHealth(serverId: string): MCPHealthStatus | undefined {
    return this.healthMonitors.get(serverId)?.status;
  }

  /**
   * Get status of all servers.
   */
  getStatus(): MCPServerStatus[] {
    return Array.from(this.connections.values()).map((conn) => ({
      id: conn.serverId,
      name: conn.config.name,
      connected: conn.connected,
      toolCount: conn.tools.length,
      resourceCount: conn.resources.length,
      error: conn.error,
      lastConnected: conn.lastConnected,
    }));
  }

  /**
   * Disconnect all servers.
   */
  async disconnectAll(): Promise<void> {
    // Stop all health monitors
    for (const serverId of this.healthMonitors.keys()) {
      this.stopHealthMonitor(serverId);
    }
    this.healthMonitors.clear();

    const disconnectPromises = Array.from(this.connections.keys()).map((serverId) =>
      this.disconnect(serverId)
    );
    await Promise.all(disconnectPromises);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Send a JSON-RPC request and wait for the response.
   */
  private sendRequest<T = unknown>(
    serverId: string,
    method: string,
    params: unknown,
    timeout = this.requestTimeout
  ): Promise<T> {
    const connection = this.connections.get(serverId);
    if (!connection || !connection.process) {
      return Promise.reject(new Error(`No connection to server: ${serverId}`));
    }

    const requestId = connection.nextRequestId++;
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: requestId,
      method,
      params,
    };

    return new Promise<T>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        connection.pendingRequests.delete(requestId);
        reject(new Error(`Request timeout: ${method} (${timeout}ms)`));
      }, timeout);

      const pendingRequest: PendingRequest = {
        requestId,
        method,
        resolve: (value) => {
          clearTimeout(timeoutHandle);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timeoutHandle);
          reject(error);
        },
        timeout: timeoutHandle,
      };

      connection.pendingRequests.set(requestId, pendingRequest);

      try {
        const message = JSON.stringify(request) + "\n";
        connection.process.stdin.write(message);
      } catch (err) {
        clearTimeout(timeoutHandle);
        connection.pendingRequests.delete(requestId);
        reject(err);
      }
    });
  }

  /**
   * Send a JSON-RPC notification (no response expected).
   */
  private sendNotification(serverId: string, method: string, params: unknown): void {
    const connection = this.connections.get(serverId);
    if (!connection || !connection.process) {
      return;
    }

    const notification = {
      jsonrpc: "2.0",
      method,
      params,
    };

    try {
      const message = JSON.stringify(notification) + "\n";
      connection.process.stdin.write(message);
    } catch (err) {
      log.error(`Failed to send notification to ${serverId}:`, err);
    }
  }

  /**
   * Handle incoming JSON-RPC message from server.
   */
  private handleMessage(serverId: string, message: string): void {
    const connection = this.connections.get(serverId);
    if (!connection) return;

    try {
      const parsed = JSON.parse(message) as JsonRpcResponse;

      // Check if this is a response to a pending request
      if (typeof parsed.id === "number" || typeof parsed.id === "string") {
        const pending = connection.pendingRequests.get(parsed.id as number);
        if (pending) {
          connection.pendingRequests.delete(parsed.id as number);

          if (parsed.error) {
            pending.reject(
              new Error(`JSON-RPC error: ${parsed.error.message} (code: ${parsed.error.code})`)
            );
          } else {
            pending.resolve(parsed.result);
          }
        }
      }
      // Otherwise it's a notification (no id) — we can ignore for now
    } catch (err) {
      log.error(`Failed to parse JSON-RPC message from ${serverId}:`, message, err);
    }
  }

  /**
   * Reject all pending requests for a server.
   */
  private rejectAllPending(serverId: string, error: Error): void {
    const connection = this.connections.get(serverId);
    if (!connection) return;

    for (const [requestId, pending] of connection.pendingRequests.entries()) {
      pending.reject(error);
      clearTimeout(pending.timeout);
    }
    connection.pendingRequests.clear();
  }
}
