import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  getRipgrepPath,
  resetRipgrepPathCache,
  execRipgrep,
  RipgrepTimeoutError,
  RipgrepError,
  VCS_DIRS,
  COMMON_IGNORE_DIRS,
  vcsExclusionArgs,
  commonExclusionArgs,
  extractGlobBaseDir,
} from "./ripgrep";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  resetRipgrepPathCache();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rg-test-"));

  // Create test files
  fs.writeFileSync(path.join(tmpDir, "hello.ts"), "const greeting = 'hello world';\nexport default greeting;\n");
  fs.writeFileSync(path.join(tmpDir, "foo.js"), "function foo() { return 42; }\n");
  fs.mkdirSync(path.join(tmpDir, "sub"));
  fs.writeFileSync(path.join(tmpDir, "sub", "bar.ts"), "export const bar = 'baz';\n");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

describe("getRipgrepPath", () => {
  it("returns a path on systems with rg installed", () => {
    const result = getRipgrepPath();
    // In CI without rg this would be null, which is also acceptable
    if (result !== null) {
      expect(result).toContain("rg");
    }
  });

  it("is memoized (returns same value on second call)", () => {
    const first = getRipgrepPath();
    const second = getRipgrepPath();
    expect(first).toBe(second);
  });

  it("respects RIPGREP_PATH env override", () => {
    const original = process.env.RIPGREP_PATH;
    try {
      process.env.RIPGREP_PATH = "/custom/path/to/rg";
      resetRipgrepPathCache();
      expect(getRipgrepPath()).toBe("/custom/path/to/rg");
    } finally {
      if (original !== undefined) {
        process.env.RIPGREP_PATH = original;
      } else {
        delete process.env.RIPGREP_PATH;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// execRipgrep
// ---------------------------------------------------------------------------

describe("execRipgrep", () => {
  it("returns matching lines for a content search", async () => {
    const rgPath = getRipgrepPath();
    if (!rgPath) return; // skip if rg not installed

    const lines = await execRipgrep(["greeting", tmpDir]);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l) => l.includes("hello world"))).toBe(true);
  });

  it("returns empty array for no matches", async () => {
    const rgPath = getRipgrepPath();
    if (!rgPath) return;

    const lines = await execRipgrep(["NONEXISTENT_STRING_12345", tmpDir]);
    expect(lines).toEqual([]);
  });

  it("lists files with --files flag", async () => {
    const rgPath = getRipgrepPath();
    if (!rgPath) return;

    const lines = await execRipgrep(["--files", tmpDir]);
    expect(lines.length).toBe(3); // hello.ts, foo.js, sub/bar.ts
    expect(lines.some((l) => l.endsWith("hello.ts"))).toBe(true);
    expect(lines.some((l) => l.endsWith("foo.js"))).toBe(true);
    expect(lines.some((l) => l.endsWith("bar.ts"))).toBe(true);
  });

  it("respects glob patterns", async () => {
    const rgPath = getRipgrepPath();
    if (!rgPath) return;

    const lines = await execRipgrep(["--files", "--glob", "*.ts", tmpDir]);
    // Should find hello.ts but not foo.js. sub/bar.ts may or may not match
    // depending on whether ** is implied. With --glob '*.ts' only top-level matches.
    expect(lines.some((l) => l.endsWith("hello.ts"))).toBe(true);
    expect(lines.some((l) => l.endsWith("foo.js"))).toBe(false);
  });

  it("throws RipgrepError for invalid regex", async () => {
    const rgPath = getRipgrepPath();
    if (!rgPath) return;

    await expect(execRipgrep(["[invalid", tmpDir])).rejects.toThrow(RipgrepError);
  });

  it("throws RipgrepTimeoutError for very short timeout", async () => {
    const rgPath = getRipgrepPath();
    if (!rgPath) return;

    // Search root filesystem with 1ms timeout — should timeout
    await expect(
      execRipgrep(["--files", "/"], { timeoutMs: 1 }),
    ).rejects.toThrow(RipgrepTimeoutError);
  });

  it("respects AbortSignal", async () => {
    const rgPath = getRipgrepPath();
    if (!rgPath) return;

    const controller = new AbortController();
    // Abort immediately
    controller.abort();

    await expect(
      execRipgrep(["--files", tmpDir], { signal: controller.signal }),
    ).rejects.toThrow("Aborted");
  });

  it("throws when rg is not available", async () => {
    const original = process.env.RIPGREP_PATH;
    try {
      process.env.RIPGREP_PATH = "/nonexistent/rg";
      resetRipgrepPathCache();

      await expect(execRipgrep(["--files", tmpDir])).rejects.toThrow();
    } finally {
      if (original !== undefined) {
        process.env.RIPGREP_PATH = original;
      } else {
        delete process.env.RIPGREP_PATH;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("constants", () => {
  it("VCS_DIRS includes .git", () => {
    expect(VCS_DIRS).toContain(".git");
  });

  it("COMMON_IGNORE_DIRS includes node_modules and VCS dirs", () => {
    expect(COMMON_IGNORE_DIRS).toContain("node_modules");
    expect(COMMON_IGNORE_DIRS).toContain(".git");
  });
});

// ---------------------------------------------------------------------------
// Arg builders
// ---------------------------------------------------------------------------

describe("vcsExclusionArgs", () => {
  it("generates --glob pairs for each VCS dir", () => {
    const args = vcsExclusionArgs();
    expect(args).toContain("--glob");
    expect(args).toContain("!.git");
    expect(args.length).toBe(VCS_DIRS.length * 2);
  });
});

describe("commonExclusionArgs", () => {
  it("generates --glob pairs for all common ignore dirs", () => {
    const args = commonExclusionArgs();
    expect(args).toContain("!node_modules");
    expect(args).toContain("!.git");
    expect(args.length).toBe(COMMON_IGNORE_DIRS.length * 2);
  });
});

// ---------------------------------------------------------------------------
// extractGlobBaseDir
// ---------------------------------------------------------------------------

describe("extractGlobBaseDir", () => {
  it("extracts base dir from simple glob", () => {
    const { baseDir, relativePattern } = extractGlobBaseDir("src/components/*.tsx");
    expect(baseDir).toBe("src/components");
    expect(relativePattern).toBe("*.tsx");
  });

  it("returns empty base for leading **", () => {
    const { baseDir, relativePattern } = extractGlobBaseDir("**/*.ts");
    expect(baseDir).toBe("");
    expect(relativePattern).toBe("**/*.ts");
  });

  it("handles nested static path", () => {
    const { baseDir, relativePattern } = extractGlobBaseDir("src/server/tools/**/*.test.ts");
    expect(baseDir).toBe("src/server/tools");
    expect(relativePattern).toBe("**/*.test.ts");
  });

  it("handles literal filename (no glob)", () => {
    const { baseDir, relativePattern } = extractGlobBaseDir("src/index.ts");
    expect(baseDir).toBe("src");
    expect(relativePattern).toBe("index.ts");
  });

  it("handles pattern with no path separator", () => {
    const { baseDir, relativePattern } = extractGlobBaseDir("*.ts");
    expect(baseDir).toBe("");
    expect(relativePattern).toBe("*.ts");
  });
});
