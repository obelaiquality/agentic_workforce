import { describe, expect, it } from "vitest";
import {
  compactToolResult,
  compactToolResultContent,
  inferToolType,
  DEFAULT_MICRO_COMPACT_THRESHOLD,
} from "./microCompactor";

describe("microCompactor", () => {
  describe("inferToolType", () => {
    it("maps bash to shell", () => {
      expect(inferToolType("bash")).toBe("shell");
    });

    it("maps run_tests to shell", () => {
      expect(inferToolType("run_tests")).toBe("shell");
    });

    it("maps read_file to file_read", () => {
      expect(inferToolType("read_file")).toBe("file_read");
    });

    it("maps grep_search to search", () => {
      expect(inferToolType("grep_search")).toBe("search");
    });

    it("maps run_build to build", () => {
      expect(inferToolType("run_build")).toBe("build");
    });

    it("maps unknown tools to generic", () => {
      expect(inferToolType("custom_tool")).toBe("generic");
      expect(inferToolType("write_file")).toBe("generic");
    });
  });

  describe("compactToolResult", () => {
    it("returns content unchanged when under threshold", () => {
      const small = "Hello, world!";
      expect(compactToolResult(small, "bash")).toBe(small);
    });

    it("returns content unchanged when exactly at threshold", () => {
      const exact = "x".repeat(DEFAULT_MICRO_COMPACT_THRESHOLD);
      expect(compactToolResult(exact, "bash")).toBe(exact);
    });

    it("compacts shell output over threshold", () => {
      const lines = Array.from({ length: 500 }, (_, i) => `line ${i}: output data here`);
      lines[100] = "ERROR: something failed badly";
      lines[200] = "fatal: compilation error";
      const large = lines.join("\n");

      const result = compactToolResult(large, "bash", 100);
      expect(result.length).toBeLessThan(large.length);
      expect(result).toContain("ERROR: something failed badly");
      expect(result).toContain("fatal: compilation error");
      expect(result).toContain("truncated");
    });

    it("compacts file read output over threshold", () => {
      const lines = Array.from({ length: 500 }, (_, i) => `const var${i} = ${i};`);
      const large = lines.join("\n");

      const result = compactToolResult(large, "read_file", 100);
      expect(result.length).toBeLessThan(large.length);
      expect(result).toContain("omitted");
    });

    it("compacts search results over threshold", () => {
      const blocks = Array.from({ length: 50 }, (_, i) => `File: src/file${i}.ts\nLine 1: match found`);
      const large = blocks.join("\n\n");

      const result = compactToolResult(large, "grep_search", 100);
      expect(result.length).toBeLessThan(large.length);
      expect(result).toContain("omitted");
    });

    it("compacts build output over threshold", () => {
      const lines = [
        ...Array.from({ length: 200 }, (_, i) => `Building module ${i}...`),
        "error TS2304: Cannot find name 'foo'",
        "warning: unused variable 'bar'",
      ];
      const large = lines.join("\n");

      const result = compactToolResult(large, "run_build", 100);
      expect(result.length).toBeLessThan(large.length);
      expect(result).toContain("error TS2304");
      expect(result).toContain("warning: unused variable");
    });

    it("uses generic strategy for unknown tool types", () => {
      const lines = Array.from({ length: 500 }, (_, i) => `data row ${i}`);
      lines[250] = "ERROR: unexpected value";
      const large = lines.join("\n");

      const result = compactToolResult(large, "custom_tool", 100);
      expect(result.length).toBeLessThan(large.length);
      expect(result).toContain("ERROR: unexpected value");
      expect(result).toContain("omitted");
    });

    it("preserves error lines in generic compaction", () => {
      const lines = [
        ...Array.from({ length: 100 }, (_, i) => `info: step ${i}`),
        "FATAL: out of memory",
        "exception: stack overflow",
        "traceback: in function foo",
        ...Array.from({ length: 100 }, (_, i) => `info: step ${i + 100}`),
      ];
      const large = lines.join("\n");

      const result = compactToolResult(large, "unknown", 100);
      expect(result).toContain("FATAL: out of memory");
      expect(result).toContain("exception: stack overflow");
      expect(result).toContain("traceback: in function foo");
    });
  });

  describe("compactToolResultContent", () => {
    it("returns undefined for undefined input", () => {
      expect(compactToolResultContent("bash", undefined)).toBeUndefined();
    });

    it("returns small content unchanged", () => {
      expect(compactToolResultContent("bash", "small output")).toBe("small output");
    });

    it("compacts large content", () => {
      const large = "x\n".repeat(10_000);
      const result = compactToolResultContent("bash", large, 100);
      expect(result).toBeDefined();
      expect(result!.length).toBeLessThan(large.length);
    });

    it("respects custom threshold", () => {
      const medium = "x".repeat(500);
      // Under custom threshold — unchanged
      expect(compactToolResultContent("bash", medium, 1000)).toBe(medium);
      // Over custom threshold — compacted
      const result = compactToolResultContent("bash", medium + "\n".repeat(500), 100);
      expect(result).toBeDefined();
    });
  });
});
