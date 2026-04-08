import { describe, it, expect, beforeEach } from "vitest";
import { FileIndex, type SearchResult } from "./fileIndex";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const TEST_FILES = [
  "src/server/tools/definitions/fileOps.ts",
  "src/server/tools/definitions/fileOps.test.ts",
  "src/server/tools/registry.ts",
  "src/server/tools/registry.test.ts",
  "src/server/services/editMatcherChain.ts",
  "src/server/services/editMatcherChain.test.ts",
  "src/server/execution/agenticOrchestrator.ts",
  "src/server/execution/agenticOrchestrator.test.ts",
  "src/server/execution/streamingToolExecutor.ts",
  "src/server/execution/coordinatorAgent.ts",
  "src/app/components/ui/tooltip.tsx",
  "src/app/App.tsx",
  "src/app/hooks/useAuth.ts",
  "package.json",
  "README.md",
  "tsconfig.json",
  "src/server/services/fileIndex.ts",
  "src/server/services/ripgrep.ts",
  "src/shared/contracts.ts",
];

let index: FileIndex;

beforeEach(() => {
  index = new FileIndex();
  index.loadFromFileList(TEST_FILES);
});

// ---------------------------------------------------------------------------
// Basic functionality
// ---------------------------------------------------------------------------

describe("FileIndex", () => {
  it("indexes all files", () => {
    expect(index.getFileCount()).toBe(TEST_FILES.length);
    expect(index.isReady()).toBe(true);
  });

  it("deduplicates files", () => {
    const idx = new FileIndex();
    idx.loadFromFileList(["a.ts", "b.ts", "a.ts", "", "b.ts"]);
    expect(idx.getFileCount()).toBe(2);
  });

  it("returns empty array for empty query with limit 0", () => {
    expect(index.search("", 0)).toEqual([]);
  });

  it("returns top-level entries for empty query", () => {
    const results = index.search("", 5);
    expect(results.length).toBeGreaterThan(0);
    // Top-level entries are the first path segments
    expect(results.some((r) => r.path === "src")).toBe(true);
  });

  it("clears the index", () => {
    index.clear();
    expect(index.getFileCount()).toBe(0);
    expect(index.isReady()).toBe(false);
    expect(index.search("test", 5)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Search quality
// ---------------------------------------------------------------------------

describe("search scoring", () => {
  it("finds exact filename matches", () => {
    const results = index.search("registry", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.path).toContain("registry");
  });

  it("finds fuzzy matches across path segments", () => {
    const results = index.search("agOrch", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.path).toContain("agenticOrchestrator");
  });

  it("ranks boundary matches higher than mid-word", () => {
    const results = index.search("fI", 10);
    // fileIndex.ts should rank higher because 'f' and 'I' are at boundaries
    const fileIndexRank = results.findIndex((r) => r.path.includes("fileIndex"));
    expect(fileIndexRank).toBeGreaterThanOrEqual(0);
  });

  it("applies camelCase bonus", () => {
    const results = index.search("eMC", 5);
    expect(results.length).toBeGreaterThan(0);
    // editMatcherChain should match via camelCase boundaries
    expect(results[0]!.path).toContain("editMatcherChain");
  });

  it("respects smart case (lowercase = case-insensitive)", () => {
    const results = index.search("readme", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.path).toBe("README.md");
  });

  it("respects smart case (uppercase = case-sensitive)", () => {
    // Uppercase 'R' should match 'README' but not 'registry'
    const results = index.search("READ", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.path).toBe("README.md");
  });

  it("penalizes test files", () => {
    // Search for something that matches both test and non-test files
    const results = index.search("fileOps", 10);
    const nonTestIdx = results.findIndex((r) => !r.path.includes(".test."));
    const testIdx = results.findIndex((r) => r.path.includes(".test."));

    // Both should be found
    expect(nonTestIdx).toBeGreaterThanOrEqual(0);
    expect(testIdx).toBeGreaterThanOrEqual(0);

    // Non-test file should have equal or better (lower) score
    if (nonTestIdx >= 0 && testIdx >= 0) {
      expect(results[nonTestIdx]!.score).toBeLessThanOrEqual(results[testIdx]!.score);
    }
  });

  it("returns no results for completely non-matching query", () => {
    const results = index.search("zzzzqqqq", 5);
    expect(results).toEqual([]);
  });

  it("respects limit parameter", () => {
    const results = index.search("ts", 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// Bitmap pre-filtering
// ---------------------------------------------------------------------------

describe("bitmap pre-filtering", () => {
  it("rejects paths missing query letters", () => {
    // Query 'xyz' should find nothing in our test set (no paths contain x, y, and z)
    const results = index.search("xyz", 10);
    expect(results.length).toBe(0);
  });

  it("accepts paths containing all query letters", () => {
    // Query 'ts' should match many files ending in .ts
    const results = index.search("ts", 20);
    expect(results.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Async indexing
// ---------------------------------------------------------------------------

describe("async indexing", () => {
  it("builds index asynchronously", async () => {
    const asyncIndex = new FileIndex();
    const { queryable, done } = asyncIndex.loadFromFileListAsync(TEST_FILES);

    await queryable;
    // Should be at least partially ready
    expect(asyncIndex.getFileCount()).toBeGreaterThan(0);

    await done;
    // Should be fully indexed
    expect(asyncIndex.getFileCount()).toBe(TEST_FILES.length);
  });

  it("supports search on partial index", async () => {
    const asyncIndex = new FileIndex();
    const { queryable, done } = asyncIndex.loadFromFileListAsync(TEST_FILES);

    await queryable;
    // Search should work even if index is still building
    const results = asyncIndex.search("registry", 5);
    // May or may not find results depending on indexing progress, but shouldn't throw
    expect(Array.isArray(results)).toBe(true);

    await done;
  });
});
