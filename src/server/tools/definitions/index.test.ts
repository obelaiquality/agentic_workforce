import { describe, it, expect } from "vitest";
import { getAllCoreTools, getCoreToolNames, getInitialCoreTools, getDeferredCoreTools } from "./index";

describe("Tool Definitions", () => {
  describe("getAllCoreTools", () => {
    it("should return all core tools (16 base + 4 LSP + 3 team + 2 plan mode + 3 task decomposition)", () => {
      const tools = getAllCoreTools();
      expect(tools).toHaveLength(28);
    });

    it("should include all required file operation tools", () => {
      const names = getCoreToolNames();
      expect(names).toContain("read_file");
      expect(names).toContain("edit_file");
      expect(names).toContain("write_file");
      expect(names).toContain("list_files");
      expect(names).toContain("grep_search");
      expect(names).toContain("glob_search");
    });

    it("should include bash tool", () => {
      const names = getCoreToolNames();
      expect(names).toContain("bash");
    });

    it("should include all git tools", () => {
      const names = getCoreToolNames();
      expect(names).toContain("git_status");
      expect(names).toContain("git_diff");
      expect(names).toContain("git_commit");
    });

    it("should include verification tools", () => {
      const names = getCoreToolNames();
      expect(names).toContain("run_tests");
      expect(names).toContain("run_lint");
    });

    it("should include meta tools", () => {
      const names = getCoreToolNames();
      expect(names).toContain("rollback_file");
      expect(names).toContain("ask_user");
      expect(names).toContain("complete_task");
      expect(names).toContain("skill");
    });

    it("should include plan mode tools", () => {
      const names = getCoreToolNames();
      expect(names).toContain("submit_plan");
      expect(names).toContain("ask_plan_question");
    });

    it("should include task decomposition tools", () => {
      const names = getCoreToolNames();
      expect(names).toContain("create_subtask");
      expect(names).toContain("update_subtask");
      expect(names).toContain("list_subtasks");
    });
  });

  describe("Tool Properties", () => {
    it("all tools should have required properties", () => {
      const tools = getAllCoreTools();
      for (const tool of tools) {
        expect(tool).toHaveProperty("name");
        expect(tool).toHaveProperty("description");
        expect(tool).toHaveProperty("inputSchema");
        expect(tool).toHaveProperty("execute");
        expect(tool).toHaveProperty("permission");

        expect(typeof tool.name).toBe("string");
        expect(typeof tool.description).toBe("string");
        expect(typeof tool.execute).toBe("function");
        expect(tool.permission).toHaveProperty("scope");
      }
    });

    it("all read-only tools should be marked as readOnly", () => {
      const tools = getAllCoreTools();
      const readOnlyTools = ["read_file", "list_files", "grep_search", "glob_search", "git_status", "git_diff", "ask_user", "complete_task"];

      for (const tool of tools) {
        if (readOnlyTools.includes(tool.name)) {
          expect(tool.permission.readOnly).toBe(true);
        }
      }
    });

    it("write operations should have correct permissions", () => {
      const tools = getAllCoreTools();
      const toolMap = Object.fromEntries(tools.map(t => [t.name, t]));

      expect(toolMap["edit_file"].permission.scope).toBe("repo.edit");
      expect(toolMap["write_file"].permission.scope).toBe("repo.edit");
      expect(toolMap["git_commit"].permission.scope).toBe("git.write");
      expect(toolMap["rollback_file"].permission.scope).toBe("repo.edit");
    });
  });

  describe("Tool Loading Strategy", () => {
    it("should have correct initial vs deferred tools", () => {
      const initial = getInitialCoreTools();
      const deferred = getDeferredCoreTools();

      // rollback_file should be deferred
      expect(deferred.map(t => t.name)).toContain("rollback_file");

      // Most tools should be initial
      expect(initial.length).toBeGreaterThan(10);
    });

    it("all tools should specify alwaysLoad explicitly or default to true", () => {
      const tools = getAllCoreTools();
      for (const tool of tools) {
        // alwaysLoad is either undefined (defaults to true) or explicitly set
        expect([true, false, undefined]).toContain(tool.alwaysLoad);
      }
    });
  });

  describe("getCoreToolNames", () => {
    it("should return array of tool names", () => {
      const names = getCoreToolNames();
      expect(names).toHaveLength(28);
      expect(names.every(n => typeof n === "string")).toBe(true);
    });

    it("should have unique names", () => {
      const names = getCoreToolNames();
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });
  });
});
