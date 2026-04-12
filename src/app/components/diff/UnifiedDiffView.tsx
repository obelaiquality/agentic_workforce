import { useMemo } from "react";
import { Check, X } from "lucide-react";
import { cn } from "../ui/utils";
import type { DiffFile, DiffHunk, DiffLine } from "./DiffParser";

// ---------------------------------------------------------------------------
// Syntax highlighting — reuses the CODE_KEYWORDS approach from CodebaseView
// ---------------------------------------------------------------------------

const CODE_KEYWORDS: Record<string, string[]> = {
  typescript: [
    "as", "async", "await", "break", "case", "catch", "class", "const", "continue",
    "default", "delete", "do", "else", "enum", "export", "extends", "false", "finally",
    "for", "from", "function", "if", "implements", "import", "in", "instanceof",
    "interface", "let", "new", "null", "private", "protected", "public", "readonly",
    "return", "static", "super", "switch", "this", "throw", "true", "try", "type",
    "typeof", "undefined", "var", "void", "while", "yield",
  ],
  javascript: [
    "async", "await", "break", "case", "catch", "class", "const", "continue",
    "default", "delete", "do", "else", "export", "extends", "false", "finally",
    "for", "from", "function", "if", "import", "in", "instanceof", "let", "new",
    "null", "return", "static", "super", "switch", "this", "throw", "true", "try",
    "typeof", "undefined", "var", "while", "yield",
  ],
  python: [
    "and", "as", "assert", "async", "await", "break", "class", "continue", "def",
    "del", "elif", "else", "except", "False", "finally", "for", "from", "global",
    "if", "import", "in", "is", "lambda", "None", "nonlocal", "not", "or", "pass",
    "raise", "return", "True", "try", "while", "with", "yield",
  ],
  rust: [
    "as", "async", "await", "break", "const", "continue", "crate", "else", "enum",
    "extern", "false", "fn", "for", "if", "impl", "in", "let", "loop", "match",
    "mod", "move", "mut", "pub", "ref", "return", "self", "Self", "static", "struct",
    "super", "trait", "true", "type", "unsafe", "use", "where", "while",
  ],
};

interface HighlightToken {
  text: string;
  className?: string;
}

function detectLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    py: "python", rs: "rust", json: "json", md: "markdown",
    css: "css", html: "html", yaml: "yaml", yml: "yaml",
  };
  return map[ext] ?? "";
}

