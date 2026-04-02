import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { ToolRegistry, createToolRegistry } from "./registry";
import type { ToolDefinition, ToolContext, ToolResult } from "./types";

// Helper to create a minimal ToolContext for testing
function createMockContext(): ToolContext {
  return {
    runId: "test-run",
    repoId: "test-repo",
    ticketId: "test-ticket",
    worktreePath: "/tmp/test",
    actor: "test-actor",
    stage: "build",
    conversationHistory: [],
    createApproval: async () => ({ id: "approval-1" }),
    recordEvent: async () => {},
  };
}

// Sample tool definitions for testing
const readTool: ToolDefinition = {
  name: "read_file",
  description: "Read a file from disk",
  inputSchema: z.object({ path: z.string() }),
  permission: { scope: "repo.read", readOnly: true },
  alwaysLoad: true,
  concurrencySafe: true,
  aliases: ["read", "cat"],
  searchHints: ["file", "content", "view"],
  async execute(input) {
    return { type: "success", content: `Reading ${input.path}` };
  },
};

const writeTool: ToolDefinition = {
  name: "write_file",
  description: "Write content to a file",
  inputSchema: z.object({ path: z.string(), content: z.string() }),
  permission: { scope: "repo.edit" },
  alwaysLoad: true,
  concurrencySafe: false,
  async execute(input) {
    return { type: "success", content: `Wrote to ${input.path}` };
  },
};

const deferredTool: ToolDefinition = {
  name: "fancy_analysis",
  description: "Perform advanced code analysis",
  inputSchema: z.object({ file: z.string(), depth: z.number().optional() }),
  permission: { scope: "repo.read", readOnly: true },
  alwaysLoad: false, // Deferred loading
  concurrencySafe: true,
  searchHints: ["analyze", "ast", "complexity"],
  async execute() {
    return { type: "success", content: "Analysis complete" };
  },
};

const disabledTool: ToolDefinition = {
  name: "disabled_tool",
  description: "Tool that is context-dependent",
  inputSchema: z.object({}),
  permission: { scope: "repo.read" },
  isEnabled: (ctx) => ctx.stage === "review",
  async execute() {
    return { type: "success", content: "OK" };
  },
};

