import path from "node:path";

/**
 * Configuration for the file sandbox.
 */
export interface SandboxConfig {
  /** Directories where file writes are allowed (absolute paths) */
  allowedRoots: string[];
  /** Glob-style patterns to always block (e.g. ".env", "*.pem") */
  blockedPatterns?: string[];
}

// ---------------------------------------------------------------------------
// Default blocked patterns — common sensitive file names
// ---------------------------------------------------------------------------

const DEFAULT_BLOCKED_PATTERNS = [
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "id_rsa",
  "id_rsa.*",
  "id_ed25519",
  "id_ed25519.*",
  "id_dsa",
  "id_dsa.*",
];

/**
 * Convert a simple glob pattern to a RegExp that matches the full string.
 */
function globToRegex(glob: string): RegExp {
  let result = "^";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*") {
      result += ".*";
    } else if (ch === "?") {
      result += ".";
    } else if (".+^${}()|[]\\".includes(ch)) {
      result += "\\" + ch;
    } else {
      result += ch;
    }
  }
  result += "$";
  return new RegExp(result);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether a file path is allowed by the sandbox configuration.
 *
 * 1. Resolves and normalizes the path.
 * 2. Checks the file is under one of the `allowedRoots`.
 * 3. Checks the basename against blocked patterns.
 */
export function isPathAllowed(filepath: string, config: SandboxConfig): boolean {
  const resolved = path.resolve(filepath);

  // Check the file is under an allowed root
  const underAllowedRoot = config.allowedRoots.some((root) => {
    const resolvedRoot = path.resolve(root);
    // Must be under the root (resolved path starts with root + separator, or equals root)
    return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep);
  });

  if (!underAllowedRoot) {
    return false;
  }

  // Check against blocked patterns
  const basename = path.basename(resolved);
  const patterns = config.blockedPatterns ?? DEFAULT_BLOCKED_PATTERNS;

  for (const pattern of patterns) {
    // Strip **/ prefix for basename matching
    const cleanPattern = pattern.replace(/^\*\*\//, "");
    if (globToRegex(cleanPattern).test(basename)) {
      return false;
    }
  }

  return true;
}

/**
 * Create a default sandbox configuration for a given worktree path.
 * The worktree is the only allowed root, and the default blocked patterns apply.
 */
export function createDefaultSandbox(worktreePath: string): SandboxConfig {
  return {
    allowedRoots: [path.resolve(worktreePath)],
    blockedPatterns: [...DEFAULT_BLOCKED_PATTERNS],
  };
}
