import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerLearningsRoutes } from "./learningsRoutes";

// ---------------------------------------------------------------------------
// Mock LearningsService and SkillSynthesizer — intercept constructor calls
// ---------------------------------------------------------------------------

const learningsServiceMocks = {
  getLearnings: vi.fn().mockReturnValue([]),
  getLearning: vi.fn().mockReturnValue(null),
  recordLearning: vi.fn(),
  updateLearning: vi.fn(),
  deleteLearning: vi.fn().mockReturnValue(true),
  getPrinciples: vi.fn().mockReturnValue([]),
  consolidate: vi.fn().mockReturnValue([]),
  pruneStale: vi.fn().mockReturnValue(0),
  getStats: vi.fn().mockReturnValue({ learningsCount: 0, principlesCount: 0 }),
};

const skillSynthesizerMocks = {
  listSuggestedSkills: vi.fn().mockReturnValue([]),
  approveSkill: vi.fn().mockReturnValue(null),
  dismissSkill: vi.fn().mockReturnValue(null),
};

vi.mock("../services/learningsService", () => ({
  LearningsService: vi.fn().mockImplementation(() => learningsServiceMocks),
}));

vi.mock("../services/skillSynthesizer", () => ({
  SkillSynthesizer: vi.fn().mockImplementation(() => skillSynthesizerMocks),
}));

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const PROJECT_ID = "proj-test";

