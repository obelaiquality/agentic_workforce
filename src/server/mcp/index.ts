// ---------------------------------------------------------------------------
// MCP (Model Context Protocol) Integration
// ---------------------------------------------------------------------------

export { MCPClient } from "./mcpClient";
export { MCPToolAdapter } from "./mcpToolAdapter";
export {
  MCPServerRegistry,
  getDefaultMCPServerRegistry,
  createMCPServerRegistry,
} from "./mcpServerRegistry";

export type {
  MCPServerConfig,
  MCPServerStatus,
  MCPToolDescriptor,
  MCPResourceDescriptor,
  MCPConnection,
  MCPInitializeParams,
  MCPInitializeResult,
  MCPToolInfo,
  MCPToolCallParams,
  MCPToolCallResult,
  MCPResourceInfo,
  MCPResourceReadParams,
  MCPResourceReadResult,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  PendingRequest,
} from "./types";
