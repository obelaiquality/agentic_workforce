/**
 * Result of validating a bash command string.
 */
export interface BashValidationResult {
  /** Whether every segment is considered safe */
  safe: boolean;
  /** Human-readable reason when `safe` is false */
  reason?: string;
  /** The individual command segments after splitting on pipes/operators */
  segments: string[];
}

// ---------------------------------------------------------------------------
// Allowlisted safe commands (prefix match on trimmed segment)
// ---------------------------------------------------------------------------

const SAFE_COMMAND_PREFIXES = [
  "ls",
  "cat",
  "head",
  "tail",
  "grep",
  "find",
  "echo",
  "pwd",
  "wc",
  "sort",
  "diff",
  "git status",
  "git log",
  "git diff",
  "npm test",
  "npm run",
];

// ---------------------------------------------------------------------------
// Dangerous patterns (reuses the same spirit as defaultPolicies.ts)
// ---------------------------------------------------------------------------

const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /rm\s+(-[rf]+\s+)?\/($|\s)/, label: "rm targeting root" },
  { pattern: /rm\s+(-[rf]+\s+)?\S*\*/, label: "rm with glob wildcard" },
  { pattern: /rm\s+(-rf?|--recursive)\s+(\/|~|\.\.)/i, label: "recursive rm on sensitive path" },
  { pattern: /sudo\s+rm\s+-rf/i, label: "sudo rm -rf" },
  { pattern: /git\s+push\s+.*--force/i, label: "git push --force" },
  { pattern: /git\s+push\s+-f/i, label: "git push -f" },
  { pattern: /git\s+reset\s+--hard/i, label: "git reset --hard" },
  { pattern: /DROP\s+(TABLE|DATABASE)/i, label: "DROP TABLE/DATABASE" },
  { pattern: /DELETE\s+FROM\s+\w+\s*(;|$)/i, label: "DELETE FROM without WHERE" },
  { pattern: /TRUNCATE\s+TABLE/i, label: "TRUNCATE TABLE" },
  { pattern: /dd\s+if=/i, label: "dd if=" },
  { pattern: /mkfs\./i, label: "mkfs (format filesystem)" },
  { pattern: />?\s*\/dev\/(null|zero|random|sd)/i, label: "write to device file" },
  { pattern: /chmod\s+777/i, label: "chmod 777" },
  { pattern: /curl\s+.*\|\s*(ba)?sh/i, label: "curl piped to shell" },
  { pattern: /wget\s+.*\|\s*(ba)?sh/i, label: "wget piped to shell" },
];

// ---------------------------------------------------------------------------
// Command splitting
// ---------------------------------------------------------------------------

/**
 * Split a compound command string into its individual segments.
 * Splits on `|`, `;`, `&&`, and `||`.
 */
function splitCommand(command: string): string[] {
  // Split on pipe (|), logical AND (&&), logical OR (||), and semicolon (;)
  // We split on || before | to avoid partial matches
  return command
    .split(/\s*(?:\|\||&&|;|\|)\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Check if a single segment matches a safe command prefix.
 */
function isSafeSegment(segment: string): boolean {
  const lower = segment.toLowerCase();
  return SAFE_COMMAND_PREFIXES.some((prefix) => {
    // Must match prefix followed by end-of-string or whitespace
    if (lower === prefix) return true;
    if (lower.startsWith(prefix + " ")) return true;
    return false;
  });
}

/**
 * Check if a single segment matches a dangerous pattern.
 * Returns the label of the first matching pattern, or null.
 */
function findDangerousPattern(segment: string): string | null {
  for (const { pattern, label } of DANGEROUS_PATTERNS) {
    if (pattern.test(segment)) {
      return label;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate a bash command by splitting it into segments and checking each
 * against allowlisted safe commands and dangerous patterns.
 *
 * A command is considered safe only if every segment is in the allowlist
 * and no segment matches a dangerous pattern.
 */
export function validateBashCommand(command: string): BashValidationResult {
  const segments = splitCommand(command);

  if (segments.length === 0) {
    return { safe: true, reason: undefined, segments: [] };
  }

  // Check the full (unsplit) command against dangerous patterns first.
  // This catches cross-segment patterns like "curl ... | sh".
  const fullDangerous = findDangerousPattern(command);
  if (fullDangerous) {
    return {
      safe: false,
      reason: `Dangerous pattern detected: ${fullDangerous} in command "${command}"`,
      segments,
    };
  }

  // Per-segment dangerous pattern check
  for (const segment of segments) {
    const dangerousLabel = findDangerousPattern(segment);
    if (dangerousLabel) {
      return {
        safe: false,
        reason: `Dangerous pattern detected: ${dangerousLabel} in segment "${segment}"`,
        segments,
      };
    }
  }

  // Verify all segments are in the safe allowlist
  for (const segment of segments) {
    if (!isSafeSegment(segment)) {
      return {
        safe: false,
        reason: `Segment "${segment}" is not in the safe command allowlist`,
        segments,
      };
    }
  }

  return { safe: true, reason: undefined, segments };
}
