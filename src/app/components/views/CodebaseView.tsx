import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MutableRefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, ChevronRight, Code2, Copy, FileCode2, Folder, FolderOpen, FolderTree, Search, Sparkles, WrapText } from "lucide-react";
import { EmptyState } from "../ui/empty-state";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { CodebaseTreeNode, CodeGraphNode, ContextPack } from "../../../shared/contracts";
import { getMissionCodeFileDiffV8, getMissionCodeFileV8, getMissionCodebaseTreeV8, getCodeGraphStatusV5, queryCodeGraphV5, buildContextPackV5, getLatestContextPackV5 } from "../../lib/apiClient";
import { getDesktopBridge, openDesktopExternal } from "../../lib/desktopBridge";
import { sanitizeSvgMarkup } from "../../lib/sanitizeSvgMarkup";
import { useUiStore } from "../../store/uiStore";
import { ProcessingIndicator } from "../ui/processing-indicator";

const STATUS_COLOR = {
  modified: "text-amber-400",
  added: "text-emerald-400",
  deleted: "text-rose-400",
  unchanged: "text-zinc-500",
};

const STATUS_BADGE = {
  modified: "bg-amber-500/10 text-amber-400",
  added: "bg-emerald-500/10 text-emerald-400",
  deleted: "bg-rose-500/10 text-rose-400",
  unchanged: "bg-zinc-800 text-zinc-500",
};

const STATUS_ICON = {
  modified: "M",
  added: "A",
  deleted: "D",
  unchanged: "·",
};

const LANGUAGE_LABELS: Record<string, string> = {
  typescript: "TypeScript",
  javascript: "JavaScript",
  python: "Python",
  rust: "Rust",
  markdown: "Markdown",
  json: "JSON",
  yaml: "YAML",
  css: "CSS",
  html: "HTML",
};

const CODE_KEYWORDS: Record<string, string[]> = {
  typescript: [
    "as",
    "async",
    "await",
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "default",
    "delete",
    "do",
    "else",
    "enum",
    "export",
    "extends",
    "false",
    "finally",
    "for",
    "from",
    "function",
    "if",
    "implements",
    "import",
    "in",
    "instanceof",
    "interface",
    "let",
    "new",
    "null",
    "private",
    "protected",
    "public",
    "readonly",
    "return",
    "static",
    "super",
    "switch",
    "this",
    "throw",
    "true",
    "try",
    "type",
    "typeof",
    "undefined",
    "var",
    "void",
    "while",
    "yield",
  ],
  javascript: [
    "async",
    "await",
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "default",
    "delete",
    "do",
    "else",
    "export",
    "extends",
    "false",
    "finally",
    "for",
    "from",
    "function",
    "if",
    "import",
    "in",
    "instanceof",
    "let",
    "new",
    "null",
    "return",
    "static",
    "super",
    "switch",
    "this",
    "throw",
    "true",
    "try",
    "typeof",
    "undefined",
    "var",
    "while",
    "yield",
  ],
  python: [
    "and",
    "as",
    "assert",
    "async",
    "await",
    "break",
    "class",
    "continue",
    "def",
    "del",
    "elif",
    "else",
    "except",
    "False",
    "finally",
    "for",
    "from",
    "global",
    "if",
    "import",
    "in",
    "is",
    "lambda",
    "None",
    "nonlocal",
    "not",
    "or",
    "pass",
    "raise",
    "return",
    "True",
    "try",
    "while",
    "with",
    "yield",
  ],
  rust: [
    "as",
    "async",
    "await",
    "break",
    "const",
    "continue",
    "crate",
    "else",
    "enum",
    "extern",
    "false",
    "fn",
    "for",
    "if",
    "impl",
    "in",
    "let",
    "loop",
    "match",
    "mod",
    "move",
    "mut",
    "pub",
    "ref",
    "return",
    "self",
    "Self",
    "static",
    "struct",
    "super",
    "trait",
    "true",
    "type",
    "unsafe",
    "use",
    "where",
    "while",
  ],
};

interface HighlightToken {
  text: string;
  className?: string;
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16);
}

function MermaidDiagram({ chart, idSeed }: { chart: string; idSeed: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const diagramId = `mermaid-${idSeed}-${hashString(chart)}`;

    async function renderMermaid() {
      try {
        const mermaidModule = await import("mermaid");
        const mermaid = mermaidModule.default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "dark",
          themeVariables: {
            primaryColor: "#121722",
            primaryTextColor: "#E5E7EB",
            lineColor: "#22D3EE",
            tertiaryColor: "#1E293B",
            fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans",
          },
        });
        const rendered = await mermaid.render(diagramId, chart);
        if (!cancelled) {
          setSvg(rendered.svg);
          setError(null);
        }
      } catch (renderError) {
        if (!cancelled) {
          const message = renderError instanceof Error ? renderError.message : String(renderError);
          setError(message);
          setSvg(null);
        }
      }
    }

    void renderMermaid();
    return () => {
      cancelled = true;
    };
  }, [chart, idSeed]);

  if (error) {
    return (
      <div className="rounded-xl border border-rose-500/20 bg-rose-500/[0.08] p-3 text-xs text-rose-200">
        Mermaid render failed: {error}
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/20 bg-cyan-500/[0.08] px-3 py-2 text-xs text-cyan-100">
        <ProcessingIndicator kind="processing" active size="xs" tone="subtle" />
        Rendering diagram…
      </div>
    );
  }

  return (
    <div
      className="overflow-x-auto rounded-xl border border-white/10 bg-black/20 p-3 [&_svg]:h-auto [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: sanitizeSvgMarkup(svg) }}
    />
  );
}

function pushWithKeywordAndNumberHighlight(target: HighlightToken[], text: string, language: string) {
  if (!text) return;
  const keywordSet = new Set(CODE_KEYWORDS[language] || []);
  const pattern = /\b([A-Za-z_][A-Za-z0-9_]*)\b|(-?\b\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?\b)/gi;
  let cursor = 0;
  let match = pattern.exec(text);
  while (match) {
    const [fullMatch, identifier, numericLiteral] = match;
    const start = match.index;
    if (start > cursor) {
      target.push({ text: text.slice(cursor, start) });
    }
    if (identifier) {
      target.push({
        text: fullMatch,
        className: keywordSet.has(identifier) ? "text-violet-300" : undefined,
      });
    } else if (numericLiteral) {
      target.push({ text: fullMatch, className: "text-amber-300" });
    } else {
      target.push({ text: fullMatch });
    }
    cursor = start + fullMatch.length;
    match = pattern.exec(text);
  }
  if (cursor < text.length) {
    target.push({ text: text.slice(cursor) });
  }
}

function tokenizeJsonLine(line: string) {
  const tokens: HighlightToken[] = [];
  const pattern = /"(?:\\.|[^"\\])*"|-?\b\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?\b|\btrue\b|\bfalse\b|\bnull\b/gi;
  let cursor = 0;
  let match = pattern.exec(line);
  while (match) {
    const [fullMatch] = match;
    const start = match.index;
    if (start > cursor) {
      tokens.push({ text: line.slice(cursor, start) });
    }
    if (fullMatch.startsWith("\"")) {
      const trailing = line.slice(start + fullMatch.length);
      const isJsonKey = /^\s*:/.test(trailing);
      tokens.push({ text: fullMatch, className: isJsonKey ? "text-cyan-300" : "text-emerald-300" });
    } else if (/^(true|false|null)$/i.test(fullMatch)) {
      tokens.push({ text: fullMatch, className: "text-fuchsia-300" });
    } else {
      tokens.push({ text: fullMatch, className: "text-amber-300" });
    }
    cursor = start + fullMatch.length;
    match = pattern.exec(line);
  }
  if (cursor < line.length) {
    tokens.push({ text: line.slice(cursor) });
  }
  return tokens;
}

