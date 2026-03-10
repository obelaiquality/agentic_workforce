import { describe, expect, it } from "vitest";
import {
  extractJsonObject,
  parsePatchManifest,
  mapConsoleCategory,
  mapConsoleLevel,
  removeUnusedImportSymbol,
  findMissingImportTargets,
  repairImportPathAfterMove,
  repairStaleAssertion,
} from "./patchHelpers";

describe("extractJsonObject", () => {
  it("parses bare JSON", () => {
    const result = extractJsonObject('{"summary": "hello"}');
    expect(result.summary).toBe("hello");
  });

  it("extracts JSON from fenced code block", () => {
    const input = '```json\n{"summary": "fenced"}\n```';
    const result = extractJsonObject(input);
    expect(result.summary).toBe("fenced");
  });

  it("extracts JSON from code block without language tag", () => {
    const input = '```\n{"summary": "no-lang"}\n```';
    const result = extractJsonObject(input);
    expect(result.summary).toBe("no-lang");
  });

  it("throws on non-JSON input", () => {
    expect(() => extractJsonObject("Just some text")).toThrow("Model did not return a JSON object");
  });

  it("throws on empty input", () => {
    expect(() => extractJsonObject("")).toThrow("Model did not return a JSON object");
  });

  it("handles JSON with surrounding commentary", () => {
    const input = 'Here is the plan:\n{"summary": "with preamble"}\nDone.';
    const result = extractJsonObject(input);
    expect(result.summary).toBe("with preamble");
  });
});

describe("parsePatchManifest", () => {
  it("parses a valid manifest with files", () => {
    const input = JSON.stringify({
      summary: "Add component",
      files: [
        { path: "src/Foo.tsx", action: "create", reason: "Create Foo component" },
        { path: "src/App.tsx", action: "update", reason: "Render Foo" },
      ],
      docsChecked: ["README.md"],
      tests: ["src/App.test.tsx"],
    });

    const result = parsePatchManifest(input);
    expect(result.summary).toBe("Add component");
    expect(result.files).toHaveLength(2);
    expect(result.files[0].path).toBe("src/Foo.tsx");
    expect(result.files[0].action).toBe("create");
    expect(result.files[0].strategy).toBe("full_file");
    expect(result.files[1].action).toBe("update");
    expect(result.docsChecked).toEqual(["README.md"]);
    expect(result.tests).toEqual(["src/App.test.tsx"]);
  });

  it("defaults action to update for unknown values", () => {
    const input = JSON.stringify({
      summary: "Fix",
      files: [{ path: "src/main.ts", action: "patch", reason: "Fix bug" }],
    });

    const result = parsePatchManifest(input);
    expect(result.files[0].action).toBe("update");
  });

  it("provides default reason when missing", () => {
    const input = JSON.stringify({
      summary: "Update",
      files: [{ path: "src/main.ts", action: "update" }],
    });

    const result = parsePatchManifest(input);
    expect(result.files[0].reason).toBe("Update this file to satisfy the objective.");
  });

  it("filters files with empty paths", () => {
    const input = JSON.stringify({
      summary: "Update",
      files: [
        { path: "", action: "create", reason: "Empty" },
        { path: "src/valid.ts", action: "create", reason: "Valid" },
      ],
    });

    const result = parsePatchManifest(input);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toBe("src/valid.ts");
  });

  it("handles missing files array gracefully", () => {
    const input = JSON.stringify({ summary: "No files" });
    const result = parsePatchManifest(input);
    expect(result.files).toEqual([]);
    expect(result.docsChecked).toEqual([]);
    expect(result.tests).toEqual([]);
  });

  it("preserves raw text", () => {
    const input = JSON.stringify({ summary: "Raw" });
    const result = parsePatchManifest(input);
    expect(result.raw).toBe(input);
  });

  it("rejects commentary instead of JSON", () => {
    expect(() => parsePatchManifest("I think we should update the file")).toThrow();
  });

  it("maps strategy correctly", () => {
    const input = JSON.stringify({
      summary: "Strategies",
      files: [
        { path: "a.ts", action: "update", strategy: "unified_diff", reason: "diff" },
        { path: "b.ts", action: "update", strategy: "search_replace", reason: "sr" },
        { path: "c.ts", action: "create", strategy: "full_file", reason: "full" },
        { path: "d.ts", action: "update", strategy: "unknown", reason: "fallback" },
      ],
    });

    const result = parsePatchManifest(input);
    expect(result.files[0].strategy).toBe("unified_diff");
    expect(result.files[1].strategy).toBe("search_replace");
    expect(result.files[2].strategy).toBe("full_file");
    expect(result.files[3].strategy).toBe("full_file");
  });
});

