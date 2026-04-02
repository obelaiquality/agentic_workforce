import { describe, it, expect, vi, beforeEach } from "vitest";
import { MergeService } from "./mergeService";

const mockPrisma = vi.hoisted(() => ({
  mergeReport: {
    upsert: vi.fn(),
    findUnique: vi.fn(),
  },
}));

vi.mock("../db", () => ({
  prisma: mockPrisma,
}));

vi.mock("../eventBus", () => ({
  publishEvent: vi.fn(),
}));

const mockEvents = {
  appendEvent: vi.fn(),
};

describe("MergeService", () => {
  let service: MergeService;

  beforeEach(() => {
    vi.clearAllMocks();
    // @ts-expect-error - mock types
    service = new MergeService(mockEvents);
  });

  describe("prepareMerge", () => {
    it("creates merge report with fast_path outcome when overlap is low and no conflicts", async () => {
      const mockReport = {
        id: "report-1",
        repoId: "repo-1",
        runId: "run-1",
        changedFiles: ["src/file1.ts"],
        overlapScore: 0.05,
        semanticConflicts: [],
        requiredChecks: ["lint_changed", "tests_impacted"],
        outcome: "fast_path",
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.mergeReport.upsert.mockResolvedValue(mockReport);

      const result = await service.prepareMerge({
        actor: "user-1",
        repo_id: "repo-1",
        run_id: "run-1",
        changed_files: ["src/file1.ts"],
      });

      expect(result.outcome).toBe("fast_path");
      expect(result.overlapScore).toBe(0.05);
      expect(result.semanticConflicts).toEqual([]);
      expect(mockEvents.appendEvent).toHaveBeenCalledWith({
        type: "merge.prepared",
        aggregateId: "run-1",
        actor: "user-1",
        payload: expect.objectContaining({
          outcome: "fast_path",
        }),
      });
    });

    it("requires integrator when semantic conflicts exist", async () => {
      const mockReport = {
        id: "report-2",
        repoId: "repo-1",
        runId: "run-2",
        changedFiles: ["src/file1.ts", "src/file2.ts"],
        overlapScore: 0.12,
        semanticConflicts: ["src/shared.ts"],
        requiredChecks: ["lint_changed", "tests_impacted"],
        outcome: "integrator_required",
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.mergeReport.upsert.mockResolvedValue(mockReport);

      const result = await service.prepareMerge({
        actor: "user-1",
        repo_id: "repo-1",
        run_id: "run-2",
        changed_files: ["src/file1.ts", "src/file2.ts"],
        semantic_conflicts: ["src/shared.ts"],
      });

      expect(result.outcome).toBe("integrator_required");
      expect(result.semanticConflicts).toEqual(["src/shared.ts"]);
      expect(mockEvents.appendEvent).toHaveBeenCalledWith({
        type: "merge.conflict.detected",
        aggregateId: "run-2",
        actor: "user-1",
        payload: expect.objectContaining({
          semantic_conflicts: ["src/shared.ts"],
        }),
      });
    });

    it("requires integrator when overlap score exceeds threshold", async () => {
      const changedFiles = Array(10)
        .fill(0)
        .map((_, i) => `src/module/file${i}.ts`);

      const mockReport = {
        id: "report-3",
        repoId: "repo-1",
        runId: "run-3",
        changedFiles,
        overlapScore: 0.65,
        semanticConflicts: [],
        requiredChecks: ["lint_changed", "tests_impacted"],
        outcome: "integrator_required",
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.mergeReport.upsert.mockResolvedValue(mockReport);

      const result = await service.prepareMerge({
        actor: "user-1",
        repo_id: "repo-1",
        run_id: "run-3",
        changed_files: changedFiles,
      });

      expect(result.outcome).toBe("integrator_required");
      expect(result.overlapScore).toBeGreaterThan(0.2);
    });

    it("computes overlap score from changed files when not provided", async () => {
      // Single file results in 0.05 overlap
      const mockReport = {
        id: "report-4",
        repoId: null,
        runId: "run-4",
        changedFiles: ["src/a.ts"],
        overlapScore: 0.05,
        semanticConflicts: [],
        requiredChecks: ["lint_changed", "tests_impacted"],
        outcome: "fast_path",
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.mergeReport.upsert.mockResolvedValue(mockReport);

      const result = await service.prepareMerge({
        actor: "user-1",
        run_id: "run-4",
        changed_files: ["src/a.ts"],
      });

      expect(result.overlapScore).toBe(0.05);
      expect(mockPrisma.mergeReport.upsert).toHaveBeenCalledWith({
        where: { runId: "run-4" },
        update: expect.objectContaining({
          overlapScore: 0.05,
        }),
        create: expect.objectContaining({
          overlapScore: 0.05,
        }),
      });
    });

    it("uses custom overlap score when provided", async () => {
      const mockReport = {
        id: "report-5",
        repoId: null,
        runId: "run-5",
        changedFiles: ["src/file.ts"],
        overlapScore: 0.75,
        semanticConflicts: [],
        requiredChecks: ["lint_changed", "tests_impacted"],
        outcome: "integrator_required",
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.mergeReport.upsert.mockResolvedValue(mockReport);

      const result = await service.prepareMerge({
        actor: "user-1",
        run_id: "run-5",
        changed_files: ["src/file.ts"],
        overlap_score: 0.75,
      });

      expect(result.overlapScore).toBe(0.75);
    });

    it("uses custom required checks when provided", async () => {
      const customChecks = ["lint_all", "tests_all", "integration_tests"];

      const mockReport = {
        id: "report-6",
        repoId: null,
        runId: "run-6",
        changedFiles: ["src/file.ts"],
        overlapScore: 0.05,
        semanticConflicts: [],
        requiredChecks: customChecks,
        outcome: "fast_path",
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.mergeReport.upsert.mockResolvedValue(mockReport);

      const result = await service.prepareMerge({
        actor: "user-1",
        run_id: "run-6",
        changed_files: ["src/file.ts"],
        required_checks: customChecks,
      });

      expect(result.requiredChecks).toEqual(customChecks);
    });

    it("uses default required checks when not provided", async () => {
      const mockReport = {
        id: "report-7",
        repoId: null,
        runId: "run-7",
        changedFiles: ["src/file.ts"],
        overlapScore: 0.05,
        semanticConflicts: [],
        requiredChecks: ["lint_changed", "tests_impacted"],
        outcome: "fast_path",
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.mergeReport.upsert.mockResolvedValue(mockReport);

      const result = await service.prepareMerge({
        actor: "user-1",
        run_id: "run-7",
        changed_files: ["src/file.ts"],
      });

      expect(result.requiredChecks).toEqual(["lint_changed", "tests_impacted"]);
    });

    it("upserts merge report (creates if not exists, updates if exists)", async () => {
      const mockReport = {
        id: "report-8",
        repoId: "repo-1",
        runId: "run-8",
        changedFiles: ["src/file.ts"],
        overlapScore: 0.05,
        semanticConflicts: [],
        requiredChecks: ["lint_changed", "tests_impacted"],
        outcome: "fast_path",
        metadata: { key: "value" },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.mergeReport.upsert.mockResolvedValue(mockReport);

      await service.prepareMerge({
        actor: "user-1",
        repo_id: "repo-1",
        run_id: "run-8",
        changed_files: ["src/file.ts"],
        metadata: { key: "value" },
      });

      expect(mockPrisma.mergeReport.upsert).toHaveBeenCalledWith({
        where: { runId: "run-8" },
        update: expect.objectContaining({
          repoId: "repo-1",
          changedFiles: ["src/file.ts"],
          metadata: { key: "value" },
        }),
        create: expect.objectContaining({
          repoId: "repo-1",
          runId: "run-8",
          changedFiles: ["src/file.ts"],
          metadata: { key: "value" },
        }),
      });
    });

    it("handles files from same directory (higher overlap)", async () => {
      const changedFiles = [
        "src/module/a.ts",
        "src/module/b.ts",
        "src/module/c.ts",
        "src/module/d.ts",
      ];

      const mockReport = {
        id: "report-9",
        repoId: null,
        runId: "run-9",
        changedFiles,
        overlapScore: 0.45,
        semanticConflicts: [],
        requiredChecks: ["lint_changed", "tests_impacted"],
        outcome: "integrator_required",
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.mergeReport.upsert.mockResolvedValue(mockReport);

      const result = await service.prepareMerge({
        actor: "user-1",
        run_id: "run-9",
        changed_files: changedFiles,
      });

      expect(result.overlapScore).toBeGreaterThan(0.2);
      expect(result.outcome).toBe("integrator_required");
    });
  });

  describe("getMergeReport", () => {
    it("returns merge report when found", async () => {
      const mockReport = {
        id: "report-1",
        repoId: "repo-1",
        runId: "run-1",
        changedFiles: ["src/file.ts"],
        overlapScore: 0.15,
        semanticConflicts: [],
        requiredChecks: ["lint_changed", "tests_impacted"],
        outcome: "fast_path",
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.mergeReport.findUnique.mockResolvedValue(mockReport);

      const result = await service.getMergeReport("run-1");

      expect(result).not.toBeNull();
      expect(result?.id).toBe("report-1");
      expect(result?.runId).toBe("run-1");
      expect(mockPrisma.mergeReport.findUnique).toHaveBeenCalledWith({
        where: { runId: "run-1" },
      });
    });

    it("returns null when merge report not found", async () => {
      mockPrisma.mergeReport.findUnique.mockResolvedValue(null);

      const result = await service.getMergeReport("nonexistent-run");

      expect(result).toBeNull();
    });

    it("correctly maps arrays from unknown type", async () => {
      const mockReport = {
        id: "report-2",
        repoId: null,
        runId: "run-2",
        changedFiles: ["file1.ts", "file2.ts"],
        overlapScore: 0.2,
        semanticConflicts: ["conflict.ts"],
        requiredChecks: ["check1", "check2"],
        outcome: "integrator_required",
        metadata: { custom: "data" },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.mergeReport.findUnique.mockResolvedValue(mockReport);

      const result = await service.getMergeReport("run-2");

      expect(result?.changedFiles).toEqual(["file1.ts", "file2.ts"]);
      expect(result?.semanticConflicts).toEqual(["conflict.ts"]);
      expect(result?.requiredChecks).toEqual(["check1", "check2"]);
    });

    it("handles null metadata as empty object", async () => {
      const mockReport = {
        id: "report-3",
        repoId: null,
        runId: "run-3",
        changedFiles: [],
        overlapScore: 0,
        semanticConflicts: [],
        requiredChecks: [],
        outcome: "fast_path",
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.mergeReport.findUnique.mockResolvedValue(mockReport);

      const result = await service.getMergeReport("run-3");

      expect(result?.metadata).toEqual({});
    });
  });
});
