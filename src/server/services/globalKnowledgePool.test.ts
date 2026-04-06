import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  jaccardSimilarity,
  extractTechFingerprint,
  GlobalKnowledgePool,
} from "./globalKnowledgePool";
import type { LearningEntry, SkillRecord, RepoGuidelineProfile, ProjectBlueprint } from "../../shared/contracts";

// ---------------------------------------------------------------------------
// Mock Prisma
// ---------------------------------------------------------------------------

const mockPrisma = vi.hoisted(() => ({
  globalLearning: {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "gl-1", ...data, createdAt: new Date(), updatedAt: new Date() })),
    update: vi.fn().mockImplementation(({ data }) => Promise.resolve(data)),
    delete: vi.fn().mockResolvedValue({}),
    count: vi.fn().mockResolvedValue(0),
  },
  globalPrinciple: {
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "gp-1", ...data, createdAt: new Date(), updatedAt: new Date() })),
    update: vi.fn().mockResolvedValue({}),
    count: vi.fn().mockResolvedValue(0),
  },
  repoRegistry: {
    count: vi.fn().mockResolvedValue(5),
  },
}));

vi.mock("../db", () => ({ prisma: mockPrisma }));

// ---------------------------------------------------------------------------
// Jaccard Similarity
// ---------------------------------------------------------------------------

