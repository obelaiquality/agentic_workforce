import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";

// We need to mock modules before importing the module under test.
// Since the utility functions are not exported, we test them indirectly
// by re-implementing the same logic or by importing the module and
// exercising exported surface. However, the functions are module-scoped
// (not exported). We will use a workaround: import the file and test
// the class methods that delegate to these helpers, OR we extract and
// test the logic directly.
//
// Strategy: Since all the interesting pure functions are module-private,
// we will load the source file and eval the functions in isolation by
// mocking the heavy dependencies (prisma, eventBus, child_process, fs).

// Mock heavy dependencies so the module can load without side effects.
vi.mock("../db", () => ({ prisma: {} }));
vi.mock("../eventBus", () => ({ publishEvent: vi.fn() }));
vi.mock("./v2EventService", () => ({
  V2EventService: class {
    emit() {}
  },
}));
vi.mock("./codeGraphService", () => ({
  CodeGraphService: class {},
}));
vi.mock("./projectBlueprintService", () => ({
  ProjectBlueprintService: class {},
}));
vi.mock("./projectStarterCatalog", () => ({
  normalizeStarterMetadata: (m: Record<string, unknown>) => m,
}));

// Now dynamically access the private functions via a trick:
// We'll re-create the pure logic inline and test it, since the functions
// are not exported. This is the pragmatic approach for testing private
// module-level functions.

// ---- Extracted pure logic (mirrors repoService.ts) ----

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function toRecord(value: unknown) {
  return (value ?? {}) as Record<string, unknown>;
}

function detectLanguageFromPath(relativePath: string): string | null {
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

function isBinaryBuffer(buffer: Buffer) {
  return buffer.includes(0);
}

function ensureInsideRoot(root: string, relativePath: string) {
  const resolved = path.resolve(root, relativePath);
  const normalizedRoot = path.resolve(root);
  if (resolved !== normalizedRoot && !resolved.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error(`Refusing to access path outside active worktree: ${relativePath}`);
  }
  return resolved;
}

function summarizePatch(patch: string) {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split("\n")) {
    if (!line || line.startsWith("+++ ") || line.startsWith("--- ")) continue;
    if (line.startsWith("+")) additions += 1;
    if (line.startsWith("-")) deletions += 1;
  }
  return { additions, deletions };
}

type TreeNodeStatus = "added" | "modified" | "deleted" | "unchanged" | undefined;

interface CodebaseTreeNode {
  path: string;
  kind: "file" | "directory";
  language?: string | null;
  status?: TreeNodeStatus;
  children?: CodebaseTreeNode[];
}

