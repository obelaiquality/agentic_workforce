import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LearningEntry, ConsolidatedPrinciple } from "../../shared/contracts";

// ---------------------------------------------------------------------------
// In-memory filesystem mock
// ---------------------------------------------------------------------------

const fileStore: Record<string, string> = {};

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn((p: string) => p in fileStore),
    readFileSync: vi.fn((p: string) => {
      if (!(p in fileStore)) throw new Error("ENOENT");
      return fileStore[p];
    }),
    writeFileSync: vi.fn((p: string, data: string) => {
      fileStore[p] = data;
    }),
    mkdirSync: vi.fn(),
  },
}));

vi.mock("node:fs/promises", () => ({
  default: {},
}));

// We want real tokenize / cosineSimilarity — do NOT mock memoryService.

import { LearningsService } from "./learningsService";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WORKTREE = "/tmp/test-worktree";
const BASE = `${WORKTREE}/.agentic-workforce/learnings`;
const LEARNINGS_PATH = `${BASE}/learnings.json`;
const PRINCIPLES_PATH = `${BASE}/principles.json`;
const PROJECT = "proj-1";

function seedLearnings(entries: LearningEntry[]): void {
  fileStore[LEARNINGS_PATH] = JSON.stringify(entries);
}

function seedPrinciples(entries: ConsolidatedPrinciple[]): void {
  fileStore[PRINCIPLES_PATH] = JSON.stringify(entries);
}

function readPersistedLearnings(): LearningEntry[] {
  return JSON.parse(fileStore[LEARNINGS_PATH] || "[]");
}

function readPersistedPrinciples(): ConsolidatedPrinciple[] {
  return JSON.parse(fileStore[PRINCIPLES_PATH] || "[]");
}