function highlightTokens(text: string, language: string): HighlightToken[] {
  const tokens: HighlightToken[] = [];
  if (!text) return tokens;

  const keywordSet = new Set(CODE_KEYWORDS[language] || []);
  const pattern = /\b([A-Za-z_][A-Za-z0-9_]*)\b|(-?\b\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?\b)/gi;
  let cursor = 0;
  let match = pattern.exec(text);

  while (match) {
    const [fullMatch, identifier, numericLiteral] = match;
    const start = match.index;
    if (start > cursor) {
      tokens.push({ text: text.slice(cursor, start) });
    }
    if (identifier) {
      tokens.push({
        text: fullMatch,
        className: keywordSet.has(identifier) ? "text-violet-300" : undefined,
      });
    } else if (numericLiteral) {
      tokens.push({ text: fullMatch, className: "text-amber-300" });
    } else {
      tokens.push({ text: fullMatch });
    }
    cursor = start + fullMatch.length;
    match = pattern.exec(text);
  }

  if (cursor < text.length) {
    tokens.push({ text: text.slice(cursor) });
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Status badge helpers
// ---------------------------------------------------------------------------

const STATUS_BADGE: Record<string, string> = {
  modified: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  added: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  deleted: "bg-rose-500/10 text-rose-400 border-rose-500/20",
  renamed: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface UnifiedDiffViewProps {
  file: DiffFile;
  decisions: Map<number, "accept" | "reject">;
  onDecide: (hunkIndex: number, decision: "accept" | "reject") => void;
}

function DiffLineRow({
  line,
  language,
}: {
  line: DiffLine;
  language: string;
}) {
  const tokens = useMemo(() => highlightTokens(line.content, language), [line.content, language]);

  const bgClass =
    line.type === "added"
      ? "bg-emerald-500/10"
      : line.type === "removed"
      ? "bg-rose-500/10"
      : "";

  const gutterPrefix =
    line.type === "added" ? "+" : line.type === "removed" ? "-" : " ";

  const gutterColor =
    line.type === "added"
      ? "text-emerald-500"
      : line.type === "removed"
      ? "text-rose-500"
      : "text-zinc-600";

  return (
    <tr className={cn("group", bgClass)}>
      <td className="w-12 select-none border-r border-white/6 px-2 text-right font-mono text-[11px] text-zinc-600">
        {line.oldLineNumber ?? ""}
      </td>
      <td className="w-12 select-none border-r border-white/6 px-2 text-right font-mono text-[11px] text-zinc-600">
        {line.newLineNumber ?? ""}
      </td>
      <td className={cn("w-5 select-none px-1 text-center font-mono text-[11px]", gutterColor)}>
        {gutterPrefix}
      </td>
      <td className="whitespace-pre-wrap break-all px-2 font-mono text-[12px] leading-5 text-zinc-200">
        {tokens.map((token, i) => (
          <span key={i} className={token.className}>
            {token.text}
          </span>
        ))}
      </td>
    </tr>
  );
}

function HunkHeader({
  hunk,
  decision,
  onDecide,
}: {
  hunk: DiffHunk;
  decision: "accept" | "reject" | undefined;
  onDecide: (hunkIndex: number, decision: "accept" | "reject") => void;
}) {
  return (
    <tr className="bg-cyan-500/5">
      <td colSpan={3} className="border-r border-white/6 px-2">
        <div className="flex items-center gap-1.5 py-1">
          <button
            type="button"
            onClick={() => onDecide(hunk.index, "accept")}
            className={cn(
              "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide transition",
              decision === "accept"
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                : "text-zinc-500 hover:text-emerald-400 hover:bg-emerald-500/10 border border-transparent"
            )}
            aria-label={`Accept hunk ${hunk.index + 1}`}
          >
            <Check className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => onDecide(hunk.index, "reject")}
            className={cn(
              "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide transition",
              decision === "reject"
                ? "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                : "text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 border border-transparent"
            )}
            aria-label={`Reject hunk ${hunk.index + 1}`}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </td>
      <td className="px-2 py-1 font-mono text-[11px] text-cyan-400/70">
        {hunk.header}
      </td>
    </tr>
  );
}

export function UnifiedDiffView({ file, decisions, onDecide }: UnifiedDiffViewProps) {
  const language = detectLanguage(file.newPath);

  return (
    <div className="rounded-xl border border-white/6 bg-black/20 overflow-hidden">
      {/* File header */}
      <div className="flex items-center justify-between gap-2 border-b border-white/6 bg-[#0a0a0c] px-4 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="truncate font-mono text-xs text-zinc-200">{file.newPath}</span>
          <span
            className={cn(
              "inline-flex flex-shrink-0 items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
              STATUS_BADGE[file.status] ?? "bg-zinc-800 text-zinc-500 border-zinc-700"
            )}
          >
            {file.status}
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] font-mono flex-shrink-0">
          {file.additions > 0 && <span className="text-emerald-400">+{file.additions}</span>}
          {file.deletions > 0 && <span className="text-rose-400">-{file.deletions}</span>}
        </div>
      </div>

      {/* Diff table */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse" data-testid="unified-diff-table">
          <tbody>
            {file.hunks.map((hunk) => (
              <HunkSection
                key={hunk.index}
                hunk={hunk}
                language={language}
                decision={decisions.get(hunk.index)}
                onDecide={onDecide}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HunkSection({
  hunk,
  language,
  decision,
  onDecide,
}: {
  hunk: DiffHunk;
  language: string;
  decision: "accept" | "reject" | undefined;
  onDecide: (hunkIndex: number, decision: "accept" | "reject") => void;
}) {
  return (
    <>
      <HunkHeader hunk={hunk} decision={decision} onDecide={onDecide} />
      {hunk.lines.map((line, i) => (
        <DiffLineRow key={`${hunk.index}-${i}`} line={line} language={language} />
      ))}
    </>
  );
}