describe("ToolRegistry", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = createToolRegistry();
  });

  // ── register() ──────────────────────────────────────────────────────────────

  describe("register()", () => {
    it("registers a tool successfully", () => {
      registry.register(readTool);
      expect(registry.has("read_file")).toBe(true);
      expect(registry.get("read_file")).toBe(readTool);
    });

    it("registers aliases", () => {
      registry.register(readTool);
      expect(registry.has("read")).toBe(true);
      expect(registry.has("cat")).toBe(true);
      expect(registry.get("read")).toBe(readTool);
      expect(registry.get("cat")).toBe(readTool);
    });

    it("rejects duplicate tool names", () => {
      registry.register(readTool);
      expect(() => registry.register(readTool)).toThrow("Tool already registered: read_file");
    });
  });

  // ── registerAll() ───────────────────────────────────────────────────────────

  describe("registerAll()", () => {
    it("registers multiple tools at once", () => {
      registry.registerAll([readTool, writeTool, deferredTool]);
      expect(registry.size).toBe(3);
      expect(registry.has("read_file")).toBe(true);
      expect(registry.has("write_file")).toBe(true);
      expect(registry.has("fancy_analysis")).toBe(true);
    });
  });

  // ── get() ───────────────────────────────────────────────────────────────────

  describe("get()", () => {
    beforeEach(() => {
      registry.register(readTool);
    });

    it("retrieves tool by name", () => {
      expect(registry.get("read_file")).toBe(readTool);
    });

    it("retrieves tool by alias", () => {
      expect(registry.get("read")).toBe(readTool);
      expect(registry.get("cat")).toBe(readTool);
    });

    it("returns undefined for unknown tool", () => {
      expect(registry.get("nonexistent")).toBeUndefined();
    });
  });

  // ── has() ───────────────────────────────────────────────────────────────────

  describe("has()", () => {
    beforeEach(() => {
      registry.register(readTool);
    });

    it("returns true for existing tool", () => {
      expect(registry.has("read_file")).toBe(true);
    });

    it("returns true for alias", () => {
      expect(registry.has("read")).toBe(true);
      expect(registry.has("cat")).toBe(true);
    });

    it("returns false for non-existent tool", () => {
      expect(registry.has("nonexistent")).toBe(false);
    });
  });

  // ── list(), names(), size ───────────────────────────────────────────────────

  describe("list(), names(), size", () => {
    beforeEach(() => {
      registry.registerAll([readTool, writeTool]);
    });

    it("lists all registered tools", () => {
      const tools = registry.list();
      expect(tools).toHaveLength(2);
      expect(tools).toContain(readTool);
      expect(tools).toContain(writeTool);
    });

    it("returns tool names", () => {
      const names = registry.names();
      expect(names).toEqual(expect.arrayContaining(["read_file", "write_file"]));
      expect(names).toHaveLength(2);
    });

    it("returns size", () => {
      expect(registry.size).toBe(2);
    });
  });

  // ── getInitialTools() vs getDeferredTools() ─────────────────────────────────

  describe("getInitialTools() and getDeferredTools()", () => {
    beforeEach(() => {
      registry.registerAll([readTool, writeTool, deferredTool]);
    });

    it("getInitialTools() returns tools with alwaysLoad=true or undefined", () => {
      const initial = registry.getInitialTools();
      expect(initial).toHaveLength(2);
      expect(initial.map((t) => t.name)).toEqual(expect.arrayContaining(["read_file", "write_file"]));
    });

    it("getDeferredTools() returns tools with alwaysLoad=false", () => {
      const deferred = registry.getDeferredTools();
      expect(deferred).toHaveLength(1);
      expect(deferred[0].name).toBe("fancy_analysis");
    });
  });

  // ── getDeferredToolSummaries() ──────────────────────────────────────────────

  describe("getDeferredToolSummaries()", () => {
    beforeEach(() => {
      registry.registerAll([readTool, deferredTool]);
    });

    it("returns name and description for deferred tools", () => {
      const summaries = registry.getDeferredToolSummaries();
      expect(summaries).toHaveLength(1);
      expect(summaries[0]).toEqual({
        name: "fancy_analysis",
        description: "Perform advanced code analysis",
      });
    });
  });

  // ── searchTools() ───────────────────────────────────────────────────────────

  describe("searchTools()", () => {
    beforeEach(() => {
      registry.registerAll([readTool, writeTool, deferredTool]);
    });

    it("finds tools by keyword in name", () => {
      const results = registry.searchTools("file");
      expect(results.length).toBeGreaterThan(0);
      expect(results.map((t) => t.name)).toContain("read_file");
    });

    it("finds tools by keyword in description", () => {
      const results = registry.searchTools("analysis");
      expect(results.map((t) => t.name)).toContain("fancy_analysis");
    });

    it("finds tools by keyword in searchHints", () => {
      const results = registry.searchTools("ast");
      expect(results.map((t) => t.name)).toContain("fancy_analysis");
    });

    it("ranks by relevance (more matching tokens = higher score)", () => {
      const results = registry.searchTools("file read");
      expect(results[0].name).toBe("read_file");
    });

    it("respects max_results limit", () => {
      const results = registry.searchTools("file", 1);
      expect(results).toHaveLength(1);
    });

    it("returns empty array for empty query", () => {
      const results = registry.searchTools("");
      expect(results).toEqual([]);
    });

    it("returns empty array for query with only short tokens", () => {
      const results = registry.searchTools("a b c");
      expect(results).toEqual([]);
    });
  });

  // ── toJsonSchema() ──────────────────────────────────────────────────────────

  describe("toJsonSchema()", () => {
    it("converts Zod string schema", () => {
      const tool: ToolDefinition = {
        name: "test",
        description: "Test tool",
        inputSchema: z.object({ name: z.string() }),
        permission: { scope: "repo.read" },
        async execute() {
          return { type: "success", content: "OK" };
        },
      };
      const schema = registry.toJsonSchema(tool);
      expect(schema).toEqual({
        name: "test",
        description: "Test tool",
        parameters: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
      });
    });

    it("converts Zod number schema", () => {
      const tool: ToolDefinition = {
        name: "test",
        description: "Test tool",
        inputSchema: z.object({ count: z.number() }),
        permission: { scope: "repo.read" },
        async execute() {
          return { type: "success", content: "OK" };
        },
      };
      const schema = registry.toJsonSchema(tool);
      expect(schema.parameters).toMatchObject({
        type: "object",
        properties: { count: { type: "number" } },
        required: ["count"],
      });
    });

    it("converts Zod boolean schema", () => {
      const tool: ToolDefinition = {
        name: "test",
        description: "Test tool",
        inputSchema: z.object({ flag: z.boolean() }),
        permission: { scope: "repo.read" },
        async execute() {
          return { type: "success", content: "OK" };
        },
      };
      const schema = registry.toJsonSchema(tool);
      expect(schema.parameters).toMatchObject({
        type: "object",
        properties: { flag: { type: "boolean" } },
        required: ["flag"],
      });
    });

    it("converts Zod optional schema", () => {
      const tool: ToolDefinition = {
        name: "test",
        description: "Test tool",
        inputSchema: z.object({ name: z.string(), age: z.number().optional() }),
        permission: { scope: "repo.read" },
        async execute() {
          return { type: "success", content: "OK" };
        },
      };
      const schema = registry.toJsonSchema(tool);
      expect(schema.parameters).toMatchObject({
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
        required: ["name"],
      });
    });

    it("converts Zod array schema", () => {
      const tool: ToolDefinition = {
        name: "test",
        description: "Test tool",
        inputSchema: z.object({ tags: z.array(z.string()) }),
        permission: { scope: "repo.read" },
        async execute() {
          return { type: "success", content: "OK" };
        },
      };
      const schema = registry.toJsonSchema(tool);
      expect(schema.parameters).toMatchObject({
        type: "object",
        properties: {
          tags: { type: "array", items: { type: "string" } },
        },
      });
    });

    it("converts Zod enum schema", () => {
      const tool: ToolDefinition = {
        name: "test",
        description: "Test tool",
        inputSchema: z.object({ status: z.enum(["pending", "done"]) }),
        permission: { scope: "repo.read" },
        async execute() {
          return { type: "success", content: "OK" };
        },
      };
      const schema = registry.toJsonSchema(tool);
      expect(schema.parameters).toMatchObject({
        type: "object",
        properties: {
          status: { type: "string", enum: ["pending", "done"] },
        },
      });
    });
  });

  // ── toJsonSchemas() ─────────────────────────────────────────────────────────

  describe("toJsonSchemas()", () => {
    beforeEach(() => {
      registry.registerAll([readTool, writeTool, deferredTool]);
    });

    it("returns JSON schemas for initial tools only", () => {
      const schemas = registry.toJsonSchemas();
      expect(schemas).toHaveLength(2);
      expect(schemas.map((s) => s.name)).toEqual(expect.arrayContaining(["read_file", "write_file"]));
      expect(schemas.map((s) => s.name)).not.toContain("fancy_analysis");
    });
  });

  // ── toJsonSchemasFor() ──────────────────────────────────────────────────────

  describe("toJsonSchemasFor()", () => {
    beforeEach(() => {
      registry.registerAll([readTool, writeTool, deferredTool]);
    });

    it("returns JSON schemas for specific tool names", () => {
      const schemas = registry.toJsonSchemasFor(["read_file", "fancy_analysis"]);
      expect(schemas).toHaveLength(2);
      expect(schemas.map((s) => s.name)).toEqual(expect.arrayContaining(["read_file", "fancy_analysis"]));
    });

    it("filters out unknown tools", () => {
      const schemas = registry.toJsonSchemasFor(["read_file", "nonexistent"]);
      expect(schemas).toHaveLength(1);
      expect(schemas[0].name).toBe("read_file");
    });
  });

  // ── executeValidated() ──────────────────────────────────────────────────────

  describe("executeValidated()", () => {
    const ctx = createMockContext();

    beforeEach(() => {
      registry.registerAll([readTool, writeTool, disabledTool]);
    });

    it("executes tool with valid input", async () => {
      const result = await registry.executeValidated("read_file", { path: "test.txt" }, ctx);
      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toContain("Reading test.txt");
      }
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("returns error for unknown tool", async () => {
      const result = await registry.executeValidated("nonexistent", {}, ctx);
      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error).toContain("Unknown tool: nonexistent");
      }
    });

    it("returns error for validation failure", async () => {
      const result = await registry.executeValidated("read_file", { invalidKey: "value" }, ctx);
      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error).toContain("Invalid input");
      }
    });

    it("returns error for execution failure", async () => {
      const failingTool: ToolDefinition = {
        name: "fail_tool",
        description: "Always fails",
        inputSchema: z.object({}),
        permission: { scope: "repo.read" },
        async execute() {
          throw new Error("Intentional failure");
        },
      };
      registry.register(failingTool);

      const result = await registry.executeValidated("fail_tool", {}, ctx);
      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error).toContain("execution failed");
        expect(result.error).toContain("Intentional failure");
      }
    });

    it("returns error for disabled tool", async () => {
      const buildCtx = { ...ctx, stage: "build" as const };
      const result = await registry.executeValidated("disabled_tool", {}, buildCtx);
      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error).toContain("not available in this context");
      }
    });

    it("executes enabled tool successfully", async () => {
      const reviewCtx = { ...ctx, stage: "review" as const };
      const result = await registry.executeValidated("disabled_tool", {}, reviewCtx);
      expect(result.type).toBe("success");
    });
  });
});
