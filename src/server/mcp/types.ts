// ---------------------------------------------------------------------------
// MCP Server Configuration and Descriptors
// ---------------------------------------------------------------------------

export interface MCPServerConfig {
  id: string;
  name: string;
  transport: "stdio" | "sse";
  command?: string; // For stdio transport
  args?: string[]; // For stdio transport
  url?: string; // For SSE transport
  env?: Record<string, string>;
  enabled: boolean;
}

export interface MCPToolDescriptor {
  serverId: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface MCPResourceDescriptor {
  serverId: string;
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface MCPServerStatus {
  id: string;
  name: string;
  connected: boolean;
  toolCount: number;
  resourceCount: number;
  error?: string;
  lastConnected?: string;
}

// ---------------------------------------------------------------------------
// MCP Protocol Types (JSON-RPC 2.0)
// ---------------------------------------------------------------------------

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: "2.0";
  id: number | string;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

// ---------------------------------------------------------------------------
// MCP Protocol Messages
// ---------------------------------------------------------------------------

export interface MCPInitializeParams {
  protocolVersion: string;
  capabilities: {
    roots?: { listChanged?: boolean };
    sampling?: Record<string, unknown>;
  };
  clientInfo: {
    name: string;
    version: string;
  };
}

export interface MCPInitializeResult {
  protocolVersion: string;
  capabilities: {
    logging?: Record<string, unknown>;
    prompts?: { listChanged?: boolean };
    resources?: { subscribe?: boolean; listChanged?: boolean };
    tools?: { listChanged?: boolean };
  };
  serverInfo: {
    name: string;
    version: string;
  };
}

export interface MCPToolInfo {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
}

export interface MCPToolCallParams {
  name: string;
  arguments?: unknown;
}

export interface MCPToolCallResult {
  content: Array<{
    type: "text" | "image" | "resource";
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

export interface MCPResourceInfo {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface MCPResourceReadParams {
  uri: string;
}

export interface MCPResourceReadResult {
  contents: Array<{
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Internal Connection State
// ---------------------------------------------------------------------------

export interface MCPConnection {
  serverId: string;
  config: MCPServerConfig;
  process?: {
    pid: number;
    stdin: NodeJS.WritableStream;
    stdout: NodeJS.ReadableStream;
    stderr: NodeJS.ReadableStream;
  };
  connected: boolean;
  serverInfo?: {
    name: string;
    version: string;
  };
  capabilities?: MCPInitializeResult["capabilities"];
  tools: MCPToolDescriptor[];
  resources: MCPResourceDescriptor[];
  nextRequestId: number;
  pendingRequests: Map<number, PendingRequest>;
  error?: string;
  lastConnected?: string;
}

export interface PendingRequest {
  requestId: number;
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}
