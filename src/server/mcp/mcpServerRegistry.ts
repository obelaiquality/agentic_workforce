import type { ToolRegistry } from "../tools/registry";
import { createLogger } from "../logger";
import { MCPClient } from "./mcpClient";
import { MCPToolAdapter } from "./mcpToolAdapter";
import type { MCPServerConfig, MCPServerStatus } from "./types";

const log = createLogger("MCP");

// ---------------------------------------------------------------------------
// MCP Server Registry — manages MCP server configurations and connections
// ---------------------------------------------------------------------------

export class MCPServerRegistry {
  private configs: MCPServerConfig[] = [];
  private client: MCPClient;
  private adapter: MCPToolAdapter;
  private toolRegistry: ToolRegistry | null = null;
  private serverToolNames = new Map<string, string[]>();

  constructor() {
    this.client = new MCPClient();
    this.adapter = new MCPToolAdapter(this.client);
  }

  /**
   * Register a server configuration.
   */
  addServer(config: MCPServerConfig): void {
    // Check for duplicate IDs
    const existing = this.configs.find((c) => c.id === config.id);
    if (existing) {
      throw new Error(`Server with id "${config.id}" already registered`);
    }

    this.configs.push(config);
  }

  /**
   * Register multiple server configurations.
   */
  addServers(configs: MCPServerConfig[]): void {
    for (const config of configs) {
      this.addServer(config);
    }
  }

  /**
   * Replace all registered server configurations.
   * Existing live connections are disconnected if the config changed or disappeared.
   */
  async replaceServers(configs: MCPServerConfig[], toolRegistry?: ToolRegistry): Promise<void> {
    for (const existing of this.configs) {
      const next = configs.find((config) => config.id === existing.id);
      if (!next || JSON.stringify(next) !== JSON.stringify(existing)) {
        await this.disconnect(existing.id).catch(() => undefined);
      }
    }

    if (toolRegistry) {
      this.toolRegistry = toolRegistry;
    }
    this.configs = configs.map((config) => ({ ...config, args: [...(config.args ?? [])] }));
  }

  /**
   * Remove a server configuration.
   */
  removeServer(serverId: string): void {
    const index = this.configs.findIndex((c) => c.id === serverId);
    if (index !== -1) {
      this.configs.splice(index, 1);
    }
    this.unregisterServerTools(serverId);
  }

  /**
   * Get a server configuration by ID.
   */
  getServer(serverId: string): MCPServerConfig | undefined {
    return this.configs.find((c) => c.id === serverId);
  }

  /**
   * Get all server configurations.
   */
  getServers(): MCPServerConfig[] {
    return [...this.configs];
  }

  /**
   * Get all enabled server configurations.
   */
  getEnabledServers(): MCPServerConfig[] {
    return this.configs.filter((c) => c.enabled);
  }

