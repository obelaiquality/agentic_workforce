import { beforeEach, describe, expect, it, vi } from "vitest";

/* ------------------------------------------------------------------ */
/*  Hoisted mocks for prisma and fs                                   */
/* ------------------------------------------------------------------ */

const mocks = vi.hoisted(() => ({
  prisma: {
    projectBlueprint: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    repoRegistry: {
      findUnique: vi.fn(),
    },
    repoGuidelineProfile: {
      findUnique: vi.fn(),
    },
  },
  fs: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  },
}));

vi.mock("../db", () => ({ prisma: mocks.prisma }));
vi.mock("node:fs", () => ({ default: mocks.fs, ...mocks.fs }));
vi.mock("./sensitiveRedaction", () => ({ sanitizeUnicode: (s: string) => s }));

import {
  ProjectBlueprintService,
  firstParagraph,
  inferProductIntent,
  inferSuccessCriteria,
  inferConstraints,
  classifyConfidence,
} from "./projectBlueprintService";
import type { RepoGuidelineProfile, ProjectBlueprint } from "../../shared/contracts";

/* ------------------------------------------------------------------ */
/*  Section 1: Helper Functions (~22 tests)                           */
/* ------------------------------------------------------------------ */

describe("firstParagraph", () => {
  it("returns first paragraph longer than 40 chars", () => {
    const text = "This is a short line.\n\nThis is a much longer paragraph that definitely exceeds the forty character threshold.";
    const result = firstParagraph(text);
    expect(result).toBe("This is a much longer paragraph that definitely exceeds the forty character threshold.");
  });

  it("skips markdown headers (lines starting with #)", () => {
    const text = "# Header\n## Subheader\n\nThis is a valid paragraph that is long enough to be returned by the function.";
    const result = firstParagraph(text);
    expect(result).toBe("This is a valid paragraph that is long enough to be returned by the function.");
  });

  it("returns empty string when no chunk is long enough", () => {
    const text = "Short.\n\nAlso short.\n\nToo short.";
    const result = firstParagraph(text);
    expect(result).toBe("");
  });

  it("handles multi-paragraph text (returns first qualifying)", () => {
    const text = "Short.\n\nThis is the first qualifying paragraph that meets the length requirement.\n\nThis is another long paragraph that also qualifies.";
    const result = firstParagraph(text);
    expect(result).toBe("This is the first qualifying paragraph that meets the length requirement.");
  });

  it("collapses whitespace within chunks", () => {
    const text = "Short.\n\nThis   has    excessive     whitespace    and   should   be   collapsed   properly.";
    const result = firstParagraph(text);
    expect(result).toBe("This has excessive whitespace and should be collapsed properly.");
  });
});

describe("inferProductIntent", () => {
  it("returns first paragraph when found", () => {
    const text = "Short.\n\nThis is a comprehensive description of the product that should be extracted and returned.";
    const result = inferProductIntent(text, "TestProject");
    expect(result).toBe("This is a comprehensive description of the product that should be extracted and returned.");
  });

  it("truncates to 280 chars", () => {
    const text = "Short.\n\n" + "a".repeat(400);
    const result = inferProductIntent(text, "TestProject");
    expect(result.length).toBe(280);
    expect(result).toBe("a".repeat(280));
  });

  it("returns fallback message when no paragraph found", () => {
    const text = "Short.\n\nToo short.";
    const result = inferProductIntent(text, "TestProject");
    expect(result).toBe("TestProject should ship reliable code changes with verification and documentation discipline.");
  });

  it("uses fallbackName in fallback message", () => {
    const text = "";
    const result = inferProductIntent(text, "MyApp");
    expect(result).toContain("MyApp should ship");
  });
});

