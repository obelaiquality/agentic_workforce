import type { ConsoleEvent } from "../../shared/contracts";

export function extractJsonObject(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] || trimmed;
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("Model did not return a JSON object");
  }
  return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
}

export type PatchManifestFile = {
  path: string;
  action: "create" | "update";
  strategy?: "full_file" | "unified_diff" | "search_replace";
  reason: string;
};

export type ParsedPatchManifest = {
  summary: string;
  files: PatchManifestFile[];
  docsChecked: string[];
  tests: string[];
  raw: string;
};

function truncate(text: string, max = 500) {
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

export function parsePatchManifest(text: string): ParsedPatchManifest {
  const plan = extractJsonObject(text);
  return {
    summary: plan.summary || truncate(text, 180),
    files: Array.isArray(plan.files)
      ? plan.files
          .map((item: Record<string, unknown>) => ({
            path: typeof item.path === "string" ? (item.path as string).trim() : "",
            action: item.action === "create" ? ("create" as const) : ("update" as const),
            strategy:
              item.strategy === "unified_diff"
                ? ("unified_diff" as const)
                : item.strategy === "search_replace"
                  ? ("search_replace" as const)
                  : ("full_file" as const),
            reason:
              typeof item.reason === "string" && (item.reason as string).trim()
                ? (item.reason as string).trim()
                : "Update this file to satisfy the objective.",
          }))
          .filter((item: PatchManifestFile) => item.path)
      : [],
    docsChecked: Array.isArray(plan.docsChecked)
      ? plan.docsChecked.filter((item: unknown): item is string => typeof item === "string")
      : [],
    tests: Array.isArray(plan.tests)
      ? plan.tests.filter((item: unknown): item is string => typeof item === "string")
      : [],
    raw: text,
  };
}

export function mapConsoleCategory(type: string): ConsoleEvent["category"] {
  if (type.startsWith("execution.") || type.startsWith("task.")) return "execution";
  if (type.startsWith("verification.") || type.includes("verify")) return "verification";
  if (type.startsWith("approval.") || type.includes("approval")) return "approval";
  if (type.startsWith("channel.") || type.startsWith("subagent.")) return "automation";
  if (type.startsWith("repo.index") || type.startsWith("codegraph") || type.includes("context.pack")) return "indexing";
  return "provider";
}

export function mapConsoleLevel(type: string): ConsoleEvent["level"] {
  if (type.includes("failed") || type.includes("error") || type.includes("rejected")) return "error";
  if (type.includes("pending") || type.includes("cooldown") || type.includes("warn")) return "warn";
  return "info";
}

export function removeUnusedImportSymbol(content: string, symbol: string) {
  const lines = content.split("\n");
  let changed = false;
  const nextLines = lines.flatMap((line) => {
    if (!line.trim().startsWith("import ") || !line.includes(symbol)) {
      return [line];
    }

    const namedOnly = line.match(/^(\s*import\s*\{)([^}]+)(\}\s*from\s*["'][^"']+["'];?\s*)$/);
    if (namedOnly) {
      const names = namedOnly[2]
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .filter((item) => item.replace(/\s+as\s+.*/, "") !== symbol);
      changed = true;
      if (names.length === 0) {
        return [];
      }
      return [`${namedOnly[1]} ${names.join(", ")} ${namedOnly[3]}`.replace(/\s+\}/, " }")];
    }

    return [line];
  });

  return { changed, content: nextLines.join("\n") };
}

export function findMissingImportTargets(input: {
  worktreePath: string;
  combinedOutput: string;
}) {
  const unresolvedImportRegex =
    /(?:Failed to resolve import|Could not resolve)\s+["']([^"']+)["']\s+from\s+["']([^"']+)["']/gi;
  const targets: string[] = [];

  for (const match of input.combinedOutput.matchAll(unresolvedImportRegex)) {
    const importSpecifier = match[1];
    if (!importSpecifier?.startsWith(".")) {
      continue;
    }
    targets.push(importSpecifier);
  }

  return [...new Set(targets)];
}

/**
 * Deterministic repair: fix import paths after a file has been moved.
 * Scans import statements and rewrites relative paths that reference
 * the old location to point to the new location.
 */
export function repairImportPathAfterMove(input: {
  fileContent: string;
  oldRelativePath: string;
  newRelativePath: string;
}) {
  const { fileContent, oldRelativePath, newRelativePath } = input;
  const oldBase = oldRelativePath.replace(/\.[jt]sx?$/, "").replace(/\/index$/, "");
  const newBase = newRelativePath.replace(/\.[jt]sx?$/, "").replace(/\/index$/, "");

  if (oldBase === newBase) {
    return { changed: false, content: fileContent };
  }

  const lines = fileContent.split("\n");
  let changed = false;
  const nextLines = lines.map((line) => {
    if (!line.includes("import ") && !line.includes("require(")) {
      return line;
    }

    const importMatch = line.match(/(from\s+["'])([^"']+)(["'])/);
    const requireMatch = !importMatch ? line.match(/(require\(\s*["'])([^"']+)(["']\s*\))/) : null;
    const match = importMatch || requireMatch;

    if (!match) {
      return line;
    }

    const specifier = match[2];
    if (!specifier.startsWith(".")) {
      return line;
    }

    const specifierBase = specifier.replace(/\.[jt]sx?$/, "").replace(/\/index$/, "");
    if (specifierBase.endsWith(oldBase) || specifier.endsWith(oldBase)) {
      const updated = specifier.replace(oldBase, newBase);
      changed = true;
      return line.replace(match[0], `${match[1]}${updated}${match[3]}`);
    }

    return line;
  });

  return { changed, content: nextLines.join("\n") };
}

/**
 * Deterministic repair: fix stale test assertions where the expected
 * text no longer matches due to a direct, local change.
 * Only handles simple string-literal assertion mismatches.
 */
export function repairStaleAssertion(input: {
  testContent: string;
  oldText: string;
  newText: string;
}) {
  const { testContent, oldText, newText } = input;
  if (!oldText || !newText || oldText === newText) {
    return { changed: false, content: testContent };
  }

  if (!testContent.includes(oldText)) {
    return { changed: false, content: testContent };
  }

  const next = testContent.split(oldText).join(newText);
  return { changed: next !== testContent, content: next };
}