  /**
   * Connect to all enabled servers and register their tools.
   */
  async connectAll(toolRegistry: ToolRegistry): Promise<void> {
    this.toolRegistry = toolRegistry;
    const enabledServers = this.getEnabledServers();

    if (enabledServers.length === 0) {
      log.info("No enabled servers to connect");
      return;
    }

    log.info(`Connecting to ${enabledServers.length} enabled server(s)...`);

    const results = await Promise.allSettled(
      enabledServers.map(async (config) => {
        try {
          log.info(`Connecting to server: ${config.name} (${config.id})`);
          await this.client.connect(config);

          const tools = await this.client.listTools(config.id);
          log.info(`Server ${config.name} provided ${tools.length} tool(s)`);

          this.registerServerTools(config.id, tools, toolRegistry);

          log.info(`Successfully connected to ${config.name}`);
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          log.error(`Failed to connect to ${config.name}: ${errorMessage}`);
          throw err;
        }
      })
    );

    // Log summary
    const successful = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    log.info(`Connection summary: ${successful} successful, ${failed} failed`);

    // Log failures
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        const config = enabledServers[index];
        log.error(`Failed to connect to ${config.name}: ${result.reason}`);
      }
    });
  }

  /**
   * Connect to a specific server and register its tools.
   */
  async connect(serverId: string, toolRegistry: ToolRegistry): Promise<void> {
    this.toolRegistry = toolRegistry;
    const config = this.getServer(serverId);
    if (!config) {
      throw new Error(`Server configuration not found: ${serverId}`);
    }

    if (!config.enabled) {
      throw new Error(`Server is disabled: ${serverId}`);
    }

    const currentStatus = this.client.getStatus().find((status) => status.id === serverId);
    if (currentStatus?.connected) {
      return;
    }

    log.info(`Connecting to server: ${config.name} (${config.id})`);
    await this.client.connect(config);

    const tools = await this.client.listTools(config.id);
    log.info(`Server ${config.name} provided ${tools.length} tool(s)`);

    this.registerServerTools(config.id, tools, toolRegistry);

    log.info(`Successfully connected to ${config.name}`);
  }

  /**
   * Disconnect and reconnect a specific server.
   */
  async reconnect(serverId: string, toolRegistry?: ToolRegistry): Promise<void> {
    const resolvedToolRegistry = toolRegistry ?? this.toolRegistry;
    if (!resolvedToolRegistry) {
      throw new Error("Tool registry is required to reconnect MCP server");
    }
    await this.disconnect(serverId);
    await this.connect(serverId, resolvedToolRegistry);
  }

  /**
   * Disconnect from a specific server.
   */
  async disconnect(serverId: string): Promise<void> {
    log.info(`Disconnecting from server: ${serverId}`);
    await this.client.disconnect(serverId);
    this.unregisterServerTools(serverId);
  }

  /**
   * Get status of all registered servers.
   */
  getStatuses(): MCPServerStatus[] {
    const connectedStatuses = this.client.getStatus();
    const statusMap = new Map(connectedStatuses.map((s) => [s.id, s]));

    // Include all registered servers, even if not connected
    return this.configs.map((config) => {
      const connectedStatus = statusMap.get(config.id);
      return (
        connectedStatus || {
          id: config.id,
          name: config.name,
          connected: false,
          toolCount: 0,
          resourceCount: 0,
        }
      );
    });
  }

  /**
   * Get the MCP client instance (for advanced usage).
   */
  getClient(): MCPClient {
    return this.client;
  }

  /**
   * Shutdown all connections.
   */
  async shutdown(): Promise<void> {
    log.info("Shutting down all connections...");
    await this.client.disconnectAll();
    for (const serverId of Array.from(this.serverToolNames.keys())) {
      this.unregisterServerTools(serverId);
    }
    log.info("All connections closed");
  }

  async listResources(serverId: string) {
    return this.client.listResources(serverId);
  }

  async readResource(serverId: string, uri: string) {
    return this.client.readResource(serverId, uri);
  }

  private registerServerTools(serverId: string, tools: Awaited<ReturnType<MCPClient["listTools"]>>, toolRegistry: ToolRegistry) {
    this.unregisterServerTools(serverId, toolRegistry);
    const wrappedTools = this.adapter.wrapAllTools(serverId, tools);
    for (const tool of wrappedTools) {
      if (!toolRegistry.has(tool.name)) {
        toolRegistry.register(tool);
      }
    }
    this.serverToolNames.set(serverId, wrappedTools.map((tool) => tool.name));
  }

  private unregisterServerTools(serverId: string, toolRegistry = this.toolRegistry ?? undefined) {
    const toolNames = this.serverToolNames.get(serverId) ?? [];
    if (toolRegistry && toolNames.length > 0) {
      toolRegistry.unregisterAll(toolNames);
    }
    this.serverToolNames.delete(serverId);
  }
}

// ---------------------------------------------------------------------------
// Singleton instance
// ---------------------------------------------------------------------------

let defaultRegistry: MCPServerRegistry | null = null;

export function getDefaultMCPServerRegistry(): MCPServerRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new MCPServerRegistry();
  }
  return defaultRegistry;
}

export function createMCPServerRegistry(): MCPServerRegistry {
  return new MCPServerRegistry();
}