describe("inferSuccessCriteria", () => {
  it("always includes Implement and Verify criteria", () => {
    const result = inferSuccessCriteria(null);
    expect(result).toContain("Implement the requested change with minimal diffs.");
    expect(result).toContain("Verify impacted behavior before promotion.");
  });

  it("adds test criterion when guidelines.requiredArtifacts includes tests", () => {
    const guidelines: RepoGuidelineProfile = {
      id: "g1",
      repoId: "r1",
      languages: [],
      testCommands: [],
      buildCommands: [],
      lintCommands: [],
      docRules: [],
      patchRules: [],
      filePlacementRules: [],
      reviewStyle: "summary_first",
      requiredArtifacts: ["tests"],
      sourceRefs: [],
      confidence: 0.8,
      createdAt: "2026-03-28T12:00:00.000Z",
      updatedAt: "2026-03-28T12:00:00.000Z",
    };
    const result = inferSuccessCriteria(guidelines);
    expect(result).toContain("Add or update tests when behavior changes.");
  });

  it("adds doc criterion when guidelines.requiredArtifacts includes documentation", () => {
    const guidelines: RepoGuidelineProfile = {
      id: "g1",
      repoId: "r1",
      languages: [],
      testCommands: [],
      buildCommands: [],
      lintCommands: [],
      docRules: [],
      patchRules: [],
      filePlacementRules: [],
      reviewStyle: "summary_first",
      requiredArtifacts: ["documentation"],
      sourceRefs: [],
      confidence: 0.8,
      createdAt: "2026-03-28T12:00:00.000Z",
      updatedAt: "2026-03-28T12:00:00.000Z",
    };
    const result = inferSuccessCriteria(guidelines);
    expect(result).toContain("Update documentation when user-facing or operational behavior changes.");
  });

  it("handles null guidelines", () => {
    const result = inferSuccessCriteria(null);
    expect(result).toHaveLength(2);
    expect(result).toContain("Implement the requested change with minimal diffs.");
    expect(result).toContain("Verify impacted behavior before promotion.");
  });

  it("returns unique items", () => {
    const guidelines: RepoGuidelineProfile = {
      id: "g1",
      repoId: "r1",
      languages: [],
      testCommands: [],
      buildCommands: [],
      lintCommands: [],
      docRules: [],
      patchRules: [],
      filePlacementRules: [],
      reviewStyle: "summary_first",
      requiredArtifacts: ["Tests", "tests"],
      sourceRefs: [],
      confidence: 0.8,
      createdAt: "2026-03-28T12:00:00.000Z",
      updatedAt: "2026-03-28T12:00:00.000Z",
    };
    const result = inferSuccessCriteria(guidelines);
    const testCriteria = result.filter((c) => c.includes("tests"));
    expect(testCriteria).toHaveLength(1);
  });
});

describe("inferConstraints", () => {
  it("returns minimal diff constraint for text containing minimal diff", () => {
    const result = inferConstraints("We prefer minimal diffs in this project.");
    expect(result).toContain("Prefer minimal diffs.");
  });

  it("returns worktree constraint for text containing worktree", () => {
    const result = inferConstraints("Always work inside the managed worktree.");
    expect(result).toContain("Operate inside the managed worktree only.");
  });

  it("returns review findings constraint for text containing review findings", () => {
    const result = inferConstraints("Use review findings first style.");
    expect(result).toContain("Use findings-first review style.");
  });

  it("returns performance constraint for text containing performance", () => {
    const result = inferConstraints("Preserve performance-sensitive code paths.");
    expect(result).toContain("Preserve performance-sensitive paths.");
  });

  it("returns empty array for unrelated text", () => {
    const result = inferConstraints("This is some random text with no special keywords.");
    expect(result).toEqual([]);
  });

  it("returns unique results", () => {
    const result = inferConstraints("minimal diff and minimal diffs are important");
    expect(result).toEqual(["Prefer minimal diffs."]);
  });
});

