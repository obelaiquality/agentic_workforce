import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface PathValidationResult {
  fullPath: string;
  error?: string;
}

/**
 * Comprehensive path validation — prevents traversal, injection, and dangerous operations.
 * Inspired by Claude Code's pathValidation.ts defense-in-depth approach.
 */
export function validatePath(
  worktreePath: string,
  filePath: string,
  operation: "read" | "write" | "delete" = "read"
): PathValidationResult {
  // 1. Reject empty paths
  if (!filePath || !filePath.trim()) {
    return { fullPath: "", error: "Path cannot be empty" };
  }

  // 2. Shell expansion blocking — reject paths with $, backticks, %
  if (containsShellExpansion(filePath)) {
    return { fullPath: "", error: `Path contains shell expansion characters: "${filePath}"` };
  }

  // 3. UNC path blocking — prevent credential leaking on Windows/WSL
  if (isUNCPath(filePath)) {
    return { fullPath: "", error: `UNC paths are not allowed: "${filePath}"` };
  }

  // 4. Tilde variant blocking — reject ~user, ~+, ~-
  if (containsDangerousTilde(filePath)) {
    return { fullPath: "", error: `Dangerous tilde expansion in path: "${filePath}"` };
  }

  // 5. Resolve and normalize
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(worktreePath, filePath);
  const normalized = path.normalize(fullPath);
  const normalizedWorktree = path.normalize(worktreePath);

  // 6. Basic boundary check
  if (!normalized.startsWith(normalizedWorktree + path.sep) && normalized !== normalizedWorktree) {
    return { fullPath: "", error: `Path traversal detected: "${filePath}" resolves outside worktree boundary` };
  }

  // 7. Symlink resolution — resolve symlinks and re-check boundary
  try {
    // Only check if the file/parent exists
    const existingPath = findExistingAncestor(normalized);
    if (existingPath) {
      const realPath = fs.realpathSync(existingPath);
      const realWorktree = fs.realpathSync(normalizedWorktree);
      if (!realPath.startsWith(realWorktree + path.sep) && realPath !== realWorktree) {
        return { fullPath: "", error: `Symlink resolves outside worktree: "${filePath}"` };
      }
    }
  } catch {
    // If realpath fails (e.g. broken symlink), allow the normalized path through.
    // The subsequent file operation will fail naturally.
  }

  // 8. For write/delete operations, check against dangerous paths
  if (operation === "write" || operation === "delete") {
    const dangerousError = checkDangerousPath(normalized, operation);
    if (dangerousError) {
      return { fullPath: "", error: dangerousError };
    }
  }

  // 9. Unicode normalization check
  const nfcNormalized = normalized.normalize("NFC");
  if (nfcNormalized !== normalized) {
    return { fullPath: "", error: `Path contains ambiguous Unicode characters: "${filePath}"` };
  }

  return { fullPath: normalized };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function containsShellExpansion(p: string): boolean {
  // Reject: $VAR, $(cmd), ${var}, `cmd`, %var%
  return /[\$`]|%[a-zA-Z]/.test(p);
}

function isUNCPath(p: string): boolean {
  // Reject: \\server\share or //server/share
  return /^\\\\[^\\]/.test(p) || /^\/\/[a-zA-Z]/.test(p);
}

function containsDangerousTilde(p: string): boolean {
  // Allow bare ~ at start only if followed by / or end of string.
  // Reject: ~user, ~+, ~-, ~. (tilde with any non-slash suffix)
  if (!p.startsWith("~")) return false;
  if (p === "~" || p.startsWith("~/")) return false;
  return true; // ~user, ~+, ~-, etc.
}

function findExistingAncestor(p: string): string | null {
  let current = p;
  while (current && current !== path.dirname(current)) {
    try {
      fs.accessSync(current);
      return current;
    } catch {
      current = path.dirname(current);
    }
  }
  return null;
}

function checkDangerousPath(normalized: string, operation: string): string | null {
  const home = os.homedir();
  const dangerousPaths = [
    "/",
    "/usr",
    "/etc",
    "/var",
    "/tmp",
    "/System",
    "/Library",
    "/bin",
    "/sbin",
    home,
  ];

  // On macOS, also block /Applications and /Users
  if (process.platform === "darwin") {
    dangerousPaths.push("/Applications", "/Users");
  }

  // Check if the path IS a dangerous directory (not files within it)
  for (const dangerous of dangerousPaths) {
    if (normalized === dangerous || normalized === dangerous + path.sep) {
      return `Cannot ${operation} dangerous path: "${normalized}"`;
    }
  }

  // Block writing to dotfiles in home directory
  const relToHome = path.relative(home, normalized);
  if (
    !relToHome.startsWith("..") &&
    relToHome.startsWith(".") &&
    (relToHome === ".bashrc" ||
      relToHome === ".zshrc" ||
      relToHome === ".profile" ||
      relToHome === ".bash_profile" ||
      relToHome === ".ssh" ||
      relToHome.startsWith(".ssh/"))
  ) {
    return `Cannot ${operation} sensitive dotfile: "${normalized}"`;
  }

  // Block glob patterns in write paths
  if ((operation === "write" || operation === "delete") && /[*?\[\]]/.test(normalized)) {
    return `Glob patterns not allowed in ${operation} paths: "${normalized}"`;
  }

  return null;
}
