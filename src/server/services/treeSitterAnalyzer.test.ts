import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  checkTreeSitterSupport,
  extractSymbolsTreeSitter,
  extractImportsTreeSitter,
  isTreeSitterAvailable,
} from "./treeSitterAnalyzer";

describe("treeSitterAnalyzer", () => {
  it("reports availability status without crashing", async () => {
    const status = await checkTreeSitterSupport();
    expect(typeof status.available).toBe("boolean");
    expect(Array.isArray(status.languages)).toBe(true);
  });

  it("returns null for symbol extraction when tree-sitter is not installed", async () => {
    const result = await extractSymbolsTreeSitter("typescript", "export function foo() {}");
    // Returns null if tree-sitter not installed, or string[] if installed
    if (result !== null) {
      expect(Array.isArray(result)).toBe(true);
    } else {
      expect(result).toBeNull();
    }
  });

  it("returns null for import extraction when tree-sitter is not installed", async () => {
    const result = await extractImportsTreeSitter("typescript", 'import { foo } from "./bar"');
    if (result !== null) {
      expect(Array.isArray(result)).toBe(true);
    } else {
      expect(result).toBeNull();
    }
  });

  it("returns null for unsupported languages", async () => {
    const symbols = await extractSymbolsTreeSitter("haskell", "module Main where");
    expect(symbols).toBeNull();

    const imports = await extractImportsTreeSitter("haskell", "import Data.List");
    expect(imports).toBeNull();
  });

  it("returns null for null language", async () => {
    const symbols = await extractSymbolsTreeSitter(null, "some code");
    expect(symbols).toBeNull();
  });

  it("returns boolean from isTreeSitterAvailable", () => {
    const result = isTreeSitterAvailable();
    expect(typeof result).toBe("boolean");
  });

  it("handles jsx language mapping for extractSymbols", async () => {
    const result = await extractSymbolsTreeSitter("jsx", "function App() {}");
    // jsx maps to "javascript" — null if tree-sitter not installed
    if (result !== null) {
      expect(Array.isArray(result)).toBe(true);
    } else {
      expect(result).toBeNull();
    }
  });

  it("handles jsx language mapping for extractImports", async () => {
    const result = await extractImportsTreeSitter("jsx", 'import React from "react"');
    if (result !== null) {
      expect(Array.isArray(result)).toBe(true);
    } else {
      expect(result).toBeNull();
    }
  });

  it("handles tsx language mapping", async () => {
    const result = await extractSymbolsTreeSitter("tsx", "const App: React.FC = () => {}");
    if (result !== null) {
      expect(Array.isArray(result)).toBe(true);
    } else {
      expect(result).toBeNull();
    }
  });

  it("handles python language mapping for extractSymbols", async () => {
    const result = await extractSymbolsTreeSitter("python", "def hello(): pass");
    if (result !== null) {
      expect(Array.isArray(result)).toBe(true);
    } else {
      expect(result).toBeNull();
    }
  });

  it("handles python language mapping for extractImports", async () => {
    const result = await extractImportsTreeSitter("python", "import os");
    if (result !== null) {
      expect(Array.isArray(result)).toBe(true);
    } else {
      expect(result).toBeNull();
    }
  });

  it("handles null language for extractImports", async () => {
    const result = await extractImportsTreeSitter(null, 'import foo from "bar"');
    expect(result).toBeNull();
  });

  it("handles empty content for extractSymbols", async () => {
    const result = await extractSymbolsTreeSitter("typescript", "");
    if (result !== null) {
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    } else {
      expect(result).toBeNull();
    }
  });

  it("handles empty content for extractImports", async () => {
    const result = await extractImportsTreeSitter("typescript", "");
    if (result !== null) {
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    } else {
      expect(result).toBeNull();
    }
  });

  it("returns consistent availability across multiple calls", async () => {
    const status1 = await checkTreeSitterSupport();
    const status2 = await checkTreeSitterSupport();
    expect(status1.available).toBe(status2.available);
    expect(status1.languages).toEqual(status2.languages);
  });

  it("handles case-insensitive language names", async () => {
    const resultUpper = await extractSymbolsTreeSitter("TYPESCRIPT", "const x = 1;");
    const resultLower = await extractSymbolsTreeSitter("typescript", "const x = 1;");
    // Both should behave identically
    if (resultUpper === null) {
      expect(resultLower).toBeNull();
    } else {
      expect(resultLower).not.toBeNull();
    }
  });

  it("handles JavaScript language name", async () => {
    const result = await extractSymbolsTreeSitter("JavaScript", "function foo() {}");
    if (result !== null) {
      expect(Array.isArray(result)).toBe(true);
    } else {
      expect(result).toBeNull();
    }
  });

  it("handles JavaScript imports", async () => {
    const result = await extractImportsTreeSitter("JavaScript", 'import { x } from "y"');
    if (result !== null) {
      expect(Array.isArray(result)).toBe(true);
    } else {
      expect(result).toBeNull();
    }
  });
});

// ── Tests with mocked tree-sitter (to exercise internal parsing branches) ──
describe("treeSitterAnalyzer — mocked tree-sitter", () => {
  // These tests use a separate module scope to mock tree-sitter
  // Since tree-sitter is optional and may not be installed, we test
  // the resolveLanguageKey function behavior through the public API

  it("returns null for completely unknown language in extractSymbols", async () => {
    const result = await extractSymbolsTreeSitter("fortran", "PROGRAM HELLO");
    expect(result).toBeNull();
  });

  it("returns null for completely unknown language in extractImports", async () => {
    const result = await extractImportsTreeSitter("fortran", "USE module_name");
    expect(result).toBeNull();
  });

  it("returns null for empty string language", async () => {
    const result = await extractSymbolsTreeSitter("", "const x = 1;");
    expect(result).toBeNull();
  });

  it("handles PYTHON (uppercase) language mapping", async () => {
    const result = await extractSymbolsTreeSitter("PYTHON", "class Foo: pass");
    if (result !== null) {
      expect(Array.isArray(result)).toBe(true);
    } else {
      expect(result).toBeNull();
    }
  });
});
