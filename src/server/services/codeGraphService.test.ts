import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CodeGraphNode, CodeGraphEdge, ContextPack } from "../../shared/contracts";

// Mock heavy dependencies before importing the module under test
vi.mock("../db", () => ({
  prisma: {
    repoRegistry: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    codeGraphNode: {
      findMany: vi.fn(),
      count: vi.fn(),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    codeGraphEdge: {
      findMany: vi.fn(),
      count: vi.fn(),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    contextPack: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    retrievalTrace: {
      create: vi.fn(),
    },
    repoGuidelineProfile: {
      findUnique: vi.fn(),
    },
    benchmarkRun: {
      findMany: vi.fn(),
    },
    executionAttempt: {
      findMany: vi.fn(),
    },
    auditEvent: {
      create: vi.fn(),
    },
    verificationBundle: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("../eventBus", () => ({ publishEvent: vi.fn() }));
vi.mock("./treeSitterAnalyzer", () => ({
  extractSymbolsTreeSitter: vi.fn().mockResolvedValue(null),
  extractImportsTreeSitter: vi.fn().mockResolvedValue(null),
}));

vi.mock("./ripgrep", () => ({
  getRipgrepPath: vi.fn().mockReturnValue(null),
  execRipgrep: vi.fn().mockResolvedValue([]),
  COMMON_IGNORE_DIRS: ["node_modules", ".git"],
  commonExclusionArgs: vi.fn().mockReturnValue(["--glob", "!node_modules"]),
}));

// Mock fs to avoid real file system access
vi.mock("node:fs", () => ({
  default: {
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
  },
}));

import { CodeGraphService } from "./codeGraphService";
import { prisma } from "../db";

// Get typed access to mocked prisma
const mockPrisma = vi.mocked(prisma);

describe("CodeGraphService", () => {
  let service: CodeGraphService;

  beforeEach(() => {
    service = new CodeGraphService();
    vi.clearAllMocks();
  });

  describe("setContextShaper", () => {
    it("registers a context shaper callback", async () => {
      const mockShaper = vi.fn().mockResolvedValue({
        files: ["file1.ts"],
        tests: ["test1.test.ts"],
        docs: ["README.md"],
        symbols: ["MyClass"],
      });

      service.setContextShaper(mockShaper);

      // Setup minimal mock data
      mockPrisma.repoRegistry.findUnique.mockResolvedValue({
        id: "repo1",
        managedWorktreeRoot: "/test/repo",
        metadata: {},
        updatedAt: new Date(),
      });
      mockPrisma.codeGraphNode.count.mockResolvedValue(1);
      mockPrisma.codeGraphNode.findMany.mockResolvedValue([
        {
          id: "node1",
          repoId: "repo1",
          kind: "file",
          path: "src/index.ts",
          name: "index.ts",
          language: "typescript",
          content: "export function test() {}",
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      mockPrisma.codeGraphEdge.findMany.mockResolvedValue([]);
      mockPrisma.repoGuidelineProfile.findUnique.mockResolvedValue(null);
      mockPrisma.benchmarkRun.findMany.mockResolvedValue([]);
      mockPrisma.executionAttempt.findMany.mockResolvedValue([]);
      mockPrisma.retrievalTrace.create.mockResolvedValue({
        id: "trace1",
        repoId: "repo1",
        aggregateId: "repo:repo1",
        query: "test objective",
        retrievalIds: [],
        results: [],
        metadata: {},
        createdAt: new Date(),
      });
      mockPrisma.contextPack.create.mockResolvedValue({
        id: "pack1",
        repoId: "repo1",
        objective: "test objective",
        queryMode: "basic",
        files: ["file1.ts"],
        symbols: ["MyClass"],
        tests: ["test1.test.ts"],
        docs: ["README.md"],
        rules: [],
        priorRuns: [],
        confidence: 0.5,
        why: [],
        tokenBudget: 1800,
        retrievalTraceId: "trace1",
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.buildContextPack({
        repoId: "repo1",
        objective: "test objective",
      });

      expect(mockShaper).toHaveBeenCalled();
      expect(mockShaper).toHaveBeenCalledWith(
        expect.objectContaining({
          objective: "test objective",
          candidateFiles: expect.any(Array),
          candidateTests: expect.any(Array),
          candidateDocs: expect.any(Array),
          candidateSymbols: expect.any(Array),
        })
      );
    });

    it("falls back to deterministic selection when shaper throws", async () => {
      const mockShaper = vi.fn().mockRejectedValue(new Error("Shaper error"));

      service.setContextShaper(mockShaper);

      // Setup minimal mock data
      mockPrisma.repoRegistry.findUnique.mockResolvedValue({
        id: "repo1",
        managedWorktreeRoot: "/test/repo",
        metadata: {},
        updatedAt: new Date(),
      });
      mockPrisma.codeGraphNode.count.mockResolvedValue(1);
      mockPrisma.codeGraphNode.findMany.mockResolvedValue([
        {
          id: "node1",
          repoId: "repo1",
          kind: "file",
          path: "src/index.ts",
          name: "index.ts",
          language: "typescript",
          content: "export function test() {}",
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      mockPrisma.codeGraphEdge.findMany.mockResolvedValue([]);
      mockPrisma.repoGuidelineProfile.findUnique.mockResolvedValue(null);
      mockPrisma.benchmarkRun.findMany.mockResolvedValue([]);
      mockPrisma.executionAttempt.findMany.mockResolvedValue([]);
      mockPrisma.retrievalTrace.create.mockResolvedValue({
        id: "trace1",
        repoId: "repo1",
        aggregateId: "repo:repo1",
        query: "test objective",
        retrievalIds: [],
        results: [],
        metadata: {},
        createdAt: new Date(),
      });
      mockPrisma.contextPack.create.mockResolvedValue({
        id: "pack1",
        repoId: "repo1",
        objective: "test objective",
        queryMode: "basic",
        files: ["src/index.ts"],
        symbols: [],
        tests: [],
        docs: [],
        rules: [],
        priorRuns: [],
        confidence: 0.5,
        why: [],
        tokenBudget: 1800,
        retrievalTraceId: "trace1",
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.buildContextPack({
        repoId: "repo1",
        objective: "test objective",
      });

      // Should not throw, should use deterministic selection
      expect(result.pack).toBeDefined();
      expect(mockShaper).toHaveBeenCalled();
    });

    it("falls back when shaper returns empty results", async () => {
      const mockShaper = vi.fn().mockResolvedValue({
        files: [],
        tests: [],
        docs: [],
        symbols: [],
      });

      service.setContextShaper(mockShaper);

      mockPrisma.repoRegistry.findUnique.mockResolvedValue({
        id: "repo1",
        managedWorktreeRoot: "/test/repo",
        metadata: {},
        updatedAt: new Date(),
      });
      mockPrisma.codeGraphNode.count.mockResolvedValue(1);
      mockPrisma.codeGraphNode.findMany.mockResolvedValue([
        {
          id: "node1",
          repoId: "repo1",
          kind: "file",
          path: "src/index.ts",
          name: "index.ts",
          language: "typescript",
          content: "export function test() {}",
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      mockPrisma.codeGraphEdge.findMany.mockResolvedValue([]);
      mockPrisma.repoGuidelineProfile.findUnique.mockResolvedValue(null);
      mockPrisma.benchmarkRun.findMany.mockResolvedValue([]);
      mockPrisma.executionAttempt.findMany.mockResolvedValue([]);
      mockPrisma.retrievalTrace.create.mockResolvedValue({
        id: "trace1",
        repoId: "repo1",
        aggregateId: "repo:repo1",
        query: "test objective",
        retrievalIds: [],
        results: [],
        metadata: {},
        createdAt: new Date(),
      });
      mockPrisma.contextPack.create.mockResolvedValue({
        id: "pack1",
        repoId: "repo1",
        objective: "test objective",
        queryMode: "basic",
        files: ["src/index.ts"],
        symbols: [],
        tests: [],
        docs: [],
        rules: [],
        priorRuns: [],
        confidence: 0.5,
        why: [],
        tokenBudget: 1800,
        retrievalTraceId: "trace1",
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.buildContextPack({
        repoId: "repo1",
        objective: "test objective",
      });

      // Should use deterministic fallback
      expect(result.pack.files).toEqual(["src/index.ts"]);
    });
  });

  describe("buildContextPack", () => {
    beforeEach(() => {
      mockPrisma.repoRegistry.findUnique.mockResolvedValue({
        id: "repo1",
        managedWorktreeRoot: "/test/repo",
        metadata: {},
        updatedAt: new Date(),
      });
      mockPrisma.repoGuidelineProfile.findUnique.mockResolvedValue(null);
      mockPrisma.benchmarkRun.findMany.mockResolvedValue([]);
      mockPrisma.executionAttempt.findMany.mockResolvedValue([]);
      mockPrisma.retrievalTrace.create.mockResolvedValue({
        id: "trace1",
        repoId: "repo1",
        aggregateId: "repo:repo1",
        query: "test",
        retrievalIds: [],
        results: [],
        metadata: {},
        createdAt: new Date(),
      });
    });

    it("builds graph structure with files, symbols, and edges", async () => {
      const mockNodes = [
        {
          id: "file1",
          repoId: "repo1",
          kind: "file",
          path: "src/utils.ts",
          name: "utils.ts",
          language: "typescript",
          content: "export function helper() {}",
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "symbol1",
          repoId: "repo1",
          kind: "symbol",
          path: "src/utils.ts",
          name: "helper",
          language: "typescript",
          content: "export function helper() {}",
          metadata: { defined_in: "src/utils.ts" },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const mockEdges = [
        {
          id: "edge1",
          repoId: "repo1",
          fromNodeId: "file1",
          toNodeId: "symbol1",
          kind: "defines",
          weight: 1,
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockPrisma.codeGraphNode.count.mockResolvedValue(2);
      mockPrisma.codeGraphNode.findMany.mockResolvedValue(mockNodes);
      mockPrisma.codeGraphEdge.findMany.mockResolvedValue(mockEdges);
      mockPrisma.codeGraphEdge.count.mockResolvedValue(1);
      mockPrisma.contextPack.create.mockResolvedValue({
        id: "pack1",
        repoId: "repo1",
        objective: "test helper",
        queryMode: "basic",
        files: ["src/utils.ts"],
        symbols: ["helper"],
        tests: [],
        docs: [],
        rules: [],
        priorRuns: [],
        confidence: 0.5,
        why: [],
        tokenBudget: 1800,
        retrievalTraceId: "trace1",
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.buildContextPack({
        repoId: "repo1",
        objective: "test helper",
      });

      expect(result.graph.nodes).toHaveLength(2);
      expect(result.graph.edges).toHaveLength(1);
      expect(result.pack.files).toContain("src/utils.ts");
      expect(result.pack.symbols).toContain("helper");
    });

    it("ranks nodes by token match and mode", async () => {
      const mockNodes = [
        {
          id: "test1",
          repoId: "repo1",
          kind: "test",
          path: "tests/auth.test.ts",
          name: "auth.test.ts",
          language: "typescript",
          content: "test('auth works', () => {})",
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "file1",
          repoId: "repo1",
          kind: "file",
          path: "src/auth.ts",
          name: "auth.ts",
          language: "typescript",
          content: "export function authenticate() {}",
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "doc1",
          repoId: "repo1",
          kind: "doc",
          path: "docs/auth.md",
          name: "auth.md",
          language: "markdown",
          content: "# Authentication Guide",
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockPrisma.codeGraphNode.count.mockResolvedValue(3);
      mockPrisma.codeGraphNode.findMany.mockResolvedValue(mockNodes);
      mockPrisma.codeGraphEdge.findMany.mockResolvedValue([]);
      mockPrisma.contextPack.create.mockResolvedValue({
        id: "pack1",
        repoId: "repo1",
        objective: "auth",
        queryMode: "impact",
        files: ["src/auth.ts"],
        symbols: [],
        tests: ["tests/auth.test.ts"],
        docs: ["docs/auth.md"],
        rules: [],
        priorRuns: [],
        confidence: 0.5,
        why: [],
        tokenBudget: 1800,
        retrievalTraceId: "trace1",
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.buildContextPack({
        repoId: "repo1",
        objective: "auth",
        queryMode: "impact",
      });

      // Impact mode should boost test nodes
      expect(result.pack.tests).toContain("tests/auth.test.ts");
      expect(result.pack.files).toContain("src/auth.ts");
      expect(result.pack.docs).toContain("docs/auth.md");
    });

    it("handles empty graph gracefully", async () => {
      mockPrisma.codeGraphNode.count.mockResolvedValue(0);
      mockPrisma.codeGraphNode.findMany.mockResolvedValue([]);
      mockPrisma.codeGraphEdge.findMany.mockResolvedValue([]);

      // Mock indexRepo to do nothing (prevent real FS operations)
      const originalIndexRepo = service.indexRepo;
      service.indexRepo = vi.fn().mockResolvedValue({
        repoId: "repo1",
        status: "ready" as const,
        nodeCount: 0,
        edgeCount: 0,
        fileCount: 0,
      });

      mockPrisma.contextPack.create.mockResolvedValue({
        id: "pack1",
        repoId: "repo1",
        objective: "test",
        queryMode: "basic",
        files: [],
        symbols: [],
        tests: [],
        docs: [],
        rules: [],
        priorRuns: [],
        confidence: 0.25,
        why: [],
        tokenBudget: 1800,
        retrievalTraceId: "trace1",
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.buildContextPack({
        repoId: "repo1",
        objective: "test",
      });

      expect(result.pack.files).toEqual([]);
      expect(result.pack.confidence).toBe(0.25);
      expect(result.graph.nodes).toEqual([]);
      expect(result.graph.edges).toEqual([]);

      service.indexRepo = originalIndexRepo;
    });

    it("throws when repo not found", async () => {
      mockPrisma.repoRegistry.findUnique.mockResolvedValue(null);

      await expect(
        service.buildContextPack({
          repoId: "nonexistent",
          objective: "test",
        })
      ).rejects.toThrow("Repo not found: nonexistent");
    });
  });

  describe("rerankForManifest", () => {
    it("boosts graph-connected files for manifest targets", async () => {
      const contextPack: ContextPack = {
        id: "pack1",
        repoId: "repo1",
        objective: "test",
        queryMode: "basic",
        files: ["src/other.ts", "src/utils.ts"],
        symbols: [],
        tests: ["tests/other.test.ts"],
        docs: ["docs/other.md"],
        rules: [],
        priorRuns: [],
        confidence: 0.5,
        why: [],
        tokenBudget: 1800,
        retrievalTraceId: "trace1",
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const manifestFiles = [{ path: "src/main.ts", action: "modify" }];

      mockPrisma.codeGraphNode.findMany
        .mockResolvedValueOnce([
          {
            id: "target1",
            repoId: "repo1",
            kind: "file",
            path: "src/main.ts",
            name: "main.ts",
            language: "typescript",
            content: "",
            metadata: {},
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ])
        .mockResolvedValueOnce([
          {
            id: "neighbor1",
            path: "src/utils.ts",
            kind: "file",
            language: "typescript",
            metadata: {},
          },
          {
            id: "neighbor2",
            path: "tests/main.test.ts",
            kind: "test",
            language: "typescript",
            metadata: {},
          },
          {
            id: "neighbor3",
            path: "docs/main.md",
            kind: "doc",
            language: "markdown",
            metadata: {},
          },
        ]);

      mockPrisma.codeGraphEdge.findMany.mockResolvedValue([
        {
          id: "edge1",
          repoId: "repo1",
          fromNodeId: "target1",
          toNodeId: "neighbor1",
          kind: "imports",
          weight: 1,
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "edge2",
          repoId: "repo1",
          fromNodeId: "neighbor2",
          toNodeId: "target1",
          kind: "covers_test",
          weight: 1,
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "edge3",
          repoId: "repo1",
          fromNodeId: "neighbor3",
          toNodeId: "target1",
          kind: "documents",
          weight: 0.5,
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const reranked = await service.rerankForManifest(
        "repo1",
        contextPack,
        manifestFiles
      );

      // src/utils.ts should be boosted to front (it was second, now first)
      expect(reranked.files[0]).toBe("src/utils.ts");
      expect(reranked.files).toContain("src/other.ts");

      // tests/main.test.ts should be added and boosted
      expect(reranked.tests[0]).toBe("tests/main.test.ts");

      // docs/main.md should be added and boosted
      expect(reranked.docs[0]).toBe("docs/main.md");
    });

    it("handles missing target nodes gracefully", async () => {
      const contextPack: ContextPack = {
        id: "pack1",
        repoId: "repo1",
        objective: "test",
        queryMode: "basic",
        files: ["src/other.ts"],
        symbols: [],
        tests: [],
        docs: [],
        rules: [],
        priorRuns: [],
        confidence: 0.5,
        why: [],
        tokenBudget: 1800,
        retrievalTraceId: "trace1",
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      mockPrisma.codeGraphNode.findMany.mockResolvedValue([]);

      const result = await service.rerankForManifest(
        "repo1",
        contextPack,
        [{ path: "nonexistent.ts", action: "create" }]
      );

      // Should return original pack unchanged
      expect(result).toEqual(contextPack);
    });

    it("preserves original order for boosted files", async () => {
      const contextPack: ContextPack = {
        id: "pack1",
        repoId: "repo1",
        objective: "test",
        queryMode: "basic",
        files: ["zebra.ts", "alpha.ts", "beta.ts"],
        symbols: [],
        tests: [],
        docs: [],
        rules: [],
        priorRuns: [],
        confidence: 0.5,
        why: [],
        tokenBudget: 1800,
        retrievalTraceId: "trace1",
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const manifestFiles = [{ path: "src/main.ts", action: "modify" }];

      mockPrisma.codeGraphNode.findMany
        .mockResolvedValueOnce([
          {
            id: "target1",
            repoId: "repo1",
            kind: "file",
            path: "src/main.ts",
            name: "main.ts",
            language: "typescript",
            content: "",
            metadata: {},
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ])
        .mockResolvedValueOnce([
          {
            id: "n1",
            path: "zebra.ts",
            kind: "file",
            language: "typescript",
            metadata: {},
          },
          {
            id: "n2",
            path: "alpha.ts",
            kind: "file",
            language: "typescript",
            metadata: {},
          },
          {
            id: "n3",
            path: "beta.ts",
            kind: "file",
            language: "typescript",
            metadata: {},
          },
        ]);

      mockPrisma.codeGraphEdge.findMany.mockResolvedValue([
        {
          id: "e1",
          repoId: "repo1",
          fromNodeId: "target1",
          toNodeId: "n1",
          kind: "imports",
          weight: 1,
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "e2",
          repoId: "repo1",
          fromNodeId: "target1",
          toNodeId: "n2",
          kind: "imports",
          weight: 1,
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "e3",
          repoId: "repo1",
          fromNodeId: "target1",
          toNodeId: "n3",
          kind: "imports",
          weight: 1,
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const result = await service.rerankForManifest(
        "repo1",
        contextPack,
        manifestFiles
      );

      // All three files are related and should be in front, preserving original order
      expect(result.files.slice(0, 3)).toEqual([
        "zebra.ts",
        "alpha.ts",
        "beta.ts",
      ]);
    });

    it("adds new related files not in original pack", async () => {
      const contextPack: ContextPack = {
        id: "pack1",
        repoId: "repo1",
        objective: "test",
        queryMode: "basic",
        files: ["existing.ts"],
        symbols: [],
        tests: [],
        docs: [],
        rules: [],
        priorRuns: [],
        confidence: 0.5,
        why: [],
        tokenBudget: 1800,
        retrievalTraceId: "trace1",
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      mockPrisma.codeGraphNode.findMany
        .mockResolvedValueOnce([
          {
            id: "target1",
            repoId: "repo1",
            kind: "file",
            path: "src/main.ts",
            name: "main.ts",
            language: "typescript",
            content: "",
            metadata: {},
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ])
        .mockResolvedValueOnce([
          {
            id: "new1",
            path: "src/helper.ts",
            kind: "file",
            language: "typescript",
            metadata: {},
          },
        ]);

      mockPrisma.codeGraphEdge.findMany.mockResolvedValue([
        {
          id: "edge1",
          repoId: "repo1",
          fromNodeId: "target1",
          toNodeId: "new1",
          kind: "imports",
          weight: 1,
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const result = await service.rerankForManifest(
        "repo1",
        contextPack,
        [{ path: "src/main.ts", action: "modify" }]
      );

      // New file should be added at front
      expect(result.files[0]).toBe("src/helper.ts");
      expect(result.files).toContain("existing.ts");
    });

    it("respects max file limits", async () => {
      const contextPack: ContextPack = {
        id: "pack1",
        repoId: "repo1",
        objective: "test",
        queryMode: "basic",
        files: Array.from({ length: 12 }, (_, i) => `file${i}.ts`),
        symbols: [],
        tests: [],
        docs: [],
        rules: [],
        priorRuns: [],
        confidence: 0.5,
        why: [],
        tokenBudget: 1800,
        retrievalTraceId: "trace1",
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      mockPrisma.codeGraphNode.findMany
        .mockResolvedValueOnce([
          {
            id: "target1",
            repoId: "repo1",
            kind: "file",
            path: "src/main.ts",
            name: "main.ts",
            language: "typescript",
            content: "",
            metadata: {},
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ])
        .mockResolvedValueOnce([
          {
            id: "new1",
            path: "file0.ts",
            kind: "file",
            language: "typescript",
            metadata: {},
          },
        ]);

      mockPrisma.codeGraphEdge.findMany.mockResolvedValue([
        {
          id: "edge1",
          repoId: "repo1",
          fromNodeId: "target1",
          toNodeId: "new1",
          kind: "imports",
          weight: 1,
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const result = await service.rerankForManifest(
        "repo1",
        contextPack,
        [{ path: "src/main.ts", action: "modify" }]
      );

      // Should respect max of 10 files
      expect(result.files.length).toBeLessThanOrEqual(10);
    });
  });

  describe("edge cases", () => {
    it("handles circular imports in graph", async () => {
      const mockNodes = [
        {
          id: "a",
          repoId: "repo1",
          kind: "file",
          path: "a.ts",
          name: "a.ts",
          language: "typescript",
          content: "import { b } from './b'",
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "b",
          repoId: "repo1",
          kind: "file",
          path: "b.ts",
          name: "b.ts",
          language: "typescript",
          content: "import { a } from './a'",
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const mockEdges = [
        {
          id: "e1",
          repoId: "repo1",
          fromNodeId: "a",
          toNodeId: "b",
          kind: "imports",
          weight: 1,
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "e2",
          repoId: "repo1",
          fromNodeId: "b",
          toNodeId: "a",
          kind: "imports",
          weight: 1,
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockPrisma.repoRegistry.findUnique.mockResolvedValue({
        id: "repo1",
        managedWorktreeRoot: "/test/repo",
        metadata: {},
        updatedAt: new Date(),
      });
      mockPrisma.codeGraphNode.count.mockResolvedValue(2);
      mockPrisma.codeGraphNode.findMany.mockResolvedValue(mockNodes);
      mockPrisma.codeGraphEdge.findMany.mockResolvedValue(mockEdges);
      mockPrisma.repoGuidelineProfile.findUnique.mockResolvedValue(null);
      mockPrisma.benchmarkRun.findMany.mockResolvedValue([]);
      mockPrisma.executionAttempt.findMany.mockResolvedValue([]);
      mockPrisma.retrievalTrace.create.mockResolvedValue({
        id: "trace1",
        repoId: "repo1",
        aggregateId: "repo:repo1",
        query: "circular",
        retrievalIds: [],
        results: [],
        metadata: {},
        createdAt: new Date(),
      });
      mockPrisma.contextPack.create.mockResolvedValue({
        id: "pack1",
        repoId: "repo1",
        objective: "circular",
        queryMode: "basic",
        files: ["a.ts", "b.ts"],
        symbols: [],
        tests: [],
        docs: [],
        rules: [],
        priorRuns: [],
        confidence: 0.5,
        why: [],
        tokenBudget: 1800,
        retrievalTraceId: "trace1",
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.buildContextPack({
        repoId: "repo1",
        objective: "circular",
      });

      // Should handle circular references without infinite loops
      expect(result.graph.edges).toHaveLength(2);
      expect(result.pack.files).toContain("a.ts");
      expect(result.pack.files).toContain("b.ts");
    });

    it("handles empty candidate lists in rerankForManifest", async () => {
      const contextPack: ContextPack = {
        id: "pack1",
        repoId: "repo1",
        objective: "test",
        queryMode: "basic",
        files: [],
        symbols: [],
        tests: [],
        docs: [],
        rules: [],
        priorRuns: [],
        confidence: 0.5,
        why: [],
        tokenBudget: 1800,
        retrievalTraceId: "trace1",
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      mockPrisma.codeGraphNode.findMany.mockResolvedValue([]);

      const result = await service.rerankForManifest(
        "repo1",
        contextPack,
        [{ path: "src/main.ts", action: "create" }]
      );

      expect(result.files).toEqual([]);
      expect(result.tests).toEqual([]);
      expect(result.docs).toEqual([]);
    });

    it("handles empty manifest file list", async () => {
      const contextPack: ContextPack = {
        id: "pack1",
        repoId: "repo1",
        objective: "test",
        queryMode: "basic",
        files: ["src/file.ts"],
        symbols: [],
        tests: [],
        docs: [],
        rules: [],
        priorRuns: [],
        confidence: 0.5,
        why: [],
        tokenBudget: 1800,
        retrievalTraceId: "trace1",
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = await service.rerankForManifest("repo1", contextPack, []);

      // Should return original pack unchanged
      expect(result).toEqual(contextPack);
    });
  });

  describe("getStatus", () => {
    it("returns status for indexed repo", async () => {
      mockPrisma.repoRegistry.findUnique.mockResolvedValue({
        id: "repo1",
        metadata: {
          code_graph_status: "ready",
          code_graph_updated_at: "2026-03-31T10:00:00.000Z",
        },
        updatedAt: new Date(),
      });
      mockPrisma.codeGraphNode.count.mockResolvedValue(100);
      mockPrisma.codeGraphEdge.count.mockResolvedValue(50);

      const status = await service.getStatus("repo1");

      expect(status).toEqual({
        repoId: "repo1",
        status: "ready",
        nodeCount: 100,
        edgeCount: 50,
        updatedAt: "2026-03-31T10:00:00.000Z",
      });
    });

    it("returns null for missing repo", async () => {
      mockPrisma.repoRegistry.findUnique.mockResolvedValue(null);

      const status = await service.getStatus("nonexistent");

      expect(status).toBeNull();
    });

    it("infers ready status when metadata missing but nodes exist", async () => {
      mockPrisma.repoRegistry.findUnique.mockResolvedValue({
        id: "repo1",
        metadata: {},
        updatedAt: new Date("2026-03-31T10:00:00.000Z"),
      });
      mockPrisma.codeGraphNode.count.mockResolvedValue(50);
      mockPrisma.codeGraphEdge.count.mockResolvedValue(25);

      const status = await service.getStatus("repo1");

      expect(status?.status).toBe("ready");
      expect(status?.nodeCount).toBe(50);
    });

    it("returns not_indexed when no nodes exist", async () => {
      mockPrisma.repoRegistry.findUnique.mockResolvedValue({
        id: "repo1",
        metadata: {},
        updatedAt: new Date("2026-03-31T10:00:00.000Z"),
      });
      mockPrisma.codeGraphNode.count.mockResolvedValue(0);
      mockPrisma.codeGraphEdge.count.mockResolvedValue(0);

      const status = await service.getStatus("repo1");

      expect(status?.status).toBe("not_indexed");
      expect(status?.nodeCount).toBe(0);
    });
  });

  describe("getLatestContextPack", () => {
    it("returns mapped context pack when one exists", async () => {
      const now = new Date();
      mockPrisma.contextPack.findFirst.mockResolvedValue({
        id: "pack1",
        repoId: "repo1",
        objective: "test objective",
        queryMode: "basic",
        files: ["src/a.ts"],
        symbols: ["Foo"],
        tests: ["a.test.ts"],
        docs: ["README.md"],
        rules: ["rule1"],
        priorRuns: ["run1"],
        confidence: 0.8,
        why: ["reason1"],
        tokenBudget: 2000,
        retrievalTraceId: "trace1",
        metadata: { key: "val" },
        createdAt: now,
        updatedAt: now,
      });

      const result = await service.getLatestContextPack("repo1");

      expect(result).not.toBeNull();
      expect(result!.id).toBe("pack1");
      expect(result!.files).toEqual(["src/a.ts"]);
      expect(result!.symbols).toEqual(["Foo"]);
      expect(result!.createdAt).toBe(now.toISOString());
    });

    it("returns null when no context pack exists", async () => {
      mockPrisma.contextPack.findFirst.mockResolvedValue(null);

      const result = await service.getLatestContextPack("repo1");

      expect(result).toBeNull();
    });
  });

  describe("getExecutionAttempts", () => {
    it("returns mapped execution attempts", async () => {
      const now = new Date();
      mockPrisma.executionAttempt.findMany.mockResolvedValue([
        {
          id: "attempt1",
          runId: "run1",
          repoId: "repo1",
          projectId: "proj1",
          modelRole: "coder_default",
          providerId: "qwen-cli",
          status: "completed",
          objective: "do stuff",
          patchSummary: "fixed it",
          changedFiles: ["a.ts", "b.ts"],
          approvalRequired: false,
          contextPackId: "pack1",
          routingDecisionId: null,
          startedAt: now,
          completedAt: now,
          updatedAt: now,
          metadata: { key: "val" },
        },
      ]);

      const result = await service.getExecutionAttempts("run1");

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("attempt1");
      expect(result[0].changedFiles).toEqual(["a.ts", "b.ts"]);
      expect(result[0].startedAt).toBe(now.toISOString());
      expect(result[0].completedAt).toBe(now.toISOString());
    });

    it("returns empty array when no attempts found", async () => {
      mockPrisma.executionAttempt.findMany.mockResolvedValue([]);

      const result = await service.getExecutionAttempts("run-none");

      expect(result).toEqual([]);
    });

    it("handles null completedAt", async () => {
      const now = new Date();
      mockPrisma.executionAttempt.findMany.mockResolvedValue([
        {
          id: "attempt2",
          runId: "run2",
          repoId: "repo1",
          projectId: "proj1",
          modelRole: "coder_default",
          providerId: "qwen-cli",
          status: "running",
          objective: "still working",
          patchSummary: null,
          changedFiles: [],
          approvalRequired: false,
          contextPackId: null,
          routingDecisionId: null,
          startedAt: now,
          completedAt: null,
          updatedAt: now,
          metadata: null,
        },
      ]);

      const result = await service.getExecutionAttempts("run2");

      expect(result[0].completedAt).toBeNull();
      expect(result[0].metadata).toEqual({});
    });
  });

  describe("getVerificationBundle", () => {
    it("returns mapped verification bundle", async () => {
      const now = new Date();
      mockPrisma.verificationBundle.findFirst.mockResolvedValue({
        id: "vb1",
        runId: "run1",
        repoId: "repo1",
        executionAttemptId: "attempt1",
        changedFileChecks: ["a.ts"],
        impactedTests: ["a.test.ts"],
        fullSuiteRun: true,
        docsChecked: ["README.md"],
        pass: true,
        failures: [],
        artifacts: ["output.log"],
        createdAt: now,
        updatedAt: now,
        metadata: { key: "val" },
      });

      const result = await service.getVerificationBundle("run1");

      expect(result).not.toBeNull();
      expect(result!.id).toBe("vb1");
      expect(result!.pass).toBe(true);
      expect(result!.changedFileChecks).toEqual(["a.ts"]);
      expect(result!.artifacts).toEqual(["output.log"]);
      expect(result!.createdAt).toBe(now.toISOString());
    });

    it("returns null when no verification bundle exists", async () => {
      mockPrisma.verificationBundle.findFirst.mockResolvedValue(null);

      const result = await service.getVerificationBundle("run-none");

      expect(result).toBeNull();
    });
  });

  describe("indexRepo", () => {
    it("indexes files with BFS fallback when ripgrep is unavailable", async () => {
      const fs = await import("node:fs");
      const mockedFs = vi.mocked(fs.default);

      // Mock the ripgrep module to disable rg
      const ripgrep = await import("./ripgrep");
      vi.mocked(ripgrep.getRipgrepPath).mockReturnValue(null);

      // Setup fs mocks: root dir has one ts file and one subdir
      mockedFs.readdirSync
        .mockReturnValueOnce([
          { name: "index.ts", isDirectory: () => false, isFile: () => true } as any,
          { name: "sub", isDirectory: () => true, isFile: () => false } as any,
          { name: "node_modules", isDirectory: () => true, isFile: () => false } as any,
        ])
        .mockReturnValueOnce([
          { name: "helper.ts", isDirectory: () => false, isFile: () => true } as any,
        ]);

      mockedFs.readFileSync.mockReturnValue(Buffer.from("export function myFunc() {}"));

      mockPrisma.repoRegistry.findUnique.mockResolvedValue({
        id: "repo1",
        managedWorktreeRoot: "/test/repo",
        metadata: {},
        updatedAt: new Date(),
      });
      mockPrisma.codeGraphEdge.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.codeGraphNode.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.repoGuidelineProfile.findUnique.mockResolvedValue(null);
      mockPrisma.codeGraphNode.createMany.mockResolvedValue({ count: 2 });
      mockPrisma.codeGraphEdge.createMany.mockResolvedValue({ count: 0 });
      mockPrisma.repoRegistry.update.mockResolvedValue({} as any);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      const result = await service.indexRepo("repo1", "/test/repo");

      expect(result.status).toBe("ready");
      expect(result.repoId).toBe("repo1");
      // Should have created nodes (2 files + symbols)
      expect(result.nodeCount).toBeGreaterThanOrEqual(2);
    });

    it("indexes with command nodes from guideline profile", async () => {
      const fs = await import("node:fs");
      const mockedFs = vi.mocked(fs.default);

      const ripgrep = await import("./ripgrep");
      vi.mocked(ripgrep.getRipgrepPath).mockReturnValue(null);

      mockedFs.readdirSync.mockReturnValueOnce([
        { name: "main.py", isDirectory: () => false, isFile: () => true } as any,
      ]);
      mockedFs.readFileSync.mockReturnValue(Buffer.from("def hello():\n    pass\nclass World:\n    pass"));

      mockPrisma.repoRegistry.findUnique.mockResolvedValue({
        id: "repo1",
        managedWorktreeRoot: "/test/repo",
        metadata: {},
        updatedAt: new Date(),
      });
      mockPrisma.codeGraphEdge.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.codeGraphNode.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.repoGuidelineProfile.findUnique.mockResolvedValue({
        repoId: "repo1",
        testCommands: ["pytest"],
        buildCommands: ["make build"],
        lintCommands: ["flake8"],
        patchRules: [],
        docRules: [],
        requiredArtifacts: [],
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);
      mockPrisma.codeGraphNode.createMany.mockResolvedValue({ count: 5 });
      mockPrisma.codeGraphEdge.createMany.mockResolvedValue({ count: 0 });
      mockPrisma.repoRegistry.update.mockResolvedValue({} as any);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      const result = await service.indexRepo("repo1", "/test/repo");

      expect(result.status).toBe("ready");
      // 1 file + 2 symbols (hello, World) + 3 commands = 6 nodes
      expect(result.nodeCount).toBe(6);
    });

    it("handles binary files by returning empty content", async () => {
      const fs = await import("node:fs");
      const mockedFs = vi.mocked(fs.default);

      const ripgrep = await import("./ripgrep");
      vi.mocked(ripgrep.getRipgrepPath).mockReturnValue(null);

      mockedFs.readdirSync.mockReturnValueOnce([
        { name: "image.png", isDirectory: () => false, isFile: () => true } as any,
      ]);
      // Simulate binary file with null byte
      const binaryBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a]);
      mockedFs.readFileSync.mockReturnValue(binaryBuffer);

      mockPrisma.repoRegistry.findUnique.mockResolvedValue({
        id: "repo1",
        managedWorktreeRoot: "/test/repo",
        metadata: {},
        updatedAt: new Date(),
      });
      mockPrisma.codeGraphEdge.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.codeGraphNode.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.repoGuidelineProfile.findUnique.mockResolvedValue(null);
      mockPrisma.codeGraphNode.createMany.mockResolvedValue({ count: 1 });
      mockPrisma.codeGraphEdge.createMany.mockResolvedValue({ count: 0 });
      mockPrisma.repoRegistry.update.mockResolvedValue({} as any);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      const result = await service.indexRepo("repo1", "/test/repo");

      expect(result.status).toBe("ready");
      expect(result.nodeCount).toBe(1);
    });

    it("creates test coverage edges for test files", async () => {
      const fs = await import("node:fs");
      const mockedFs = vi.mocked(fs.default);

      const ripgrep = await import("./ripgrep");
      vi.mocked(ripgrep.getRipgrepPath).mockReturnValue(null);

      mockedFs.readdirSync
        .mockReturnValueOnce([
          { name: "src", isDirectory: () => true, isFile: () => false } as any,
          { name: "tests", isDirectory: () => true, isFile: () => false } as any,
        ])
        .mockReturnValueOnce([
          { name: "utils.ts", isDirectory: () => false, isFile: () => true } as any,
        ])
        .mockReturnValueOnce([
          { name: "utils.test.ts", isDirectory: () => false, isFile: () => true } as any,
        ]);
      mockedFs.readFileSync.mockReturnValue(Buffer.from("export function helper() {}"));

      mockPrisma.repoRegistry.findUnique.mockResolvedValue({
        id: "repo1",
        managedWorktreeRoot: "/test/repo",
        metadata: {},
        updatedAt: new Date(),
      });
      mockPrisma.codeGraphEdge.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.codeGraphNode.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.repoGuidelineProfile.findUnique.mockResolvedValue(null);
      mockPrisma.codeGraphNode.createMany.mockResolvedValue({ count: 3 });
      mockPrisma.codeGraphEdge.createMany.mockResolvedValue({ count: 2 });
      mockPrisma.repoRegistry.update.mockResolvedValue({} as any);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      const result = await service.indexRepo("repo1", "/test/repo");

      expect(result.status).toBe("ready");
      expect(result.edgeCount).toBeGreaterThan(0);
    });

    it("creates documentation edges for doc files referencing symbols", async () => {
      const fs = await import("node:fs");
      const mockedFs = vi.mocked(fs.default);

      const ripgrep = await import("./ripgrep");
      vi.mocked(ripgrep.getRipgrepPath).mockReturnValue(null);

      mockedFs.readdirSync
        .mockReturnValueOnce([
          { name: "src", isDirectory: () => true, isFile: () => false } as any,
          { name: "docs", isDirectory: () => true, isFile: () => false } as any,
        ])
        .mockReturnValueOnce([
          { name: "myService.ts", isDirectory: () => false, isFile: () => true } as any,
        ])
        .mockReturnValueOnce([
          { name: "guide.md", isDirectory: () => false, isFile: () => true } as any,
        ]);

      mockedFs.readFileSync.mockImplementation((filePath: any) => {
        const fp = String(filePath);
        if (fp.includes("myService")) {
          return Buffer.from("export function myService() {}");
        }
        return Buffer.from("# Guide\nUsing myservice in your project and myService calls");
      });

      mockPrisma.repoRegistry.findUnique.mockResolvedValue({
        id: "repo1",
        managedWorktreeRoot: "/test/repo",
        metadata: {},
        updatedAt: new Date(),
      });
      mockPrisma.codeGraphEdge.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.codeGraphNode.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.repoGuidelineProfile.findUnique.mockResolvedValue(null);
      mockPrisma.codeGraphNode.createMany.mockResolvedValue({ count: 3 });
      mockPrisma.codeGraphEdge.createMany.mockResolvedValue({ count: 2 });
      mockPrisma.repoRegistry.update.mockResolvedValue({} as any);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      const result = await service.indexRepo("repo1", "/test/repo");

      expect(result.status).toBe("ready");
      // Should have doc-to-file and doc-to-symbol edges
      expect(result.edgeCount).toBeGreaterThan(0);
    });

    it("creates import edges for typescript files", async () => {
      const fs = await import("node:fs");
      const mockedFs = vi.mocked(fs.default);

      const ripgrep = await import("./ripgrep");
      vi.mocked(ripgrep.getRipgrepPath).mockReturnValue(null);

      mockedFs.readdirSync.mockReturnValueOnce([
        { name: "index.ts", isDirectory: () => false, isFile: () => true } as any,
        { name: "helper.ts", isDirectory: () => false, isFile: () => true } as any,
      ]);
      mockedFs.readFileSync.mockImplementation((filePath: any) => {
        const fp = String(filePath);
        if (fp.includes("index")) {
          return Buffer.from('import { helper } from "./helper";\nexport function main() {}');
        }
        return Buffer.from("export function helper() {}");
      });

      mockPrisma.repoRegistry.findUnique.mockResolvedValue({
        id: "repo1",
        managedWorktreeRoot: "/test/repo",
        metadata: {},
        updatedAt: new Date(),
      });
      mockPrisma.codeGraphEdge.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.codeGraphNode.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.repoGuidelineProfile.findUnique.mockResolvedValue(null);
      mockPrisma.codeGraphNode.createMany.mockResolvedValue({ count: 4 });
      mockPrisma.codeGraphEdge.createMany.mockResolvedValue({ count: 3 });
      mockPrisma.repoRegistry.update.mockResolvedValue({} as any);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      const result = await service.indexRepo("repo1", "/test/repo");

      expect(result.status).toBe("ready");
      expect(result.edgeCount).toBeGreaterThan(0);
    });

    it("handles readdir errors gracefully in BFS walk", async () => {
      const fs = await import("node:fs");
      const mockedFs = vi.mocked(fs.default);

      const ripgrep = await import("./ripgrep");
      vi.mocked(ripgrep.getRipgrepPath).mockReturnValue(null);

      mockedFs.readdirSync.mockImplementation(() => {
        throw new Error("Permission denied");
      });
      mockedFs.readFileSync.mockReturnValue(Buffer.from(""));

      mockPrisma.repoRegistry.findUnique.mockResolvedValue({
        id: "repo1",
        managedWorktreeRoot: "/test/repo",
        metadata: {},
        updatedAt: new Date(),
      });
      mockPrisma.codeGraphEdge.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.codeGraphNode.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.repoGuidelineProfile.findUnique.mockResolvedValue(null);
      mockPrisma.codeGraphNode.createMany.mockResolvedValue({ count: 0 });
      mockPrisma.repoRegistry.update.mockResolvedValue({} as any);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      const result = await service.indexRepo("repo1", "/test/repo");

      expect(result.status).toBe("ready");
      expect(result.fileCount).toBe(0);
    });

    it("indexes rust files with symbols and imports", async () => {
      const fs = await import("node:fs");
      const mockedFs = vi.mocked(fs.default);

      const ripgrep = await import("./ripgrep");
      vi.mocked(ripgrep.getRipgrepPath).mockReturnValue(null);

      mockedFs.readdirSync.mockReturnValueOnce([
        { name: "lib.rs", isDirectory: () => false, isFile: () => true } as any,
      ]);
      mockedFs.readFileSync.mockReturnValue(Buffer.from(
        "use std::io;\npub fn process() {}\npub struct Config {}\npub enum Mode {}\npub trait Handler {}"
      ));

      mockPrisma.repoRegistry.findUnique.mockResolvedValue({
        id: "repo1",
        managedWorktreeRoot: "/test/repo",
        metadata: {},
        updatedAt: new Date(),
      });
      mockPrisma.codeGraphEdge.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.codeGraphNode.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.repoGuidelineProfile.findUnique.mockResolvedValue(null);
      mockPrisma.codeGraphNode.createMany.mockResolvedValue({ count: 5 });
      mockPrisma.codeGraphEdge.createMany.mockResolvedValue({ count: 4 });
      mockPrisma.repoRegistry.update.mockResolvedValue({} as any);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      const result = await service.indexRepo("repo1", "/test/repo");

      expect(result.status).toBe("ready");
      // 1 file + 4 symbols (process, Config, Mode, Handler)
      expect(result.nodeCount).toBe(5);
    });

    it("indexes python files with symbols and imports", async () => {
      const fs = await import("node:fs");
      const mockedFs = vi.mocked(fs.default);

      const ripgrep = await import("./ripgrep");
      vi.mocked(ripgrep.getRipgrepPath).mockReturnValue(null);

      mockedFs.readdirSync.mockReturnValueOnce([
        { name: "app.py", isDirectory: () => false, isFile: () => true } as any,
      ]);
      mockedFs.readFileSync.mockReturnValue(Buffer.from(
        "from os import path\nimport json\ndef main():\n    pass\nclass App:\n    pass"
      ));

      mockPrisma.repoRegistry.findUnique.mockResolvedValue({
        id: "repo1",
        managedWorktreeRoot: "/test/repo",
        metadata: {},
        updatedAt: new Date(),
      });
      mockPrisma.codeGraphEdge.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.codeGraphNode.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.repoGuidelineProfile.findUnique.mockResolvedValue(null);
      mockPrisma.codeGraphNode.createMany.mockResolvedValue({ count: 3 });
      mockPrisma.codeGraphEdge.createMany.mockResolvedValue({ count: 2 });
      mockPrisma.repoRegistry.update.mockResolvedValue({} as any);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      const result = await service.indexRepo("repo1", "/test/repo");

      expect(result.status).toBe("ready");
      // 1 file + 2 symbols (main, App)
      expect(result.nodeCount).toBe(3);
    });

    it("detects various file types for language", async () => {
      const fs = await import("node:fs");
      const mockedFs = vi.mocked(fs.default);

      const ripgrep = await import("./ripgrep");
      vi.mocked(ripgrep.getRipgrepPath).mockReturnValue(null);

      mockedFs.readdirSync.mockReturnValueOnce([
        { name: "config.json", isDirectory: () => false, isFile: () => true } as any,
        { name: "config.yaml", isDirectory: () => false, isFile: () => true } as any,
        { name: "config.yml", isDirectory: () => false, isFile: () => true } as any,
        { name: "README.md", isDirectory: () => false, isFile: () => true } as any,
        { name: "README.mdx", isDirectory: () => false, isFile: () => true } as any,
        { name: "app.jsx", isDirectory: () => false, isFile: () => true } as any,
        { name: "app.mjs", isDirectory: () => false, isFile: () => true } as any,
        { name: "app.cjs", isDirectory: () => false, isFile: () => true } as any,
        { name: "unknown.xyz", isDirectory: () => false, isFile: () => true } as any,
      ]);
      mockedFs.readFileSync.mockReturnValue(Buffer.from("content"));

      mockPrisma.repoRegistry.findUnique.mockResolvedValue({
        id: "repo1",
        managedWorktreeRoot: "/test/repo",
        metadata: {},
        updatedAt: new Date(),
      });
      mockPrisma.codeGraphEdge.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.codeGraphNode.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.repoGuidelineProfile.findUnique.mockResolvedValue(null);
      mockPrisma.codeGraphNode.createMany.mockResolvedValue({ count: 9 });
      mockPrisma.codeGraphEdge.createMany.mockResolvedValue({ count: 0 });
      mockPrisma.repoRegistry.update.mockResolvedValue({} as any);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      const result = await service.indexRepo("repo1", "/test/repo");

      expect(result.status).toBe("ready");
      expect(result.fileCount).toBe(9);
    });

    it("handles updateRepoStatus when repo not found", async () => {
      const fs = await import("node:fs");
      const mockedFs = vi.mocked(fs.default);

      const ripgrep = await import("./ripgrep");
      vi.mocked(ripgrep.getRipgrepPath).mockReturnValue(null);

      // First call for updateRepoStatus("indexing") returns null
      mockPrisma.repoRegistry.findUnique.mockResolvedValueOnce(null);

      mockedFs.readdirSync.mockReturnValueOnce([]);
      mockPrisma.codeGraphEdge.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.codeGraphNode.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.repoGuidelineProfile.findUnique.mockResolvedValue(null);
      mockPrisma.codeGraphNode.createMany.mockResolvedValue({ count: 0 });
      // Second call for updateRepoStatus("ready") also returns null
      mockPrisma.repoRegistry.findUnique.mockResolvedValueOnce(null);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      const result = await service.indexRepo("repo1", "/test/repo");

      expect(result.status).toBe("ready");
      // update should not have been called when repo not found
      expect(mockPrisma.repoRegistry.update).not.toHaveBeenCalled();
    });

    it("indexes with ripgrep when available", async () => {
      const ripgrep = await import("./ripgrep");
      const fs = await import("node:fs");
      const mockedFs = vi.mocked(fs.default);

      vi.mocked(ripgrep.getRipgrepPath).mockReturnValue("/usr/bin/rg");
      vi.mocked(ripgrep.execRipgrep).mockResolvedValue(["/test/repo/index.ts"]);

      mockedFs.readFileSync.mockReturnValue(Buffer.from("export function main() {}"));

      mockPrisma.repoRegistry.findUnique.mockResolvedValue({
        id: "repo1",
        managedWorktreeRoot: "/test/repo",
        metadata: {},
        updatedAt: new Date(),
      });
      mockPrisma.codeGraphEdge.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.codeGraphNode.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.repoGuidelineProfile.findUnique.mockResolvedValue(null);
      mockPrisma.codeGraphNode.createMany.mockResolvedValue({ count: 2 });
      mockPrisma.codeGraphEdge.createMany.mockResolvedValue({ count: 1 });
      mockPrisma.repoRegistry.update.mockResolvedValue({} as any);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      const result = await service.indexRepo("repo1", "/test/repo");

      expect(result.status).toBe("ready");
      expect(result.fileCount).toBe(1);
    });

    it("reads file error returns empty content", async () => {
      const fs = await import("node:fs");
      const mockedFs = vi.mocked(fs.default);

      const ripgrep = await import("./ripgrep");
      vi.mocked(ripgrep.getRipgrepPath).mockReturnValue(null);

      mockedFs.readdirSync.mockReturnValueOnce([
        { name: "bad.ts", isDirectory: () => false, isFile: () => true } as any,
      ]);
      mockedFs.readFileSync.mockImplementation(() => {
        throw new Error("EACCES");
      });

      mockPrisma.repoRegistry.findUnique.mockResolvedValue({
        id: "repo1",
        managedWorktreeRoot: "/test/repo",
        metadata: {},
        updatedAt: new Date(),
      });
      mockPrisma.codeGraphEdge.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.codeGraphNode.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.repoGuidelineProfile.findUnique.mockResolvedValue(null);
      mockPrisma.codeGraphNode.createMany.mockResolvedValue({ count: 1 });
      mockPrisma.codeGraphEdge.createMany.mockResolvedValue({ count: 0 });
      mockPrisma.repoRegistry.update.mockResolvedValue({} as any);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      const result = await service.indexRepo("repo1", "/test/repo");

      expect(result.status).toBe("ready");
      expect(result.nodeCount).toBe(1);
    });
  });

  describe("buildContextPack additional paths", () => {
    beforeEach(() => {
      mockPrisma.repoRegistry.findUnique.mockResolvedValue({
        id: "repo1",
        managedWorktreeRoot: "/test/repo",
        metadata: {},
        updatedAt: new Date(),
      });
      mockPrisma.repoGuidelineProfile.findUnique.mockResolvedValue(null);
      mockPrisma.benchmarkRun.findMany.mockResolvedValue([]);
      mockPrisma.executionAttempt.findMany.mockResolvedValue([]);
      mockPrisma.retrievalTrace.create.mockResolvedValue({
        id: "trace1",
        repoId: "repo1",
        aggregateId: "repo:repo1",
        query: "test",
        retrievalIds: [],
        results: [],
        metadata: {},
        createdAt: new Date(),
      });
    });

    it("triggers auto-indexing when node count is zero", async () => {
      // First call returns 0, second call after indexing returns 1
      mockPrisma.codeGraphNode.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1);
      mockPrisma.codeGraphNode.findMany.mockResolvedValue([]);
      mockPrisma.codeGraphEdge.findMany.mockResolvedValue([]);

      const originalIndexRepo = service.indexRepo;
      service.indexRepo = vi.fn().mockResolvedValue({
        repoId: "repo1",
        status: "ready" as const,
        nodeCount: 0,
        edgeCount: 0,
        fileCount: 0,
      });

      mockPrisma.contextPack.create.mockResolvedValue({
        id: "pack1",
        repoId: "repo1",
        objective: "test",
        queryMode: "basic",
        files: [],
        symbols: [],
        tests: [],
        docs: [],
        rules: [],
        priorRuns: [],
        confidence: 0.25,
        why: [],
        tokenBudget: 1800,
        retrievalTraceId: "trace1",
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.buildContextPack({
        repoId: "repo1",
        objective: "test",
      });

      expect(service.indexRepo).toHaveBeenCalledWith("repo1", expect.any(String), "system");
      service.indexRepo = originalIndexRepo;
    });

    it("includes guidelines rules when available", async () => {
      mockPrisma.codeGraphNode.count.mockResolvedValue(1);
      mockPrisma.codeGraphNode.findMany.mockResolvedValue([]);
      mockPrisma.codeGraphEdge.findMany.mockResolvedValue([]);
      mockPrisma.repoGuidelineProfile.findUnique.mockResolvedValue({
        repoId: "repo1",
        patchRules: ["no-console", "prefer-const"],
        docRules: ["jsdoc-required"],
        requiredArtifacts: ["changelog"],
        testCommands: [],
        buildCommands: [],
        lintCommands: [],
      } as any);

      mockPrisma.contextPack.create.mockImplementation(async (args: any) => {
        return {
          id: "pack1",
          repoId: "repo1",
          ...args.data,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      });

      const result = await service.buildContextPack({
        repoId: "repo1",
        objective: "test",
      });

      // Rules should include patch + doc + required artifact rules
      const createCall = mockPrisma.contextPack.create.mock.calls[0][0] as any;
      expect(createCall.data.rules).toContain("no-console");
      expect(createCall.data.rules).toContain("jsdoc-required");
      expect(createCall.data.rules).toContain("changelog");
    });

    it("includes prior run references", async () => {
      mockPrisma.codeGraphNode.count.mockResolvedValue(1);
      mockPrisma.codeGraphNode.findMany.mockResolvedValue([]);
      mockPrisma.codeGraphEdge.findMany.mockResolvedValue([]);

      mockPrisma.benchmarkRun.findMany.mockResolvedValue([
        { id: "bench1" } as any,
      ]);
      mockPrisma.executionAttempt.findMany.mockResolvedValue([
        { id: "exec1", status: "completed" } as any,
        { id: "exec2", status: "failed" } as any,
      ]);

      mockPrisma.contextPack.create.mockImplementation(async (args: any) => {
        return {
          id: "pack1",
          repoId: "repo1",
          ...args.data,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      });

      await service.buildContextPack({
        repoId: "repo1",
        objective: "test",
      });

      const createCall = mockPrisma.contextPack.create.mock.calls[0][0] as any;
      expect(createCall.data.priorRuns).toContain("exec1");
      expect(createCall.data.priorRuns).toContain("bench1");
    });

    it("uses review mode scoring with doc and test boost", async () => {
      mockPrisma.codeGraphNode.count.mockResolvedValue(3);
      mockPrisma.codeGraphNode.findMany.mockResolvedValue([
        {
          id: "doc1",
          repoId: "repo1",
          kind: "doc",
          path: "docs/auth.md",
          name: "auth.md",
          language: "markdown",
          content: "# Auth docs",
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "test1",
          repoId: "repo1",
          kind: "test",
          path: "tests/auth.test.ts",
          name: "auth.test.ts",
          language: "typescript",
          content: "test auth",
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      mockPrisma.codeGraphEdge.findMany.mockResolvedValue([]);

      mockPrisma.contextPack.create.mockResolvedValue({
        id: "pack1",
        repoId: "repo1",
        objective: "review auth",
        queryMode: "review",
        files: [],
        symbols: [],
        tests: ["tests/auth.test.ts"],
        docs: ["docs/auth.md"],
        rules: [],
        priorRuns: [],
        confidence: 0.49,
        why: [],
        tokenBudget: 1800,
        retrievalTraceId: "trace1",
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.buildContextPack({
        repoId: "repo1",
        objective: "review auth",
        queryMode: "review",
      });

      expect(result.pack.queryMode).toBe("review");
    });

    it("uses architecture mode scoring with doc and symbol boost", async () => {
      mockPrisma.codeGraphNode.count.mockResolvedValue(2);
      mockPrisma.codeGraphNode.findMany.mockResolvedValue([
        {
          id: "sym1",
          repoId: "repo1",
          kind: "symbol",
          path: "src/main.ts",
          name: "MainService",
          language: "typescript",
          content: "export class MainService {}",
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "doc1",
          repoId: "repo1",
          kind: "doc",
          path: "docs/architecture.md",
          name: "architecture.md",
          language: "markdown",
          content: "# Architecture overview of MainService",
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      mockPrisma.codeGraphEdge.findMany.mockResolvedValue([]);

      mockPrisma.contextPack.create.mockResolvedValue({
        id: "pack1",
        repoId: "repo1",
        objective: "understand mainservice architecture",
        queryMode: "architecture",
        files: [],
        symbols: ["MainService"],
        tests: [],
        docs: ["docs/architecture.md"],
        rules: [],
        priorRuns: [],
        confidence: 0.49,
        why: [],
        tokenBudget: 1800,
        retrievalTraceId: "trace1",
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.buildContextPack({
        repoId: "repo1",
        objective: "understand mainservice architecture",
        queryMode: "architecture",
      });

      expect(result.pack.queryMode).toBe("architecture");
    });

    it("generates proper why explanations for different node types", async () => {
      mockPrisma.codeGraphNode.count.mockResolvedValue(4);
      mockPrisma.codeGraphNode.findMany.mockResolvedValue([
        {
          id: "file1",
          repoId: "repo1",
          kind: "file",
          path: "src/auth.ts",
          name: "auth.ts",
          language: "typescript",
          content: "authentication logic",
          metadata: { priority: "high" },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "test1",
          repoId: "repo1",
          kind: "test",
          path: "tests/auth.test.ts",
          name: "auth.test.ts",
          language: "typescript",
          content: "test authentication",
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "doc1",
          repoId: "repo1",
          kind: "doc",
          path: "docs/auth.md",
          name: "auth.md",
          language: "markdown",
          content: "auth documentation",
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      mockPrisma.codeGraphEdge.findMany.mockResolvedValue([]);

      mockPrisma.contextPack.create.mockImplementation(async (args: any) => {
        return {
          id: "pack1",
          ...args.data,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      });

      await service.buildContextPack({
        repoId: "repo1",
        objective: "auth",
      });

      const createCall = mockPrisma.contextPack.create.mock.calls[0][0] as any;
      const why = createCall.data.why as string[];
      expect(why.some((w: string) => w.includes("relevant file"))).toBe(true);
      expect(why.some((w: string) => w.includes("impacted test"))).toBe(true);
    });

    it("passes custom tokenBudget and aggregateId", async () => {
      mockPrisma.codeGraphNode.count.mockResolvedValue(1);
      mockPrisma.codeGraphNode.findMany.mockResolvedValue([]);
      mockPrisma.codeGraphEdge.findMany.mockResolvedValue([]);

      mockPrisma.contextPack.create.mockImplementation(async (args: any) => {
        return {
          id: "pack1",
          ...args.data,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      });

      await service.buildContextPack({
        repoId: "repo1",
        objective: "test",
        tokenBudget: 3000,
        aggregateId: "custom:agg",
      });

      const createCall = mockPrisma.contextPack.create.mock.calls[0][0] as any;
      expect(createCall.data.tokenBudget).toBe(3000);

      // aggregateId should be passed to retrievalTrace
      const traceCall = mockPrisma.retrievalTrace.create.mock.calls[0][0] as any;
      expect(traceCall.data.aggregateId).toBe("custom:agg");
    });
  });

  describe("query", () => {
    it("builds context pack with basic mode", async () => {
      mockPrisma.repoRegistry.findUnique.mockResolvedValue({
        id: "repo1",
        managedWorktreeRoot: "/test/repo",
        metadata: {},
        updatedAt: new Date(),
      });
      mockPrisma.codeGraphNode.count.mockResolvedValue(1);
      mockPrisma.codeGraphNode.findMany.mockResolvedValue([
        {
          id: "node1",
          repoId: "repo1",
          kind: "file",
          path: "src/index.ts",
          name: "index.ts",
          language: "typescript",
          content: "export function test() {}",
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      mockPrisma.codeGraphEdge.findMany.mockResolvedValue([]);
      mockPrisma.repoGuidelineProfile.findUnique.mockResolvedValue(null);
      mockPrisma.benchmarkRun.findMany.mockResolvedValue([]);
      mockPrisma.executionAttempt.findMany.mockResolvedValue([]);
      mockPrisma.retrievalTrace.create.mockResolvedValue({
        id: "trace1",
        repoId: "repo1",
        aggregateId: "repo:repo1",
        query: "test query",
        retrievalIds: [],
        results: [],
        metadata: {},
        createdAt: new Date(),
      });
      mockPrisma.contextPack.create.mockResolvedValue({
        id: "pack1",
        repoId: "repo1",
        objective: "test query",
        queryMode: "basic",
        files: ["src/index.ts"],
        symbols: [],
        tests: [],
        docs: [],
        rules: [],
        priorRuns: [],
        confidence: 0.5,
        why: [],
        tokenBudget: 1800,
        retrievalTraceId: "trace1",
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.query("repo1", "test query");

      expect(result.pack.objective).toBe("test query");
      expect(result.pack.queryMode).toBe("basic");
      expect(result.nodes).toHaveLength(1);
    });

    it("accepts custom query mode", async () => {
      mockPrisma.repoRegistry.findUnique.mockResolvedValue({
        id: "repo1",
        managedWorktreeRoot: "/test/repo",
        metadata: {},
        updatedAt: new Date(),
      });
      mockPrisma.codeGraphNode.count.mockResolvedValue(1);
      mockPrisma.codeGraphNode.findMany.mockResolvedValue([]);
      mockPrisma.codeGraphEdge.findMany.mockResolvedValue([]);
      mockPrisma.repoGuidelineProfile.findUnique.mockResolvedValue(null);
      mockPrisma.benchmarkRun.findMany.mockResolvedValue([]);
      mockPrisma.executionAttempt.findMany.mockResolvedValue([]);
      mockPrisma.retrievalTrace.create.mockResolvedValue({
        id: "trace1",
        repoId: "repo1",
        aggregateId: "repo:repo1",
        query: "test",
        retrievalIds: [],
        results: [],
        metadata: {},
        createdAt: new Date(),
      });
      mockPrisma.contextPack.create.mockResolvedValue({
        id: "pack1",
        repoId: "repo1",
        objective: "test",
        queryMode: "architecture",
        files: [],
        symbols: [],
        tests: [],
        docs: [],
        rules: [],
        priorRuns: [],
        confidence: 0.25,
        why: [],
        tokenBudget: 1800,
        retrievalTraceId: "trace1",
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.query("repo1", "test", "architecture");

      expect(result.pack.queryMode).toBe("architecture");
    });
  });
});
