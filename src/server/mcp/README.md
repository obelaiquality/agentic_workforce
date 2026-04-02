# MCP (Model Context Protocol) Integration

This directory contains the MCP server integration for the agentic coding application. MCP allows the application to connect to external tool servers and expose their capabilities as native tools within the agent's tool registry.

## Architecture

### Components

1. **`mcpClient.ts`** — Low-level MCP client
   - Manages stdio transport to MCP servers
   - Handles JSON-RPC 2.0 protocol communication
   - Implements initialize handshake
   - Provides tool calling and resource reading APIs

2. **`mcpToolAdapter.ts`** — Tool adaptation layer
   - Converts MCP tool descriptors to native `ToolDefinition` format
   - Implements JSON Schema → Zod conversion
   - Handles MCP tool execution and error wrapping

3. **`mcpServerRegistry.ts`** — Server lifecycle management
   - Manages MCP server configurations
   - Connects to enabled servers on startup
   - Registers MCP tools with the tool registry
   - Provides status monitoring and cleanup

4. **`types.ts`** — TypeScript type definitions
   - MCP protocol types (JSON-RPC, initialize, tools/list, tools/call)
   - Server configuration and status types
   - Internal connection state types

## Usage

### Basic Setup

```typescript
import { getDefaultMCPServerRegistry } from "./mcp";
import { getDefaultToolRegistry } from "./tools/registry";

// Get registries
const mcpRegistry = getDefaultMCPServerRegistry();
const toolRegistry = getDefaultToolRegistry();

// Add MCP server configurations
mcpRegistry.addServer({
  id: "filesystem",
  name: "Filesystem MCP Server",
  transport: "stdio",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/dir"],
  enabled: true,
});

// Connect all enabled servers and register their tools
await mcpRegistry.connectAll(toolRegistry);
```

### Configuration

MCP servers are configured with `MCPServerConfig`:

```typescript
interface MCPServerConfig {
  id: string;              // Unique identifier
  name: string;            // Human-readable name
  transport: "stdio";      // Transport type (only stdio supported)
  command: string;         // Command to spawn server
  args?: string[];         // Command arguments
  env?: Record<string, string>;  // Environment variables
  enabled: boolean;        // Enable/disable server
}
```

### Tool Naming

MCP tools are registered with prefixed names to avoid conflicts:

```
mcp__<serverId>__<toolName>
```

For example:
- `mcp__filesystem__read_file`
- `mcp__github__create_issue`
- `mcp__slack__send_message`

### Tool Permissions

All MCP tools are registered with:
- **Scope**: `meta` (requires approval based on execution policy)
- **Always Load**: `false` (deferred loading via tool search)
- **Concurrency Safe**: `true`
- **Search Hints**: `[serverId, toolName, "mcp"]`

### Status Monitoring

```typescript
// Get status of all servers
const statuses = mcpRegistry.getStatuses();

statuses.forEach(status => {
  console.log(`${status.name}: ${status.connected ? 'connected' : 'disconnected'}`);
  console.log(`  Tools: ${status.toolCount}`);
  console.log(`  Resources: ${status.resourceCount}`);
  if (status.error) {
    console.log(`  Error: ${status.error}`);
  }
});
```

### Cleanup

```typescript
// Disconnect all servers on shutdown
await mcpRegistry.shutdown();
```

## Protocol Support

### Implemented

- ✅ stdio transport
- ✅ JSON-RPC 2.0 message format
- ✅ `initialize` handshake
- ✅ `tools/list` — List available tools
- ✅ `tools/call` — Execute a tool
- ✅ `resources/list` — List available resources
- ✅ `resources/read` — Read a resource
- ✅ Request timeout handling (30s default)
- ✅ Process lifecycle management
- ✅ Error handling and recovery

### Not Implemented

- ❌ SSE transport (future)
- ❌ Prompts API
- ❌ Logging API
- ❌ Sampling API
- ❌ Dynamic tool/resource list updates

## JSON Schema → Zod Conversion

The adapter implements best-effort conversion for common JSON Schema patterns:

| JSON Schema | Zod Equivalent |
|-------------|----------------|
| `{"type": "string"}` | `z.string()` |
| `{"type": "number"}` | `z.number()` |
| `{"type": "integer"}` | `z.number().int()` |
| `{"type": "boolean"}` | `z.boolean()` |
| `{"type": "array"}` | `z.array()` |
| `{"type": "object"}` | `z.object()` |
| `{"enum": [...]}` | `z.enum()` |
| `{"anyOf": [...]}` | `z.union()` |
| `{"allOf": [...]}` | `z.intersection()` |
| `{"const": value}` | `z.literal()` |

### Constraints

Supported constraints:
- String: `minLength`, `maxLength`, `pattern`
- Number: `minimum`, `maximum`
- Object: `required`, `properties`
- Array: `items`

## Error Handling

### Connection Errors

- Server process spawn failures
- Protocol version mismatches
- Server crashes or unexpected exits
- Timeout during initialization

### Tool Execution Errors

- Tool not found
- Invalid arguments
- Tool execution failure
- Response timeout

All errors are wrapped and returned as `ToolResultError` to maintain consistency with the native tool system.

## Example MCP Servers

### Filesystem

```typescript
mcpRegistry.addServer({
  id: "filesystem",
  name: "Filesystem Access",
  transport: "stdio",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem", "/home/user/projects"],
  enabled: true,
});
```

### GitHub

```typescript
mcpRegistry.addServer({
  id: "github",
  name: "GitHub Integration",
  transport: "stdio",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-github"],
  env: {
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  },
  enabled: true,
});
```

### Custom Server

```typescript
mcpRegistry.addServer({
  id: "custom",
  name: "Custom MCP Server",
  transport: "stdio",
  command: "/path/to/custom-server",
  args: ["--config", "/path/to/config.json"],
  enabled: true,
});
```

## Security Considerations

1. **Command Execution**: MCP servers spawn child processes. Only configure trusted servers.
2. **Tool Permissions**: All MCP tools use `meta` scope, subject to execution policy.
3. **Environment Variables**: Sensitive tokens/keys should be passed via `env` config.
4. **Path Restrictions**: Filesystem servers should be configured with restricted paths.

## Future Enhancements

- SSE transport support for HTTP-based MCP servers
- Dynamic tool/resource list updates (listChanged notifications)
- MCP Prompts API integration
- Connection pooling and retry logic
- Server health monitoring and auto-restart
- Configuration persistence (JSON/YAML files)
- UI for managing MCP servers