function tokenizeMarkdownLine(line: string) {
  if (/^\s*```/.test(line)) {
    return [{ text: line, className: "text-cyan-300" }];
  }
  const headingMatch = line.match(/^(\s{0,3}#{1,6}\s+)(.*)$/);
  if (headingMatch) {
    return [
      { text: headingMatch[1], className: "text-cyan-300" },
      { text: headingMatch[2], className: "text-zinc-100" },
    ];
  }
  const listMatch = line.match(/^(\s*(?:[-*+]\s+|\d+\.\s+))(.*)$/);
  if (listMatch) {
    return [
      { text: listMatch[1], className: "text-violet-300" },
      { text: listMatch[2] },
    ];
  }
  const quoteMatch = line.match(/^(\s*>\s+)(.*)$/);
  if (quoteMatch) {
    return [
      { text: quoteMatch[1], className: "text-zinc-500" },
      { text: quoteMatch[2], className: "text-zinc-300" },
    ];
  }
  return [{ text: line }];
}

function tokenizeCodeLine(line: string, language: string) {
  const tokens: HighlightToken[] = [];
  const commentPrefix = language === "python" || language === "yaml" ? "#" : language === "sql" ? "--" : "//";
  let buffer = "";
  let cursor = 0;
  const flushBuffer = () => {
    if (!buffer) return;
    pushWithKeywordAndNumberHighlight(tokens, buffer, language);
    buffer = "";
  };

  while (cursor < line.length) {
    const char = line[cursor];
    const nextChar = line[cursor + 1];
    const isLineComment =
      commentPrefix.length === 2
        ? line.startsWith(commentPrefix, cursor)
        : commentPrefix.length === 1 && char === commentPrefix;
    if (isLineComment) {
      flushBuffer();
      tokens.push({ text: line.slice(cursor), className: "text-zinc-500" });
      return tokens;
    }
    if (char === "/" && nextChar === "*") {
      flushBuffer();
      const end = line.indexOf("*/", cursor + 2);
      const closeIndex = end >= 0 ? end + 2 : line.length;
      tokens.push({ text: line.slice(cursor, closeIndex), className: "text-zinc-500" });
      cursor = closeIndex;
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      flushBuffer();
      const delimiter = char;
      let end = cursor + 1;
      while (end < line.length) {
        if (line[end] === "\\" && delimiter !== "`") {
          end += 2;
          continue;
        }
        if (line[end] === delimiter) {
          end += 1;
          break;
        }
        end += 1;
      }
      tokens.push({ text: line.slice(cursor, end), className: "text-emerald-300" });
      cursor = end;
      continue;
    }
    buffer += char;
    cursor += 1;
  }
  flushBuffer();
  return tokens;
}

function highlightLine(line: string, language: string) {
  if (!line) return [{ text: " " }] as HighlightToken[];
  if (language === "json") {
    return tokenizeJsonLine(line);
  }
  if (language === "markdown") {
    return tokenizeMarkdownLine(line);
  }
  if (language === "yaml") {
    const keyMatch = line.match(/^(\s*[A-Za-z0-9_.-]+\s*:\s*)(.*)$/);
    if (keyMatch) {
      const remainder: HighlightToken[] = [];
      pushWithKeywordAndNumberHighlight(remainder, keyMatch[2], language);
      return [{ text: keyMatch[1], className: "text-cyan-300" }, ...remainder];
    }
  }
  return tokenizeCodeLine(line, language);
}

function inferLanguageFromPath(filePath: string) {
  if (/\.(ts|tsx)$/.test(filePath)) return "typescript";
  if (/\.(js|jsx|mjs|cjs)$/.test(filePath)) return "javascript";
  if (/\.py$/.test(filePath)) return "python";
  if (/\.rs$/.test(filePath)) return "rust";
  if (/\.mdx?$/.test(filePath)) return "markdown";
  if (/\.json$/.test(filePath)) return "json";
  if (/\.ya?ml$/.test(filePath)) return "yaml";
  if (/\.css$/.test(filePath)) return "css";
  if (/\.html?$/.test(filePath)) return "html";
  return "text";
}

function toLanguageLabel(language: string | null | undefined, filePath: string) {
  const resolved = language || inferLanguageFromPath(filePath);
  return LANGUAGE_LABELS[resolved] || resolved || "Text";
}

function fileParentPath(filePath: string) {
  const parts = filePath.split("/");
  if (parts.length <= 1) return "repo root";
  return parts.slice(0, -1).join("/");
}

function countMatchingLines(content: string, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return 0;
  return content.split("\n").reduce((count, line) => count + (line.toLowerCase().includes(needle) ? 1 : 0), 0);
}

function scopeLabel(scope: "context" | "tests" | "docs" | "all") {
  switch (scope) {
    case "context":
      return "Context";
    case "tests":
      return "Tests";
    case "docs":
      return "Docs";
    default:
      return "All Files";
  }
}

function scopeAsset(scope: "context" | "tests" | "docs" | "all") {
  switch (scope) {
    case "tests":
      return "/assets/verification-shield.svg";
    case "docs":
      return "/assets/structural-blueprint.svg";
    case "context":
      return "/assets/hypercube.svg";
    default:
      return "/assets/focus-reticle.svg";
  }
}

function flattenFiles(nodes: CodebaseTreeNode[]): Array<CodebaseTreeNode & { depth: number }> {
  const output: Array<CodebaseTreeNode & { depth: number }> = [];

  function walk(items: CodebaseTreeNode[], depth: number) {
    for (const item of items) {
      output.push({ ...item, depth });
      if (item.kind === "directory" && item.children?.length) {
        walk(item.children, depth + 1);
      }
    }
  }

  walk(nodes, 0);
  return output;
}

function collectAncestorDirectories(filePath: string) {
  const parts = filePath.split("/");
  const ancestors: string[] = [];
  for (let index = 1; index < parts.length; index += 1) {
    ancestors.push(parts.slice(0, index).join("/"));
  }
  return ancestors;
}

function collectTopLevelDirectories(nodes: CodebaseTreeNode[]) {
  return nodes.filter((node) => node.kind === "directory").map((node) => node.path);
}

function treeHasVisibleDescendant(node: CodebaseTreeNode, visiblePaths: Set<string>) {
  if (node.kind === "file") {
    return visiblePaths.has(node.path);
  }
  return (node.children || []).some((child) => treeHasVisibleDescendant(child, visiblePaths));
}

function orderedValuesMatch(left: Iterable<string>, right: Iterable<string>) {
  const leftValues = Array.from(left);
  const rightValues = Array.from(right);
  if (leftValues.length !== rightValues.length) return false;
  return leftValues.every((value, index) => value === rightValues[index]);
}

function firstFilePath(nodes: CodebaseTreeNode[]): string | null {
  for (const node of nodes) {
    if (node.kind === "file") {
      return node.path;
    }
    if (node.children?.length) {
      const nested = firstFilePath(node.children);
      if (nested) return nested;
    }
  }
  return null;
}

interface VisibleTreeRow {
  path: string;
  kind: "file" | "directory";
  depth: number;
  parentPath: string | null;
  isExpanded?: boolean;
}

function buildVisibleTreeRows(
  nodes: CodebaseTreeNode[],
  visiblePaths: Set<string>,
  expandedDirectories: Set<string>,
  searchActive: boolean,
  depth = 0,
  parentPath: string | null = null
): VisibleTreeRow[] {
  const rows: VisibleTreeRow[] = [];
  for (const node of nodes) {
    if (!treeHasVisibleDescendant(node, visiblePaths)) continue;
    if (node.kind === "directory") {
      const isExpanded = searchActive || expandedDirectories.has(node.path);
      rows.push({
        path: node.path,
        kind: "directory",
        depth,
        parentPath,
        isExpanded,
      });
      if (isExpanded) {
        rows.push(...buildVisibleTreeRows(node.children || [], visiblePaths, expandedDirectories, searchActive, depth + 1, node.path));
      }
      continue;
    }
    rows.push({
      path: node.path,
      kind: "file",
      depth,
      parentPath,
    });
  }
  return rows;
}

function parsePatchBlocks(patch: string) {
  return patch.split("\n").map((line, index) => {
    let kind: "meta" | "added" | "removed" | "hunk" | "context" = "context";
    if (line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ")) {
      kind = "meta";
    } else if (line.startsWith("@@")) {
      kind = "hunk";
    } else if (line.startsWith("+")) {
      kind = "added";
    } else if (line.startsWith("-")) {
      kind = "removed";
    }
    return { line, kind, number: index + 1 };
  });
}

