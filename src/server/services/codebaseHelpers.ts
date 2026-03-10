import path from "node:path";
import type { CodebaseTreeNode } from "../../shared/contracts";

export function detectLanguageFromPath(relativePath: string): string | null {
  if (/\.(ts|tsx)$/.test(relativePath)) return "typescript";
  if (/\.(js|jsx|mjs|cjs)$/.test(relativePath)) return "javascript";
  if (/\.py$/.test(relativePath)) return "python";
  if (/\.rs$/.test(relativePath)) return "rust";
  if (/\.mdx?$/.test(relativePath)) return "markdown";
  if (/\.json$/.test(relativePath)) return "json";
  if (/\.ya?ml$/.test(relativePath)) return "yaml";
  if (/\.css$/.test(relativePath)) return "css";
  if (/\.html$/.test(relativePath)) return "html";
  return null;
}

export function isBinaryBuffer(buffer: Buffer) {
  return buffer.includes(0);
}

export function ensureInsideRoot(root: string, relativePath: string) {
  const resolved = path.resolve(root, relativePath);
  const normalizedRoot = path.resolve(root);
  if (resolved !== normalizedRoot && !resolved.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error(`Refusing to access path outside active worktree: ${relativePath}`);
  }
  return resolved;
}

export function buildTree(paths: Array<{ path: string; status: CodebaseTreeNode["status"] }>) {
  const root: Array<CodebaseTreeNode & { children?: Array<CodebaseTreeNode & { children?: CodebaseTreeNode[] }> }> = [];

  for (const entry of paths) {
    const parts = entry.path.split("/").filter(Boolean);
    let currentLevel = root as Array<CodebaseTreeNode & { children?: CodebaseTreeNode[] }>;
    let currentPath = "";

    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isLeaf = index === parts.length - 1;
      let node = currentLevel.find((candidate) => path.posix.basename(candidate.path) === part);

      if (!node) {
        node = isLeaf
          ? {
              path: currentPath,
              kind: "file",
              language: detectLanguageFromPath(currentPath),
              status: entry.status,
            }
          : {
              path: currentPath,
              kind: "directory",
              children: [],
            };
        currentLevel.push(node);
      }

      if (!isLeaf) {
        if (!node.children) node.children = [];
        currentLevel = node.children as Array<CodebaseTreeNode & { children?: CodebaseTreeNode[] }>;
      }
    }
  }

  function finalize(nodes: Array<CodebaseTreeNode & { children?: CodebaseTreeNode[] }>): CodebaseTreeNode[] {
    return nodes
      .map((node) => ({
        ...node,
        children: node.children ? finalize(node.children as Array<CodebaseTreeNode & { children?: CodebaseTreeNode[] }>) : undefined,
      }))
      .sort((left, right) => {
        if (left.kind !== right.kind) {
          return left.kind === "directory" ? -1 : 1;
        }
        return left.path.localeCompare(right.path);
      });
  }

  return finalize(root);
}

export function truncateFileContent(text: string, lineLimit = 800, byteLimit = 64000) {
  const lines = text.split("\n");
  const truncated = Buffer.byteLength(text, "utf8") > byteLimit || lines.length > lineLimit;
  const content = truncated ? lines.slice(0, lineLimit).join("\n").slice(0, byteLimit) : text;
  return { content, truncated };
}
