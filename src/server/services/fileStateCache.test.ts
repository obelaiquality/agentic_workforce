import { describe, it, expect, beforeEach } from "vitest";
import { FileStateCache } from "./fileStateCache";

describe("FileStateCache", () => {
  let cache: FileStateCache;

  beforeEach(() => {
    cache = new FileStateCache();
  });

  // ---------------------------------------------------------------------------
  // Basic operations: get, set, has, delete
  // ---------------------------------------------------------------------------

  describe("basic operations", () => {
    it("get returns undefined for non-existent key", () => {
      expect(cache.get("/foo/bar.ts")).toBeUndefined();
    });

    it("set and get round-trip", () => {
      cache.set("/foo/bar.ts", "const x = 1;");
      const state = cache.get("/foo/bar.ts");
      expect(state).toBeDefined();
      expect(state!.content).toBe("const x = 1;");
      expect(state!.sizeBytes).toBe(Buffer.byteLength("const x = 1;"));
    });

    it("has returns true for existing entry", () => {
      cache.set("/foo/bar.ts", "content");
      expect(cache.has("/foo/bar.ts")).toBe(true);
    });

    it("has returns false for non-existent entry", () => {
      expect(cache.has("/nonexistent.ts")).toBe(false);
    });

    it("delete removes entry and returns true", () => {
      cache.set("/foo/bar.ts", "content");
      expect(cache.delete("/foo/bar.ts")).toBe(true);
      expect(cache.has("/foo/bar.ts")).toBe(false);
    });

    it("delete returns false for non-existent entry", () => {
      expect(cache.delete("/nonexistent.ts")).toBe(false);
    });

    it("set with custom timestamp preserves timestamp", () => {
      const timestamp = Date.now() - 10000;
      cache.set("/foo/bar.ts", "content", timestamp);
      const state = cache.get("/foo/bar.ts");
      expect(state!.timestamp).toBe(timestamp);
    });

    it("set without timestamp uses current time", () => {
      const before = Date.now();
      cache.set("/foo/bar.ts", "content");
      const after = Date.now();
      const state = cache.get("/foo/bar.ts");
      expect(state!.timestamp).toBeGreaterThanOrEqual(before);
      expect(state!.timestamp).toBeLessThanOrEqual(after);
    });
  });

  // ---------------------------------------------------------------------------
  // LRU behavior
  // ---------------------------------------------------------------------------

  describe("LRU eviction by entry count", () => {
    it("evicts oldest entry when maxEntries is exceeded", () => {
      const smallCache = new FileStateCache({ maxEntries: 3 });

      smallCache.set("/file1.ts", "one");
      smallCache.set("/file2.ts", "two");
      smallCache.set("/file3.ts", "three");

      // All three should be present
      expect(smallCache.size).toBe(3);

      // Adding a fourth should evict the oldest (file1)
      smallCache.set("/file4.ts", "four");
      expect(smallCache.size).toBe(3);
      expect(smallCache.has("/file1.ts")).toBe(false);
      expect(smallCache.has("/file2.ts")).toBe(true);
      expect(smallCache.has("/file3.ts")).toBe(true);
      expect(smallCache.has("/file4.ts")).toBe(true);
    });

    it("get moves entry to end (most recently used)", () => {
      const smallCache = new FileStateCache({ maxEntries: 3 });

      smallCache.set("/file1.ts", "one");
      smallCache.set("/file2.ts", "two");
      smallCache.set("/file3.ts", "three");

      // Access file1 to make it recently used
      smallCache.get("/file1.ts");

      // Add file4, should evict file2 (oldest) instead of file1
      smallCache.set("/file4.ts", "four");
      expect(smallCache.has("/file1.ts")).toBe(true);
      expect(smallCache.has("/file2.ts")).toBe(false);
      expect(smallCache.has("/file3.ts")).toBe(true);
      expect(smallCache.has("/file4.ts")).toBe(true);
    });

    it("set on existing key moves it to end", () => {
      const smallCache = new FileStateCache({ maxEntries: 3 });

      smallCache.set("/file1.ts", "one");
      smallCache.set("/file2.ts", "two");
      smallCache.set("/file3.ts", "three");

      // Update file1
      smallCache.set("/file1.ts", "one updated");

      // Add file4, should evict file2 (now oldest)
      smallCache.set("/file4.ts", "four");
      expect(smallCache.has("/file1.ts")).toBe(true);
      expect(smallCache.has("/file2.ts")).toBe(false);
      expect(smallCache.has("/file3.ts")).toBe(true);
      expect(smallCache.has("/file4.ts")).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Size-based eviction
  // ---------------------------------------------------------------------------

  describe("size-based eviction", () => {
    it("evicts entries when total size exceeds maxSizeBytes", () => {
      // 100 bytes max, each "x".repeat(30) is 30 bytes
      const smallCache = new FileStateCache({ maxSizeBytes: 100 });

      smallCache.set("/file1.ts", "x".repeat(30));
      smallCache.set("/file2.ts", "x".repeat(30));
      smallCache.set("/file3.ts", "x".repeat(30));

      expect(smallCache.totalSizeBytes).toBe(90);
      expect(smallCache.size).toBe(3);

      // Adding 30 more bytes should evict file1
      smallCache.set("/file4.ts", "x".repeat(30));
      expect(smallCache.size).toBe(3);
      expect(smallCache.has("/file1.ts")).toBe(false);
      expect(smallCache.totalSizeBytes).toBe(90);
    });

    it("evicts multiple entries if needed to make room", () => {
      const smallCache = new FileStateCache({ maxSizeBytes: 100 });

      smallCache.set("/file1.ts", "x".repeat(20));
      smallCache.set("/file2.ts", "x".repeat(20));
      smallCache.set("/file3.ts", "x".repeat(20));

      expect(smallCache.totalSizeBytes).toBe(60);

      // Add a large file that requires evicting multiple entries
      smallCache.set("/file4.ts", "x".repeat(90));
      expect(smallCache.size).toBe(1);
      expect(smallCache.has("/file1.ts")).toBe(false);
      expect(smallCache.has("/file2.ts")).toBe(false);
      expect(smallCache.has("/file3.ts")).toBe(false);
      expect(smallCache.has("/file4.ts")).toBe(true);
      expect(smallCache.totalSizeBytes).toBe(90);
    });

    it("does not cache files larger than maxSizeBytes", () => {
      const smallCache = new FileStateCache({ maxSizeBytes: 100 });

      // Try to cache a file larger than the entire budget
      smallCache.set("/huge.ts", "x".repeat(200));
      expect(smallCache.has("/huge.ts")).toBe(false);
      expect(smallCache.totalSizeBytes).toBe(0);

      // Files within the budget should work
      smallCache.set("/small.ts", "x".repeat(50));
      expect(smallCache.has("/small.ts")).toBe(true);
      expect(smallCache.totalSizeBytes).toBe(50);
    });

    it("updates totalSizeBytes when deleting entries", () => {
      cache.set("/file1.ts", "x".repeat(100));
      cache.set("/file2.ts", "x".repeat(200));
      expect(cache.totalSizeBytes).toBe(300);

      cache.delete("/file1.ts");
      expect(cache.totalSizeBytes).toBe(200);

      cache.delete("/file2.ts");
      expect(cache.totalSizeBytes).toBe(0);
    });

    it("updates totalSizeBytes when overwriting entries", () => {
      cache.set("/file.ts", "x".repeat(100));
      expect(cache.totalSizeBytes).toBe(100);

      cache.set("/file.ts", "x".repeat(50));
      expect(cache.totalSizeBytes).toBe(50);
    });
  });

  // ---------------------------------------------------------------------------
  // Path normalization
  // ---------------------------------------------------------------------------

  describe("path normalization", () => {
    it("normalizes paths with .. segments", () => {
      cache.set("/foo/../bar.ts", "content");
      expect(cache.has("/bar.ts")).toBe(true);
      expect(cache.get("/bar.ts")!.content).toBe("content");
    });

    it("normalizes paths with . segments", () => {
      cache.set("/foo/./bar.ts", "content");
      expect(cache.has("/foo/bar.ts")).toBe(true);
    });

    it("normalizes paths with multiple slashes", () => {
      cache.set("/foo//bar.ts", "content");
      expect(cache.has("/foo/bar.ts")).toBe(true);
    });

    it("treats equivalent normalized paths as same key", () => {
      cache.set("/foo/../bar.ts", "first");
      cache.set("/bar.ts", "second");

      expect(cache.size).toBe(1);
      expect(cache.get("/bar.ts")!.content).toBe("second");
    });
  });

  // ---------------------------------------------------------------------------
  // Clear and metadata
  // ---------------------------------------------------------------------------

  describe("clear and metadata", () => {
    it("clear removes all entries and resets size", () => {
      cache.set("/file1.ts", "x".repeat(100));
      cache.set("/file2.ts", "x".repeat(200));
      cache.set("/file3.ts", "x".repeat(300));

      expect(cache.size).toBe(3);
      expect(cache.totalSizeBytes).toBe(600);

      cache.clear();

      expect(cache.size).toBe(0);
      expect(cache.totalSizeBytes).toBe(0);
      expect(cache.keys()).toEqual([]);
    });

    it("size returns correct entry count", () => {
      expect(cache.size).toBe(0);
      cache.set("/file1.ts", "one");
      expect(cache.size).toBe(1);
      cache.set("/file2.ts", "two");
      expect(cache.size).toBe(2);
      cache.delete("/file1.ts");
      expect(cache.size).toBe(1);
    });

    it("keys returns all cached file paths", () => {
      cache.set("/foo/a.ts", "a");
      cache.set("/foo/b.ts", "b");
      cache.set("/bar/c.ts", "c");

      const keys = cache.keys();
      expect(keys).toHaveLength(3);
      expect(keys).toContain("/foo/a.ts");
      expect(keys).toContain("/foo/b.ts");
      expect(keys).toContain("/bar/c.ts");
    });

    it("keys returns empty array for empty cache", () => {
      expect(cache.keys()).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Combined entry count + size limits
  // ---------------------------------------------------------------------------

  describe("combined entry and size limits", () => {
    it("respects both maxEntries and maxSizeBytes", () => {
      const smallCache = new FileStateCache({
        maxEntries: 5,
        maxSizeBytes: 100,
      });

      // Add 3 files totaling 90 bytes
      smallCache.set("/file1.ts", "x".repeat(30));
      smallCache.set("/file2.ts", "x".repeat(30));
      smallCache.set("/file3.ts", "x".repeat(30));

      expect(smallCache.size).toBe(3);
      expect(smallCache.totalSizeBytes).toBe(90);

      // Adding 30 more bytes would exceed size limit (even though entry limit allows 2 more)
      smallCache.set("/file4.ts", "x".repeat(30));
      expect(smallCache.size).toBe(3);
      expect(smallCache.has("/file1.ts")).toBe(false);
      expect(smallCache.totalSizeBytes).toBe(90);
    });
  });
});