function CodeGraphPanel({ repoId }: { repoId: string }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [queryMode, setQueryMode] = useState<"basic" | "impact" | "review" | "architecture" | "cross_project">("basic");
  const [searchSubmitted, setSearchSubmitted] = useState(false);
  const [submittedQuery, setSubmittedQuery] = useState("");

  const statusQuery = useQuery({
    queryKey: ["code-graph-status-v5", repoId],
    queryFn: () => getCodeGraphStatusV5(repoId),
    enabled: Boolean(repoId),
    staleTime: 10000,
  });

  const resultsQuery = useQuery({
    queryKey: ["code-graph-query-v5", repoId, submittedQuery, queryMode],
    queryFn: () => queryCodeGraphV5(repoId, submittedQuery, queryMode),
    enabled: Boolean(repoId && searchSubmitted && submittedQuery.trim()),
    staleTime: 5000,
  });

  const latestPackQuery = useQuery({
    queryKey: ["latest-context-pack-v5", repoId],
    queryFn: () => getLatestContextPackV5(repoId),
    enabled: Boolean(repoId),
    staleTime: 10000,
  });

  const status = statusQuery.data?.item;
  const results = resultsQuery.data?.items || [];
  const latestPack = latestPackQuery.data?.item;

  function handleSearch(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = searchQuery.trim();
    if (!trimmed) return;
    setSubmittedQuery(trimmed);
    setSearchSubmitted(true);
  }

  async function handleBuildContextPack() {
    if (!repoId || !submittedQuery.trim()) return;
    try {
      await buildContextPackV5({
        repoId,
        objective: submittedQuery,
        queryMode,
      });
      await latestPackQuery.refetch();
    } catch (error) {
      console.error("Failed to build context pack:", error);
    }
  }

  const kindColors: Record<string, string> = {
    file: "bg-cyan-500/10 text-cyan-300 border-cyan-400/20",
    symbol: "bg-violet-500/10 text-violet-300 border-violet-400/20",
    test: "bg-emerald-500/10 text-emerald-300 border-emerald-400/20",
    doc: "bg-amber-500/10 text-amber-300 border-amber-400/20",
    command: "bg-rose-500/10 text-rose-300 border-rose-400/20",
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="rounded-[18px] border border-white/8 bg-white/[0.02] px-4 py-3">
        <div className="flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-3">
            <span className="text-zinc-400">Status:</span>
            {statusQuery.isLoading ? (
              <ProcessingIndicator kind="processing" active size="xs" tone="subtle" />
            ) : status ? (
              <>
                <span className={status.indexed ? "text-emerald-300" : "text-amber-300"}>
                  {status.indexed ? "Indexed" : "Not indexed"}
                </span>
                {status.indexed && (
                  <>
                    <span className="text-zinc-600">•</span>
                    <span className="text-zinc-400">{status.nodeCount} nodes</span>
                    <span className="text-zinc-600">•</span>
                    <span className="text-zinc-400">{status.edgeCount} edges</span>
                    {status.lastIndexedAt && (
                      <>
                        <span className="text-zinc-600">•</span>
                        <span className="text-zinc-500 font-mono text-[10px]">
                          {new Date(status.lastIndexedAt).toLocaleString()}
                        </span>
                      </>
                    )}
                  </>
                )}
              </>
            ) : (
              <span className="text-zinc-500">No status available</span>
            )}
          </div>
        </div>
      </div>

      <form onSubmit={handleSearch} className="rounded-[18px] border border-white/8 bg-white/[0.02] px-4 py-4">
        <label className="block">
          <span className="mb-2 block text-[10px] uppercase tracking-[0.18em] text-zinc-400">Symbol Search</span>
          <div className="flex gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search symbols, files, or entities..."
              className="flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600"
            />
            <select
              value={queryMode}
              onChange={(e) => setQueryMode(e.target.value as typeof queryMode)}
              className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-200"
            >
              <option value="basic">Basic</option>
              <option value="impact">Impact</option>
              <option value="review">Review</option>
              <option value="architecture">Architecture</option>
              <option value="cross_project">Cross Project</option>
            </select>
            <button
              type="submit"
              className="rounded-xl border border-cyan-400/20 bg-cyan-500/[0.10] px-4 py-2 text-xs text-cyan-100 transition hover:bg-cyan-500/[0.15]"
            >
              Search
            </button>
          </div>
        </label>
      </form>

      {resultsQuery.isLoading ? (
        <div className="rounded-[18px] border border-white/8 bg-white/[0.02] px-4 py-3 text-xs text-zinc-500">
          <div className="inline-flex items-center gap-2">
            <ProcessingIndicator kind="processing" active size="xs" tone="subtle" />
            Searching...
          </div>
        </div>
      ) : results.length > 0 ? (
        <div className="rounded-[18px] border border-white/8 bg-white/[0.02] p-3">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-400">
              {results.length} {results.length === 1 ? "result" : "results"}
            </span>
            <button
              type="button"
              onClick={handleBuildContextPack}
              className="rounded-xl border border-emerald-400/20 bg-emerald-500/[0.10] px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-emerald-100 transition hover:bg-emerald-500/[0.15]"
            >
              Build Context Pack
            </button>
          </div>
          <div className="space-y-2">
            {results.map((node) => (
              <div
                key={node.id}
                className="rounded-xl border border-white/8 bg-black/20 px-3 py-2 transition hover:bg-white/[0.02]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-zinc-200">{node.name}</span>
                      <span className={`rounded-md border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] ${kindColors[node.kind] || "bg-zinc-500/10 text-zinc-300 border-zinc-400/20"}`}>
                        {node.kind}
                      </span>
                    </div>
                    <div className="mt-1 text-[10px] text-zinc-500">
                      {node.path}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : searchSubmitted ? (
        <div className="rounded-[18px] border border-white/8 bg-white/[0.02] px-4 py-3 text-xs text-zinc-500">
          No results found for "{submittedQuery}"
        </div>
      ) : null}

      {latestPack ? (
        <div className="rounded-[18px] border border-emerald-500/16 bg-emerald-500/[0.06] px-4 py-3">
          <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-emerald-300">Latest Context Pack</div>
          <div className="text-xs text-emerald-100">
            <div className="mb-1">
              <span className="text-emerald-200/70">Objective:</span> {latestPack.objective}
            </div>
            <div className="mb-1">
              <span className="text-emerald-200/70">Mode:</span> {latestPack.queryMode}
            </div>
            <div>
              <span className="text-emerald-200/70">Files:</span> {latestPack.files.length}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function CodebaseView({
  repoId,
  contextPaths = [],
  testPaths = [],
  docPaths = [],
  workflowTitle,
  requestedScope,
}: {
  repoId: string | null;
  contextPaths?: string[];
  testPaths?: string[];
  docPaths?: string[];
  workflowTitle?: string | null;
  requestedScope?: "context" | "tests" | "docs" | "all";
}) {
  const [activeTab, setActiveTab] = useState<"files" | "graph">("files");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "modified" | "added" | "unchanged" | "deleted">("all");
  const [fileSearch, setFileSearch] = useState("");
  const [codeSearch, setCodeSearch] = useState("");
  const [wrapLines, setWrapLines] = useState(false);
  const [copiedTarget, setCopiedTarget] = useState<"path" | "content" | null>(null);
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(new Set());
  const [treeFocusedPath, setTreeFocusedPath] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<"source" | "changes">("source");
  const [markdownMode, setMarkdownMode] = useState<"raw" | "preview">("preview");
  const storedScope = useUiStore((state) => state.codebaseScope);
  const storedExpandedDirectoriesByRepo = useUiStore((state) => state.codebaseExpandedDirectoriesByRepo);
  const storedSelectedFileByRepoScope = useUiStore((state) => state.codebaseSelectedFileByRepoScope);
  const setCodebaseScope = useUiStore((state) => state.setCodebaseScope);
  const setCodebaseExpandedDirectories = useUiStore((state) => state.setCodebaseExpandedDirectories);
  const setCodebaseSelectedFile = useUiStore((state) => state.setCodebaseSelectedFile);
  const setActiveSection = useUiStore((state) => state.setActiveSection);

  const treeQuery = useQuery({
    queryKey: ["mission-codebase-tree-v8", repoId],
    queryFn: () => getMissionCodebaseTreeV8(repoId!),
    enabled: Boolean(repoId),
    staleTime: 3000,
  });

  const tree = treeQuery.data?.items ?? [];
  const flattened = useMemo(() => flattenFiles(tree), [tree]);
  const fileNodes = useMemo(() => flattened.filter((node) => node.kind === "file"), [flattened]);
  const normalizedContextPaths = useMemo(() => Array.from(new Set(contextPaths.filter(Boolean))), [contextPaths]);
  const normalizedTestPaths = useMemo(() => Array.from(new Set(testPaths.filter(Boolean))), [testPaths]);
  const normalizedDocPaths = useMemo(() => Array.from(new Set(docPaths.filter(Boolean))), [docPaths]);
  const requestedScopeValue = requestedScope || storedScope;
  const effectiveScope = useMemo(() => {
    if (requestedScopeValue === "context" && normalizedContextPaths.length > 0) return "context";
    if (requestedScopeValue === "tests" && normalizedTestPaths.length > 0) return "tests";
    if (requestedScopeValue === "docs" && normalizedDocPaths.length > 0) return "docs";
    return "all";
  }, [normalizedContextPaths.length, normalizedDocPaths.length, normalizedTestPaths.length, requestedScopeValue]);
  const scopedPaths = useMemo(() => {
    switch (effectiveScope) {
      case "context":
        return normalizedContextPaths;
      case "tests":
        return normalizedTestPaths;
      case "docs":
        return normalizedDocPaths;
      default:
        return [];
    }
  }, [effectiveScope, normalizedContextPaths, normalizedDocPaths, normalizedTestPaths]);
  const scopedPathSet = useMemo(() => new Set(scopedPaths), [scopedPaths]);
  const testPathSet = useMemo(() => new Set(normalizedTestPaths), [normalizedTestPaths]);
  const docPathSet = useMemo(() => new Set(normalizedDocPaths), [normalizedDocPaths]);
  const persistedExpandedDirectories = useMemo(
    () => (repoId ? storedExpandedDirectoriesByRepo[repoId] || [] : []),
    [repoId, storedExpandedDirectoriesByRepo]
  );
  const persistedSelectedFileForScope = useMemo(
    () => (repoId ? storedSelectedFileByRepoScope[repoId]?.[effectiveScope] || null : null),
    [effectiveScope, repoId, storedSelectedFileByRepoScope]
  );

  useEffect(() => {
    if (tree.length === 0) return;
    const hasPath = (path: string | null | undefined) => Boolean(path && fileNodes.some((node) => node.path === path));
    const scopeDefault = effectiveScope !== "all" && scopedPaths.length > 0 ? scopedPaths[0] : null;
    const fallbackPath = scopeDefault || firstFilePath(tree);

    if (persistedSelectedFileForScope && hasPath(persistedSelectedFileForScope) && selectedPath !== persistedSelectedFileForScope) {
      setSelectedPath(persistedSelectedFileForScope);
      return;
    }

    if (!selectedPath) {
      setSelectedPath(fallbackPath);
      return;
    }

    if (!hasPath(selectedPath)) {
      setSelectedPath(fallbackPath);
      return;
    }

    if (effectiveScope !== "all" && scopedPathSet.size > 0 && !scopedPathSet.has(selectedPath)) {
      setSelectedPath(scopeDefault || persistedSelectedFileForScope || fallbackPath);
    }
  }, [effectiveScope, fileNodes, persistedSelectedFileForScope, scopedPathSet, scopedPaths, selectedPath, tree]);

  const filtered = useMemo(
    () =>
      fileNodes.filter((node) => {
        if (effectiveScope !== "all" && scopedPathSet.size > 0 && !scopedPathSet.has(node.path)) {
          return false;
        }
        if (filter === "all") return true;
        if ((node.status || "unchanged") !== filter) return false;
        return true;
      }),
    [effectiveScope, fileNodes, filter, scopedPathSet]
  );

  const searchedFiles = useMemo(() => {
    const needle = fileSearch.trim().toLowerCase();
    if (!needle) return filtered;
    return filtered.filter((node) => node.path.toLowerCase().includes(needle));
  }, [fileSearch, filtered]);
  const selectedSearchMatchIndex = useMemo(
    () => searchedFiles.findIndex((node) => node.path === selectedPath),
    [searchedFiles, selectedPath, focusTreeRow]
  );
  const searchedFileSet = useMemo(() => new Set(searchedFiles.map((node) => node.path)), [searchedFiles]);
  const searchActive = fileSearch.trim().length > 0;

  useEffect(() => {
    if (!repoId || !selectedPath) return;
    setCodebaseSelectedFile(repoId, effectiveScope, selectedPath);
  }, [effectiveScope, repoId, selectedPath, setCodebaseSelectedFile]);

  useEffect(() => {
    if (tree.length === 0) return;
    setExpandedDirectories((current) => {
      if (current.size > 0) return current;
      const seeded = new Set<string>(persistedExpandedDirectories.length > 0 ? persistedExpandedDirectories : collectTopLevelDirectories(tree));
      const initialPaths = [selectedPath, ...scopedPaths].filter(Boolean) as string[];
      for (const filePath of initialPaths) {
        for (const ancestor of collectAncestorDirectories(filePath)) {
          seeded.add(ancestor);
        }
      }
      return seeded;
    });
  }, [persistedExpandedDirectories, scopedPaths, selectedPath, tree]);

  useEffect(() => {
    if (!selectedPath) return;
    setExpandedDirectories((current) => {
      const next = new Set(current);
      let changed = false;
      for (const ancestor of collectAncestorDirectories(selectedPath)) {
        if (!next.has(ancestor)) {
          next.add(ancestor);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [selectedPath]);

  useEffect(() => {
    if (!repoId) return;
    setExpandedDirectories((current) =>
      orderedValuesMatch(current, persistedExpandedDirectories) ? current : new Set(persistedExpandedDirectories)
    );
  }, [persistedExpandedDirectories, repoId]);

  useEffect(() => {
    if (!repoId) return;
    const nextValues = Array.from(expandedDirectories);
    if (orderedValuesMatch(nextValues, persistedExpandedDirectories)) {
      return;
    }
    setCodebaseExpandedDirectories(repoId, nextValues);
  }, [expandedDirectories, persistedExpandedDirectories, repoId, setCodebaseExpandedDirectories]);

  const fileQuery = useQuery({
    queryKey: ["mission-codebase-file-v8", repoId, selectedPath],
    queryFn: () => getMissionCodeFileV8(repoId!, selectedPath!),
    enabled: Boolean(repoId && selectedPath),
    staleTime: 3000,
    placeholderData: (previousData) => previousData,
  });

  const diffQuery = useQuery({
    queryKey: ["mission-codebase-diff-v8", repoId, selectedPath],
    queryFn: () => getMissionCodeFileDiffV8(repoId!, selectedPath!),
    enabled: Boolean(repoId && selectedPath),
    staleTime: 3000,
    placeholderData: (previousData) => previousData,
  });

  const file = fileQuery.data?.item ?? null;
  const diff = diffQuery.data?.item ?? null;
  const showingPreviousFile = Boolean(selectedPath && file?.path && file.path !== selectedPath);
  const modCount = fileNodes.filter((node) => (node.status || "unchanged") === "modified").length;
  const addCount = fileNodes.filter((node) => (node.status || "unchanged") === "added").length;
  const highlightLanguage = useMemo(
    () => (selectedPath ? file?.language || inferLanguageFromPath(selectedPath) : "text"),
    [file?.language, selectedPath]
  );
  const fileLanguage = useMemo(() => (selectedPath ? toLanguageLabel(file?.language, selectedPath) : "Text"), [file?.language, selectedPath]);
  const currentStatus = useMemo(
    () => fileNodes.find((node) => node.path === selectedPath)?.status || "unchanged",
    [fileNodes, selectedPath]
  );
  const currentLineCount = useMemo(() => (file?.content ? file.content.split("\n").length : 0), [file?.content]);
  const currentCharCount = useMemo(() => (file?.content ? file.content.length : 0), [file?.content]);
  const codeMatchCount = useMemo(() => (file?.content ? countMatchingLines(file.content, codeSearch) : 0), [codeSearch, file?.content]);
  const matchingLines = useMemo(() => {
    const needle = codeSearch.trim().toLowerCase();
    if (!needle || !file?.content) return new Set<number>();
    return new Set(
      file.content
        .split("\n")
        .map((line, index) => (line.toLowerCase().includes(needle) ? index + 1 : -1))
        .filter((lineNumber) => lineNumber > 0)
    );
  }, [codeSearch, file?.content]);
  const breadcrumbSegments = useMemo(() => (selectedPath ? selectedPath.split("/") : []), [selectedPath]);
  const scopeBreadcrumb = useMemo(() => scopeLabel(effectiveScope), [effectiveScope]);
  const visibleTreeRows = useMemo(
    () => buildVisibleTreeRows(tree, searchedFileSet, expandedDirectories, searchActive),
    [expandedDirectories, searchActive, searchedFileSet, tree]
  );
  const rowRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const activePreviewMode = previewMode === "changes" && diff?.available ? "changes" : "source";
  const diffLines = useMemo(() => (diff?.patch ? parsePatchBlocks(diff.patch) : []), [diff?.patch]);

  useEffect(() => {
    if (!copiedTarget) return;
    const timeout = window.setTimeout(() => setCopiedTarget(null), 1200);
    return () => window.clearTimeout(timeout);
  }, [copiedTarget]);

  useEffect(() => {
    if (!selectedPath) return;
    setTreeFocusedPath((current) => current || selectedPath);
  }, [selectedPath]);

  useEffect(() => {
    if (currentStatus === "modified" || currentStatus === "added") {
      setPreviewMode("changes");
      return;
    }
    setPreviewMode("source");
  }, [currentStatus, selectedPath]);

  useEffect(() => {
    if (highlightLanguage === "markdown") {
      setMarkdownMode("preview");
      return;
    }
    setMarkdownMode("raw");
  }, [highlightLanguage, selectedPath]);

  async function copyToClipboard(kind: "path" | "content") {
    const value = kind === "path" ? selectedPath : file?.content;
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopiedTarget(kind);
  }

  function toggleDirectory(path: string) {
    setExpandedDirectories((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  function collapseAllDirectories() {
    const keepOpen = new Set<string>();
    if (selectedPath) {
      for (const ancestor of collectAncestorDirectories(selectedPath)) {
        keepOpen.add(ancestor);
      }
    }
    setExpandedDirectories(keepOpen);
  }

  function expandScopedDirectories() {
    const next = new Set<string>(collectTopLevelDirectories(tree));
    const emphasisPaths =
      effectiveScope !== "all" && scopedPaths.length > 0
        ? scopedPaths
        : searchedFiles.map((node) => node.path);
    for (const filePath of emphasisPaths) {
      for (const ancestor of collectAncestorDirectories(filePath)) {
        next.add(ancestor);
      }
    }
    if (selectedPath) {
      for (const ancestor of collectAncestorDirectories(selectedPath)) {
        next.add(ancestor);
      }
    }
    setExpandedDirectories(next);
  }

  function focusTreeRow(path: string | null) {
    if (!path) return;
    const row = rowRefs.current.get(path);
    if (row) {
      row.focus();
      setTreeFocusedPath(path);
    }
  }

  const jumpToFileSearchMatch = useCallback(
    (direction: 1 | -1) => {
      if (searchedFiles.length === 0) return;
      const currentIndex = searchedFiles.findIndex((node) => node.path === selectedPath);
      const startIndex = currentIndex >= 0 ? currentIndex : direction > 0 ? -1 : 0;
      const nextIndex = (startIndex + direction + searchedFiles.length) % searchedFiles.length;
      const nextPath = searchedFiles[nextIndex]?.path;
      if (!nextPath) return;
      setSelectedPath(nextPath);
      setTreeFocusedPath(nextPath);
      window.requestAnimationFrame(() => focusTreeRow(nextPath));
    },
    [searchedFiles, selectedPath]
  );

  function handleFileSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    jumpToFileSearchMatch(event.shiftKey ? -1 : 1);
  }

  function handleTreeKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (visibleTreeRows.length === 0) return;
    const currentPath = treeFocusedPath || selectedPath || visibleTreeRows[0]?.path || null;
    const currentIndex = visibleTreeRows.findIndex((row) => row.path === currentPath);
    const currentRow = currentIndex >= 0 ? visibleTreeRows[currentIndex] : visibleTreeRows[0];
    if (!currentRow) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusTreeRow(visibleTreeRows[Math.min(currentIndex + 1, visibleTreeRows.length - 1)]?.path || currentRow.path);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      focusTreeRow(visibleTreeRows[Math.max(currentIndex - 1, 0)]?.path || currentRow.path);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      focusTreeRow(visibleTreeRows[0]?.path || null);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      focusTreeRow(visibleTreeRows[visibleTreeRows.length - 1]?.path || null);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      if (currentRow.kind === "directory") {
        if (!currentRow.isExpanded) {
          toggleDirectory(currentRow.path);
          return;
        }
        const nextRow = visibleTreeRows[currentIndex + 1];
        if (nextRow && nextRow.parentPath === currentRow.path) {
          focusTreeRow(nextRow.path);
        }
        return;
      }
      setSelectedPath(currentRow.path);
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (currentRow.kind === "directory" && currentRow.isExpanded && !searchActive) {
        toggleDirectory(currentRow.path);
        return;
      }
      if (currentRow.parentPath) {
        focusTreeRow(currentRow.parentPath);
      }
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (currentRow.kind === "directory") {
        toggleDirectory(currentRow.path);
      } else {
        setSelectedPath(currentRow.path);
      }
    }
  }

  if (!repoId) {
    return (
      <EmptyState
        data-testid="codebase-empty"
        icon={<Code2 className="h-6 w-6 text-zinc-500" />}
        heading="No project connected"
        description="Connect a project to browse files, tests, and docs impacted by your tasks."
      />
    );
  }

  return (
    <div data-testid="codebase-root" className="flex flex-col gap-5">
      <div className="rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(16,18,24,0.96),rgba(10,11,15,0.94))] p-4 shadow-[0_16px_50px_rgba(0,0,0,0.26)]">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
              <img src={scopeAsset(effectiveScope)} alt="" className="h-4 w-4 opacity-75" aria-hidden="true" />
              <span className="text-[10px] uppercase tracking-[0.16em] text-zinc-400">
                {effectiveScope === "all" ? "Managed worktree view" : "Focused file scope"}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-zinc-400">
              <span className="text-amber-400 font-mono">{modCount} modified</span>
              <span className="text-zinc-700">·</span>
              <span className="text-emerald-400 font-mono">{addCount} added</span>
              <span className="text-zinc-700">·</span>
              <span className="text-zinc-500 font-mono">{fileNodes.length} total</span>
            </div>

            {normalizedContextPaths.length > 0 || normalizedTestPaths.length > 0 || normalizedDocPaths.length > 0 ? (
              <div data-testid="codebase-scope-toggle" className="inline-flex items-center rounded-xl border border-white/10 bg-white/[0.03] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                <button
                  onClick={() => setCodebaseScope("context")}
                  disabled={normalizedContextPaths.length === 0}
                  className={`rounded-lg px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] transition-colors ${
                    effectiveScope === "context"
                      ? "border border-cyan-400/20 bg-cyan-500/[0.12] text-cyan-100 shadow-[0_0_0_1px_rgba(34,211,238,0.08)]"
                      : "text-zinc-500 hover:text-zinc-300 disabled:cursor-not-allowed disabled:text-zinc-700"
                  }`}
                >
                  Context
                </button>
                <button
                  onClick={() => setCodebaseScope("tests")}
                  disabled={normalizedTestPaths.length === 0}
                  className={`rounded-lg px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] transition-colors ${
                    effectiveScope === "tests"
                      ? "border border-cyan-400/20 bg-cyan-500/[0.12] text-cyan-100 shadow-[0_0_0_1px_rgba(34,211,238,0.08)]"
                      : "text-zinc-500 hover:text-zinc-300 disabled:cursor-not-allowed disabled:text-zinc-700"
                  }`}
                >
                  Tests
                </button>
                <button
                  onClick={() => setCodebaseScope("docs")}
                  disabled={normalizedDocPaths.length === 0}
                  className={`rounded-lg px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] transition-colors ${
                    effectiveScope === "docs"
                      ? "border border-cyan-400/20 bg-cyan-500/[0.12] text-cyan-100 shadow-[0_0_0_1px_rgba(34,211,238,0.08)]"
                      : "text-zinc-500 hover:text-zinc-300 disabled:cursor-not-allowed disabled:text-zinc-700"
                  }`}
                >
                  Docs
                </button>
                <button
                  onClick={() => setCodebaseScope("all")}
                  className={`rounded-lg px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] transition-colors ${
                    effectiveScope === "all"
                      ? "border border-white/12 bg-white/[0.07] text-white shadow-[0_0_0_1px_rgba(255,255,255,0.04)]"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  All Files
                </button>
              </div>
            ) : null}

            {workflowTitle ? (
              <div className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveSection("live")}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-zinc-300 transition hover:border-cyan-400/18 hover:bg-cyan-500/[0.08] hover:text-cyan-100"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back to Workflow
                </button>
                <div className="min-w-0 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-zinc-400">
                  <span className="truncate text-zinc-300">{workflowTitle}</span>
                  <span className="px-2 text-zinc-600">›</span>
                  <span className="text-cyan-200">{scopeBreadcrumb}</span>
                </div>
              </div>
            ) : null}

            <div className="ml-auto inline-flex flex-wrap items-center gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
              {(["all", "modified", "added", "unchanged", "deleted"] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => setFilter(status)}
                  className={`rounded-lg px-2.5 py-1.5 text-[10px] uppercase tracking-[0.14em] transition-colors ${
                    filter === status
                      ? "border border-white/12 bg-white/[0.08] text-zinc-100"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>

          {effectiveScope !== "all" && scopedPaths.length > 0 ? (
            <div className="rounded-[18px] border border-cyan-500/16 bg-cyan-500/[0.06] px-4 py-3 text-xs text-cyan-100">
              <div className="flex items-center gap-2 font-medium">
                {treeQuery.isFetching ? <ProcessingIndicator kind="routing" active size="xs" tone="subtle" /> : null}
                <Sparkles className="h-3.5 w-3.5 text-cyan-300" />
                {workflowTitle
                  ? `${workflowTitle} ${effectiveScope === "context" ? "context" : effectiveScope} scope`
                  : effectiveScope === "context"
                  ? "Context scope"
                  : effectiveScope === "tests"
                  ? "Tests scope"
                  : "Docs scope"}
              </div>
              <div className="mt-1 text-cyan-100/80">
                {effectiveScope === "context"
                  ? "Prioritizing impacted files from the selected workflow and current context pack."
                  : effectiveScope === "tests"
                  ? "Prioritizing tests linked to the current workflow and context pack."
                  : "Prioritizing documentation linked to the current workflow and context pack."}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(16,18,24,0.96),rgba(10,11,15,0.94))] p-1 shadow-[0_16px_50px_rgba(0,0,0,0.26)]">
        <div className="inline-flex items-center rounded-xl border border-white/10 bg-white/[0.03] p-1">
          <button
            onClick={() => setActiveTab("files")}
            className={`rounded-lg px-4 py-2 text-[10px] uppercase tracking-[0.18em] transition-colors ${
              activeTab === "files"
                ? "border border-cyan-400/20 bg-cyan-500/[0.12] text-cyan-100 shadow-[0_0_0_1px_rgba(34,211,238,0.08)]"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            Files
          </button>
          <button
            onClick={() => setActiveTab("graph")}
            className={`rounded-lg px-4 py-2 text-[10px] uppercase tracking-[0.18em] transition-colors ${
              activeTab === "graph"
                ? "border border-cyan-400/20 bg-cyan-500/[0.12] text-cyan-100 shadow-[0_0_0_1px_rgba(34,211,238,0.08)]"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            Graph
          </button>
        </div>
      </div>

      {activeTab === "graph" ? (
        <div className="rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(15,17,23,0.96),rgba(10,11,15,0.94))] shadow-[0_16px_44px_rgba(0,0,0,0.26)]" style={{ minHeight: 500 }}>
          <CodeGraphPanel repoId={repoId} />
        </div>
      ) : (
        <div className="flex gap-4" style={{ minHeight: 500 }}>
          <div data-testid="codebase-file-tree" className="w-80 shrink-0 overflow-hidden rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(15,17,23,0.96),rgba(10,11,15,0.94))] shadow-[0_16px_44px_rgba(0,0,0,0.26)] flex flex-col">
            <div className="px-3 py-3 border-b border-white/6 text-[10px] text-zinc-500 uppercase tracking-[0.18em] font-medium flex items-center gap-2">
              <FolderTree className="w-3.5 h-3.5 text-cyan-400" />
              Files
            </div>
          <div className="border-b border-white/6 px-3 py-3">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
              <input
                value={fileSearch}
                onChange={(event) => setFileSearch(event.target.value)}
                onKeyDown={handleFileSearchKeyDown}
                placeholder="Search paths or filenames"
                className="w-full rounded-xl border border-white/10 bg-white/[0.03] py-2 pl-9 pr-3 text-xs text-zinc-200 placeholder:text-zinc-600"
              />
            </label>
            <div className="mt-2 flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-zinc-500">
              <span>
                {searchedFiles.length} shown
                {searchActive && searchedFiles.length > 0
                  ? ` · ${selectedSearchMatchIndex >= 0 ? selectedSearchMatchIndex + 1 : 1}/${searchedFiles.length}`
                  : ""}
              </span>
              <div className="flex items-center gap-2">
                {searchActive ? (
                  <div className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => jumpToFileSearchMatch(-1)}
                      disabled={searchedFiles.length === 0}
                      className="rounded-lg border border-white/8 bg-white/[0.03] px-2 py-1 text-[9px] uppercase tracking-[0.16em] text-zinc-500 transition hover:text-zinc-200 disabled:cursor-not-allowed disabled:text-zinc-700"
                    >
                      Prev
                    </button>
                    <button
                      type="button"
                      onClick={() => jumpToFileSearchMatch(1)}
                      disabled={searchedFiles.length === 0}
                      className="rounded-lg border border-white/8 bg-white/[0.03] px-2 py-1 text-[9px] uppercase tracking-[0.16em] text-zinc-500 transition hover:text-cyan-200 disabled:cursor-not-allowed disabled:text-zinc-700"
                    >
                      Next
                    </button>
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={collapseAllDirectories}
                  className="rounded-lg border border-white/8 bg-white/[0.03] px-2 py-1 text-[9px] uppercase tracking-[0.16em] text-zinc-500 transition hover:text-zinc-200"
                >
                  Collapse all
                </button>
                <button
                  type="button"
                  onClick={expandScopedDirectories}
                  className="rounded-lg border border-white/8 bg-white/[0.03] px-2 py-1 text-[9px] uppercase tracking-[0.16em] text-zinc-500 transition hover:text-cyan-200"
                >
                  Expand scoped
                </button>
              </div>
            </div>
          </div>
          <div
            className="flex-1 overflow-y-auto custom-scrollbar p-2 outline-none"
            role="tree"
            aria-label="Codebase files"
            tabIndex={0}
            onKeyDown={handleTreeKeyDown}
          >
            {treeQuery.isLoading ? (
              <div className="p-3 text-xs text-zinc-500 inline-flex items-center gap-2">
                <ProcessingIndicator kind="processing" active size="xs" tone="subtle" />
                Loading codebase…
              </div>
            ) : treeQuery.isError ? (
              <div className="p-3 text-xs text-rose-200">
                {treeQuery.error instanceof Error ? treeQuery.error.message : "The codebase tree could not be loaded."}
              </div>
            ) : searchedFiles.length === 0 ? (
              <div className="p-3 text-xs text-zinc-500">
                {effectiveScope !== "all"
                  ? `No ${effectiveScope} files are available for the current scope yet. Review a plan or run a task from Work to populate this focused scope.`
                  : "No files match the current filter. Clear the filter or return to Work to generate a new scoped context."}
              </div>
            ) : (
              tree.map((node) => (
                <TreeNodeRow
                  key={node.path}
                  node={node}
                  depth={0}
                  visiblePaths={searchedFileSet}
                  selectedPath={selectedPath}
                  onSelect={setSelectedPath}
                  expandedDirectories={expandedDirectories}
                  onToggleDirectory={toggleDirectory}
                  searchActive={searchActive}
                  testPathSet={testPathSet}
                  docPathSet={docPathSet}
                  focusedPath={treeFocusedPath}
                  onFocusPath={setTreeFocusedPath}
                  rowRefs={rowRefs}
                />
              ))
            )}
          </div>
        </div>

        <div data-testid="codebase-file-viewer" className="sticky top-4 flex max-h-[calc(100vh-7rem)] min-w-0 flex-1 overflow-hidden rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(15,17,23,0.96),rgba(10,11,15,0.94))] shadow-[0_16px_44px_rgba(0,0,0,0.26)]">
          {selectedPath && file ? (
            <>
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="border-b border-white/6 bg-zinc-900/45 px-4 py-3 shrink-0 backdrop-blur-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileCode2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                        <span className="text-xs font-mono text-zinc-300 truncate">{selectedPath}</span>
                        <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded shrink-0 ${STATUS_BADGE[currentStatus]}`}>
                          {STATUS_ICON[currentStatus]}
                        </span>
                        <span className="rounded-md border border-white/8 bg-white/[0.04] px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] text-zinc-400">
                          {fileLanguage}
                        </span>
                      </div>
                      {breadcrumbSegments.length > 1 ? (
                        <div className="mt-1 flex items-center gap-1 overflow-hidden text-[10px] text-zinc-600">
                          {breadcrumbSegments.slice(0, -1).map((segment, index) => (
                            <span key={`${segment}-${index}`} className="truncate">
                              {index > 0 ? <span className="px-1 text-zinc-700">/</span> : null}
                              {segment}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-zinc-500 font-mono shrink-0">
                      <span>{currentLineCount} lines</span>
                      <span>{currentCharCount} chars</span>
                      {codeSearch.trim() ? <span>{codeMatchCount} matches</span> : null}
                      {file.truncated ? <span className="text-amber-400">truncated</span> : null}
                    </div>
                  </div>
                </div>
                <div className="border-b border-white/6 bg-white/[0.015] px-4 py-3 shrink-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="relative min-w-[220px] flex-1">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
                      <input
                        value={codeSearch}
                        onChange={(event) => setCodeSearch(event.target.value)}
                        placeholder="Find in file"
                        className="w-full rounded-xl border border-white/10 bg-white/[0.03] py-2 pl-9 pr-3 text-xs text-zinc-200 placeholder:text-zinc-600"
                      />
                    </label>
                    {(currentStatus === "modified" || currentStatus === "added") && diff?.available ? (
                      <div className="inline-flex items-center rounded-xl border border-white/10 bg-white/[0.03] p-1">
                        <button
                          type="button"
                          onClick={() => setPreviewMode("changes")}
                          className={`rounded-lg px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] ${
                            activePreviewMode === "changes" ? "border border-violet-400/20 bg-violet-500/[0.10] text-violet-100" : "text-zinc-500 hover:text-zinc-300"
                          }`}
                        >
                          Changes
                        </button>
                        <button
                          type="button"
                          onClick={() => setPreviewMode("source")}
                          className={`rounded-lg px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] ${
                            activePreviewMode === "source" ? "border border-cyan-400/20 bg-cyan-500/[0.10] text-cyan-100" : "text-zinc-500 hover:text-zinc-300"
                          }`}
                        >
                          Source
                        </button>
                      </div>
                    ) : null}
                    {highlightLanguage === "markdown" && activePreviewMode === "source" ? (
                      <div className="inline-flex items-center rounded-xl border border-white/10 bg-white/[0.03] p-1">
                        <button
                          type="button"
                          onClick={() => setMarkdownMode("preview")}
                          className={`rounded-lg px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] ${
                            markdownMode === "preview"
                              ? "border border-emerald-400/20 bg-emerald-500/[0.10] text-emerald-100"
                              : "text-zinc-500 hover:text-zinc-300"
                          }`}
                        >
                          Preview
                        </button>
                        <button
                          type="button"
                          onClick={() => setMarkdownMode("raw")}
                          className={`rounded-lg px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] ${
                            markdownMode === "raw"
                              ? "border border-cyan-400/20 bg-cyan-500/[0.10] text-cyan-100"
                              : "text-zinc-500 hover:text-zinc-300"
                          }`}
                        >
                          Raw
                        </button>
                      </div>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setWrapLines((current) => !current)}
                      className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[10px] uppercase tracking-[0.16em] ${
                        wrapLines ? "border-cyan-400/20 bg-cyan-500/[0.10] text-cyan-100" : "border-white/10 bg-white/[0.03] text-zinc-400"
                      }`}
                    >
                      <WrapText className="h-3.5 w-3.5" />
                      Wrap
                    </button>
                    <button
                      type="button"
                      onClick={() => void copyToClipboard("path")}
                      className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-zinc-300"
                    >
                      {copiedTarget === "path" ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
                      {copiedTarget === "path" ? "Path copied" : "Copy path"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void copyToClipboard("content")}
                      className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-zinc-300"
                    >
                      {copiedTarget === "content" ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
                      {copiedTarget === "content" ? "Content copied" : "Copy file"}
                    </button>
                  </div>
                </div>
                {activePreviewMode === "changes" && diff?.available ? (
                  <div className="border-b border-white/6 bg-violet-500/[0.04] px-4 py-2 shrink-0">
                    <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.16em]">
                      <span className="rounded-full border border-violet-400/16 bg-violet-500/[0.08] px-2.5 py-1 text-violet-100">Changed file</span>
                      <span className="rounded-full border border-emerald-400/16 bg-emerald-500/[0.08] px-2.5 py-1 text-emerald-200">+{diff.additions}</span>
                      <span className="rounded-full border border-rose-400/16 bg-rose-500/[0.08] px-2.5 py-1 text-rose-200">-{diff.deletions}</span>
                      {diff.truncated ? <span className="text-amber-300">Patch truncated</span> : null}
                    </div>
                  </div>
                ) : null}
                <div className="relative flex min-h-0 flex-1 overflow-hidden bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.03),transparent_42%)]">
                  <div className="relative min-w-0 flex-1 overflow-auto custom-scrollbar">
                    {activePreviewMode === "changes" && diff?.available ? (
                      <pre className={`text-[11px] font-mono leading-relaxed ${wrapLines ? "whitespace-pre-wrap break-words" : "whitespace-pre"}`}>
                        {diffLines.map((entry) => (
                          <div
                            key={`${selectedPath}-diff-${entry.number}`}
                            className={`flex gap-3 px-3 py-px ${
                              entry.kind === "added"
                                ? "bg-emerald-500/[0.08] text-emerald-100"
                                : entry.kind === "removed"
                                ? "bg-rose-500/[0.08] text-rose-100"
                                : entry.kind === "hunk"
                                ? "bg-violet-500/[0.10] text-violet-100"
                                : entry.kind === "meta"
                                ? "text-zinc-500"
                                : "text-zinc-300 hover:bg-white/[0.02]"
                            }`}
                          >
                            <span className="select-none text-right w-8 shrink-0 tabular-nums text-zinc-700">{entry.number}</span>
                            <span className="min-w-0 flex-1">{entry.line || " "}</span>
                          </div>
                        ))}
                      </pre>
                    ) : highlightLanguage === "markdown" && markdownMode === "preview" ? (
                      <div className="px-5 py-4">
                        <article className="prose prose-invert prose-sm max-w-none prose-headings:text-zinc-100 prose-p:text-zinc-200 prose-strong:text-zinc-100 prose-li:text-zinc-200 prose-a:text-cyan-200 prose-code:text-emerald-200 prose-pre:border prose-pre:border-white/10 prose-pre:bg-black/30">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              a: ({ node: _node, href, onClick, ...props }) => (
                                <a
                                  {...props}
                                  href={href}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                  className="underline decoration-cyan-500/40 underline-offset-2 hover:text-cyan-100"
                                  onClick={(event) => {
                                    onClick?.(event);
                                    if (event.defaultPrevented) {
                                      return;
                                    }
                                    if (!getDesktopBridge()?.openExternal) {
                                      return;
                                    }
                                    event.preventDefault();
                                    if (typeof href === "string" && /^https?:\/\//i.test(href)) {
                                      void openDesktopExternal(href);
                                    }
                                  }}
                                />
                              ),
                              code: ({ node: _node, className, children, ...props }) => {
                                const languageMatch = /language-([a-z0-9_-]+)/i.exec(className || "");
                                const language = languageMatch?.[1]?.toLowerCase() ?? "";
                                const content = String(children || "").replace(/\n$/, "");
                                const inline = !className && !content.includes("\n");
                                if (inline) {
                                  return (
                                    <code {...props} className="rounded-md border border-white/10 bg-white/[0.05] px-1.5 py-0.5 text-emerald-200">
                                      {children}
                                    </code>
                                  );
                                }
                                if (language === "mermaid") {
                                  return <MermaidDiagram chart={content} idSeed={selectedPath || "diagram"} />;
                                }
                                return (
                                  <pre className="overflow-x-auto rounded-xl border border-white/10 bg-black/30 p-3">
                                    <code {...props} className={className}>
                                      {children}
                                    </code>
                                  </pre>
                                );
                              },
                              table: ({ node: _node, ...props }) => (
                                <div className="overflow-x-auto">
                                  <table {...props} className="min-w-full border-collapse text-sm" />
                                </div>
                              ),
                              th: ({ node: _node, ...props }) => <th {...props} className="border border-white/10 bg-white/[0.04] px-3 py-2 text-left" />,
                              td: ({ node: _node, ...props }) => <td {...props} className="border border-white/10 px-3 py-2" />,
                            }}
                          >
                            {file.content}
                          </ReactMarkdown>
                        </article>
                      </div>
                    ) : (
                      <pre className={`text-[11px] font-mono leading-relaxed ${wrapLines ? "whitespace-pre-wrap break-words" : "whitespace-pre"}`}>
                        {file.content.split("\n").map((line, index) => {
                          const lineNumber = index + 1;
                          const isMatched = matchingLines.has(lineNumber);
                          const tokens = highlightLine(line, highlightLanguage);
                          return (
                            <div
                              key={`${selectedPath}-${index}`}
                              className={`flex gap-3 px-3 py-px text-zinc-300 ${isMatched ? "bg-cyan-500/[0.08]" : "hover:bg-white/[0.02]"}`}
                            >
                              <span
                                className={`select-none text-right w-8 shrink-0 tabular-nums ${isMatched ? "text-cyan-300" : "text-zinc-700"}`}
                              >
                                {lineNumber}
                              </span>
                              <span className="min-w-0 flex-1">
                                {tokens.map((token, tokenIndex) => (
                                  <span key={`${selectedPath}-${index}-${tokenIndex}`} className={token.className}>
                                    {token.text}
                                  </span>
                                ))}
                              </span>
                            </div>
                          );
                        })}
                      </pre>
                    )}
                  </div>
                  <aside className="hidden w-72 shrink-0 border-l border-white/6 bg-white/[0.02] xl:flex xl:flex-col">
                    <div className="border-b border-white/6 px-4 py-3 text-[10px] uppercase tracking-[0.18em] text-zinc-500">At a glance</div>
                    <div className="space-y-3 p-4 text-sm">
                      <InfoCard label="Language" value={fileLanguage} />
                      <InfoCard label="Status" value={currentStatus} className={STATUS_COLOR[currentStatus]} />
                      <InfoCard label="Folder" value={fileParentPath(selectedPath)} />
                      <InfoCard label="Matches" value={codeSearch.trim() ? `${codeMatchCount}` : "—"} />
                      <InfoCard label="Source" value="managed worktree" />
                      {(currentStatus === "modified" || currentStatus === "added") && diff?.available ? (
                        <InfoCard label="Changes" value={`+${diff.additions} / -${diff.deletions}`} className="text-violet-100" />
                      ) : null}
                    </div>
                  </aside>
                  {showingPreviousFile ? (
                    <div className="pointer-events-none absolute inset-0 flex items-start justify-end bg-[linear-gradient(180deg,rgba(10,11,15,0.14),rgba(10,11,15,0.04))] px-4 py-3">
                      <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/16 bg-cyan-500/[0.08] px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-cyan-100 shadow-[0_0_0_1px_rgba(34,211,238,0.04)]">
                        <ProcessingIndicator kind="processing" active size="xs" tone="subtle" />
                        Loading selected file
                      </div>
                    </div>
                  ) : null}
                </div>
                {file.truncated ? (
                  <div className="border-t border-white/5 px-4 py-2 text-[10px] text-amber-300 shrink-0">
                    File view truncated for performance. Open the managed worktree for the full source if needed.
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-zinc-600 text-sm">
              {fileQuery.isLoading ? (
                <span className="inline-flex items-center gap-2">
                  <ProcessingIndicator kind="processing" active size="xs" tone="subtle" />
                  Loading file…
                </span>
              ) : (
                "Select a file to view its contents"
              )}
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  );
}

function InfoCard({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <div className={`mt-2 break-words text-zinc-100 ${className}`}>{value}</div>
    </div>
  );
}

function TreeNodeRow({
  node,
  depth,
  visiblePaths,
  selectedPath,
  onSelect,
  expandedDirectories,
  onToggleDirectory,
  searchActive,
  testPathSet,
  docPathSet,
  focusedPath,
  onFocusPath,
  rowRefs,
}: {
  node: CodebaseTreeNode;
  depth: number;
  visiblePaths: Set<string>;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  expandedDirectories: Set<string>;
  onToggleDirectory: (path: string) => void;
  searchActive: boolean;
  testPathSet: Set<string>;
  docPathSet: Set<string>;
  focusedPath: string | null;
  onFocusPath: (path: string | null) => void;
  rowRefs: MutableRefObject<Map<string, HTMLButtonElement>>;
}) {
  if (!treeHasVisibleDescendant(node, visiblePaths)) {
    return null;
  }

  if (node.kind === "directory") {
    const isExpanded = searchActive || expandedDirectories.has(node.path);
    return (
      <div className="select-none">
        <button
          ref={(element) => {
            if (element) rowRefs.current.set(node.path, element);
            else rowRefs.current.delete(node.path);
          }}
          type="button"
          onClick={() => onToggleDirectory(node.path)}
          onMouseDown={(event) => event.preventDefault()}
          onFocus={() => onFocusPath(node.path)}
          role="treeitem"
          aria-expanded={isExpanded}
          className={`group flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors hover:bg-white/[0.04] ${
            focusedPath === node.path ? "bg-white/[0.05]" : ""
          }`}
          style={{ paddingLeft: `${12 + depth * 12}px` }}
        >
          <ChevronRight className={`h-3 w-3 shrink-0 text-zinc-600 transition-transform ${isExpanded ? "rotate-90 text-zinc-400" : ""}`} />
          {isExpanded ? (
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-cyan-300/90" />
          ) : (
            <Folder className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
          )}
          <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-300 group-hover:text-zinc-100">{node.path.split("/").pop()}</span>
        </button>
        {isExpanded ? (
          <div>
            {(node.children || []).map((child) => (
              <TreeNodeRow
                key={child.path}
                node={child}
                depth={depth + 1}
                visiblePaths={visiblePaths}
                selectedPath={selectedPath}
                onSelect={onSelect}
                expandedDirectories={expandedDirectories}
                onToggleDirectory={onToggleDirectory}
                searchActive={searchActive}
                testPathSet={testPathSet}
                docPathSet={docPathSet}
                focusedPath={focusedPath}
                onFocusPath={onFocusPath}
                rowRefs={rowRefs}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  const isSelected = selectedPath === node.path;
  const filename = node.path.split("/").pop()!;
  const status = node.status || "unchanged";
  const parent = fileParentPath(node.path);
  const isTest = testPathSet.has(node.path);
  const isDoc = docPathSet.has(node.path);

  return (
    <button
      ref={(element) => {
        if (element) rowRefs.current.set(node.path, element);
        else rowRefs.current.delete(node.path);
      }}
      type="button"
      onClick={() => onSelect(node.path)}
      onMouseDown={(event) => event.preventDefault()}
      onFocus={() => onFocusPath(node.path)}
      role="treeitem"
      aria-selected={isSelected}
      className={`group flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors ${
        isSelected
          ? "border border-cyan-400/18 bg-cyan-500/[0.10] shadow-[0_0_0_1px_rgba(34,211,238,0.06)]"
          : focusedPath === node.path
          ? "bg-white/[0.05]"
          : "hover:bg-white/[0.04]"
      }`}
      style={{ paddingLeft: `${12 + depth * 12}px` }}
    >
      <span className="h-3 w-3 shrink-0" />
      <span className={`w-3 shrink-0 text-[9px] font-mono font-bold ${STATUS_COLOR[status]}`}>{STATUS_ICON[status] as string}</span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[11px] ${isSelected ? "text-zinc-200" : "text-zinc-400 group-hover:text-zinc-300"}`}>{filename}</span>
        <span className="block truncate text-[10px] text-zinc-600">{parent}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {isTest ? (
          <span className="rounded-md border border-violet-400/18 bg-violet-500/[0.08] px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-[0.16em] text-violet-200">
            test
          </span>
        ) : null}
        {isDoc ? (
          <span className="rounded-md border border-emerald-400/18 bg-emerald-500/[0.08] px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-[0.16em] text-emerald-200">
            doc
          </span>
        ) : null}
      </span>
    </button>
  );
}