function makeLearning(overrides: Partial<LearningEntry> = {}): LearningEntry {
  return {
    id: overrides.id ?? `learn_${Math.random().toString(36).slice(2, 10)}`,
    projectId: PROJECT,
    category: "pattern",
    summary: "use descriptive variable names",
    detail: "Descriptive names make code easier to read",
    source: "auto_extraction",
    confidence: 0.5,
    occurrences: 1,
    relatedFiles: [],
    relatedTools: [],
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LearningsService", () => {
  let svc: LearningsService;

  beforeEach(() => {
    // Clear mock file store
    for (const key of Object.keys(fileStore)) {
      delete fileStore[key];
    }
    vi.clearAllMocks();
    svc = new LearningsService(WORKTREE);
  });

  // ---- CRUD ----

  describe("recordLearning + getLearning", () => {
    it("records a new learning and retrieves it by id", () => {
      const entry = svc.recordLearning({
        projectId: PROJECT,
        category: "pattern",
        summary: "always add error handling",
        detail: "wrap async calls in try/catch",
        source: "user_feedback",
      });

      expect(entry.id).toMatch(/^learn_/);
      expect(entry.projectId).toBe(PROJECT);
      expect(entry.category).toBe("pattern");
      expect(entry.occurrences).toBe(1);
      expect(entry.confidence).toBe(0.3); // default

      const fetched = svc.getLearning(entry.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.summary).toBe("always add error handling");
    });

    it("returns null for unknown id", () => {
      expect(svc.getLearning("nonexistent")).toBeNull();
    });
  });

  describe("recordPattern / recordAntipattern", () => {
    it("recordPattern sets category to pattern", () => {
      const entry = svc.recordPattern({
        projectId: PROJECT,
        summary: "prefer const over let",
        detail: "immutability reduces bugs",
        source: "auto_extraction",
      });
      expect(entry.category).toBe("pattern");
    });

    it("recordAntipattern sets category to antipattern", () => {
      const entry = svc.recordAntipattern({
        projectId: PROJECT,
        summary: "avoid global mutable state",
        detail: "global state causes hard-to-debug issues",
        source: "doom_loop",
      });
      expect(entry.category).toBe("antipattern");
    });
  });

  describe("merging similar learnings", () => {
    it("merges when recording a similar summary for the same project and category", () => {
      const first = svc.recordLearning({
        projectId: PROJECT,
        category: "pattern",
        summary: "always use error handling in async functions",
        detail: "short detail",
        source: "auto_extraction",
        relatedFiles: ["a.ts"],
        relatedTools: ["eslint"],
      });

      // Nearly identical summary — should merge
      const second = svc.recordLearning({
        projectId: PROJECT,
        category: "pattern",
        summary: "use error handling in all async functions",
        detail: "a much longer and more detailed explanation of why error handling matters",
        source: "user_feedback",
        relatedFiles: ["b.ts"],
        relatedTools: ["typescript"],
      });

      // Should return the same entry (merged)
      expect(second.id).toBe(first.id);
      expect(second.occurrences).toBe(2);
      // Confidence bumped by 0.1
      expect(second.confidence).toBeCloseTo(0.4);
      // Longer detail replaces shorter one
      expect(second.detail).toContain("much longer");
      // Related files/tools merged
      expect(second.relatedFiles).toContain("a.ts");
      expect(second.relatedFiles).toContain("b.ts");
      expect(second.relatedTools).toContain("eslint");
      expect(second.relatedTools).toContain("typescript");

      // Only one entry persisted
      const all = svc.getLearnings();
      expect(all).toHaveLength(1);
    });

    it("does not merge when category differs", () => {
      svc.recordLearning({
        projectId: PROJECT,
        category: "pattern",
        summary: "use error handling in async functions",
        detail: "detail",
        source: "auto_extraction",
      });

      svc.recordLearning({
        projectId: PROJECT,
        category: "antipattern",
        summary: "use error handling in async functions",
        detail: "detail",
        source: "auto_extraction",
      });

      expect(svc.getLearnings()).toHaveLength(2);
    });

    it("does not merge when projectId differs", () => {
      svc.recordLearning({
        projectId: "proj-A",
        category: "pattern",
        summary: "use error handling in async functions",
        detail: "detail",
        source: "auto_extraction",
      });

      svc.recordLearning({
        projectId: "proj-B",
        category: "pattern",
        summary: "use error handling in async functions",
        detail: "detail",
        source: "auto_extraction",
      });

      expect(svc.getLearnings()).toHaveLength(2);
    });

    it("does not merge when summaries are dissimilar", () => {
      svc.recordLearning({
        projectId: PROJECT,
        category: "pattern",
        summary: "always add error handling in async functions",
        detail: "detail",
        source: "auto_extraction",
      });

      svc.recordLearning({
        projectId: PROJECT,
        category: "pattern",
        summary: "prefer immutable data structures for state management",
        detail: "detail",
        source: "auto_extraction",
      });

      expect(svc.getLearnings()).toHaveLength(2);
    });
  });

  describe("getLearnings filtering", () => {
    beforeEach(() => {
      seedLearnings([
        makeLearning({ id: "l1", projectId: "proj-A", category: "pattern", confidence: 0.9 }),
        makeLearning({ id: "l2", projectId: "proj-A", category: "antipattern", confidence: 0.3 }),
        makeLearning({ id: "l3", projectId: "proj-B", category: "pattern", confidence: 0.6 }),
        makeLearning({ id: "l4", projectId: "proj-A", category: "preference", confidence: 0.7 }),
      ]);
    });

    it("returns all learnings sorted by confidence desc when no filter", () => {
      const all = svc.getLearnings();
      expect(all).toHaveLength(4);
      expect(all[0].confidence).toBeGreaterThanOrEqual(all[1].confidence);
    });

    it("filters by projectId", () => {
      const filtered = svc.getLearnings({ projectId: "proj-A" });
      expect(filtered).toHaveLength(3);
      expect(filtered.every((l) => l.projectId === "proj-A")).toBe(true);
    });

    it("filters by category", () => {
      const filtered = svc.getLearnings({ category: "pattern" });
      expect(filtered).toHaveLength(2);
      expect(filtered.every((l) => l.category === "pattern")).toBe(true);
    });

    it("filters by minConfidence", () => {
      const filtered = svc.getLearnings({ minConfidence: 0.7 });
      expect(filtered).toHaveLength(2);
      expect(filtered.every((l) => l.confidence >= 0.7)).toBe(true);
    });

    it("combines multiple filters", () => {
      const filtered = svc.getLearnings({ projectId: "proj-A", minConfidence: 0.5 });
      expect(filtered).toHaveLength(2);
      expect(filtered.every((l) => l.projectId === "proj-A" && l.confidence >= 0.5)).toBe(true);
    });
  });

  describe("updateLearning", () => {
    it("updates specified fields and persists", () => {
      const entry = svc.recordLearning({
        projectId: PROJECT,
        category: "pattern",
        summary: "original summary",
        detail: "original detail",
        source: "auto_extraction",
      });

      const updated = svc.updateLearning(entry.id, {
        summary: "updated summary",
        confidence: 0.95,
      });

      expect(updated).not.toBeNull();
      expect(updated!.summary).toBe("updated summary");
      expect(updated!.confidence).toBe(0.95);
      // detail unchanged
      expect(updated!.detail).toBe("original detail");

      // Persisted
      const reloaded = svc.getLearning(entry.id);
      expect(reloaded!.summary).toBe("updated summary");
    });

    it("clamps confidence to [0, 1]", () => {
      const entry = svc.recordLearning({
        projectId: PROJECT,
        category: "pattern",
        summary: "test clamping",
        detail: "detail",
        source: "auto_extraction",
      });

      const over = svc.updateLearning(entry.id, { confidence: 5.0 });
      expect(over!.confidence).toBe(1);

      const under = svc.updateLearning(entry.id, { confidence: -2.0 });
      expect(under!.confidence).toBe(0);
    });

    it("returns null for unknown id", () => {
      expect(svc.updateLearning("nonexistent", { summary: "nope" })).toBeNull();
    });

    it("truncates summary to 200 and detail to 500 chars", () => {
      const entry = svc.recordLearning({
        projectId: PROJECT,
        category: "pattern",
        summary: "short",
        detail: "short",
        source: "auto_extraction",
      });

      const longSummary = "x".repeat(300);
      const longDetail = "y".repeat(700);

      const updated = svc.updateLearning(entry.id, {
        summary: longSummary,
        detail: longDetail,
      });

      expect(updated!.summary).toHaveLength(200);
      expect(updated!.detail).toHaveLength(500);
    });
  });

  describe("deleteLearning", () => {
    it("removes entry and returns true", () => {
      const entry = svc.recordLearning({
        projectId: PROJECT,
        category: "pattern",
        summary: "to be deleted",
        detail: "detail",
        source: "auto_extraction",
      });

      expect(svc.deleteLearning(entry.id)).toBe(true);
      expect(svc.getLearning(entry.id)).toBeNull();
      expect(svc.getLearnings()).toHaveLength(0);
    });

    it("returns false for unknown id", () => {
      expect(svc.deleteLearning("nonexistent")).toBe(false);
    });
  });

  // ---- MAX_LEARNINGS cap ----

  describe("MAX_LEARNINGS eviction", () => {
    it("evicts lowest-confidence entries when exceeding 200", () => {
      // Seed 200 learnings
      const existing: LearningEntry[] = [];
      for (let i = 0; i < 200; i++) {
        existing.push(
          makeLearning({
            id: `learn_existing_${i}`,
            summary: `existing learning number ${i} unique`,
            confidence: 0.5,
          }),
        );
      }
      seedLearnings(existing);

      // Record one more with high confidence
      const newEntry = svc.recordLearning({
        projectId: PROJECT,
        category: "pattern",
        summary: "brand new unique unrelated topic about quantum computing",
        detail: "detail",
        source: "user_feedback",
        confidence: 0.9,
      });

      const all = readPersistedLearnings();
      expect(all).toHaveLength(200);
      // The new high-confidence entry should survive eviction
      expect(all.some((l) => l.id === newEntry.id)).toBe(true);
    });
  });

  // ---- Consolidation ----

  describe("consolidate", () => {
    it("groups related learnings into principles", () => {
      // Create learnings that share tools and related content
      seedLearnings([
        makeLearning({
          id: "l1",
          summary: "handle errors in database queries properly",
          detail: "always wrap DB calls in try-catch",
          confidence: 0.7,
          relatedTools: ["prisma"],
        }),
        makeLearning({
          id: "l2",
          summary: "add error handling for database operations",
          detail: "use proper error handling for Prisma calls",
          confidence: 0.8,
          relatedTools: ["prisma"],
        }),
        makeLearning({
          id: "l3",
          summary: "validate input to database queries",
          detail: "sanitize user input before passing to DB",
          confidence: 0.6,
          relatedTools: ["prisma"],
        }),
      ]);

      const newPrinciples = svc.consolidate(PROJECT);
      expect(newPrinciples.length).toBeGreaterThanOrEqual(1);

      const principle = newPrinciples[0];
      expect(principle.id).toMatch(/^principle_/);
      expect(principle.projectId).toBe(PROJECT);
      expect(principle.principle).toBeTruthy();
      expect(principle.derivedFrom.length).toBeGreaterThanOrEqual(2);
      expect(principle.confidence).toBeGreaterThan(0);

      // Principles persisted
      const persisted = readPersistedPrinciples();
      expect(persisted.length).toBeGreaterThanOrEqual(1);
    });

    it("returns empty when fewer than 3 qualifying learnings", () => {
      seedLearnings([
        makeLearning({ id: "l1", confidence: 0.8 }),
        makeLearning({ id: "l2", confidence: 0.8, summary: "something completely different about deployment" }),
      ]);

      const result = svc.consolidate(PROJECT);
      expect(result).toEqual([]);
    });

    it("creates Avoid prefix for antipattern-only groups", () => {
      seedLearnings([
        makeLearning({
          id: "l1",
          category: "antipattern",
          summary: "avoid using any type in TypeScript",
          detail: "any disables type safety",
          confidence: 0.7,
          relatedTools: ["typescript"],
        }),
        makeLearning({
          id: "l2",
          category: "antipattern",
          summary: "never use any type in TS code",
          detail: "using any removes compile-time checks",
          confidence: 0.8,
          relatedTools: ["typescript"],
        }),
        makeLearning({
          id: "l3",
          category: "antipattern",
          summary: "stop using any type annotation",
          detail: "prefer unknown or explicit types",
          confidence: 0.6,
          relatedTools: ["typescript"],
        }),
      ]);

      const principles = svc.consolidate(PROJECT);
      expect(principles.length).toBeGreaterThanOrEqual(1);
      expect(principles[0].principle).toMatch(/^Avoid:/);
    });
  });

  // ---- formatForSystemPrompt ----

  describe("formatForSystemPrompt", () => {
    it("returns empty string when no principles exist", () => {
      expect(svc.formatForSystemPrompt(PROJECT)).toBe("");
    });

    it("returns empty string when no principles match project", () => {
      seedPrinciples([
        {
          id: "p1",
          projectId: "other-project",
          principle: "do something",
          reasoning: "because",
          derivedFrom: [],
          confidence: 0.9,
          createdAt: new Date().toISOString(),
        },
      ]);
      expect(svc.formatForSystemPrompt(PROJECT)).toBe("");
    });

    it("formats principles as markdown list", () => {
      seedPrinciples([
        {
          id: "p1",
          projectId: PROJECT,
          principle: "Prefer: use TypeScript strict mode",
          reasoning: "catches bugs",
          derivedFrom: ["l1"],
          confidence: 0.9,
          createdAt: new Date().toISOString(),
        },
        {
          id: "p2",
          projectId: PROJECT,
          principle: "Avoid: console.log in production code",
          reasoning: "noise",
          derivedFrom: ["l2"],
          confidence: 0.8,
          createdAt: new Date().toISOString(),
        },
      ]);

      const result = svc.formatForSystemPrompt(PROJECT);
      expect(result).toContain("## Project Learnings");
      expect(result).toContain("- Prefer: use TypeScript strict mode");
      expect(result).toContain("- Avoid: console.log in production code");
    });

    it("respects maxTokens cap and omits principles that exceed it", () => {
      const principles: ConsolidatedPrinciple[] = [];
      for (let i = 0; i < 15; i++) {
        principles.push({
          id: `p${i}`,
          projectId: PROJECT,
          principle: `Principle ${i}: ${"a".repeat(150)}`,
          reasoning: "reason",
          derivedFrom: [],
          confidence: 0.9 - i * 0.01,
          createdAt: new Date().toISOString(),
        });
      }
      seedPrinciples(principles);

      // With a generous budget, all 15 principles should fit.
      const fullResult = svc.formatForSystemPrompt(PROJECT, 10000);
      const fullLineCount = fullResult.split("\n").filter((l) => l.startsWith("- ")).length;
      expect(fullLineCount).toBe(15);

      // With a very small budget, fewer principles should appear.
      const smallResult = svc.formatForSystemPrompt(PROJECT, 200);
      const smallLineCount = smallResult.split("\n").filter((l) => l.startsWith("- ")).length;
      expect(smallLineCount).toBeGreaterThanOrEqual(1);
      expect(smallLineCount).toBeLessThan(15);
    });
  });

  // ---- pruneStale ----

  describe("pruneStale", () => {
    it("removes old low-confidence entries for the given project", () => {
      const oldDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(); // 90 days ago
      const recentDate = new Date().toISOString();

      seedLearnings([
        makeLearning({ id: "old-low", lastSeenAt: oldDate, confidence: 0.3 }),
        makeLearning({ id: "old-high", lastSeenAt: oldDate, confidence: 0.8 }),
        makeLearning({ id: "recent-low", lastSeenAt: recentDate, confidence: 0.2 }),
      ]);

      const pruned = svc.pruneStale(PROJECT);
      expect(pruned).toBe(1); // only old-low removed

      const remaining = readPersistedLearnings();
      expect(remaining).toHaveLength(2);
      expect(remaining.find((l) => l.id === "old-low")).toBeUndefined();
      expect(remaining.find((l) => l.id === "old-high")).toBeDefined();
      expect(remaining.find((l) => l.id === "recent-low")).toBeDefined();
    });

    it("does not prune entries from other projects", () => {
      const oldDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

      seedLearnings([
        makeLearning({ id: "other-proj", projectId: "other", lastSeenAt: oldDate, confidence: 0.1 }),
        makeLearning({ id: "this-proj", projectId: PROJECT, lastSeenAt: oldDate, confidence: 0.1 }),
      ]);

      const pruned = svc.pruneStale(PROJECT);
      expect(pruned).toBe(1);

      const remaining = readPersistedLearnings();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe("other-proj");
    });

    it("returns 0 when nothing to prune", () => {
      seedLearnings([
        makeLearning({ id: "fresh", lastSeenAt: new Date().toISOString(), confidence: 0.3 }),
      ]);

      expect(svc.pruneStale(PROJECT)).toBe(0);
    });
  });

  // ---- Stats ----

  describe("getStats", () => {
    it("returns correct counts scoped by projectId", () => {
      seedLearnings([
        makeLearning({ id: "l1", projectId: "proj-A" }),
        makeLearning({ id: "l2", projectId: "proj-A" }),
        makeLearning({ id: "l3", projectId: "proj-B" }),
      ]);
      seedPrinciples([
        {
          id: "p1",
          projectId: "proj-A",
          principle: "x",
          reasoning: "y",
          derivedFrom: [],
          confidence: 0.9,
          createdAt: new Date().toISOString(),
        },
      ]);

      const statsA = svc.getStats("proj-A");
      expect(statsA.learningsCount).toBe(2);
      expect(statsA.principlesCount).toBe(1);

      const statsB = svc.getStats("proj-B");
      expect(statsB.learningsCount).toBe(1);
      expect(statsB.principlesCount).toBe(0);
    });

    it("returns global counts when no projectId given", () => {
      seedLearnings([
        makeLearning({ id: "l1", projectId: "proj-A" }),
        makeLearning({ id: "l2", projectId: "proj-B" }),
      ]);
      seedPrinciples([]);

      const stats = svc.getStats();
      expect(stats.learningsCount).toBe(2);
      expect(stats.principlesCount).toBe(0);
    });
  });

  // ---- Edge cases ----

  describe("edge cases", () => {
    it("truncates summary to 200 chars and detail to 500 chars on record", () => {
      const entry = svc.recordLearning({
        projectId: PROJECT,
        category: "pattern",
        summary: "x".repeat(500),
        detail: "y".repeat(1000),
        source: "auto_extraction",
      });

      expect(entry.summary).toHaveLength(200);
      expect(entry.detail).toHaveLength(500);
    });

    it("caps relatedFiles at 20 and relatedTools at 10", () => {
      const files = Array.from({ length: 30 }, (_, i) => `file${i}.ts`);
      const tools = Array.from({ length: 15 }, (_, i) => `tool${i}`);

      const entry = svc.recordLearning({
        projectId: PROJECT,
        category: "pattern",
        summary: "many related items",
        detail: "testing caps",
        source: "auto_extraction",
        relatedFiles: files,
        relatedTools: tools,
      });

      expect(entry.relatedFiles).toHaveLength(20);
      expect(entry.relatedTools).toHaveLength(10);
    });

    it("handles empty / fresh filesystem gracefully", () => {
      // No files seeded at all
      expect(svc.getLearnings()).toEqual([]);
      expect(svc.getPrinciples()).toEqual([]);
      expect(svc.getStats()).toEqual({ learningsCount: 0, principlesCount: 0 });
    });

    it("handles corrupt JSON gracefully by returning fallback", () => {
      fileStore[LEARNINGS_PATH] = "not valid json!!!";
      expect(svc.getLearnings()).toEqual([]);
    });
  });
});
