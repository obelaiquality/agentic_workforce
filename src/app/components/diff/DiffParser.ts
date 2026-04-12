// ---------------------------------------------------------------------------
// DiffParser — parse unified diff format and apply hunk-level decisions
// ---------------------------------------------------------------------------

export interface DiffLine {
  type: "added" | "removed" | "context";
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

export interface DiffHunk {
  index: number;
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export interface DiffFile {
  oldPath: string;
  newPath: string;
  status: "added" | "modified" | "deleted" | "renamed";
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

// ---------------------------------------------------------------------------
// parseDiff — turn unified diff text into structured DiffFile[]
// ---------------------------------------------------------------------------

export function parseDiff(diffText: string): DiffFile[] {
  const files: DiffFile[] = [];
  const lines = diffText.split("\n");
  let cursor = 0;

  while (cursor < lines.length) {
    // Look for a diff header
    if (!lines[cursor].startsWith("diff --git") && !lines[cursor].startsWith("---")) {
      cursor++;
      continue;
    }

    let oldPath = "";
    let newPath = "";

    // Parse diff --git header
    if (lines[cursor].startsWith("diff --git")) {
      const gitHeaderMatch = lines[cursor].match(/^diff --git a\/(.+?) b\/(.+)$/);
      if (gitHeaderMatch) {
        oldPath = gitHeaderMatch[1];
        newPath = gitHeaderMatch[2];
      }
      cursor++;

      // Skip index, mode, and similarity lines
      while (
        cursor < lines.length &&
        !lines[cursor].startsWith("---") &&
        !lines[cursor].startsWith("@@") &&
        !lines[cursor].startsWith("diff --git")
      ) {
        // Detect new/deleted file modes
        if (lines[cursor].startsWith("new file mode")) {
          // will be handled by status detection below
        }
        if (lines[cursor].startsWith("rename from")) {
          const m = lines[cursor].match(/^rename from (.+)$/);
          if (m) oldPath = m[1];
        }
        if (lines[cursor].startsWith("rename to")) {
          const m = lines[cursor].match(/^rename to (.+)$/);
          if (m) newPath = m[1];
        }
        cursor++;
      }
    }

    // Parse --- and +++ headers
    let oldIsDevNull = false;
    let newIsDevNull = false;

    if (cursor < lines.length && lines[cursor].startsWith("---")) {
      const oldMatch = lines[cursor].match(/^--- (?:a\/)?(.+)$/);
      if (oldMatch) {
        if (oldMatch[1] === "/dev/null" || oldMatch[1] === "dev/null") {
          oldIsDevNull = true;
        } else {
          oldPath = oldPath || oldMatch[1];
        }
      }
      cursor++;
    }

    if (cursor < lines.length && lines[cursor].startsWith("+++")) {
      const newMatch = lines[cursor].match(/^\+\+\+ (?:b\/)?(.+)$/);
      if (newMatch) {
        if (newMatch[1] === "/dev/null" || newMatch[1] === "dev/null") {
          newIsDevNull = true;
        } else {
          newPath = newPath || newMatch[1];
        }
      }
      cursor++;
    }

    // Determine status
    let status: DiffFile["status"] = "modified";
    if (oldIsDevNull) {
      status = "added";
      oldPath = newPath;
    } else if (newIsDevNull) {
      status = "deleted";
      newPath = oldPath;
    } else if (oldPath !== newPath) {
      status = "renamed";
    }

    const hunks: DiffHunk[] = [];
    let totalAdditions = 0;
    let totalDeletions = 0;
    let hunkIndex = 0;

    // Parse hunks
    while (cursor < lines.length && !lines[cursor].startsWith("diff --git")) {
      if (!lines[cursor].startsWith("@@")) {
        cursor++;
        continue;
      }

      const hunkMatch = lines[cursor].match(
        /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/
      );

      if (!hunkMatch) {
        cursor++;
        continue;
      }

      const oldStart = parseInt(hunkMatch[1], 10);
      const oldCount = hunkMatch[2] !== undefined ? parseInt(hunkMatch[2], 10) : 1;
      const newStart = parseInt(hunkMatch[3], 10);
      const newCount = hunkMatch[4] !== undefined ? parseInt(hunkMatch[4], 10) : 1;
      const header = lines[cursor];

      cursor++;

      const hunkLines: DiffLine[] = [];
      let currentOldLine = oldStart;
      let currentNewLine = newStart;

      while (cursor < lines.length && !lines[cursor].startsWith("@@") && !lines[cursor].startsWith("diff --git")) {
        const line = lines[cursor];

        if (line.startsWith("+")) {
          hunkLines.push({
            type: "added",
            content: line.slice(1),
            oldLineNumber: null,
            newLineNumber: currentNewLine,
          });
          currentNewLine++;
          totalAdditions++;
        } else if (line.startsWith("-")) {
          hunkLines.push({
            type: "removed",
            content: line.slice(1),
            oldLineNumber: currentOldLine,
            newLineNumber: null,
          });
          currentOldLine++;
          totalDeletions++;
        } else if (line.startsWith(" ") || line === "") {
          // Context line (or empty line treated as context)
          const content = line.startsWith(" ") ? line.slice(1) : line;
          hunkLines.push({
            type: "context",
            content,
            oldLineNumber: currentOldLine,
            newLineNumber: currentNewLine,
          });
          currentOldLine++;
          currentNewLine++;
        } else if (line.startsWith("\\")) {
          // "\ No newline at end of file" — skip
          cursor++;
          continue;
        } else {
          // Unrecognized line, stop hunk parsing
          break;
        }

        cursor++;
      }

      hunks.push({
        index: hunkIndex++,
        header,
        oldStart,
        oldCount,
        newStart,
        newCount,
        lines: hunkLines,
      });
    }

    if (hunks.length > 0 || status !== "modified") {
      files.push({
        oldPath,
        newPath,
        status,
        hunks,
        additions: totalAdditions,
        deletions: totalDeletions,
      });
    }
  }

  // Fallback: if no "diff --git" headers, parse a single file diff
  if (files.length === 0 && diffText.includes("@@")) {
    return parseSingleFileDiff(diffText);
  }

  return files;
}

/**
 * Parse a unified diff that has no "diff --git" header — just --- / +++ / @@
 */
function parseSingleFileDiff(diffText: string): DiffFile[] {
  const lines = diffText.split("\n");
  let cursor = 0;
  let oldPath = "unknown";
  let newPath = "unknown";

  // Find --- and +++ headers
  while (cursor < lines.length) {
    if (lines[cursor].startsWith("---")) {
      const m = lines[cursor].match(/^--- (?:a\/)?(.+)$/);
      if (m && m[1] !== "/dev/null") oldPath = m[1];
      cursor++;
      break;
    }
    cursor++;
  }

  while (cursor < lines.length) {
    if (lines[cursor].startsWith("+++")) {
      const m = lines[cursor].match(/^\+\+\+ (?:b\/)?(.+)$/);
      if (m && m[1] !== "/dev/null") newPath = m[1];
      cursor++;
      break;
    }
    cursor++;
  }

  let status: DiffFile["status"] = "modified";
  if (oldPath === "unknown" || oldPath === "/dev/null") {
    status = "added";
    oldPath = newPath;
  } else if (newPath === "unknown" || newPath === "/dev/null") {
    status = "deleted";
    newPath = oldPath;
  }

  const hunks: DiffHunk[] = [];
  let totalAdditions = 0;
  let totalDeletions = 0;
  let hunkIndex = 0;

  while (cursor < lines.length) {
    if (!lines[cursor].startsWith("@@")) {
      cursor++;
      continue;
    }

    const hunkMatch = lines[cursor].match(
      /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/
    );

    if (!hunkMatch) {
      cursor++;
      continue;
    }

    const oldStart = parseInt(hunkMatch[1], 10);
    const oldCount = hunkMatch[2] !== undefined ? parseInt(hunkMatch[2], 10) : 1;
    const newStart = parseInt(hunkMatch[3], 10);
    const newCount = hunkMatch[4] !== undefined ? parseInt(hunkMatch[4], 10) : 1;
    const header = lines[cursor];

    cursor++;

    const hunkLines: DiffLine[] = [];
    let currentOldLine = oldStart;
    let currentNewLine = newStart;

    while (cursor < lines.length && !lines[cursor].startsWith("@@")) {
      const line = lines[cursor];
      if (line.startsWith("+")) {
        hunkLines.push({ type: "added", content: line.slice(1), oldLineNumber: null, newLineNumber: currentNewLine });
        currentNewLine++;
        totalAdditions++;
      } else if (line.startsWith("-")) {
        hunkLines.push({ type: "removed", content: line.slice(1), oldLineNumber: currentOldLine, newLineNumber: null });
        currentOldLine++;
        totalDeletions++;
      } else if (line.startsWith(" ") || line === "") {
        const content = line.startsWith(" ") ? line.slice(1) : line;
        hunkLines.push({ type: "context", content, oldLineNumber: currentOldLine, newLineNumber: currentNewLine });
        currentOldLine++;
        currentNewLine++;
      } else if (line.startsWith("\\")) {
        cursor++;
        continue;
      } else {
        break;
      }
      cursor++;
    }

    hunks.push({ index: hunkIndex++, header, oldStart, oldCount, newStart, newCount, lines: hunkLines });
  }

  if (hunks.length === 0) return [];

  return [{ oldPath, newPath, status, hunks, additions: totalAdditions, deletions: totalDeletions }];
}

// ---------------------------------------------------------------------------
// applyHunkDecisions — produce the resulting file content based on decisions
// ---------------------------------------------------------------------------

/**
 * Given a parsed DiffFile and a map of hunk-index -> decision, produce the
 * resulting file content as a string. Accepted hunks keep added lines and
 * drop removed lines. Rejected hunks keep the original (removed lines stay,
 * added lines are dropped). Context lines are always kept.
 */
export function applyHunkDecisions(
  file: DiffFile,
  decisions: Map<number, "accept" | "reject">
): string {
  const outputLines: string[] = [];

  for (const hunk of file.hunks) {
    const decision = decisions.get(hunk.index) ?? "accept";

    for (const line of hunk.lines) {
      if (line.type === "context") {
        outputLines.push(line.content);
      } else if (line.type === "added") {
        if (decision === "accept") {
          outputLines.push(line.content);
        }
        // rejected: skip added lines
      } else if (line.type === "removed") {
        if (decision === "reject") {
          outputLines.push(line.content);
        }
        // accepted: skip removed lines (they're deleted)
      }
    }
  }

  return outputLines.join("\n");
}