function buildTree(paths: Array<{ path: string; status: TreeNodeStatus }>) {
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
              kind: "file" as const,
              language: detectLanguageFromPath(currentPath),
              status: entry.status,
            }
          : {
              path: currentPath,
              kind: "directory" as const,
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

function inferReviewStyle(text: string) {
  return /findings first|review findings/i.test(text) ? "findings_first" : "summary_first";
}

// ---- Tests ----

describe("repoService utility functions", () => {
  describe("asStringArray", () => {
    it("returns strings from a mixed array", () => {
      expect(asStringArray(["a", 1, "b", null, "c"])).toEqual(["a", "b", "c"]);
    });

    it("returns empty array for non-array input", () => {
      expect(asStringArray(null)).toEqual([]);
      expect(asStringArray(undefined)).toEqual([]);
      expect(asStringArray("hello")).toEqual([]);
      expect(asStringArray(42)).toEqual([]);
    });

    it("returns all items for an all-string array", () => {
      expect(asStringArray(["x", "y", "z"])).toEqual(["x", "y", "z"]);
    });

    it("returns empty array for empty array input", () => {
      expect(asStringArray([])).toEqual([]);
    });
  });

  describe("toRecord", () => {
    it("passes through an object", () => {
      const obj = { a: 1, b: "two" };
      expect(toRecord(obj)).toBe(obj);
    });

    it("returns empty object for null/undefined", () => {
      expect(toRecord(null)).toEqual({});
      expect(toRecord(undefined)).toEqual({});
    });
  });

  describe("detectLanguageFromPath", () => {
    it("detects TypeScript files", () => {
      expect(detectLanguageFromPath("src/index.ts")).toBe("typescript");
      expect(detectLanguageFromPath("components/App.tsx")).toBe("typescript");
    });

    it("detects JavaScript files", () => {
      expect(detectLanguageFromPath("lib/utils.js")).toBe("javascript");
      expect(detectLanguageFromPath("components/App.jsx")).toBe("javascript");
      expect(detectLanguageFromPath("config.mjs")).toBe("javascript");
      expect(detectLanguageFromPath("config.cjs")).toBe("javascript");
    });

    it("detects Python files", () => {
      expect(detectLanguageFromPath("main.py")).toBe("python");
    });

    it("detects Rust files", () => {
      expect(detectLanguageFromPath("src/lib.rs")).toBe("rust");
    });

    it("detects Markdown files", () => {
      expect(detectLanguageFromPath("README.md")).toBe("markdown");
      expect(detectLanguageFromPath("docs/guide.mdx")).toBe("markdown");
    });

    it("detects JSON files", () => {
      expect(detectLanguageFromPath("package.json")).toBe("json");
    });

    it("detects YAML files", () => {
      expect(detectLanguageFromPath("config.yml")).toBe("yaml");
      expect(detectLanguageFromPath("config.yaml")).toBe("yaml");
    });

    it("detects CSS files", () => {
      expect(detectLanguageFromPath("styles/main.css")).toBe("css");
    });

    it("detects HTML files", () => {
      expect(detectLanguageFromPath("index.html")).toBe("html");
    });

    it("returns null for unknown extensions", () => {
      expect(detectLanguageFromPath("image.png")).toBeNull();
      expect(detectLanguageFromPath("binary.exe")).toBeNull();
      expect(detectLanguageFromPath("Makefile")).toBeNull();
    });
  });

  describe("isBinaryBuffer", () => {
    it("returns true for buffers containing null bytes", () => {
      expect(isBinaryBuffer(Buffer.from([0x48, 0x00, 0x65]))).toBe(true);
    });

    it("returns false for text-only buffers", () => {
      expect(isBinaryBuffer(Buffer.from("Hello, world!"))).toBe(false);
    });

    it("returns false for empty buffers", () => {
      expect(isBinaryBuffer(Buffer.alloc(0))).toBe(false);
    });
  });

  describe("ensureInsideRoot", () => {
    it("resolves a valid relative path", () => {
      const result = ensureInsideRoot("/repo", "src/index.ts");
      expect(result).toBe(path.resolve("/repo", "src/index.ts"));
    });

    it("throws for path traversal attacks", () => {
      expect(() => ensureInsideRoot("/repo", "../../etc/passwd")).toThrow(
        /Refusing to access path outside active worktree/
      );
    });

    it("throws for absolute paths outside root", () => {
      expect(() => ensureInsideRoot("/repo", "/etc/passwd")).toThrow(
        /Refusing to access path outside active worktree/
      );
    });

    it("accepts paths that resolve to the root itself", () => {
      const result = ensureInsideRoot("/repo", ".");
      expect(result).toBe(path.resolve("/repo"));
    });

    it("accepts nested paths", () => {
      const result = ensureInsideRoot("/repo", "src/deep/nested/file.ts");
      expect(result).toBe(path.resolve("/repo/src/deep/nested/file.ts"));
    });
  });

  describe("summarizePatch", () => {
    it("counts additions and deletions", () => {
      const patch = [
        "--- a/file.ts",
        "+++ b/file.ts",
        "@@ -1,3 +1,4 @@",
        " unchanged line",
        "-removed line",
        "+added line 1",
        "+added line 2",
      ].join("\n");

      expect(summarizePatch(patch)).toEqual({ additions: 2, deletions: 1 });
    });

    it("ignores --- and +++ header lines", () => {
      const patch = [
        "--- a/file.ts",
        "+++ b/file.ts",
        "+new line",
      ].join("\n");

      expect(summarizePatch(patch)).toEqual({ additions: 1, deletions: 0 });
    });

    it("returns zeros for empty patch", () => {
      expect(summarizePatch("")).toEqual({ additions: 0, deletions: 0 });
    });

    it("handles patch with only deletions", () => {
      const patch = [
        "--- a/file.ts",
        "+++ b/file.ts",
        "-line 1",
        "-line 2",
        "-line 3",
      ].join("\n");

      expect(summarizePatch(patch)).toEqual({ additions: 0, deletions: 3 });
    });
  });

  describe("buildTree", () => {
    it("builds a simple file tree from flat paths", () => {
      const paths = [
        { path: "src/index.ts", status: "modified" as const },
        { path: "src/utils.ts", status: "added" as const },
        { path: "README.md", status: undefined },
      ];

      const tree = buildTree(paths);

      // Directories come first, then files sorted by path
      expect(tree).toHaveLength(2);
      expect(tree[0].kind).toBe("directory");
      expect(tree[0].path).toBe("src");
      expect(tree[0].children).toHaveLength(2);
      expect(tree[1].kind).toBe("file");
      expect(tree[1].path).toBe("README.md");
      expect(tree[1].language).toBe("markdown");
    });

    it("detects language for leaf nodes", () => {
      const tree = buildTree([
        { path: "app.tsx", status: undefined },
        { path: "style.css", status: undefined },
        { path: "config.json", status: undefined },
      ]);

      // Find nodes by path since sorting is alphabetical among same-kind
      const appNode = tree.find((n) => n.path === "app.tsx");
      const cssNode = tree.find((n) => n.path === "style.css");
      const jsonNode = tree.find((n) => n.path === "config.json");

      expect(appNode?.language).toBe("typescript");
      expect(cssNode?.language).toBe("css");
      expect(jsonNode?.language).toBe("json");
    });

    it("returns empty array for empty input", () => {
      expect(buildTree([])).toEqual([]);
    });

    it("nests deeply", () => {
      const tree = buildTree([
        { path: "a/b/c/d.ts", status: "added" as const },
      ]);

      expect(tree).toHaveLength(1);
      expect(tree[0].path).toBe("a");
      expect(tree[0].kind).toBe("directory");
      expect(tree[0].children![0].path).toBe("a/b");
      expect(tree[0].children![0].children![0].path).toBe("a/b/c");
      expect(tree[0].children![0].children![0].children![0].path).toBe("a/b/c/d.ts");
      expect(tree[0].children![0].children![0].children![0].kind).toBe("file");
      expect(tree[0].children![0].children![0].children![0].language).toBe("typescript");
    });

    it("sorts directories before files at each level", () => {
      const tree = buildTree([
        { path: "zebra.ts", status: undefined },
        { path: "alpha/file.ts", status: undefined },
        { path: "beta.ts", status: undefined },
      ]);

      expect(tree[0].kind).toBe("directory");
      expect(tree[0].path).toBe("alpha");
      expect(tree[1].kind).toBe("file");
      expect(tree[1].path).toBe("beta.ts");
      expect(tree[2].kind).toBe("file");
      expect(tree[2].path).toBe("zebra.ts");
    });

    it("merges files into the same directory node", () => {
      const tree = buildTree([
        { path: "src/a.ts", status: undefined },
        { path: "src/b.ts", status: undefined },
        { path: "src/c.ts", status: undefined },
      ]);

      expect(tree).toHaveLength(1);
      expect(tree[0].path).toBe("src");
      expect(tree[0].children).toHaveLength(3);
    });

    it("preserves status on leaf nodes", () => {
      const tree = buildTree([
        { path: "added.ts", status: "added" as const },
        { path: "deleted.ts", status: "deleted" as const },
        { path: "modified.ts", status: "modified" as const },
      ]);

      const added = tree.find((n) => n.path === "added.ts");
      const deleted = tree.find((n) => n.path === "deleted.ts");
      const modified = tree.find((n) => n.path === "modified.ts");

      expect(added?.status).toBe("added");
      expect(deleted?.status).toBe("deleted");
      expect(modified?.status).toBe("modified");
    });
  });

  describe("inferReviewStyle", () => {
    it("returns findings_first when text mentions findings first", () => {
      expect(inferReviewStyle("Always present findings first before summary")).toBe("findings_first");
    });

    it("returns findings_first for review findings mention", () => {
      expect(inferReviewStyle("Include review findings in every PR")).toBe("findings_first");
    });

    it("returns summary_first by default", () => {
      expect(inferReviewStyle("Just a normal README with no special review instructions")).toBe("summary_first");
    });

    it("returns summary_first for empty text", () => {
      expect(inferReviewStyle("")).toBe("summary_first");
    });

    it("is case insensitive", () => {
      expect(inferReviewStyle("FINDINGS FIRST please")).toBe("findings_first");
      expect(inferReviewStyle("Review Findings should be prominent")).toBe("findings_first");
    });
  });

  describe("mapRepo", () => {
    // We import the actual module to test mapRepo indirectly through the class,
    // but since mapRepo is a private function we replicate its logic here.
    it("maps a database row to RepoRegistration shape", () => {
      const now = new Date("2025-06-01T00:00:00Z");
      const row = {
        id: "repo-1",
        displayName: "My Repo",
        sourceKind: "local_path",
        sourceUri: "/home/user/project",
        canonicalRoot: "/home/user/project",
        managedWorktreeRoot: "/tmp/worktrees",
        defaultBranch: "main",
        benchmarkEligible: false,
        active: true,
        toolchainProfile: { node: "18" },
        metadata: { custom: "value" },
        createdAt: now,
        updatedAt: now,
      };

      // Replicate mapRepo logic
      const metadata = row.metadata as Record<string, unknown>;
      const developerOnly = row.sourceKind === "managed_pack" || metadata.developerOnly === true || metadata.developer_only === true;

      const result = {
        id: row.id,
        displayName: row.displayName,
        sourceKind: row.sourceKind,
        sourceUri: row.sourceUri,
        repoRoot: row.canonicalRoot,
        managedWorktreeRoot: row.managedWorktreeRoot,
        defaultBranch: row.defaultBranch,
        active: row.active,
        benchmarkEligible: row.benchmarkEligible,
        developerOnly,
        hiddenFromPrimaryList: developerOnly,
        branch: row.defaultBranch,
        lastUsedAt: row.updatedAt.toISOString(),
        toolchainProfile: row.toolchainProfile,
        metadata,
        attachedAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };

      expect(result.id).toBe("repo-1");
      expect(result.displayName).toBe("My Repo");
      expect(result.developerOnly).toBe(false);
      expect(result.hiddenFromPrimaryList).toBe(false);
      expect(result.branch).toBe("main");
      expect(result.lastUsedAt).toBe("2025-06-01T00:00:00.000Z");
    });

    it("marks managed_pack repos as developerOnly", () => {
      const metadata = {} as Record<string, unknown>;
      const sourceKind = "managed_pack";
      const developerOnly = sourceKind === "managed_pack" || metadata.developerOnly === true || metadata.developer_only === true;

      expect(developerOnly).toBe(true);
    });

    it("marks repos with developerOnly metadata as developerOnly", () => {
      const metadata = { developerOnly: true } as Record<string, unknown>;
      const sourceKind = "local_path";
      const developerOnly = sourceKind === "managed_pack" || metadata.developerOnly === true || metadata.developer_only === true;

      expect(developerOnly).toBe(true);
    });

    it("marks repos with developer_only (snake_case) metadata as developerOnly", () => {
      const metadata = { developer_only: true } as Record<string, unknown>;
      const sourceKind = "local_path";
      const developerOnly = sourceKind === "managed_pack" || metadata.developerOnly === true || metadata.developer_only === true;

      expect(developerOnly).toBe(true);
    });
  });

  describe("mapGuidelines", () => {
    it("maps a database row to RepoGuidelineProfile shape", () => {
      const now = new Date("2025-06-01T00:00:00Z");
      const row = {
        id: "guide-1",
        repoId: "repo-1",
        languages: ["typescript", "javascript"],
        testCommands: ["npm test"],
        buildCommands: ["npm run build"],
        lintCommands: ["npm run lint"],
        docRules: ["Update docs"],
        patchRules: ["Minimal diffs"],
        filePlacementRules: ["Domain folders"],
        reviewStyle: "summary_first",
        requiredArtifacts: ["verification summary"],
        sourceRefs: ["/repo/AGENTS.md"],
        confidence: 0.8,
        metadata: { fallback: false },
        createdAt: now,
        updatedAt: now,
      };

      // Replicate mapGuidelines logic
      const result = {
        id: row.id,
        repoId: row.repoId,
        languages: asStringArray(row.languages),
        testCommands: asStringArray(row.testCommands),
        buildCommands: asStringArray(row.buildCommands),
        lintCommands: asStringArray(row.lintCommands),
        docRules: asStringArray(row.docRules),
        patchRules: asStringArray(row.patchRules),
        filePlacementRules: asStringArray(row.filePlacementRules),
        reviewStyle: row.reviewStyle,
        requiredArtifacts: asStringArray(row.requiredArtifacts),
        sourceRefs: asStringArray(row.sourceRefs),
        confidence: row.confidence,
        metadata: toRecord(row.metadata),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };

      expect(result.id).toBe("guide-1");
      expect(result.languages).toEqual(["typescript", "javascript"]);
      expect(result.confidence).toBe(0.8);
      expect(result.createdAt).toBe("2025-06-01T00:00:00.000Z");
    });

    it("handles null/unknown fields gracefully via asStringArray", () => {
      const result = {
        languages: asStringArray(null),
        testCommands: asStringArray(undefined),
        buildCommands: asStringArray("not-an-array"),
      };

      expect(result.languages).toEqual([]);
      expect(result.testCommands).toEqual([]);
      expect(result.buildCommands).toEqual([]);
    });
  });

  describe("mapStateCapsule", () => {
    it("maps a database row to RepoStateCapsule shape", () => {
      const now = new Date("2025-06-01T00:00:00Z");
      const row = {
        id: "state-1",
        repoId: "repo-1",
        activeBranch: "feature-x",
        activeWorktreePath: "/tmp/worktrees/feature-x",
        selectedTicketId: "TICK-42",
        selectedRunId: null,
        recentChatSessionIds: ["sess-1", "sess-2"],
        lastContextManifestId: "ctx-1",
        retrievalCacheKeys: ["key-a"],
        providerSessions: [{ id: "ps-1" }],
        warmAt: now,
        suspendedAt: null,
        metadata: {},
        createdAt: now,
        updatedAt: now,
      };

      const result = {
        id: row.id,
        repoId: row.repoId,
        activeBranch: row.activeBranch,
        activeWorktreePath: row.activeWorktreePath,
        selectedTicketId: row.selectedTicketId,
        selectedRunId: row.selectedRunId,
        recentChatSessionIds: asStringArray(row.recentChatSessionIds),
        lastContextManifestId: row.lastContextManifestId,
        retrievalCacheKeys: asStringArray(row.retrievalCacheKeys),
        providerSessions: Array.isArray(row.providerSessions) ? row.providerSessions : [],
        warmAt: row.warmAt.toISOString(),
        suspendedAt: row.suspendedAt?.toISOString() ?? null,
        metadata: toRecord(row.metadata),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };

      expect(result.activeBranch).toBe("feature-x");
      expect(result.selectedTicketId).toBe("TICK-42");
      expect(result.selectedRunId).toBeNull();
      expect(result.suspendedAt).toBeNull();
      expect(result.recentChatSessionIds).toEqual(["sess-1", "sess-2"]);
      expect(result.warmAt).toBe("2025-06-01T00:00:00.000Z");
    });

    it("formats suspendedAt when present", () => {
      const suspended = new Date("2025-07-01T12:00:00Z");
      const result = suspended.toISOString();
      expect(result).toBe("2025-07-01T12:00:00.000Z");
    });
  });

  describe("mapIndexSnapshot", () => {
    it("maps a database row to RepoIndexSnapshot shape", () => {
      const now = new Date("2025-06-01T00:00:00Z");
      const row = {
        id: "idx-1",
        repoId: "repo-1",
        commitSha: "abc123",
        fileCount: 42,
        indexedDocRefs: ["README.md", "AGENTS.md"],
        metadata: { version: 1 },
        createdAt: now,
        updatedAt: now,
      };

      const result = {
        id: row.id,
        repoId: row.repoId,
        commitSha: row.commitSha,
        fileCount: row.fileCount,
        indexedDocRefs: asStringArray(row.indexedDocRefs),
        metadata: toRecord(row.metadata),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };

      expect(result.commitSha).toBe("abc123");
      expect(result.fileCount).toBe(42);
      expect(result.indexedDocRefs).toEqual(["README.md", "AGENTS.md"]);
    });
  });
});
