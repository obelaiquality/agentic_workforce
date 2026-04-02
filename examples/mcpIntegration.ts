/**
 * Example: How to integrate MCP servers into the agentic coding application
 *
 * This file demonstrates:
 * 1. Setting up MCP server configurations
 * 2. Connecting to servers on application startup
 * 3. Exposing MCP tools to the agent
 * 4. Cleaning up on shutdown
 */

import { getDefaultMCPServerRegistry } from "./mcpServerRegistry";
import { getDefaultToolRegistry } from "../tools/registry";
import type { MCPServerConfig } from "./types";

// ---------------------------------------------------------------------------
// Step 1: Define MCP server configurations
// ---------------------------------------------------------------------------

/**
 * Example configurations for common MCP servers.
 * In production, these would likely come from:
 * - Environment variables
 * - A configuration file (config/mcp-servers.json)
 * - A database table
 * - User settings
 */
const exampleServerConfigs: MCPServerConfig[] = [
  {
    id: "filesystem",
    name: "Filesystem Access",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/directory"],
    enabled: true,
  },
  {
    id: "github",
    name: "GitHub Integration",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env: {
      GITHUB_TOKEN: process.env.GITHUB_TOKEN || "",
    },
    enabled: !!process.env.GITHUB_TOKEN, // Only enable if token is available
  },
  {
    id: "postgres",
    name: "PostgreSQL Database",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres"],
    env: {
      POSTGRES_CONNECTION_STRING: process.env.POSTGRES_CONNECTION_STRING || "",
    },
    enabled: !!process.env.POSTGRES_CONNECTION_STRING,
  },
  {
    id: "brave-search",
    name: "Brave Search",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-brave-search"],
    env: {
      BRAVE_API_KEY: process.env.BRAVE_API_KEY || "",
    },
    enabled: !!process.env.BRAVE_API_KEY,
  },
];

// ---------------------------------------------------------------------------
// Step 2: Initialize MCP integration on application startup
// ---------------------------------------------------------------------------

/**
 * Initialize MCP servers and register their tools.
 * Call this during application bootstrap (e.g., in src/server/index.ts).
 */
export async function initializeMCPIntegration(): Promise<void> {
  console.log("[MCP] Initializing MCP integration...");

  const mcpRegistry = getDefaultMCPServerRegistry();
  const toolRegistry = getDefaultToolRegistry();

  // Add server configurations
  try {
    mcpRegistry.addServers(exampleServerConfigs);
    console.log(`[MCP] Registered ${exampleServerConfigs.length} server configuration(s)`);
  } catch (err) {
    console.error("[MCP] Failed to register server configurations:", err);
    throw err;
  }

  // Connect to all enabled servers and register their tools
  try {
    await mcpRegistry.connectAll(toolRegistry);

    // Log summary
    const statuses = mcpRegistry.getStatuses();
    const connected = statuses.filter((s) => s.connected).length;
    const failed = statuses.filter((s) => !s.connected && s.error).length;

    console.log(`[MCP] Initialization complete: ${connected} connected, ${failed} failed`);

    // Log tool count
    const mcpToolCount = toolRegistry
      .list()
      .filter((t) => t.name.startsWith("mcp__")).length;
    console.log(`[MCP] Registered ${mcpToolCount} MCP tool(s)`);
  } catch (err) {
    console.error("[MCP] Failed to initialize MCP servers:", err);
    // Don't throw — we can continue without MCP tools
  }
}

// ---------------------------------------------------------------------------
// Step 3: Shutdown MCP integration on application exit
// ---------------------------------------------------------------------------

/**
 * Clean shutdown of MCP servers.
 * Call this during graceful shutdown (e.g., in process.on('SIGTERM')).
 */
export async function shutdownMCPIntegration(): Promise<void> {
  console.log("[MCP] Shutting down MCP integration...");

  const mcpRegistry = getDefaultMCPServerRegistry();

  try {
    await mcpRegistry.shutdown();
    console.log("[MCP] Shutdown complete");
  } catch (err) {
    console.error("[MCP] Error during shutdown:", err);
  }
}

// ---------------------------------------------------------------------------
// Step 4: Runtime management (optional)
// ---------------------------------------------------------------------------

/**
 * Get current status of all MCP servers.
 * Can be exposed via API endpoint for monitoring.
 */
export function getMCPServerStatuses() {
  const mcpRegistry = getDefaultMCPServerRegistry();
  return mcpRegistry.getStatuses();
}

/**
 * Connect to a specific MCP server at runtime.
 */
export async function connectMCPServer(serverId: string): Promise<void> {
  const mcpRegistry = getDefaultMCPServerRegistry();
  const toolRegistry = getDefaultToolRegistry();
  await mcpRegistry.connect(serverId, toolRegistry);
}

/**
 * Disconnect from a specific MCP server at runtime.
 */
export async function disconnectMCPServer(serverId: string): Promise<void> {
  const mcpRegistry = getDefaultMCPServerRegistry();
  await mcpRegistry.disconnect(serverId);
}

// ---------------------------------------------------------------------------
// Example integration into src/server/index.ts
// ---------------------------------------------------------------------------

/*
import { initializeMCPIntegration, shutdownMCPIntegration } from "./mcp/example-integration";

async function startServer() {
  // ... existing server setup ...

  // Initialize MCP integration
  await initializeMCPIntegration();

  // ... start HTTP server ...

  // Handle graceful shutdown
  process.on("SIGTERM", async () => {
    console.log("SIGTERM received, shutting down gracefully...");
    await shutdownMCPIntegration();
    // ... other cleanup ...
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    console.log("SIGINT received, shutting down gracefully...");
    await shutdownMCPIntegration();
    // ... other cleanup ...
    process.exit(0);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
*/