describe("mapConsoleCategory", () => {
  it("maps execution events", () => {
    expect(mapConsoleCategory("execution.started")).toBe("execution");
    expect(mapConsoleCategory("execution.completed")).toBe("execution");
    expect(mapConsoleCategory("task.transition")).toBe("execution");
  });

  it("maps verification events", () => {
    expect(mapConsoleCategory("verification.passed")).toBe("verification");
    expect(mapConsoleCategory("verification.failed")).toBe("verification");
    expect(mapConsoleCategory("run.verify")).toBe("verification");
  });

  it("maps approval events", () => {
    expect(mapConsoleCategory("approval.requested")).toBe("approval");
    expect(mapConsoleCategory("approval.decided")).toBe("approval");
    expect(mapConsoleCategory("pending.approval")).toBe("approval");
  });

  it("maps indexing events", () => {
    expect(mapConsoleCategory("repo.index.started")).toBe("indexing");
    expect(mapConsoleCategory("codegraph.updated")).toBe("indexing");
    expect(mapConsoleCategory("context.pack.built")).toBe("indexing");
  });

  it("defaults to provider for unrecognized types", () => {
    expect(mapConsoleCategory("model.inference")).toBe("provider");
    expect(mapConsoleCategory("unknown.event")).toBe("provider");
  });

  it("only returns valid categories", () => {
    const validCategories = new Set(["execution", "verification", "provider", "approval", "indexing"]);
    const testTypes = [
      "execution.started",
      "verification.failed",
      "approval.requested",
      "repo.index.done",
      "codegraph.sync",
      "context.pack.ready",
      "some.random.event",
    ];
    for (const type of testTypes) {
      expect(validCategories.has(mapConsoleCategory(type))).toBe(true);
    }
  });
});

describe("mapConsoleLevel", () => {
  it("maps error-level events", () => {
    expect(mapConsoleLevel("execution.failed")).toBe("error");
    expect(mapConsoleLevel("verification.error")).toBe("error");
    expect(mapConsoleLevel("approval.rejected")).toBe("error");
  });

  it("maps warn-level events", () => {
    expect(mapConsoleLevel("approval.pending")).toBe("warn");
    expect(mapConsoleLevel("provider.cooldown")).toBe("warn");
    expect(mapConsoleLevel("execution.warn")).toBe("warn");
  });

  it("defaults to info", () => {
    expect(mapConsoleLevel("execution.started")).toBe("info");
    expect(mapConsoleLevel("verification.passed")).toBe("info");
  });
});

describe("removeUnusedImportSymbol", () => {
  it("removes a single named import", () => {
    const input = 'import { Foo } from "./foo";\nconst x = 1;\n';
    const result = removeUnusedImportSymbol(input, "Foo");
    expect(result.changed).toBe(true);
    expect(result.content).not.toContain("Foo");
    expect(result.content).not.toContain("import");
  });

  it("removes one symbol from multi-import", () => {
    const input = 'import { Foo, Bar } from "./mod";\n';
    const result = removeUnusedImportSymbol(input, "Foo");
    expect(result.changed).toBe(true);
    expect(result.content).toContain("Bar");
    expect(result.content).not.toMatch(/\bFoo\b/);
  });

  it("does nothing when symbol is not found", () => {
    const input = 'import { Bar } from "./bar";\n';
    const result = removeUnusedImportSymbol(input, "Foo");
    expect(result.changed).toBe(false);
    expect(result.content).toBe(input);
  });

  it("does not remove symbol from non-import lines", () => {
    const input = "const Foo = 1;\n";
    const result = removeUnusedImportSymbol(input, "Foo");
    expect(result.changed).toBe(false);
    expect(result.content).toContain("Foo");
  });
});

