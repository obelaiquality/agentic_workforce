import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { prisma } from "../db";
import { publishEvent } from "../eventBus";
import type { CodeGraphEdge, CodeGraphNode, ContextPack, KnowledgeHit } from "../../shared/contracts";
import { extractSymbolsTreeSitter, extractImportsTreeSitter } from "./treeSitterAnalyzer";

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".cache",
  ".venv",
  "venv",
  "target",
]);

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function toRecord(value: unknown) {
  return (value ?? {}) as Record<string, unknown>;
}

function listFiles(root: string, limit = 4000) {
  const output: string[] = [];
  const queue = [root];

  while (queue.length > 0 && output.length < limit) {
    const current = queue.shift()!;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) {
        continue;
      }
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(full);
      } else {
        output.push(full);
      }
      if (output.length >= limit) {
        break;
      }
    }
  }

  return output;
}

function detectLanguage(relativePath: string): string | null {
  if (/\.(ts|tsx)$/.test(relativePath)) return "typescript";
  if (/\.(js|jsx|mjs|cjs)$/.test(relativePath)) return "javascript";
  if (/\.py$/.test(relativePath)) return "python";
  if (/\.rs$/.test(relativePath)) return "rust";
  if (/\.mdx?$/.test(relativePath)) return "markdown";
  if (/\.json$/.test(relativePath)) return "json";
  if (/\.ya?ml$/.test(relativePath)) return "yaml";
  return null;
}

function isDocPath(relativePath: string) {
  return /(^docs\/)|(^README)|\.mdx?$/.test(relativePath);
}

function isTestPath(relativePath: string) {
  return /(^tests?\/)|(__tests__\/)|\.(test|spec)\.[^.]+$|verify\.(js|ts|py|rs)$/.test(relativePath);
}

function readSnippet(filePath: string, maxChars = 6000) {
  try {
    const buffer = fs.readFileSync(filePath);
    if (buffer.includes(0)) {
      return "";
    }
    return buffer.toString("utf8").replace(/\u0000/g, "").slice(0, maxChars);
  } catch {
    return "";
  }
}

function tokenize(text: string) {
  return Array.from(new Set(text.toLowerCase().split(/[^a-z0-9_]+/g).filter((token) => token.length >= 2))).slice(0, 24);
}

