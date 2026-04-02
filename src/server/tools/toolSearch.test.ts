import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { ToolRegistry } from "./registry";
import { createToolSearchTool } from "./definitions/toolSearch";
import type { ToolDefinition, ToolContext } from "./types";

describe("Tool Search", () => {
  let registry: ToolRegistry;
  let toolSearch: ToolDefinition;
  let mockContext: ToolContext;

  beforeEach(() => {
    registry = new ToolRegistry();

    // Register some test tools
    registry.registerAll([
      {
        name: "read_file",
        description: "Read a file from disk",
        inputSchema: z.object({ path: z.string() }),
        execute: async () => ({ type: "success", content: "file content" }),
        permission: { scope: "repo.read", readOnly: true },
        alwaysLoad: true,
        searchHints: ["file", "read", "view"],
      },
      {
        name: "git_commit",
        description: "Create a git commit with changes",
        inputSchema: z.object({ message: z.string() }),
        execute: async () => ({ type: "success", content: "committed" }),
        permission: { scope: "git.write" },
        alwaysLoad: false,
        searchHints: ["git", "commit", "save", "version"],
      },
      {
        name: "run_tests",
        description: "Run test suite",
        inputSchema: z.object({ pattern: z.string().optional() }),
        execute: async () => ({ type: "success", content: "tests passed" }),
        permission: { scope: "repo.verify", readOnly: true },
        alwaysLoad: false,
        searchHints: ["test", "run", "verify", "check"],
      },
      {
        name: "http_request",
        description: "Make an HTTP request",
        inputSchema: z.object({ url: z.string(), method: z.string() }),
        execute: async () => ({ type: "success", content: "response" }),
        permission: { scope: "network" },
        alwaysLoad: false,
        searchHints: ["http", "request", "api", "fetch", "curl"],
      },
    ]);

    toolSearch = createToolSearchTool(registry);

    mockContext = {
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
  });

  it("should have correct metadata", () => {
    expect(toolSearch.name).toBe("tool_search");
    expect(toolSearch.alwaysLoad).toBe(true);
    expect(toolSearch.concurrencySafe).toBe(true);
    expect(toolSearch.permission.scope).toBe("meta");
    expect(toolSearch.permission.readOnly).toBe(true);
  });

  it("should find tools matching a query", async () => {
    const result = await toolSearch.execute(
      { query: "git commit", max_results: 5 },
      mockContext
    );

    expect(result.type).toBe("success");
    expect(result.content).toContain("git_commit");
    expect(result.content).toContain("Create a git commit");
    if (result.type === "success") {
      expect(result.metadata?.toolsFound).toBeGreaterThan(0);
      expect(result.metadata?.toolNames).toContain("git_commit");
    }
  });

  it("should find tools by test keywords", async () => {
    const result = await toolSearch.execute(
      { query: "run tests", max_results: 5 },
      mockContext
    );

    expect(result.type).toBe("success");
    expect(result.content).toContain("run_tests");
    if (result.type === "success") {
      expect(result.metadata?.toolNames).toContain("run_tests");
    }
  });

  it("should find tools by HTTP/API keywords", async () => {
    const result = await toolSearch.execute(
      { query: "http api", max_results: 5 },
      mockContext
    );

    expect(result.type).toBe("success");
    expect(result.content).toContain("http_request");
    if (result.type === "success") {
      expect(result.metadata?.toolNames).toContain("http_request");
    }
  });

  it("should return helpful message when no tools found", async () => {
    const result = await toolSearch.execute(
      { query: "nonexistent quantum blockchain", max_results: 5 },
      mockContext
    );

    expect(result.type).toBe("success");
    expect(result.content).toContain("No tools found");
    expect(result.content).toContain("Try different keywords");
  });

  it("should respect max_results parameter", async () => {
    const result = await toolSearch.execute(
      { query: "file", max_results: 2 },
      mockContext
    );

    expect(result.type).toBe("success");
    if (result.type === "success") {
      const toolsFound = result.metadata?.toolsFound as number;
      expect(toolsFound).toBeLessThanOrEqual(2);
    }
  });

  it("should include parameter schemas in response", async () => {
    const result = await toolSearch.execute(
      { query: "git commit", max_results: 5 },
      mockContext
    );

    expect(result.type).toBe("success");
    expect(result.content).toContain("Parameters:");
    if (result.type === "success") {
      const schemas = result.metadata?.schemas;
      expect(schemas).toBeDefined();
      expect(Array.isArray(schemas)).toBe(true);
    }
  });

  it("should use default max_results when not specified", async () => {
    const result = await toolSearch.execute(
      { query: "test" },
      mockContext
    );

    expect(result.type).toBe("success");
    // Default is 5, but we only have 4 tools, so should return all matching
    if (result.type === "success") {
      const toolsFound = result.metadata?.toolsFound as number;
      expect(toolsFound).toBeGreaterThan(0);
    }
  });

  it("should search by searchHints", async () => {
    const result = await toolSearch.execute(
      { query: "verify check", max_results: 5 },
      mockContext
    );

    expect(result.type).toBe("success");
    // "verify" and "check" are in run_tests searchHints
    expect(result.content).toContain("run_tests");
  });

  it("should handle empty query gracefully", async () => {
    const result = await toolSearch.execute(
      { query: "", max_results: 5 },
      mockContext
    );

    expect(result.type).toBe("success");
    // Empty query returns no results due to tokenization
    expect(result.content).toContain("No tools found");
  });
});