describe("findMissingImportTargets", () => {
  it("extracts relative import specifiers from error output", () => {
    const output = `Failed to resolve import "./components/StatusBadge" from "src/App.tsx"`;
    const result = findMissingImportTargets({
      worktreePath: "/tmp/repo",
      combinedOutput: output,
    });
    expect(result).toContain("./components/StatusBadge");
  });

  it("ignores non-relative imports", () => {
    const output = `Failed to resolve import "react" from "src/App.tsx"`;
    const result = findMissingImportTargets({
      worktreePath: "/tmp/repo",
      combinedOutput: output,
    });
    expect(result).toEqual([]);
  });

  it("deduplicates targets", () => {
    const output = [
      `Failed to resolve import "./Foo" from "src/a.tsx"`,
      `Failed to resolve import "./Foo" from "src/b.tsx"`,
    ].join("\n");
    const result = findMissingImportTargets({
      worktreePath: "/tmp/repo",
      combinedOutput: output,
    });
    expect(result).toEqual(["./Foo"]);
  });

  it("returns empty for clean output", () => {
    const result = findMissingImportTargets({
      worktreePath: "/tmp/repo",
      combinedOutput: "Build succeeded. 0 errors.",
    });
    expect(result).toEqual([]);
  });
});

describe("repairImportPathAfterMove", () => {
  it("rewrites import path when file is moved", () => {
    const content = `import { Foo } from "./components/Foo";\n`;
    const result = repairImportPathAfterMove({
      fileContent: content,
      oldRelativePath: "components/Foo.tsx",
      newRelativePath: "ui/Foo.tsx",
    });
    expect(result.changed).toBe(true);
    expect(result.content).toContain("./ui/Foo");
    expect(result.content).not.toContain("./components/Foo");
  });

  it("does nothing when paths are identical", () => {
    const content = `import { Foo } from "./Foo";\n`;
    const result = repairImportPathAfterMove({
      fileContent: content,
      oldRelativePath: "Foo.tsx",
      newRelativePath: "Foo.tsx",
    });
    expect(result.changed).toBe(false);
  });

  it("does not change non-relative imports", () => {
    const content = `import React from "react";\n`;
    const result = repairImportPathAfterMove({
      fileContent: content,
      oldRelativePath: "react.ts",
      newRelativePath: "react2.ts",
    });
    expect(result.changed).toBe(false);
  });

  it("handles require() calls", () => {
    const content = `const foo = require("./old/path");\n`;
    const result = repairImportPathAfterMove({
      fileContent: content,
      oldRelativePath: "old/path.ts",
      newRelativePath: "new/path.ts",
    });
    expect(result.changed).toBe(true);
    expect(result.content).toContain("./new/path");
  });

  it("does not change lines without imports", () => {
    const content = `const x = 1;\nconst y = 2;\n`;
    const result = repairImportPathAfterMove({
      fileContent: content,
      oldRelativePath: "a.ts",
      newRelativePath: "b.ts",
    });
    expect(result.changed).toBe(false);
    expect(result.content).toBe(content);
  });
});

describe("repairStaleAssertion", () => {
  it("replaces old text with new text in test content", () => {
    const testContent = `expect(screen.getByText("Hello World")).toBeInTheDocument();\n`;
    const result = repairStaleAssertion({
      testContent,
      oldText: "Hello World",
      newText: "Hello Universe",
    });
    expect(result.changed).toBe(true);
    expect(result.content).toContain("Hello Universe");
    expect(result.content).not.toContain("Hello World");
  });

  it("replaces all occurrences", () => {
    const testContent = [
      `expect(screen.getByText("Foo")).toBeInTheDocument();`,
      `expect(screen.getByLabelText("Foo")).toBeVisible();`,
    ].join("\n");
    const result = repairStaleAssertion({
      testContent,
      oldText: "Foo",
      newText: "Bar",
    });
    expect(result.changed).toBe(true);
    const fooCount = (result.content.match(/Foo/g) || []).length;
    expect(fooCount).toBe(0);
  });

  it("returns unchanged when old text is not found", () => {
    const testContent = `expect(1).toBe(1);\n`;
    const result = repairStaleAssertion({
      testContent,
      oldText: "NotHere",
      newText: "New",
    });
    expect(result.changed).toBe(false);
    expect(result.content).toBe(testContent);
  });

  it("returns unchanged when old and new are identical", () => {
    const testContent = `expect("same").toBe("same");\n`;
    const result = repairStaleAssertion({
      testContent,
      oldText: "same",
      newText: "same",
    });
    expect(result.changed).toBe(false);
  });

  it("returns unchanged for empty inputs", () => {
    expect(repairStaleAssertion({ testContent: "x", oldText: "", newText: "y" }).changed).toBe(false);
    expect(repairStaleAssertion({ testContent: "x", oldText: "x", newText: "" }).changed).toBe(false);
  });
});
