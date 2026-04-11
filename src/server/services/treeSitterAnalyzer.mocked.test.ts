/**
 * Tests for treeSitterAnalyzer with tree-sitter mocked as available.
 * This exercises the internal parsing branches (lines 93-125, 135-167)
 * that only run when tree-sitter is installed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock tree-sitter and language grammars ─────────────────────────────────────

function createMockNode(overrides: Partial<{
  type: string;
  text: string;
  namedChildren: unknown[];
  childForFieldName: (name: string) => unknown;
  descendantsOfType: (types: string | string[]) => unknown[];
}> = {}) {
  return {
    type: overrides.type ?? "program",
    text: overrides.text ?? "",
    namedChildren: overrides.namedChildren ?? [],
    childForFieldName: overrides.childForFieldName ?? (() => null),
    descendantsOfType: overrides.descendantsOfType ?? (() => []),
  };
}

const mockParse = vi.fn();
const mockSetLanguage = vi.fn();

vi.mock("tree-sitter", () => {
  class MockParser {
    setLanguage = mockSetLanguage;
    parse = mockParse;
  }
  return { default: MockParser };
});

const mockTsGrammar = { typescript: "ts-grammar", tsx: "tsx-grammar" };
vi.mock("tree-sitter-typescript", () => ({
  default: { typescript: "ts-grammar", tsx: "tsx-grammar" },
}));

vi.mock("tree-sitter-javascript", () => ({
  default: "js-grammar",
}));

vi.mock("tree-sitter-python", () => ({
  default: "py-grammar",
}));

import {
  extractSymbolsTreeSitter,
  extractImportsTreeSitter,
  isTreeSitterAvailable,
  checkTreeSitterSupport,
} from "./treeSitterAnalyzer";

describe("treeSitterAnalyzer with mocked tree-sitter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("extractSymbolsTreeSitter", () => {
    it("extracts symbol names from parsed tree", async () => {
      const nameNode = { text: "myFunction" };
      const declNode = createMockNode({
        type: "function_declaration",
        childForFieldName: (field: string) => (field === "name" ? nameNode : null),
      });

      mockParse.mockReturnValue({
        rootNode: createMockNode({
          descendantsOfType: () => [declNode],
        }),
      });

      const result = await extractSymbolsTreeSitter("typescript", "function myFunction() {}");
      expect(result).toEqual(["myFunction"]);
    });

    it("returns empty array when no declarations found", async () => {
      mockParse.mockReturnValue({
        rootNode: createMockNode({
          descendantsOfType: () => [],
        }),
      });

      const result = await extractSymbolsTreeSitter("typescript", "// no declarations");
      expect(result).toEqual([]);
    });

    it("skips nodes without a name child", async () => {
      const declNode = createMockNode({
        type: "export_statement",
        childForFieldName: () => null,
      });

      mockParse.mockReturnValue({
        rootNode: createMockNode({
          descendantsOfType: () => [declNode],
        }),
      });

      const result = await extractSymbolsTreeSitter("typescript", "export default 42;");
      expect(result).toEqual([]);
    });

    it("skips nodes where name text is empty", async () => {
      const nameNode = { text: "" };
      const declNode = createMockNode({
        type: "variable_declarator",
        childForFieldName: (field: string) => (field === "name" ? nameNode : null),
      });

      mockParse.mockReturnValue({
        rootNode: createMockNode({
          descendantsOfType: () => [declNode],
        }),
      });

      const result = await extractSymbolsTreeSitter("typescript", "const = 1;");
      expect(result).toEqual([]);
    });

    it("deduplicates symbol names", async () => {
      const nameNode = { text: "repeated" };
      const declNode1 = createMockNode({
        type: "function_declaration",
        childForFieldName: (field: string) => (field === "name" ? nameNode : null),
      });
      const declNode2 = createMockNode({
        type: "function_declaration",
        childForFieldName: (field: string) => (field === "name" ? nameNode : null),
      });

      mockParse.mockReturnValue({
        rootNode: createMockNode({
          descendantsOfType: () => [declNode1, declNode2],
        }),
      });

      const result = await extractSymbolsTreeSitter("typescript", "function repeated() {} function repeated() {}");
      expect(result).toEqual(["repeated"]);
    });

    it("limits results to 64 symbols", async () => {
      const nodes = Array.from({ length: 100 }, (_, i) =>
        createMockNode({
          type: "function_declaration",
          childForFieldName: (field: string) => (field === "name" ? { text: `fn${i}` } : null),
        })
      );

      mockParse.mockReturnValue({
        rootNode: createMockNode({
          descendantsOfType: () => nodes,
        }),
      });

      const result = await extractSymbolsTreeSitter("typescript", "many functions");
      expect(result).toHaveLength(64);
    });

    it("returns null when parser throws", async () => {
      mockParse.mockImplementation(() => {
        throw new Error("parse error");
      });

      const result = await extractSymbolsTreeSitter("typescript", "invalid code");
      expect(result).toBeNull();
    });

    it("returns null for unsupported language", async () => {
      const result = await extractSymbolsTreeSitter("rust", "fn main() {}");
      expect(result).toBeNull();
    });

    it("returns null for null language", async () => {
      const result = await extractSymbolsTreeSitter(null, "code");
      expect(result).toBeNull();
    });

    it("works with javascript language", async () => {
      mockParse.mockReturnValue({
        rootNode: createMockNode({
          descendantsOfType: () => [],
        }),
      });

      const result = await extractSymbolsTreeSitter("javascript", "function foo() {}");
      expect(result).toEqual([]);
    });

    it("works with jsx language (maps to javascript)", async () => {
      mockParse.mockReturnValue({
        rootNode: createMockNode({
          descendantsOfType: () => [],
        }),
      });

      const result = await extractSymbolsTreeSitter("jsx", "const App = () => {}");
      expect(result).toEqual([]);
    });

    it("works with tsx language", async () => {
      mockParse.mockReturnValue({
        rootNode: createMockNode({
          descendantsOfType: () => [],
        }),
      });

      const result = await extractSymbolsTreeSitter("tsx", "const App: FC = () => {}");
      expect(result).toEqual([]);
    });

    it("works with python language", async () => {
      const nameNode = { text: "hello" };
      const declNode = createMockNode({
        type: "function_definition",
        childForFieldName: (field: string) => (field === "name" ? nameNode : null),
      });

      mockParse.mockReturnValue({
        rootNode: createMockNode({
          descendantsOfType: () => [declNode],
        }),
      });

      const result = await extractSymbolsTreeSitter("python", "def hello(): pass");
      expect(result).toEqual(["hello"]);
    });
  });

  describe("extractImportsTreeSitter", () => {
    it("extracts import sources from parsed tree", async () => {
      const sourceNode = { text: '"./bar"' };
      const importNode = createMockNode({
        type: "import_statement",
        childForFieldName: (field: string) => (field === "source" ? sourceNode : null),
      });

      mockParse.mockReturnValue({
        rootNode: createMockNode({
          descendantsOfType: () => [importNode],
        }),
      });

      const result = await extractImportsTreeSitter("typescript", 'import { foo } from "./bar"');
      expect(result).toEqual(["./bar"]);
    });

    it("strips quotes from import source text", async () => {
      const sourceNode = { text: "'lodash'" };
      const importNode = createMockNode({
        type: "import_statement",
        childForFieldName: (field: string) => (field === "source" ? sourceNode : null),
      });

      mockParse.mockReturnValue({
        rootNode: createMockNode({
          descendantsOfType: () => [importNode],
        }),
      });

      const result = await extractImportsTreeSitter("typescript", "import lodash from 'lodash'");
      expect(result).toEqual(["lodash"]);
    });

    it("extracts module_name from Python import_from_statement", async () => {
      const moduleNode = { text: "os.path" };
      const importNode = createMockNode({
        type: "import_from_statement",
        childForFieldName: (field: string) => (field === "module_name" ? moduleNode : null),
      });

      mockParse.mockReturnValue({
        rootNode: createMockNode({
          descendantsOfType: () => [importNode],
        }),
      });

      const result = await extractImportsTreeSitter("python", "from os.path import join");
      expect(result).toEqual(["os.path"]);
    });

    it("returns empty array when no imports found", async () => {
      mockParse.mockReturnValue({
        rootNode: createMockNode({
          descendantsOfType: () => [],
        }),
      });

      const result = await extractImportsTreeSitter("typescript", "const x = 1;");
      expect(result).toEqual([]);
    });

    it("handles import node with both source and module_name", async () => {
      const sourceNode = { text: '"react"' };
      const moduleNode = { text: "react" };
      const importNode = createMockNode({
        type: "import_statement",
        childForFieldName: (field: string) => {
          if (field === "source") return sourceNode;
          if (field === "module_name") return moduleNode;
          return null;
        },
      });

      mockParse.mockReturnValue({
        rootNode: createMockNode({
          descendantsOfType: () => [importNode],
        }),
      });

      const result = await extractImportsTreeSitter("typescript", 'import React from "react"');
      expect(result).toContain("react");
    });

    it("skips empty source text after quote stripping", async () => {
      const sourceNode = { text: '""' };
      const importNode = createMockNode({
        type: "import_statement",
        childForFieldName: (field: string) => (field === "source" ? sourceNode : null),
      });

      mockParse.mockReturnValue({
        rootNode: createMockNode({
          descendantsOfType: () => [importNode],
        }),
      });

      const result = await extractImportsTreeSitter("typescript", 'import {} from ""');
      expect(result).toEqual([]);
    });

    it("skips module_name nodes with empty text", async () => {
      const moduleNode = { text: "" };
      const importNode = createMockNode({
        type: "import_from_statement",
        childForFieldName: (field: string) => (field === "module_name" ? moduleNode : null),
      });

      mockParse.mockReturnValue({
        rootNode: createMockNode({
          descendantsOfType: () => [importNode],
        }),
      });

      const result = await extractImportsTreeSitter("python", "from   import foo");
      expect(result).toEqual([]);
    });

    it("deduplicates import sources", async () => {
      const sourceNode = { text: '"react"' };
      const importNode1 = createMockNode({
        type: "import_statement",
        childForFieldName: (field: string) => (field === "source" ? sourceNode : null),
      });
      const importNode2 = createMockNode({
        type: "import_statement",
        childForFieldName: (field: string) => (field === "source" ? sourceNode : null),
      });

      mockParse.mockReturnValue({
        rootNode: createMockNode({
          descendantsOfType: () => [importNode1, importNode2],
        }),
      });

      const result = await extractImportsTreeSitter("typescript", 'import React from "react"; import { useState } from "react"');
      expect(result).toEqual(["react"]);
    });

    it("limits results to 64 imports", async () => {
      const nodes = Array.from({ length: 100 }, (_, i) =>
        createMockNode({
          type: "import_statement",
          childForFieldName: (field: string) =>
            field === "source" ? { text: `"module${i}"` } : null,
        })
      );

      mockParse.mockReturnValue({
        rootNode: createMockNode({
          descendantsOfType: () => nodes,
        }),
      });

      const result = await extractImportsTreeSitter("typescript", "many imports");
      expect(result).toHaveLength(64);
    });

    it("returns null when parser throws", async () => {
      mockParse.mockImplementation(() => {
        throw new Error("parse error");
      });

      const result = await extractImportsTreeSitter("typescript", "invalid");
      expect(result).toBeNull();
    });

    it("returns null for unsupported language", async () => {
      const result = await extractImportsTreeSitter("rust", "use std::io;");
      expect(result).toBeNull();
    });

    it("returns null for null language", async () => {
      const result = await extractImportsTreeSitter(null, "import x");
      expect(result).toBeNull();
    });
  });

  describe("isTreeSitterAvailable", () => {
    it("returns true when tree-sitter was loaded", async () => {
      // Force loadTreeSitter to run first
      await checkTreeSitterSupport();
      expect(isTreeSitterAvailable()).toBe(true);
    });
  });

  describe("checkTreeSitterSupport", () => {
    it("returns available with language list", async () => {
      const status = await checkTreeSitterSupport();
      expect(status.available).toBe(true);
      expect(status.languages).toContain("typescript");
      expect(status.languages).toContain("tsx");
      expect(status.languages).toContain("javascript");
      expect(status.languages).toContain("python");
    });
  });
});
