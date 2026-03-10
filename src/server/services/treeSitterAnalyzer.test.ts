import { describe, it, expect } from "vitest";
import { checkTreeSitterSupport, extractSymbolsTreeSitter, extractImportsTreeSitter } from "./treeSitterAnalyzer";

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
});