describe("jaccardSimilarity", () => {
  it("returns 0 for two empty arrays", () => {
    expect(jaccardSimilarity([], [])).toBe(0);
  });

  it("returns 0 for disjoint sets", () => {
    expect(jaccardSimilarity(["a", "b"], ["c", "d"])).toBe(0);
  });

  it("returns 1 for identical sets", () => {
    expect(jaccardSimilarity(["a", "b"], ["a", "b"])).toBe(1);
  });

  it("returns correct value for partial overlap", () => {
    // intersection = {typescript}, union = {typescript, react, node, fastify}
    expect(jaccardSimilarity(["typescript", "react"], ["typescript", "node", "fastify"])).toBe(1 / 4);
  });

  it("handles one empty array", () => {
    expect(jaccardSimilarity(["a"], [])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// extractTechFingerprint
// ---------------------------------------------------------------------------

describe("extractTechFingerprint", () => {
  it("extracts languages from guidelines", () => {
    const guidelines = { languages: ["TypeScript", "CSS"] } as unknown as RepoGuidelineProfile;
    const result = extractTechFingerprint(guidelines, null);
    expect(result).toContain("typescript");
    expect(result).toContain("css");
  });

  it("detects framework hints from blueprint principles", () => {
    const blueprint = {
      codingStandards: { principles: ["Use React for UI", "Tailwind for styling"] },
    } as unknown as ProjectBlueprint;
    const result = extractTechFingerprint(null, blueprint);
    expect(result).toContain("react");
    expect(result).toContain("tailwind");
  });

  it("detects test runners from testing policy", () => {
    const blueprint = {
      codingStandards: { principles: [] },
      testingPolicy: { testRunner: "vitest" },
    } as unknown as ProjectBlueprint;
    const result = extractTechFingerprint(null, blueprint);
    expect(result).toContain("vitest");
  });

  it("returns empty for null inputs", () => {
    expect(extractTechFingerprint(null, null)).toEqual([]);
  });

  it("deduplicates and sorts", () => {
    const guidelines = { languages: ["TypeScript", "typescript"] } as unknown as RepoGuidelineProfile;
    const result = extractTechFingerprint(guidelines, null);
    expect(result).toEqual(["typescript"]);
  });
});

// ---------------------------------------------------------------------------
// GlobalKnowledgePool
// ---------------------------------------------------------------------------

describe("GlobalKnowledgePool", () => {
  let pool: GlobalKnowledgePool;

  beforeEach(() => {
    vi.clearAllMocks();
    pool = new GlobalKnowledgePool();
  });

  describe("promoteLearning", () => {
    const baseLearning: LearningEntry = {
      id: "l-1",
      projectId: "proj-a",
      category: "pattern",
      summary: "Always export utility functions with named exports",
      detail: "Named exports improve tree-shaking and auto-imports",
      source: "auto_extraction",
      confidence: 0.7,
      occurrences: 4,
      relatedFiles: ["/src/utils/helpers.ts"],
      relatedTools: ["edit_file"],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };

    it("creates new global learning when no similar exists", async () => {
      await pool.promoteLearning(baseLearning, ["typescript", "node"], "proj-a");

      expect(mockPrisma.globalLearning.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          category: "pattern",
          summary: baseLearning.summary,
          sourceProjectIds: ["proj-a"],
          techFingerprint: ["typescript", "node"],
        }),
      });
    });

    it("merges with existing similar learning", async () => {
      mockPrisma.globalLearning.findMany.mockResolvedValueOnce([{
        id: "gl-existing",
        category: "pattern",
        summary: "Always export utility functions using named exports",
        confidence: 0.6,
        occurrences: 2,
        sourceProjectIds: ["proj-b"],
        techFingerprint: ["typescript"],
        detail: "",
        lastSeenAt: new Date(),
      }]);

      await pool.promoteLearning(baseLearning, ["typescript", "node"], "proj-a");

      expect(mockPrisma.globalLearning.update).toHaveBeenCalledWith({
        where: { id: "gl-existing" },
        data: expect.objectContaining({
          occurrences: 3,
          sourceProjectIds: ["proj-b", "proj-a"],
          techFingerprint: expect.arrayContaining(["typescript", "node"]),
        }),
      });
    });

    it("skips low-confidence learnings", async () => {
      await pool.promoteLearning({ ...baseLearning, confidence: 0.4 }, ["ts"], "proj-a");
      expect(mockPrisma.globalLearning.create).not.toHaveBeenCalled();
      expect(mockPrisma.globalLearning.update).not.toHaveBeenCalled();
    });

    it("evicts weakest when at capacity", async () => {
      mockPrisma.globalLearning.count.mockResolvedValueOnce(500);
      mockPrisma.globalLearning.findFirst.mockResolvedValueOnce({ id: "gl-weakest" });

      await pool.promoteLearning(baseLearning, ["ts"], "proj-a");

      expect(mockPrisma.globalLearning.delete).toHaveBeenCalledWith({ where: { id: "gl-weakest" } });
      expect(mockPrisma.globalLearning.create).toHaveBeenCalled();
    });
  });

  describe("queryRelevant", () => {
    it("returns learnings sorted by relevance score", async () => {
      mockPrisma.globalLearning.findMany.mockResolvedValueOnce([
        { id: "1", summary: "Use named exports", confidence: 0.9, universality: 0.5, techFingerprint: ["typescript", "react"], sourceProjectIds: [], relatedTools: [], relatedFilePatterns: [] },
        { id: "2", summary: "Avoid default exports", confidence: 0.8, universality: 0.3, techFingerprint: ["python", "django"], sourceProjectIds: [], relatedTools: [], relatedFilePatterns: [] },
      ]);

      const results = await pool.queryRelevant(["typescript", "react"]);
      expect(results.length).toBe(1); // Only TypeScript one matches
      expect(results[0].id).toBe("1");
    });

    it("returns all when fingerprint is empty", async () => {
      mockPrisma.globalLearning.findMany.mockResolvedValueOnce([
        { id: "1", summary: "Test", confidence: 0.9, universality: 0.5, techFingerprint: ["ts"], sourceProjectIds: [], relatedTools: [], relatedFilePatterns: [] },
      ]);

      const results = await pool.queryRelevant([]);
      expect(results.length).toBe(1);
    });
  });

  describe("formatForSystemPrompt", () => {
    it("returns empty string when no principles exist", async () => {
      const result = await pool.formatForSystemPrompt(["typescript"]);
      expect(result).toBe("");
    });

    it("formats relevant principles with metadata", async () => {
      mockPrisma.globalPrinciple.findMany.mockResolvedValueOnce([
        { id: "1", principle: "Prefer named exports", confidence: 0.9, sourceProjectCount: 3, techFingerprint: ["typescript"] },
      ]);

      const result = await pool.formatForSystemPrompt(["typescript"]);
      expect(result).toContain("Cross-Project Learnings");
      expect(result).toContain("Prefer named exports");
      expect(result).toContain("3 projects");
    });

    it("filters by tech fingerprint relevance", async () => {
      mockPrisma.globalPrinciple.findMany.mockResolvedValueOnce([
        { id: "1", principle: "Use Django ORM", confidence: 0.9, sourceProjectCount: 2, techFingerprint: ["python", "django"] },
      ]);

      const result = await pool.formatForSystemPrompt(["typescript", "react"]);
      expect(result).toBe(""); // Django not relevant to TypeScript/React
    });
  });

  describe("recomputeUniversality", () => {
    it("updates universality based on source project count", async () => {
      mockPrisma.globalLearning.findMany.mockResolvedValueOnce([
        { id: "1", sourceProjectIds: ["a", "b", "c"], universality: 0 },
      ]);
      mockPrisma.repoRegistry.count.mockResolvedValueOnce(5);

      await pool.recomputeUniversality();

      expect(mockPrisma.globalLearning.update).toHaveBeenCalledWith({
        where: { id: "1" },
        data: { universality: 0.6 },
      });
    });

    it("skips when no projects exist", async () => {
      mockPrisma.repoRegistry.count.mockResolvedValueOnce(0);
      await pool.recomputeUniversality();
      expect(mockPrisma.globalLearning.findMany).not.toHaveBeenCalled();
    });
  });

  describe("rankSkillsForProject", () => {
    const skills: SkillRecord[] = [
      { id: "s1", name: "react-component", description: "Create React components", builtIn: false, techFingerprint: ["typescript", "react"], sourceProjectIds: ["a", "b"], tags: [], version: "1.0.0", contextMode: "inline", allowedTools: [], maxIterations: null, systemPrompt: "", referenceFiles: [], author: "user", createdAt: "", updatedAt: "" },
      { id: "s2", name: "django-model", description: "Create Django models", builtIn: false, techFingerprint: ["python", "django"], sourceProjectIds: ["c"], tags: [], version: "1.0.0", contextMode: "inline", allowedTools: [], maxIterations: null, systemPrompt: "", referenceFiles: [], author: "user", createdAt: "", updatedAt: "" },
      { id: "s3", name: "verify", description: "Run verification", builtIn: true, tags: [], version: "1.0.0", contextMode: "inline", allowedTools: [], maxIterations: null, systemPrompt: "", referenceFiles: [], author: "system", createdAt: "", updatedAt: "" },
    ];

    it("ranks matching skills highest", () => {
      const ranked = pool.rankSkillsForProject(skills, ["typescript", "react"]);
      expect(ranked[0].name).toBe("react-component");
    });

    it("gives built-in skills moderate relevance", () => {
      const ranked = pool.rankSkillsForProject(skills, ["typescript", "react"]);
      const builtin = ranked.find((s) => s.name === "verify");
      expect(builtin!.relevanceScore).toBe(0.5);
    });

    it("gives non-matching skills low relevance", () => {
      const ranked = pool.rankSkillsForProject(skills, ["typescript", "react"]);
      const django = ranked.find((s) => s.name === "django-model");
      expect(django!.relevanceScore).toBe(0); // No overlap
    });

    it("boosts multi-project skills", () => {
      const ranked = pool.rankSkillsForProject(skills, ["typescript", "react"]);
      const react = ranked.find((s) => s.name === "react-component");
      // Base Jaccard = 1.0 (identical fingerprint), boosted by log2(2) * 0.1
      expect(react!.relevanceScore).toBeGreaterThan(1.0 - 0.01);
    });

    it("handles empty fingerprint gracefully", () => {
      const ranked = pool.rankSkillsForProject(skills, []);
      expect(ranked.length).toBe(3);
      const builtin = ranked.find((s) => s.name === "verify");
      expect(builtin!.relevanceScore).toBe(0.5);
      // Non-built-in untagged get base relevance
      const custom = ranked.find((s) => s.name === "react-component");
      expect(custom!.relevanceScore).toBe(0.3);
    });
  });
});
