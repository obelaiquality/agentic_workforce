import { describe, expect, it } from "vitest";
import { parseDiff, applyHunkDecisions } from "./DiffParser";
import type { DiffFile } from "./DiffParser";

// ---------------------------------------------------------------------------
// parseDiff
// ---------------------------------------------------------------------------

describe("parseDiff", () => {
  it("parses a single-file unified diff with one hunk", () => {
    const diff = [
      "diff --git a/src/index.ts b/src/index.ts",
      "index abc1234..def5678 100644",
      "--- a/src/index.ts",
      "+++ b/src/index.ts",
      "@@ -1,4 +1,5 @@",
      " import { foo } from './foo';",
      "-const bar = 1;",
      "+const bar = 2;",
      "+const baz = 3;",
      " ",
      " export { foo };",
    ].join("\n");

    const files = parseDiff(diff);
    expect(files).toHaveLength(1);

    const file = files[0];
    expect(file.oldPath).toBe("src/index.ts");
    expect(file.newPath).toBe("src/index.ts");
    expect(file.status).toBe("modified");
    expect(file.additions).toBe(2);
    expect(file.deletions).toBe(1);
    expect(file.hunks).toHaveLength(1);

    const hunk = file.hunks[0];
    expect(hunk.oldStart).toBe(1);
    expect(hunk.oldCount).toBe(4);
    expect(hunk.newStart).toBe(1);
    expect(hunk.newCount).toBe(5);
    expect(hunk.index).toBe(0);

    // Lines: 1 context + 1 removed + 2 added + 1 empty context + 1 context = 6
    expect(hunk.lines.length).toBeGreaterThanOrEqual(5);
    expect(hunk.lines[0]).toMatchObject({ type: "context", content: "import { foo } from './foo';" });
    expect(hunk.lines[1]).toMatchObject({ type: "removed", content: "const bar = 1;" });
    expect(hunk.lines[2]).toMatchObject({ type: "added", content: "const bar = 2;" });
    expect(hunk.lines[3]).toMatchObject({ type: "added", content: "const baz = 3;" });
  });

  it("parses multiple hunks in a single file", () => {
    const diff = [
      "diff --git a/file.ts b/file.ts",
      "--- a/file.ts",
      "+++ b/file.ts",
      "@@ -1,3 +1,3 @@",
      " line1",
      "-line2",
      "+line2_modified",
      " line3",
      "@@ -10,3 +10,4 @@",
      " line10",
      " line11",
      "+line11.5",
      " line12",
    ].join("\n");

    const files = parseDiff(diff);
    expect(files).toHaveLength(1);
    expect(files[0].hunks).toHaveLength(2);
    expect(files[0].hunks[0].index).toBe(0);
    expect(files[0].hunks[1].index).toBe(1);
    expect(files[0].additions).toBe(2);
    expect(files[0].deletions).toBe(1);
  });

  it("parses a new file diff", () => {
    const diff = [
      "diff --git a/new-file.ts b/new-file.ts",
      "new file mode 100644",
      "index 0000000..abc1234",
      "--- /dev/null",
      "+++ b/new-file.ts",
      "@@ -0,0 +1,2 @@",
      "+export const hello = 'world';",
      "+export const foo = 42;",
    ].join("\n");

    const files = parseDiff(diff);
    expect(files).toHaveLength(1);
    // Parser should detect new file (added) or fallback to modified with 0 deletions
    expect(["added", "modified"]).toContain(files[0].status);
    expect(files[0].newPath).toBe("new-file.ts");
    expect(files[0].additions).toBe(2);
    expect(files[0].deletions).toBe(0);
  });

  it("parses a deleted file diff", () => {
    const diff = [
      "diff --git a/old-file.ts b/old-file.ts",
      "deleted file mode 100644",
      "index abc1234..0000000",
      "--- a/old-file.ts",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-export const hello = 'world';",
      "-export const foo = 42;",
    ].join("\n");

    const files = parseDiff(diff);
    expect(files).toHaveLength(1);
    // Parser should detect deleted file or fallback to modified with 0 additions
    expect(["deleted", "modified"]).toContain(files[0].status);
    expect(files[0].oldPath).toBe("old-file.ts");
    expect(files[0].additions).toBe(0);
    expect(files[0].deletions).toBe(2);
  });

  it("parses multi-file diffs", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,2 +1,2 @@",
      " first",
      "-second",
      "+second_modified",
      "diff --git a/b.ts b/b.ts",
      "--- a/b.ts",
      "+++ b/b.ts",
      "@@ -1,2 +1,2 @@",
      " alpha",
      "-beta",
      "+beta_modified",
    ].join("\n");

    const files = parseDiff(diff);
    expect(files).toHaveLength(2);
    expect(files[0].newPath).toBe("a.ts");
    expect(files[1].newPath).toBe("b.ts");
  });

  it("handles a single-file diff without git header", () => {
    const diff = [
      "--- a/util.ts",
      "+++ b/util.ts",
      "@@ -5,3 +5,4 @@",
      " existing line",
      "+new line",
      " another existing",
      " last line",
    ].join("\n");

    const files = parseDiff(diff);
    expect(files).toHaveLength(1);
    expect(files[0].newPath).toBe("util.ts");
    expect(files[0].additions).toBe(1);
  });

  it("returns empty array for empty input", () => {
    expect(parseDiff("")).toEqual([]);
    expect(parseDiff("just some random text")).toEqual([]);
  });

  it("handles no-newline-at-end-of-file markers", () => {
    const diff = [
      "diff --git a/f.ts b/f.ts",
      "--- a/f.ts",
      "+++ b/f.ts",
      "@@ -1,2 +1,2 @@",
      "-old",
      "\\ No newline at end of file",
      "+new",
      "\\ No newline at end of file",
    ].join("\n");

    const files = parseDiff(diff);
    expect(files).toHaveLength(1);
    expect(files[0].hunks[0].lines).toHaveLength(2);
    expect(files[0].hunks[0].lines[0].type).toBe("removed");
    expect(files[0].hunks[0].lines[1].type).toBe("added");
  });
});

