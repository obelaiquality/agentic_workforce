/**
 * Unit tests for toolSearch.ts
 * Tests the createToolSearchTool meta-tool factory with a mocked registry.
 */
import { describe, it, expect, vi } from "vitest";
import { createToolSearchTool } from "./toolSearch";
import type { ToolContext } from "../types";

const bashTool = { name: "bash", description: "Run shell commands" };
const readFileTool = { name: "read_file", description: "Read a file" };

const mockRegistry = {
  listEnabled: vi.fn().mockReturnValue([bashTool, readFileTool]),
  searchTools: vi.fn().mockReturnValue([]),
  toJsonSchema: vi.fn().mockReturnValue({
    name: "bash",
    description: "Run shell commands",
    parameters: { command: { type: "string" } },
  }),
};

const mockContext: ToolContext = {
  runId: "test-run",
  repoId: "test-repo",
  ticketId: "test-ticket",
  worktreePath: "/tmp/test",
  actor: "agent:test",
  stage: "build",
  conversationHistory: [],
  createApproval: async () => ({ id: "approval-1" }),
  recordEvent: async () => {},
};

describe("createToolSearchTool", () => {
  it("is a function", () => {
    expect(typeof createToolSearchTool).toBe("function");
  });

  it('returns ToolDefinition with name "tool_search"', () => {
    const tool = createToolSearchTool(mockRegistry as never);
    expect(tool.name).toBe("tool_search");
  });

  it("has alwaysLoad: true", () => {
    const tool = createToolSearchTool(mockRegistry as never);
    expect(tool.alwaysLoad).toBe(true);
  });

  it('has permission.scope: "meta"', () => {
    const tool = createToolSearchTool(mockRegistry as never);
    expect(tool.permission.scope).toBe("meta");
  });

  it("has concurrencySafe: true", () => {
    const tool = createToolSearchTool(mockRegistry as never);
    expect(tool.concurrencySafe).toBe(true);
  });

  it('execute returns "No tools found" message when registry returns empty', async () => {
    mockRegistry.searchTools.mockReturnValueOnce([]);

    const tool = createToolSearchTool(mockRegistry as never);
    const result = await tool.execute(
      { query: "nonexistent", max_results: 5 },
      mockContext,
    );

    expect(result.type).toBe("success");
    expect(result.content).toContain("No tools found");
    expect(result.content).toContain("Try different keywords");
  });

  it("execute returns formatted tool list when matches found", async () => {
    mockRegistry.searchTools.mockReturnValueOnce([bashTool]);
    mockRegistry.listEnabled.mockReturnValueOnce([bashTool, readFileTool]);

    const tool = createToolSearchTool(mockRegistry as never);
    const result = await tool.execute(
      { query: "shell", max_results: 5 },
      mockContext,
    );

    expect(result.type).toBe("success");
    expect(result.content).toContain("Found 1 tool(s)");
    expect(result.content).toContain("bash");
    expect(result.content).toContain("Parameters:");
    if (result.type === "success") {
      expect(result.metadata?.toolsFound).toBe(1);
      expect(result.metadata?.toolNames).toContain("bash");
    }
  });
});
