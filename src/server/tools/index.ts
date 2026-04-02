/**
 * Tools module - Progressive disclosure and tool registry.
 *
 * This module provides:
 * - ToolRegistry: Central registry for all available tools
 * - DeferredToolLoader: Progressive disclosure manager for on-demand tool loading
 * - Tool definitions: Built-in tools like tool_search
 * - Type definitions: ToolDefinition, ToolContext, ToolResult, etc.
 */

// Core types
export type {
  ToolDefinition,
  ToolContext,
  ToolResult,
  ToolResultSuccess,
  ToolResultError,
  ToolResultApprovalRequired,
  ToolPermission,
  ToolPermissionScope,
  ToolJsonSchema,
  ToolUseBlock,
  ToolResultBlock,
  ConversationMessage,
  ConversationRole,
  TeamContext,
  AgenticEvent,
  AgenticExecutionInput,
} from "./types";

// Registry
export { ToolRegistry, getDefaultToolRegistry, createToolRegistry } from "./registry";

// Deferred loading
export { DeferredToolLoader, createDeferredToolLoader } from "./deferredLoader";

// Built-in tool definitions
export { createToolSearchTool } from "./definitions";
