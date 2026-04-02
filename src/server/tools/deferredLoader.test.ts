import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { ToolRegistry } from "./registry";
import { DeferredToolLoader } from "./deferredLoader";
import type { ToolDefinition } from "./types";

describe("DeferredToolLoader", () => {
  let registry: ToolRegistry;
  let loader: DeferredToolLoader;

  beforeEach(() => {
    registry = new ToolRegistry();

    // Register core tools (alwaysLoad: true or in core list)
    registry.registerAll([
      {
        name: "read_file",
        description: "Read a file",
        inputSchema: z.object({ path: z.string() }),
        execute: async () => ({ type: "success", content: "" }),
        permission: { scope: "repo.read", readOnly: true },
        alwaysLoad: true,
      },
      {
        name: "edit_file",
        description: "Edit a file",
        inputSchema: z.object({ path: z.string(), content: z.string() }),
        execute: async () => ({ type: "success", content: "" }),
        permission: { scope: "repo.edit" },
        alwaysLoad: true,
      },
      {
        name: "tool_search",
        description: "Search for tools",
        inputSchema: z.object({ query: z.string() }),
        execute: async () => ({ type: "success", content: "" }),
        permission: { scope: "meta", readOnly: true },
        alwaysLoad: true,
      },
    ]);

    // Register deferred tools (alwaysLoad: false)
    registry.registerAll([
      {
        name: "git_commit",
        description: "Create a git commit",
        inputSchema: z.object({ message: z.string() }),
        execute: async () => ({ type: "success", content: "" }),
        permission: { scope: "git.write" },
        alwaysLoad: false,
      },
      {
        name: "run_tests",
        description: "Run test suite",
        inputSchema: z.object({ pattern: z.string().optional() }),
        execute: async () => ({ type: "success", content: "" }),
        permission: { scope: "repo.verify", readOnly: true },
        alwaysLoad: false,
      },
      {
        name: "http_request",
        description: "Make HTTP request",
        inputSchema: z.object({ url: z.string() }),
        execute: async () => ({ type: "success", content: "" }),
        permission: { scope: "network" },
        alwaysLoad: false,
      },
    ]);

    loader = new DeferredToolLoader(registry);
  });

  describe("getInitialToolSchemas", () => {
    it("should return only core tools", () => {
      const schemas = loader.getInitialToolSchemas();
      const names = schemas.map((s) => s.name);

      expect(names).toContain("read_file");
      expect(names).toContain("edit_file");
      expect(names).toContain("tool_search");
      expect(names).not.toContain("git_commit");
      expect(names).not.toContain("run_tests");
    });

    it("should include tools marked with alwaysLoad: true", () => {
      const schemas = loader.getInitialToolSchemas();
      const names = schemas.map((s) => s.name);

      // All three core tools have alwaysLoad: true
      expect(names.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("getDeferredToolsList", () => {
    it("should return a formatted list of deferred tools", () => {
      const list = loader.getDeferredToolsList();

      expect(list).toContain("git_commit");
      expect(list).toContain("Create a git commit");
      expect(list).toContain("run_tests");
      expect(list).toContain("http_request");
      expect(list).toContain("tool_search");
    });

    it("should include instructions to use tool_search", () => {
      const list = loader.getDeferredToolsList();

      expect(list).toContain("tool_search");
      expect(list).toContain("use tool_search");
    });

    it("should return empty string if no deferred tools", () => {
      const emptyRegistry = new ToolRegistry();
      emptyRegistry.register({
        name: "only_core",
        description: "Only core tool",
        inputSchema: z.object({}),
        execute: async () => ({ type: "success", content: "" }),
        permission: { scope: "repo.read", readOnly: true },
        alwaysLoad: true,
      });

      const emptyLoader = new DeferredToolLoader(emptyRegistry);
      const list = emptyLoader.getDeferredToolsList();

      expect(list).toBe("");
    });
  });

  describe("markLoaded and isLoaded", () => {
    it("should mark tools as loaded", () => {
      expect(loader.isLoaded("git_commit")).toBe(false);

      loader.markLoaded("git_commit");

      expect(loader.isLoaded("git_commit")).toBe(true);
    });

    it("should mark multiple tools as loaded", () => {
      loader.markLoadedBatch(["git_commit", "run_tests"]);

      expect(loader.isLoaded("git_commit")).toBe(true);
      expect(loader.isLoaded("run_tests")).toBe(true);
      expect(loader.isLoaded("http_request")).toBe(false);
    });

    it("should consider core tools as always loaded", () => {
      expect(loader.isLoaded("read_file")).toBe(true);
      expect(loader.isLoaded("edit_file")).toBe(true);
      expect(loader.isLoaded("tool_search")).toBe(true);
    });

    it("should ignore non-existent tools", () => {
      loader.markLoaded("nonexistent_tool");

      expect(loader.isLoaded("nonexistent_tool")).toBe(false);
    });
  });

  describe("getActiveToolSchemas", () => {
    it("should return core tools initially", () => {
      const schemas = loader.getActiveToolSchemas();
      const names = schemas.map((s) => s.name);

      expect(names).toContain("read_file");
      expect(names).toContain("edit_file");
      expect(names).toContain("tool_search");
    });

    it("should include loaded tools", () => {
      loader.markLoaded("git_commit");
      loader.markLoaded("run_tests");

      const schemas = loader.getActiveToolSchemas();
      const names = schemas.map((s) => s.name);

      expect(names).toContain("git_commit");
      expect(names).toContain("run_tests");
      expect(names).not.toContain("http_request");
    });

    it("should grow as tools are loaded", () => {
      const initial = loader.getActiveToolSchemas();
      const initialCount = initial.length;

      loader.markLoaded("git_commit");

      const afterLoad = loader.getActiveToolSchemas();
      const afterCount = afterLoad.length;

      expect(afterCount).toBe(initialCount + 1);
    });
  });

  describe("getLoadedToolNames", () => {
    it("should return empty array initially", () => {
      const loaded = loader.getLoadedToolNames();

      expect(loaded).toEqual([]);
    });

    it("should return loaded tool names", () => {
      loader.markLoaded("git_commit");
      loader.markLoaded("run_tests");

      const loaded = loader.getLoadedToolNames();

      expect(loaded).toContain("git_commit");
      expect(loaded).toContain("run_tests");
      expect(loaded.length).toBe(2);
    });

    it("should not include core tools", () => {
      // Core tools are not in the loadedTools set
      const loaded = loader.getLoadedToolNames();

      expect(loaded).not.toContain("read_file");
      expect(loaded).not.toContain("edit_file");
    });
  });

  describe("reset", () => {
    it("should clear loaded tools", () => {
      loader.markLoaded("git_commit");
      loader.markLoaded("run_tests");

      expect(loader.getLoadedToolNames().length).toBe(2);

      loader.reset();

      expect(loader.getLoadedToolNames().length).toBe(0);
      expect(loader.isLoaded("git_commit")).toBe(false);
    });

    it("should not affect core tools", () => {
      loader.reset();

      expect(loader.isLoaded("read_file")).toBe(true);
      expect(loader.isLoaded("edit_file")).toBe(true);
    });
  });

  describe("getStats", () => {
    it("should return correct counts", () => {
      const stats = loader.getStats();

      expect(stats.coreCount).toBe(7); // read_file, edit_file, write_file, bash, complete_task, tool_search, ask_user
      expect(stats.deferredCount).toBe(3); // git_commit, run_tests, http_request
      expect(stats.totalCount).toBe(6); // All registered tools
      expect(stats.loadedCount).toBe(0); // None loaded yet
    });

    it("should track loaded count", () => {
      loader.markLoaded("git_commit");
      loader.markLoaded("run_tests");

      const stats = loader.getStats();

      expect(stats.loadedCount).toBe(2);
    });

    it("should show total available tools", () => {
      const stats = loader.getStats();

      // Total = core tools + deferred tools in registry
      expect(stats.totalCount).toBe(6);
    });
  });
});