function truncate(text: string, max = 500) {
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

function normalizeRelative(root: string, filePath: string) {
  return path.relative(root, filePath).replace(/\\/g, "/");
}

function resolveRelativeImport(fromPath: string, specifier: string, knownPaths: Set<string>) {
  if (!specifier.startsWith(".")) {
    return null;
  }
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), specifier));
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mjs`,
    `${base}.py`,
    `${base}.rs`,
    `${base}.md`,
    `${base}.mdx`,
    path.posix.join(base, "index.ts"),
    path.posix.join(base, "index.tsx"),
    path.posix.join(base, "index.js"),
    path.posix.join(base, "index.jsx"),
  ];
  return candidates.find((candidate) => knownPaths.has(candidate)) || null;
}

async function extractSymbolsWithFallback(language: string | null, content: string): Promise<string[]> {
  const treeSitterResult = await extractSymbolsTreeSitter(language, content);
  if (treeSitterResult !== null) return treeSitterResult;
  return extractSymbols(language, content);
}

async function extractImportsWithFallback(language: string | null, content: string): Promise<string[]> {
  const treeSitterResult = await extractImportsTreeSitter(language, content);
  if (treeSitterResult !== null) return treeSitterResult;
  return extractImports(language, content);
}

function extractSymbols(language: string | null, content: string) {
  const names = new Set<string>();
  const add = (regex: RegExp) => {
    for (const match of content.matchAll(regex)) {
      if (match[1]) {
        names.add(match[1]);
      }
    }
  };

  if (language === "typescript" || language === "javascript") {
    add(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g);
    add(/(?:const|let|var)\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s*)?\(/g);
    add(/export\s+class\s+([A-Za-z0-9_]+)/g);
  } else if (language === "python") {
    add(/^def\s+([A-Za-z0-9_]+)\s*\(/gm);
    add(/^class\s+([A-Za-z0-9_]+)\s*[(:]/gm);
  } else if (language === "rust") {
    add(/(?:pub\s+)?fn\s+([A-Za-z0-9_]+)/g);
    add(/(?:pub\s+)?struct\s+([A-Za-z0-9_]+)/g);
    add(/(?:pub\s+)?enum\s+([A-Za-z0-9_]+)/g);
    add(/(?:pub\s+)?trait\s+([A-Za-z0-9_]+)/g);
  }

  return Array.from(names).slice(0, 64);
}

function extractImports(language: string | null, content: string) {
  const imports = new Set<string>();
  if (language === "typescript" || language === "javascript") {
    for (const match of content.matchAll(/from\s+["']([^"']+)["']/g)) {
      imports.add(match[1]);
    }
    for (const match of content.matchAll(/require\(["']([^"']+)["']\)/g)) {
      imports.add(match[1]);
    }
  } else if (language === "python") {
    for (const match of content.matchAll(/^from\s+([A-Za-z0-9_\.]+)\s+import\s+/gm)) {
      imports.add(match[1]);
    }
    for (const match of content.matchAll(/^import\s+([A-Za-z0-9_\.]+)/gm)) {
      imports.add(match[1]);
    }
  } else if (language === "rust") {
    for (const match of content.matchAll(/^use\s+([^;]+);/gm)) {
      imports.add(match[1].trim());
    }
  }
  return Array.from(imports).slice(0, 64);
}

function scoreNode(node: {
  kind: string;
  path: string;
  name: string;
  content: string | null;
  metadata: Record<string, unknown>;
}, tokens: string[], mode: string) {
  const haystacks = [node.path.toLowerCase(), node.name.toLowerCase(), (node.content || "").toLowerCase()];
  let score = 0;
  for (const token of tokens) {
    if (node.name.toLowerCase() === token) score += 8;
    if (node.name.toLowerCase().includes(token)) score += 5;
    if (node.path.toLowerCase().includes(token)) score += 4;
    if ((node.content || "").toLowerCase().includes(token)) score += 2;
  }

  if (mode === "impact" && node.kind === "test") score += 3;
  if (mode === "review" && (node.kind === "doc" || node.kind === "test")) score += 2;
  if (mode === "architecture" && (node.kind === "doc" || node.kind === "symbol")) score += 2;
  if (String(node.metadata.priority || "") === "high") score += 1;

  if (node.kind === "file") score += 0.5;
  if (node.kind === "symbol") score += 1;
  if (node.kind === "doc") score += 0.25;

  return score;
}

function mapNode(row: {
  id: string;
  repoId: string;
  kind: string;
  path: string;
  name: string;
  language: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}): CodeGraphNode {
  return {
    id: row.id,
    repoId: row.repoId,
    kind: row.kind as CodeGraphNode["kind"],
    path: row.path,
    name: row.name,
    language: row.language,
    metadata: toRecord(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapEdge(row: {
  id: string;
  repoId: string;
  fromNodeId: string;
  toNodeId: string;
  kind: string;
  weight: number;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}): CodeGraphEdge {
  return {
    id: row.id,
    repoId: row.repoId,
    fromNodeId: row.fromNodeId,
    toNodeId: row.toNodeId,
    kind: row.kind as CodeGraphEdge["kind"],
    weight: row.weight,
    metadata: toRecord(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapContextPack(row: {
  id: string;
  repoId: string;
  objective: string;
  queryMode: string;
  files: unknown;
  symbols: unknown;
  tests: unknown;
  docs: unknown;
  rules: unknown;
  priorRuns: unknown;
  confidence: number;
  why: unknown;
  tokenBudget: number;
  retrievalTraceId: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}): ContextPack {
  return {
    id: row.id,
    repoId: row.repoId,
    objective: row.objective,
    queryMode: row.queryMode as ContextPack["queryMode"],
    files: asStringArray(row.files),
    symbols: asStringArray(row.symbols),
    tests: asStringArray(row.tests),
    docs: asStringArray(row.docs),
    rules: asStringArray(row.rules),
    priorRuns: asStringArray(row.priorRuns),
    confidence: row.confidence,
    why: asStringArray(row.why),
    tokenBudget: row.tokenBudget,
    retrievalTraceId: row.retrievalTraceId,
    metadata: toRecord(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Optional callback that lets the Fast model refine context pack selection.
 * Takes the objective and ranked candidates; returns the filtered/reordered set.
 * If it throws or returns empty, the original deterministic ranking is kept.
 */
export type ContextShaperFn = (input: {
  objective: string;
  candidateFiles: string[];
  candidateTests: string[];
  candidateDocs: string[];
  candidateSymbols: string[];
}) => Promise<{
  files: string[];
  tests: string[];
  docs: string[];
  symbols: string[];
}>;

export class CodeGraphService {
  private contextShaper: ContextShaperFn | null = null;

  setContextShaper(shaper: ContextShaperFn) {
    this.contextShaper = shaper;
  }
  private async updateRepoStatus(repoId: string, status: "not_indexed" | "indexing" | "ready" | "stale" | "failed", extra: Record<string, unknown> = {}) {
    const repo = await prisma.repoRegistry.findUnique({ where: { id: repoId } });
    if (!repo) {
      return;
    }
    await prisma.repoRegistry.update({
      where: { id: repoId },
      data: {
        metadata: {
          ...(toRecord(repo.metadata) || {}),
          code_graph_status: status,
          code_graph_updated_at: new Date().toISOString(),
          ...extra,
        },
      },
    });
  }

  async indexRepo(repoId: string, repoRoot: string, actor = "system") {
    await this.updateRepoStatus(repoId, "indexing", { repo_root: repoRoot });
    publishEvent("global", "codegraph.index.started", { repoId });

    const files = listFiles(repoRoot, 5000);
    const relativePaths = files.map((filePath) => normalizeRelative(repoRoot, filePath));
    const knownPaths = new Set(relativePaths);

    await prisma.codeGraphEdge.deleteMany({ where: { repoId } });
    await prisma.codeGraphNode.deleteMany({ where: { repoId } });

    const guidelineProfile = await prisma.repoGuidelineProfile.findUnique({ where: { repoId } });
    const commandNodes = [
      ...asStringArray(guidelineProfile?.testCommands),
      ...asStringArray(guidelineProfile?.buildCommands),
      ...asStringArray(guidelineProfile?.lintCommands),
    ];

    const nodeRows: Array<Record<string, unknown>> = [];
    const edges: Array<Record<string, unknown>> = [];
    const fileNodeIdByPath = new Map<string, string>();
    const symbolNodeIdsByFile = new Map<string, string[]>();
    const fileContents = new Map<string, string>();
    const symbolIndex = new Map<string, string[]>();

    for (const absolutePath of files) {
      const relativePath = normalizeRelative(repoRoot, absolutePath);
      const language = detectLanguage(relativePath);
      const kind = isTestPath(relativePath) ? "test" : isDocPath(relativePath) ? "doc" : "file";
      const content = readSnippet(absolutePath);
      fileContents.set(relativePath, content);
      const nodeId = randomUUID();
      fileNodeIdByPath.set(relativePath, nodeId);
      nodeRows.push({
        id: nodeId,
        repoId,
        kind,
        path: relativePath,
        name: path.posix.basename(relativePath),
        language,
        content,
        metadata: {
          extension: path.extname(relativePath),
          size: content.length,
        },
      });

      const symbols = await extractSymbolsWithFallback(language, content);
      const symbolIds: string[] = [];
      for (const symbol of symbols) {
        const symbolId = randomUUID();
        symbolIds.push(symbolId);
        nodeRows.push({
          id: symbolId,
          repoId,
          kind: "symbol",
          path: relativePath,
          name: symbol,
          language,
          content: truncate(content, 800),
          metadata: {
            defined_in: relativePath,
          },
        });
        edges.push({
          id: randomUUID(),
          repoId,
          fromNodeId: nodeId,
          toNodeId: symbolId,
          kind: "defines",
          weight: 1,
          metadata: {},
        });
        const bucket = symbolIndex.get(symbol.toLowerCase()) || [];
        bucket.push(symbolId);
        symbolIndex.set(symbol.toLowerCase(), bucket);
      }
      symbolNodeIdsByFile.set(relativePath, symbolIds);
    }

    for (const command of commandNodes) {
      nodeRows.push({
        id: randomUUID(),
        repoId,
        kind: "command",
        path: `command:${command}`,
        name: command,
        language: null,
        content: command,
        metadata: {},
      });
    }

    await prisma.codeGraphNode.createMany({ data: nodeRows as never[] });

    for (const relativePath of relativePaths) {
      const sourceNodeId = fileNodeIdByPath.get(relativePath);
      if (!sourceNodeId) {
        continue;
      }
      const content = fileContents.get(relativePath) || "";
      const language = detectLanguage(relativePath);
      const imports = await extractImportsWithFallback(language, content);
      for (const imported of imports) {
        const resolved = resolveRelativeImport(relativePath, imported, knownPaths);
        if (resolved && fileNodeIdByPath.has(resolved)) {
          edges.push({
            id: randomUUID(),
            repoId,
            fromNodeId: sourceNodeId,
            toNodeId: fileNodeIdByPath.get(resolved)!,
            kind: "imports",
            weight: 1,
            metadata: { specifier: imported },
          });
        }
      }

      if (isTestPath(relativePath)) {
        const basename = path.posix.basename(relativePath).replace(/\.(test|spec)\.[^.]+$/, "").replace(/verify$/, "");
        const candidates = relativePaths.filter((candidate) => !isTestPath(candidate) && candidate.includes(basename));
        for (const candidate of candidates.slice(0, 3)) {
          const targetId = fileNodeIdByPath.get(candidate);
          if (targetId) {
            edges.push({
              id: randomUUID(),
              repoId,
              fromNodeId: sourceNodeId,
              toNodeId: targetId,
              kind: "covers_test",
              weight: 1,
              metadata: { heuristic: "basename_match" },
            });
          }
        }
      }

      if (isDocPath(relativePath)) {
        const lower = content.toLowerCase();
        for (const [candidatePath, candidateNodeId] of fileNodeIdByPath.entries()) {
          if (candidatePath === relativePath) {
            continue;
          }
          const base = path.posix.basename(candidatePath).toLowerCase().replace(/\.[^.]+$/, "");
          if (base.length >= 3 && lower.includes(base)) {
            edges.push({
              id: randomUUID(),
              repoId,
              fromNodeId: sourceNodeId,
              toNodeId: candidateNodeId,
              kind: "documents",
              weight: 0.5,
              metadata: { heuristic: "basename_reference" },
            });
          }
        }
        for (const token of tokenize(content).slice(0, 20)) {
          const symbolIds = symbolIndex.get(token) || [];
          for (const symbolId of symbolIds.slice(0, 3)) {
            edges.push({
              id: randomUUID(),
              repoId,
              fromNodeId: sourceNodeId,
              toNodeId: symbolId,
              kind: "documents",
              weight: 0.35,
              metadata: { heuristic: "symbol_reference" },
            });
          }
        }
      }
    }

    if (edges.length > 0) {
      await prisma.codeGraphEdge.createMany({ data: edges as never[] });
    }

    await this.updateRepoStatus(repoId, "ready", {
      code_graph_node_count: nodeRows.length,
      code_graph_edge_count: edges.length,
    });

    await prisma.auditEvent.create({
      data: {
        actor,
        eventType: "codegraph.index_completed",
        payload: {
          repoId,
          repoRoot,
          nodeCount: nodeRows.length,
          edgeCount: edges.length,
        },
      },
    });

    publishEvent("global", "codegraph.index.completed", {
      repoId,
      nodeCount: nodeRows.length,
      edgeCount: edges.length,
    });

    return {
      repoId,
      status: "ready" as const,
      nodeCount: nodeRows.length,
      edgeCount: edges.length,
      fileCount: relativePaths.length,
    };
  }

  async getStatus(repoId: string) {
    const repo = await prisma.repoRegistry.findUnique({ where: { id: repoId } });
    if (!repo) {
      return null;
    }
    const metadata = toRecord(repo.metadata);
    const count = await prisma.codeGraphNode.count({ where: { repoId } });
    return {
      repoId,
      status: (metadata.code_graph_status as string | undefined) || (count > 0 ? "ready" : "not_indexed"),
      nodeCount: count,
      edgeCount: await prisma.codeGraphEdge.count({ where: { repoId } }),
      updatedAt: typeof metadata.code_graph_updated_at === "string" ? metadata.code_graph_updated_at : repo.updatedAt.toISOString(),
    };
  }

  async getLatestContextPack(repoId: string) {
    const row = await prisma.contextPack.findFirst({
      where: { repoId },
      orderBy: { createdAt: "desc" },
    });
    return row ? mapContextPack(row) : null;
  }

  async getExecutionAttempts(runId: string) {
    const rows = await prisma.executionAttempt.findMany({
      where: { runId },
      orderBy: { startedAt: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      runId: row.runId,
      repoId: row.repoId,
      projectId: row.projectId,
      modelRole: row.modelRole,
      providerId: row.providerId,
      status: row.status,
      objective: row.objective,
      patchSummary: row.patchSummary,
      changedFiles: asStringArray(row.changedFiles),
      approvalRequired: row.approvalRequired,
      contextPackId: row.contextPackId,
      routingDecisionId: row.routingDecisionId,
      startedAt: row.startedAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
      metadata: toRecord(row.metadata),
    }));
  }

  async getVerificationBundle(runId: string) {
    const row = await prisma.verificationBundle.findFirst({
      where: { runId },
      orderBy: { createdAt: "desc" },
    });
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      runId: row.runId,
      repoId: row.repoId,
      executionAttemptId: row.executionAttemptId,
      changedFileChecks: asStringArray(row.changedFileChecks),
      impactedTests: asStringArray(row.impactedTests),
      fullSuiteRun: row.fullSuiteRun,
      docsChecked: asStringArray(row.docsChecked),
      pass: row.pass,
      failures: asStringArray(row.failures),
      artifacts: asStringArray(row.artifacts),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      metadata: toRecord(row.metadata),
    };
  }

  async buildContextPack(input: {
    repoId: string;
    objective: string;
    queryMode?: ContextPack["queryMode"];
    tokenBudget?: number;
    aggregateId?: string;
    actor?: string;
  }) {
    const queryMode = input.queryMode || "basic";
    const tokenBudget = input.tokenBudget || 1800;
    const repo = await prisma.repoRegistry.findUnique({ where: { id: input.repoId } });
    if (!repo) {
      throw new Error(`Repo not found: ${input.repoId}`);
    }

    let nodeCount = await prisma.codeGraphNode.count({ where: { repoId: input.repoId } });
    if (nodeCount === 0) {
      await this.indexRepo(input.repoId, path.join(repo.managedWorktreeRoot, "active"), input.actor || "system");
      nodeCount = await prisma.codeGraphNode.count({ where: { repoId: input.repoId } });
    }

    const nodes = await prisma.codeGraphNode.findMany({ where: { repoId: input.repoId } });
    const tokens = tokenize(input.objective);
    const ranked = nodes
      .map((node) => ({ node, score: scoreNode({ ...node, metadata: toRecord(node.metadata) }, tokens, queryMode) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 24);

    const topNodeIds = ranked.map((entry) => entry.node.id);
    const edges = topNodeIds.length
      ? await prisma.codeGraphEdge.findMany({
          where: {
            repoId: input.repoId,
            OR: [{ fromNodeId: { in: topNodeIds } }, { toNodeId: { in: topNodeIds } }],
          },
          take: 100,
        })
      : [];

    const neighborIds = new Set<string>();
    for (const edge of edges) {
      neighborIds.add(edge.fromNodeId);
      neighborIds.add(edge.toNodeId);
    }
    const neighbors = neighborIds.size
      ? await prisma.codeGraphNode.findMany({
          where: { repoId: input.repoId, id: { in: Array.from(neighborIds) } },
        })
      : [];

    const combined = new Map<string, typeof nodes[number]>();
    for (const entry of ranked) combined.set(entry.node.id, entry.node);
    for (const neighbor of neighbors) combined.set(neighbor.id, neighbor);

    const all = Array.from(combined.values());
    let files = Array.from(new Set(all.filter((node) => node.kind === "file").map((node) => node.path))).slice(0, 8);
    let symbols = Array.from(new Set(all.filter((node) => node.kind === "symbol").map((node) => node.name))).slice(0, 16);
    let tests = Array.from(new Set(all.filter((node) => node.kind === "test").map((node) => node.path))).slice(0, 8);
    let docs = Array.from(new Set(all.filter((node) => node.kind === "doc").map((node) => node.path))).slice(0, 8);

    // Let the Fast model refine the selection when a shaper is configured
    if (this.contextShaper) {
      try {
        const shaped = await this.contextShaper({
          objective: input.objective,
          candidateFiles: files,
          candidateTests: tests,
          candidateDocs: docs,
          candidateSymbols: symbols,
        });
        if (shaped.files.length || shaped.tests.length || shaped.docs.length || shaped.symbols.length) {
          files = shaped.files.slice(0, 8);
          tests = shaped.tests.slice(0, 8);
          docs = shaped.docs.slice(0, 8);
          symbols = shaped.symbols.slice(0, 16);
        }
      } catch {
        // Shaper failure is non-fatal — keep deterministic selection
      }
    }

    const guidelines = await prisma.repoGuidelineProfile.findUnique({ where: { repoId: input.repoId } });
    const [recentBenchmarkRuns, recentExecutionRuns] = await Promise.all([
      prisma.benchmarkRun.findMany({
        where: { repoId: input.repoId },
        orderBy: { startedAt: "desc" },
        take: 3,
        select: { id: true },
      }),
      prisma.executionAttempt.findMany({
        where: { projectId: input.repoId },
        orderBy: { startedAt: "desc" },
        take: 5,
        select: { id: true, status: true },
      }),
    ]);

    const results: KnowledgeHit[] = ranked.map(({ node, score }) => ({
      id: node.id,
      source: `code_graph:${node.kind}`,
      path: node.path,
      snippet: truncate(node.content || node.name, 240),
      score,
      embedding_id: null,
    }));

    const retrievalTrace = await prisma.retrievalTrace.create({
      data: {
        repoId: input.repoId,
        aggregateId: input.aggregateId || `repo:${input.repoId}`,
        query: input.objective,
        retrievalIds: results.map((result) => result.id),
        results,
        metadata: {
          source: "code_graph",
          query_mode: queryMode,
          token_budget: tokenBudget,
        },
      },
    });

    const fileWhyMap = new Map<string, string>();
    for (const entry of ranked) {
      const nodePath = entry.node.path;
      const nodeKind = entry.node.kind;
      if (nodeKind === "file" && !fileWhyMap.has(nodePath)) {
        fileWhyMap.set(nodePath, `Matched objective tokens with score ${entry.score.toFixed(2)}`);
      } else if (nodeKind === "test" && !fileWhyMap.has(nodePath)) {
        fileWhyMap.set(nodePath, `Test file covers symbols relevant to the objective`);
      } else if (nodeKind === "doc" && !fileWhyMap.has(nodePath)) {
        fileWhyMap.set(nodePath, `Documentation source related to the change scope`);
      }
    }

    const why = [
      files.length ? `Selected ${files.length} relevant file(s) for the objective.` : "No strong file hits found.",
      ...files.map((f) => `[file] ${f}: ${fileWhyMap.get(f) || "Included via graph neighbor expansion"}`),
      symbols.length ? `Included ${symbols.length} symbol(s) to improve code targeting.` : "No symbol hits found.",
      tests.length ? `Attached ${tests.length} likely impacted test file(s).` : "No impacted tests inferred.",
      ...tests.map((t) => `[test] ${t}: ${fileWhyMap.get(t) || "Test linked by code graph edge"}`),
      docs.length ? `Included ${docs.length} documentation source(s).` : "No documentation source matched strongly.",
      ...docs.map((d) => `[doc] ${d}: ${fileWhyMap.get(d) || "Doc file in change scope"}`),
    ].slice(0, 32);

    const priorRunIds = [
      ...recentExecutionRuns.map((run) => run.id),
      ...recentBenchmarkRuns.map((run) => run.id),
    ].slice(0, 8);

    const pack = await prisma.contextPack.create({
      data: {
        repoId: input.repoId,
        objective: input.objective,
        queryMode,
        files,
        symbols,
        tests,
        docs,
        rules: [
          ...asStringArray(guidelines?.patchRules),
          ...asStringArray(guidelines?.docRules),
          ...asStringArray(guidelines?.requiredArtifacts),
        ].slice(0, 16),
        priorRuns: priorRunIds,
        confidence: ranked.length ? Math.min(0.96, 0.45 + ranked.length * 0.02) : 0.25,
        why,
        tokenBudget,
        retrievalTraceId: retrievalTrace.id,
        metadata: {
          retrieval_ids: results.map((result) => result.id),
          graph_edge_count: edges.length,
        },
      },
    });

    publishEvent("global", "context.pack.ready", {
      repoId: input.repoId,
      contextPackId: pack.id,
      retrievalTraceId: retrievalTrace.id,
    });

    return {
      pack: mapContextPack(pack),
      retrievalTrace: {
        id: retrievalTrace.id,
        repoId: retrievalTrace.repoId,
        aggregateId: retrievalTrace.aggregateId,
        query: retrievalTrace.query,
        retrievalIds: asStringArray(retrievalTrace.retrievalIds),
        results,
        createdAt: retrievalTrace.createdAt.toISOString(),
      },
      hits: results,
      graph: {
        nodes: all.map(mapNode),
        edges: edges.map(mapEdge),
      },
    };
  }

  async query(repoId: string, q: string, mode: ContextPack["queryMode"] = "basic") {
    const built = await this.buildContextPack({
      repoId,
      objective: q,
      queryMode: mode,
      aggregateId: `repo:${repoId}`,
    });

    return {
      pack: built.pack,
      hits: built.hits,
      nodes: built.graph.nodes,
      edges: built.graph.edges,
    };
  }

  /**
   * Re-rank a context pack after manifest generation.
   * Boosts files that are directly related to the manifest's target files
   * (imports, tests, docs) so per-file generation gets better context.
   */
  async rerankForManifest(
    repoId: string,
    contextPack: ContextPack,
    manifestFiles: Array<{ path: string; action: string }>,
  ): Promise<ContextPack> {
    const targetPaths = new Set(manifestFiles.map((f) => f.path));

    // Find graph edges connected to manifest target files
    const targetNodes = await prisma.codeGraphNode.findMany({
      where: { repoId, path: { in: Array.from(targetPaths) } },
    });
    const targetNodeIds = targetNodes.map((n) => n.id);

    if (targetNodeIds.length === 0) return contextPack;

    const edges = await prisma.codeGraphEdge.findMany({
      where: {
        repoId,
        OR: [{ fromNodeId: { in: targetNodeIds } }, { toNodeId: { in: targetNodeIds } }],
      },
      take: 50,
    });

    // Collect neighbor paths
    const neighborNodeIds = new Set<string>();
    for (const edge of edges) {
      neighborNodeIds.add(edge.fromNodeId);
      neighborNodeIds.add(edge.toNodeId);
    }
    const neighbors = neighborNodeIds.size
      ? await prisma.codeGraphNode.findMany({
          where: { id: { in: Array.from(neighborNodeIds) } },
          select: { path: true, kind: true },
        })
      : [];

    const importedPaths = new Set(neighbors.filter((n) => n.kind === "file").map((n) => n.path));
    const relatedTests = new Set(neighbors.filter((n) => n.kind === "test").map((n) => n.path));
    const relatedDocs = new Set(neighbors.filter((n) => n.kind === "doc").map((n) => n.path));

    // Boost: move related files to front of lists, add missing ones
    const boostList = (existing: string[], related: Set<string>, max: number) => {
      const boosted = existing.filter((p) => related.has(p));
      const rest = existing.filter((p) => !related.has(p));
      const newEntries = Array.from(related).filter((p) => !existing.includes(p));
      return [...boosted, ...newEntries, ...rest].slice(0, max);
    };

    return {
      ...contextPack,
      files: boostList(asStringArray(contextPack.files), importedPaths, 10),
      tests: boostList(asStringArray(contextPack.tests), relatedTests, 10),
      docs: boostList(asStringArray(contextPack.docs), relatedDocs, 8),
    };
  }
}