function createHarness() {
  const app = Fastify();
  const repoService = {
    getActiveWorktreePath: vi.fn().mockResolvedValue("/tmp/test-worktree"),
  };

  registerLearningsRoutes({ app, repoService: repoService as any });

  return { app, repoService };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sampleLearning = {
  id: "learn_abc123",
  projectId: PROJECT_ID,
  category: "pattern" as const,
  summary: "Always run lint before commit",
  detail: "Running lint before commit catches formatting issues early.",
  source: "user_feedback" as const,
  confidence: 0.5,
  occurrences: 1,
  relatedFiles: ["src/index.ts"],
  relatedTools: ["eslint"],
  createdAt: "2026-04-01T00:00:00.000Z",
  lastSeenAt: "2026-04-01T00:00:00.000Z",
};

const samplePrinciple = {
  id: "principle_xyz789",
  projectId: PROJECT_ID,
  principle: "Prefer: Always run lint before commit",
  reasoning: "Running lint before commit catches formatting issues early.",
  derivedFrom: ["learn_abc123"],
  confidence: 0.7,
  createdAt: "2026-04-02T00:00:00.000Z",
};

const sampleSuggestedSkill = {
  id: "suggested_sk001",
  projectId: PROJECT_ID,
  name: "lint-eslint",
  description: "Auto lint with eslint before commit",
  systemPrompt: "You are a lint specialist.",
  allowedTools: ["eslint"],
  tags: ["synthesized"],
  derivedFromLearnings: ["learn_abc123"],
  confidence: 0.8,
  status: "pending" as const,
  createdAt: "2026-04-03T00:00:00.000Z",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("learnings routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore defaults
    learningsServiceMocks.getLearnings.mockReturnValue([]);
    learningsServiceMocks.getLearning.mockReturnValue(null);
    learningsServiceMocks.deleteLearning.mockReturnValue(true);
    learningsServiceMocks.consolidate.mockReturnValue([]);
    learningsServiceMocks.getStats.mockReturnValue({ learningsCount: 0, principlesCount: 0 });
    learningsServiceMocks.getPrinciples.mockReturnValue([]);
    skillSynthesizerMocks.listSuggestedSkills.mockReturnValue([]);
    skillSynthesizerMocks.approveSkill.mockReturnValue(null);
    skillSynthesizerMocks.dismissSkill.mockReturnValue(null);
  });

  // ---- GET /api/learnings ----

  it("GET /api/learnings returns filtered items", async () => {
    learningsServiceMocks.getLearnings.mockReturnValue([sampleLearning]);
    const { app } = createHarness();

    const res = await app.inject({
      method: "GET",
      url: `/api/learnings?projectId=${PROJECT_ID}&category=pattern&minConfidence=0.3`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe("learn_abc123");
    expect(learningsServiceMocks.getLearnings).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      category: "pattern",
      minConfidence: 0.3,
    });
    await app.close();
  });

  // ---- GET /api/learnings/:id ----

  it("GET /api/learnings/:id returns the matching learning", async () => {
    learningsServiceMocks.getLearning.mockReturnValue(sampleLearning);
    const { app } = createHarness();

    const res = await app.inject({
      method: "GET",
      url: `/api/learnings/learn_abc123?projectId=${PROJECT_ID}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().item.id).toBe("learn_abc123");
    await app.close();
  });

  it("GET /api/learnings/:id returns null when not found", async () => {
    const { app } = createHarness();

    const res = await app.inject({
      method: "GET",
      url: `/api/learnings/nonexistent?projectId=${PROJECT_ID}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().item).toBeNull();
    await app.close();
  });

  // ---- POST /api/learnings ----

  it("POST /api/learnings creates a new learning", async () => {
    learningsServiceMocks.recordLearning.mockReturnValue(sampleLearning);
    const { app } = createHarness();

    const res = await app.inject({
      method: "POST",
      url: "/api/learnings",
      payload: {
        projectId: PROJECT_ID,
        category: "pattern",
        summary: "Always run lint before commit",
        detail: "Running lint before commit catches formatting issues early.",
        relatedFiles: ["src/index.ts"],
        relatedTools: ["eslint"],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().item.id).toBe("learn_abc123");
    expect(learningsServiceMocks.recordLearning).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        category: "pattern",
        summary: "Always run lint before commit",
        source: "user_feedback",
      }),
    );
    await app.close();
  });

  // ---- PUT /api/learnings/:id ----

  it("PUT /api/learnings/:id updates a learning", async () => {
    const updated = { ...sampleLearning, summary: "Updated summary" };
    learningsServiceMocks.updateLearning.mockReturnValue(updated);
    const { app } = createHarness();

    const res = await app.inject({
      method: "PUT",
      url: "/api/learnings/learn_abc123",
      payload: {
        projectId: PROJECT_ID,
        summary: "Updated summary",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().item.summary).toBe("Updated summary");
    expect(learningsServiceMocks.updateLearning).toHaveBeenCalledWith(
      "learn_abc123",
      expect.objectContaining({ summary: "Updated summary" }),
    );
    await app.close();
  });

  // ---- DELETE /api/learnings/:id ----

  it("DELETE /api/learnings/:id removes a learning", async () => {
    const { app } = createHarness();

    const res = await app.inject({
      method: "DELETE",
      url: `/api/learnings/learn_abc123?projectId=${PROJECT_ID}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(learningsServiceMocks.deleteLearning).toHaveBeenCalledWith("learn_abc123");
    await app.close();
  });

  // ---- GET /api/learnings/principles ----

  it("GET /api/learnings/principles returns principles list", async () => {
    learningsServiceMocks.getPrinciples.mockReturnValue([samplePrinciple]);
    const { app } = createHarness();

    const res = await app.inject({
      method: "GET",
      url: `/api/learnings/principles?projectId=${PROJECT_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe("principle_xyz789");
    await app.close();
  });

  // ---- POST /api/learnings/dream/trigger ----

  it("POST /api/learnings/dream/trigger runs consolidation and prune", async () => {
    learningsServiceMocks.consolidate.mockReturnValue([samplePrinciple]);
    const { app } = createHarness();

    const res = await app.inject({
      method: "POST",
      url: "/api/learnings/dream/trigger",
      payload: { projectId: PROJECT_ID },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, principlesCreated: 1 });
    expect(learningsServiceMocks.consolidate).toHaveBeenCalledWith(PROJECT_ID);
    expect(learningsServiceMocks.pruneStale).toHaveBeenCalledWith(PROJECT_ID);
    await app.close();
  });

  // ---- GET /api/learnings/dream/stats ----

  it("GET /api/learnings/dream/stats returns counts", async () => {
    learningsServiceMocks.getStats.mockReturnValue({ learningsCount: 5, principlesCount: 2 });
    const { app } = createHarness();

    const res = await app.inject({
      method: "GET",
      url: `/api/learnings/dream/stats?projectId=${PROJECT_ID}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ learningsCount: 5, principlesCount: 2 });
    await app.close();
  });

  it("GET /api/learnings/dream/stats returns zeros when projectId missing", async () => {
    const { app } = createHarness();

    const res = await app.inject({
      method: "GET",
      url: "/api/learnings/dream/stats",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ learningsCount: 0, principlesCount: 0 });
    await app.close();
  });

  // ---- GET /api/learnings/skills/suggested ----

  it("GET /api/learnings/skills/suggested returns suggested skills", async () => {
    skillSynthesizerMocks.listSuggestedSkills.mockReturnValue([sampleSuggestedSkill]);
    const { app } = createHarness();

    const res = await app.inject({
      method: "GET",
      url: `/api/learnings/skills/suggested?projectId=${PROJECT_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].name).toBe("lint-eslint");
    await app.close();
  });

  // ---- POST /api/learnings/skills/suggested/:id/approve ----

  it("POST /api/learnings/skills/suggested/:id/approve approves a skill", async () => {
    const approved = { ...sampleSuggestedSkill, status: "approved" };
    skillSynthesizerMocks.approveSkill.mockReturnValue(approved);
    const { app } = createHarness();

    const res = await app.inject({
      method: "POST",
      url: "/api/learnings/skills/suggested/suggested_sk001/approve",
      payload: { projectId: PROJECT_ID },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().item.status).toBe("approved");
    expect(skillSynthesizerMocks.approveSkill).toHaveBeenCalledWith("suggested_sk001");
    await app.close();
  });

  // ---- POST /api/learnings/skills/suggested/:id/dismiss ----

  it("POST /api/learnings/skills/suggested/:id/dismiss dismisses a skill", async () => {
    const dismissed = { ...sampleSuggestedSkill, status: "dismissed" };
    skillSynthesizerMocks.dismissSkill.mockReturnValue(dismissed);
    const { app } = createHarness();

    const res = await app.inject({
      method: "POST",
      url: "/api/learnings/skills/suggested/suggested_sk001/dismiss",
      payload: { projectId: PROJECT_ID },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().item.status).toBe("dismissed");
    expect(skillSynthesizerMocks.dismissSkill).toHaveBeenCalledWith("suggested_sk001");
    await app.close();
  });
});