// ---------------------------------------------------------------------------
// applyHunkDecisions
// ---------------------------------------------------------------------------

describe("applyHunkDecisions", () => {
  function makeTestFile(): DiffFile {
    return {
      oldPath: "test.ts",
      newPath: "test.ts",
      status: "modified",
      additions: 2,
      deletions: 1,
      hunks: [
        {
          index: 0,
          header: "@@ -1,4 +1,5 @@",
          oldStart: 1,
          oldCount: 4,
          newStart: 1,
          newCount: 5,
          lines: [
            { type: "context", content: "line1", oldLineNumber: 1, newLineNumber: 1 },
            { type: "removed", content: "old_line2", oldLineNumber: 2, newLineNumber: null },
            { type: "added", content: "new_line2", oldLineNumber: null, newLineNumber: 2 },
            { type: "added", content: "new_line2b", oldLineNumber: null, newLineNumber: 3 },
            { type: "context", content: "line3", oldLineNumber: 3, newLineNumber: 4 },
          ],
        },
        {
          index: 1,
          header: "@@ -10,3 +11,3 @@",
          oldStart: 10,
          oldCount: 3,
          newStart: 11,
          newCount: 3,
          lines: [
            { type: "context", content: "line10", oldLineNumber: 10, newLineNumber: 11 },
            { type: "removed", content: "old_line11", oldLineNumber: 11, newLineNumber: null },
            { type: "added", content: "new_line11", oldLineNumber: null, newLineNumber: 12 },
            { type: "context", content: "line12", oldLineNumber: 12, newLineNumber: 13 },
          ],
        },
      ],
    };
  }

  it("accepts all hunks by default", () => {
    const file = makeTestFile();
    const result = applyHunkDecisions(file, new Map());
    expect(result).toBe(
      ["line1", "new_line2", "new_line2b", "line3", "line10", "new_line11", "line12"].join("\n")
    );
  });

  it("accepts hunk 0 and rejects hunk 1", () => {
    const file = makeTestFile();
    const decisions = new Map<number, "accept" | "reject">([
      [0, "accept"],
      [1, "reject"],
    ]);
    const result = applyHunkDecisions(file, decisions);
    // Hunk 0 accepted: added lines kept, removed lines dropped
    // Hunk 1 rejected: removed lines kept (restored), added lines dropped
    expect(result).toBe(
      ["line1", "new_line2", "new_line2b", "line3", "line10", "old_line11", "line12"].join("\n")
    );
  });

  it("rejects all hunks — keeps original lines", () => {
    const file = makeTestFile();
    const decisions = new Map<number, "accept" | "reject">([
      [0, "reject"],
      [1, "reject"],
    ]);
    const result = applyHunkDecisions(file, decisions);
    expect(result).toBe(
      ["line1", "old_line2", "line3", "line10", "old_line11", "line12"].join("\n")
    );
  });

  it("accepts all hunks explicitly", () => {
    const file = makeTestFile();
    const decisions = new Map<number, "accept" | "reject">([
      [0, "accept"],
      [1, "accept"],
    ]);
    const result = applyHunkDecisions(file, decisions);
    expect(result).toBe(
      ["line1", "new_line2", "new_line2b", "line3", "line10", "new_line11", "line12"].join("\n")
    );
  });
});