describe("classifyConfidence", () => {
  it("returns high for confidence >= 0.75", () => {
    const result = classifyConfidence({ guidelineConfidence: 0.8, sourceRefs: [] });
    expect(result).toBe("high");
  });

  it("returns high for sourceRefs.length >= 4", () => {
    const result = classifyConfidence({ guidelineConfidence: 0.3, sourceRefs: ["a", "b", "c", "d"] });
    expect(result).toBe("high");
  });

  it("returns medium for confidence >= 0.45", () => {
    const result = classifyConfidence({ guidelineConfidence: 0.5, sourceRefs: [] });
    expect(result).toBe("medium");
  });

  it("returns medium for sourceRefs.length >= 2", () => {
    const result = classifyConfidence({ guidelineConfidence: 0.2, sourceRefs: ["a", "b"] });
    expect(result).toBe("medium");
  });

  it("returns low for low confidence and few refs", () => {
    const result = classifyConfidence({ guidelineConfidence: 0.3, sourceRefs: ["a"] });
    expect(result).toBe("low");
  });

  it("handles null/undefined confidence", () => {
    const result1 = classifyConfidence({ guidelineConfidence: null, sourceRefs: [] });
    expect(result1).toBe("low");

    const result2 = classifyConfidence({ guidelineConfidence: undefined, sourceRefs: [] });
    expect(result2).toBe("low");
  });
});

/* ------------------------------------------------------------------ */
/*  Section 2: Service Class Methods (~16 tests)                     */
/* ------------------------------------------------------------------ */

describe("ProjectBlueprintService", () => {
  let service: ProjectBlueprintService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ProjectBlueprintService();
  });

  describe("get", () => {
    it("returns null for missing blueprint", async () => {
      mocks.prisma.projectBlueprint.findUnique.mockResolvedValue(null);
      const result = await service.get("repo-1");
      expect(result).toBeNull();
    });

    it("returns mapped blueprint when found", async () => {
      const mockRow = {
        id: "bp-1",
        repoId: "repo-1",
        version: 1,
        sourceMode: "repo_extracted",
        charter: { productIntent: "Build a thing", successCriteria: [], constraints: [], riskPosture: "medium" },
        codingStandards: { principles: [], filePlacementRules: [], architectureRules: [], dependencyRules: [], reviewStyle: "summary_first" },
        testingPolicy: { requiredForBehaviorChange: true, defaultCommands: [], impactedTestStrategy: "required", fullSuitePolicy: "manual" },
        documentationPolicy: { updateUserFacingDocs: true, updateRunbooksWhenOpsChange: true, requiredDocPaths: [], changelogPolicy: "recommended" },
        executionPolicy: { approvalRequiredFor: [], protectedPaths: [], maxChangedFilesBeforeReview: 8, allowParallelExecution: true },
        providerPolicy: { preferredCoderRole: "coder_default", reviewRole: "review_deep", escalationPolicy: "high_risk_only" },
        extractedFrom: ["README.md"],
        metadata: { confidence: "medium" },
        createdAt: new Date("2026-03-28T12:00:00.000Z"),
        updatedAt: new Date("2026-03-28T12:30:00.000Z"),
      };

      mocks.prisma.projectBlueprint.findUnique.mockResolvedValue(mockRow);
      const result = await service.get("repo-1");

      expect(result).not.toBeNull();
      expect(result?.id).toBe("bp-1");
      expect(result?.projectId).toBe("repo-1");
      expect(result?.version).toBe(1);
      expect(result?.sourceMode).toBe("repo_extracted");
      expect(result?.confidence).toBe("medium");
      expect(result?.extractedFrom).toEqual(["README.md"]);
      expect(result?.createdAt).toBe("2026-03-28T12:00:00.000Z");
      expect(result?.updatedAt).toBe("2026-03-28T12:30:00.000Z");
    });
  });

  describe("getSources", () => {
    it("returns empty array for missing blueprint", async () => {
      mocks.prisma.projectBlueprint.findUnique.mockResolvedValue(null);
      const result = await service.getSources("repo-1");
      expect(result).toEqual([]);
    });

    it("returns extractedFrom when blueprint exists", async () => {
      const mockRow = {
        extractedFrom: ["README.md", "AGENTS.md"],
      };
      mocks.prisma.projectBlueprint.findUnique.mockResolvedValue(mockRow);
      const result = await service.getSources("repo-1");
      expect(result).toEqual(["README.md", "AGENTS.md"]);
    });
  });

  describe("generate", () => {
    it("throws when repo not found", async () => {
      mocks.prisma.repoRegistry.findUnique.mockResolvedValue(null);
      await expect(service.generate("repo-1")).rejects.toThrow("Repo not found: repo-1");
    });

    it("creates blueprint with proper charter shape", async () => {
      const mockRepo = {
        id: "repo-1",
        displayName: "TestRepo",
        managedWorktreeRoot: "/tmp/worktrees/repo-1",
      };
      const mockGuideline = {
        id: "g1",
        repoId: "repo-1",
        languages: ["TypeScript"],
        testCommands: ["npm test"],
        buildCommands: ["npm run build"],
        lintCommands: [],
        docRules: [],
        patchRules: ["Prefer minimal diffs"],
        filePlacementRules: [],
        reviewStyle: "summary_first",
        requiredArtifacts: ["tests"],
        sourceRefs: [],
        confidence: 0.8,
      };

      mocks.prisma.repoRegistry.findUnique.mockResolvedValue(mockRepo);
      mocks.prisma.repoGuidelineProfile.findUnique.mockResolvedValue(mockGuideline);
      mocks.prisma.projectBlueprint.findUnique.mockResolvedValue(null);
      mocks.fs.existsSync.mockReturnValue(true);
      mocks.fs.readFileSync.mockReturnValue("# TestRepo\n\nThis is a comprehensive description of the test repository that should be extracted.");

      const mockCreatedRow = {
        id: "bp-1",
        repoId: "repo-1",
        version: 1,
        sourceMode: "repo_extracted",
        charter: {
          productIntent: "This is a comprehensive description of the test repository that should be extracted.",
          successCriteria: ["Implement the requested change with minimal diffs.", "Verify impacted behavior before promotion.", "Add or update tests when behavior changes."],
          constraints: ["Prefer minimal diffs."],
          riskPosture: "medium",
        },
        codingStandards: { principles: [], filePlacementRules: [], architectureRules: [], dependencyRules: [], reviewStyle: "summary_first" },
        testingPolicy: { requiredForBehaviorChange: true, defaultCommands: [], impactedTestStrategy: "required", fullSuitePolicy: "manual" },
        documentationPolicy: { updateUserFacingDocs: true, updateRunbooksWhenOpsChange: true, requiredDocPaths: [], changelogPolicy: "recommended" },
        executionPolicy: { approvalRequiredFor: [], protectedPaths: [], maxChangedFilesBeforeReview: 8, allowParallelExecution: true },
        providerPolicy: { preferredCoderRole: "coder_default", reviewRole: "review_deep", escalationPolicy: "high_risk_only" },
        extractedFrom: [],
        metadata: {},
        createdAt: new Date("2026-03-28T12:00:00.000Z"),
        updatedAt: new Date("2026-03-28T12:00:00.000Z"),
      };

      mocks.prisma.projectBlueprint.upsert.mockResolvedValue(mockCreatedRow);

      const result = await service.generate("repo-1");

      expect(result.charter).toBeDefined();
      expect(result.charter.productIntent).toBeDefined();
      expect(result.charter.successCriteria).toBeInstanceOf(Array);
      expect(result.charter.constraints).toBeInstanceOf(Array);
      expect(result.charter.riskPosture).toBe("medium");
    });

    it("creates blueprint with proper codingStandards shape", async () => {
      const mockRepo = {
        id: "repo-1",
        displayName: "TestRepo",
        managedWorktreeRoot: "/tmp/worktrees/repo-1",
      };

      mocks.prisma.repoRegistry.findUnique.mockResolvedValue(mockRepo);
      mocks.prisma.repoGuidelineProfile.findUnique.mockResolvedValue(null);
      mocks.prisma.projectBlueprint.findUnique.mockResolvedValue(null);
      mocks.fs.existsSync.mockReturnValue(false);

      const mockCreatedRow = {
        id: "bp-1",
        repoId: "repo-1",
        version: 1,
        sourceMode: "repo_extracted",
        charter: { productIntent: "", successCriteria: [], constraints: [], riskPosture: "medium" },
        codingStandards: {
          principles: ["Prefer minimal diffs.", "Keep changes within the active project worktree."],
          filePlacementRules: ["Place files in domain-appropriate folders."],
          architectureRules: ["Keep implementation responsibilities separated."],
          dependencyRules: ["Add dependencies only when justified."],
          reviewStyle: "summary_first",
        },
        testingPolicy: { requiredForBehaviorChange: true, defaultCommands: [], impactedTestStrategy: "required", fullSuitePolicy: "manual" },
        documentationPolicy: { updateUserFacingDocs: true, updateRunbooksWhenOpsChange: true, requiredDocPaths: [], changelogPolicy: "recommended" },
        executionPolicy: { approvalRequiredFor: [], protectedPaths: [], maxChangedFilesBeforeReview: 8, allowParallelExecution: true },
        providerPolicy: { preferredCoderRole: "coder_default", reviewRole: "review_deep", escalationPolicy: "high_risk_only" },
        extractedFrom: [],
        metadata: {},
        createdAt: new Date("2026-03-28T12:00:00.000Z"),
        updatedAt: new Date("2026-03-28T12:00:00.000Z"),
      };

      mocks.prisma.projectBlueprint.upsert.mockResolvedValue(mockCreatedRow);

      const result = await service.generate("repo-1");

      expect(result.codingStandards).toBeDefined();
      expect(result.codingStandards.principles).toBeInstanceOf(Array);
      expect(result.codingStandards.filePlacementRules).toBeInstanceOf(Array);
      expect(result.codingStandards.architectureRules).toBeInstanceOf(Array);
      expect(result.codingStandards.dependencyRules).toBeInstanceOf(Array);
      expect(result.codingStandards.reviewStyle).toBe("summary_first");
    });

    it("creates blueprint with proper testingPolicy shape", async () => {
      const mockRepo = {
        id: "repo-1",
        displayName: "TestRepo",
        managedWorktreeRoot: "/tmp/worktrees/repo-1",
      };

      mocks.prisma.repoRegistry.findUnique.mockResolvedValue(mockRepo);
      mocks.prisma.repoGuidelineProfile.findUnique.mockResolvedValue(null);
      mocks.prisma.projectBlueprint.findUnique.mockResolvedValue(null);
      mocks.fs.existsSync.mockReturnValue(false);

      const mockCreatedRow = {
        id: "bp-1",
        repoId: "repo-1",
        version: 1,
        sourceMode: "repo_extracted",
        charter: { productIntent: "", successCriteria: [], constraints: [], riskPosture: "medium" },
        codingStandards: { principles: [], filePlacementRules: [], architectureRules: [], dependencyRules: [], reviewStyle: "summary_first" },
        testingPolicy: {
          requiredForBehaviorChange: true,
          defaultCommands: [],
          impactedTestStrategy: "required",
          fullSuitePolicy: "manual",
        },
        documentationPolicy: { updateUserFacingDocs: true, updateRunbooksWhenOpsChange: true, requiredDocPaths: [], changelogPolicy: "recommended" },
        executionPolicy: { approvalRequiredFor: [], protectedPaths: [], maxChangedFilesBeforeReview: 8, allowParallelExecution: true },
        providerPolicy: { preferredCoderRole: "coder_default", reviewRole: "review_deep", escalationPolicy: "high_risk_only" },
        extractedFrom: [],
        metadata: {},
        createdAt: new Date("2026-03-28T12:00:00.000Z"),
        updatedAt: new Date("2026-03-28T12:00:00.000Z"),
      };

      mocks.prisma.projectBlueprint.upsert.mockResolvedValue(mockCreatedRow);

      const result = await service.generate("repo-1");

      expect(result.testingPolicy).toBeDefined();
      expect(result.testingPolicy.requiredForBehaviorChange).toBe(true);
      expect(result.testingPolicy.defaultCommands).toBeInstanceOf(Array);
      expect(result.testingPolicy.impactedTestStrategy).toBe("required");
      expect(result.testingPolicy.fullSuitePolicy).toBe("manual");
    });

    it("bumps version when blueprint already exists", async () => {
      const mockRepo = {
        id: "repo-1",
        displayName: "TestRepo",
        managedWorktreeRoot: "/tmp/worktrees/repo-1",
      };
      const existingBlueprint = {
        id: "bp-1",
        repoId: "repo-1",
        version: 3,
        sourceMode: "repo_extracted",
      };

      mocks.prisma.repoRegistry.findUnique.mockResolvedValue(mockRepo);
      mocks.prisma.repoGuidelineProfile.findUnique.mockResolvedValue(null);
      mocks.prisma.projectBlueprint.findUnique.mockResolvedValue(existingBlueprint);
      mocks.fs.existsSync.mockReturnValue(false);

      const mockCreatedRow = {
        id: "bp-1",
        repoId: "repo-1",
        version: 4,
        sourceMode: "repo_extracted",
        charter: { productIntent: "", successCriteria: [], constraints: [], riskPosture: "medium" },
        codingStandards: { principles: [], filePlacementRules: [], architectureRules: [], dependencyRules: [], reviewStyle: "summary_first" },
        testingPolicy: { requiredForBehaviorChange: true, defaultCommands: [], impactedTestStrategy: "required", fullSuitePolicy: "manual" },
        documentationPolicy: { updateUserFacingDocs: true, updateRunbooksWhenOpsChange: true, requiredDocPaths: [], changelogPolicy: "recommended" },
        executionPolicy: { approvalRequiredFor: [], protectedPaths: [], maxChangedFilesBeforeReview: 8, allowParallelExecution: true },
        providerPolicy: { preferredCoderRole: "coder_default", reviewRole: "review_deep", escalationPolicy: "high_risk_only" },
        extractedFrom: [],
        metadata: {},
        createdAt: new Date("2026-03-28T12:00:00.000Z"),
        updatedAt: new Date("2026-03-28T12:00:00.000Z"),
      };

      mocks.prisma.projectBlueprint.upsert.mockResolvedValue(mockCreatedRow);

      const result = await service.generate("repo-1");

      expect(result.version).toBe(4);
    });

    it("preserves repo_plus_override sourceMode when regenerating", async () => {
      const mockRepo = {
        id: "repo-1",
        displayName: "TestRepo",
        managedWorktreeRoot: "/tmp/worktrees/repo-1",
      };
      const existingBlueprint = {
        id: "bp-1",
        repoId: "repo-1",
        version: 1,
        sourceMode: "repo_plus_override",
      };

      mocks.prisma.repoRegistry.findUnique.mockResolvedValue(mockRepo);
      mocks.prisma.repoGuidelineProfile.findUnique.mockResolvedValue(null);
      mocks.prisma.projectBlueprint.findUnique.mockResolvedValue(existingBlueprint);
      mocks.fs.existsSync.mockReturnValue(false);

      const mockCreatedRow = {
        id: "bp-1",
        repoId: "repo-1",
        version: 2,
        sourceMode: "repo_plus_override",
        charter: { productIntent: "", successCriteria: [], constraints: [], riskPosture: "medium" },
        codingStandards: { principles: [], filePlacementRules: [], architectureRules: [], dependencyRules: [], reviewStyle: "summary_first" },
        testingPolicy: { requiredForBehaviorChange: true, defaultCommands: [], impactedTestStrategy: "required", fullSuitePolicy: "manual" },
        documentationPolicy: { updateUserFacingDocs: true, updateRunbooksWhenOpsChange: true, requiredDocPaths: [], changelogPolicy: "recommended" },
        executionPolicy: { approvalRequiredFor: [], protectedPaths: [], maxChangedFilesBeforeReview: 8, allowParallelExecution: true },
        providerPolicy: { preferredCoderRole: "coder_default", reviewRole: "review_deep", escalationPolicy: "high_risk_only" },
        extractedFrom: [],
        metadata: {},
        createdAt: new Date("2026-03-28T12:00:00.000Z"),
        updatedAt: new Date("2026-03-28T12:00:00.000Z"),
      };

      mocks.prisma.projectBlueprint.upsert.mockResolvedValue(mockCreatedRow);

      const result = await service.generate("repo-1");

      expect(result.sourceMode).toBe("repo_plus_override");
    });
  });

  describe("update", () => {
    it("throws when blueprint not found", async () => {
      mocks.prisma.projectBlueprint.findUnique.mockResolvedValue(null);
      await expect(service.update("repo-1", {})).rejects.toThrow("Project blueprint not found: repo-1");
    });

    it("merges patch and bumps version", async () => {
      const currentBlueprint = {
        id: "bp-1",
        repoId: "repo-1",
        version: 2,
        sourceMode: "repo_extracted",
        charter: { productIntent: "Old intent", successCriteria: [], constraints: [], riskPosture: "medium" },
        codingStandards: { principles: ["Old principle"], filePlacementRules: [], architectureRules: [], dependencyRules: [], reviewStyle: "summary_first" },
        testingPolicy: { requiredForBehaviorChange: true, defaultCommands: [], impactedTestStrategy: "required", fullSuitePolicy: "manual" },
        documentationPolicy: { updateUserFacingDocs: true, updateRunbooksWhenOpsChange: true, requiredDocPaths: [], changelogPolicy: "recommended" },
        executionPolicy: { approvalRequiredFor: [], protectedPaths: [], maxChangedFilesBeforeReview: 8, allowParallelExecution: true },
        providerPolicy: { preferredCoderRole: "coder_default", reviewRole: "review_deep", escalationPolicy: "high_risk_only" },
        extractedFrom: [],
        metadata: { original: true },
        createdAt: new Date("2026-03-28T12:00:00.000Z"),
        updatedAt: new Date("2026-03-28T12:00:00.000Z"),
      };

      mocks.prisma.projectBlueprint.findUnique.mockResolvedValue(currentBlueprint);

      const updatedRow = {
        ...currentBlueprint,
        version: 3,
        sourceMode: "repo_plus_override",
        charter: { productIntent: "New intent", successCriteria: [], constraints: [], riskPosture: "medium" },
        metadata: { original: true, updated_by_override: true },
        updatedAt: new Date("2026-03-28T12:30:00.000Z"),
      };

      mocks.prisma.projectBlueprint.update.mockResolvedValue(updatedRow);

      const patch: Partial<ProjectBlueprint> = {
        charter: { productIntent: "New intent", successCriteria: [], constraints: [], riskPosture: "medium" },
      };

      const result = await service.update("repo-1", patch);

      expect(result.version).toBe(3);
      expect(result.sourceMode).toBe("repo_plus_override");
      expect(result.charter.productIntent).toBe("New intent");
      expect(mocks.prisma.projectBlueprint.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { repoId: "repo-1" },
          data: expect.objectContaining({
            version: 3,
            sourceMode: "repo_plus_override",
          }),
        })
      );
    });

    it("sets updated_by_override flag in metadata", async () => {
      const currentBlueprint = {
        id: "bp-1",
        repoId: "repo-1",
        version: 1,
        sourceMode: "repo_extracted",
        charter: { productIntent: "Old", successCriteria: [], constraints: [], riskPosture: "medium" },
        codingStandards: { principles: [], filePlacementRules: [], architectureRules: [], dependencyRules: [], reviewStyle: "summary_first" },
        testingPolicy: { requiredForBehaviorChange: true, defaultCommands: [], impactedTestStrategy: "required", fullSuitePolicy: "manual" },
        documentationPolicy: { updateUserFacingDocs: true, updateRunbooksWhenOpsChange: true, requiredDocPaths: [], changelogPolicy: "recommended" },
        executionPolicy: { approvalRequiredFor: [], protectedPaths: [], maxChangedFilesBeforeReview: 8, allowParallelExecution: true },
        providerPolicy: { preferredCoderRole: "coder_default", reviewRole: "review_deep", escalationPolicy: "high_risk_only" },
        extractedFrom: [],
        metadata: {},
        createdAt: new Date("2026-03-28T12:00:00.000Z"),
        updatedAt: new Date("2026-03-28T12:00:00.000Z"),
      };

      mocks.prisma.projectBlueprint.findUnique.mockResolvedValue(currentBlueprint);

      const updatedRow = {
        ...currentBlueprint,
        version: 2,
        sourceMode: "repo_plus_override",
        metadata: { updated_by_override: true },
        updatedAt: new Date("2026-03-28T12:30:00.000Z"),
      };

      mocks.prisma.projectBlueprint.update.mockResolvedValue(updatedRow);

      const result = await service.update("repo-1", {});

      expect(result.metadata.updated_by_override).toBe(true);
    });

    it("merges partial charter updates", async () => {
      const currentBlueprint = {
        id: "bp-1",
        repoId: "repo-1",
        version: 1,
        sourceMode: "repo_extracted",
        charter: { productIntent: "Old intent", successCriteria: ["Old criteria"], constraints: ["Old constraint"], riskPosture: "medium" },
        codingStandards: { principles: [], filePlacementRules: [], architectureRules: [], dependencyRules: [], reviewStyle: "summary_first" },
        testingPolicy: { requiredForBehaviorChange: true, defaultCommands: [], impactedTestStrategy: "required", fullSuitePolicy: "manual" },
        documentationPolicy: { updateUserFacingDocs: true, updateRunbooksWhenOpsChange: true, requiredDocPaths: [], changelogPolicy: "recommended" },
        executionPolicy: { approvalRequiredFor: [], protectedPaths: [], maxChangedFilesBeforeReview: 8, allowParallelExecution: true },
        providerPolicy: { preferredCoderRole: "coder_default", reviewRole: "review_deep", escalationPolicy: "high_risk_only" },
        extractedFrom: [],
        metadata: {},
        createdAt: new Date("2026-03-28T12:00:00.000Z"),
        updatedAt: new Date("2026-03-28T12:00:00.000Z"),
      };

      mocks.prisma.projectBlueprint.findUnique.mockResolvedValue(currentBlueprint);

      const updatedRow = {
        ...currentBlueprint,
        version: 2,
        sourceMode: "repo_plus_override",
        charter: { productIntent: "Old intent", successCriteria: ["Old criteria"], constraints: ["Old constraint"], riskPosture: "high" },
        metadata: { updated_by_override: true },
        updatedAt: new Date("2026-03-28T12:30:00.000Z"),
      };

      mocks.prisma.projectBlueprint.update.mockResolvedValue(updatedRow);

      const patch: Partial<ProjectBlueprint> = {
        charter: { riskPosture: "high" } as any,
      };

      const result = await service.update("repo-1", patch);

      expect(result.charter.riskPosture).toBe("high");
      expect(mocks.prisma.projectBlueprint.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            charter: expect.objectContaining({
              riskPosture: "high",
            }),
          }),
        })
      );
    });
  });
});
