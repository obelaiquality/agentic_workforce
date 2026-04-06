import type { FastifyInstance } from "fastify";
import { LearningsService } from "../services/learningsService";
import { SkillSynthesizer } from "../services/skillSynthesizer";
import { GlobalKnowledgePool } from "../services/globalKnowledgePool";
import type { RepoService } from "../services/repoService";
import type { LearningCategory } from "../../shared/contracts";

interface LearningsRouteDeps {
  app: FastifyInstance;
  repoService: RepoService;
}

export function registerLearningsRoutes({ app, repoService }: LearningsRouteDeps) {
  // Helper to resolve worktree path for a project
  async function getWorktreePath(projectId: string | undefined | null): Promise<string> {
    if (!projectId) throw new Error("projectId is required");
    return repoService.getActiveWorktreePath(projectId);
  }

  // ---- Learnings CRUD ----

  app.get("/api/learnings", async (request) => {
    const query = request.query as { projectId?: string; category?: LearningCategory; minConfidence?: string };
    const worktreePath = await getWorktreePath(query.projectId);
    const svc = new LearningsService(worktreePath);
    const items = svc.getLearnings({
      projectId: query.projectId,
      category: query.category,
      minConfidence: query.minConfidence ? parseFloat(query.minConfidence) : undefined,
    });
    return { items };
  });

  app.get("/api/learnings/:id", async (request) => {
    const { id } = request.params as { id: string };
    const { projectId } = request.query as { projectId?: string };
    const worktreePath = await getWorktreePath(projectId);
    const svc = new LearningsService(worktreePath);
    const item = svc.getLearning(id);
    if (!item) return { item: null };
    return { item };
  });

  app.post("/api/learnings", async (request) => {
    const body = request.body as {
      projectId: string;
      category: LearningCategory;
      summary: string;
      detail: string;
      source?: string;
      relatedFiles?: string[];
      relatedTools?: string[];
    };
    const worktreePath = await getWorktreePath(body.projectId);
    const svc = new LearningsService(worktreePath);
    const item = svc.recordLearning({
      projectId: body.projectId,
      category: body.category,
      summary: body.summary,
      detail: body.detail,
      source: (body.source as any) || "user_feedback",
      relatedFiles: body.relatedFiles,
      relatedTools: body.relatedTools,
    });
    return { item };
  });

  app.put("/api/learnings/:id", async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      projectId?: string;
      summary?: string;
      detail?: string;
      category?: LearningCategory;
      confidence?: number;
    };
    const worktreePath = await getWorktreePath(body.projectId);
    const svc = new LearningsService(worktreePath);
    const item = svc.updateLearning(id, body);
    return { item };
  });

  app.delete("/api/learnings/:id", async (request) => {
    const { id } = request.params as { id: string };
    const { projectId } = request.query as { projectId?: string };
    const worktreePath = await getWorktreePath(projectId);
    const svc = new LearningsService(worktreePath);
    const deleted = svc.deleteLearning(id);
    return { ok: deleted };
  });

  // ---- Principles ----

  app.get("/api/learnings/principles", async (request) => {
    const { projectId } = request.query as { projectId?: string };
    const worktreePath = await getWorktreePath(projectId);
    const svc = new LearningsService(worktreePath);
    const items = svc.getPrinciples(projectId);
    return { items };
  });

  // ---- Dream cycle ----

  app.post("/api/learnings/dream/trigger", async (request) => {
    const { projectId } = (request.body || {}) as { projectId?: string };
    const worktreePath = await getWorktreePath(projectId);
    const svc = new LearningsService(worktreePath);
    const newPrinciples = svc.consolidate(projectId!);
    svc.pruneStale(projectId!);
    return { ok: true, principlesCreated: newPrinciples.length };
  });

  app.get("/api/learnings/dream/stats", async (request) => {
    const { projectId } = request.query as { projectId?: string };
    if (!projectId) {
      return { learningsCount: 0, principlesCount: 0 };
    }
    const worktreePath = await getWorktreePath(projectId);
    const svc = new LearningsService(worktreePath);
    return svc.getStats(projectId);
  });

  // ---- Suggested skills ----

  app.get("/api/learnings/skills/suggested", async (request) => {
    const { projectId } = request.query as { projectId?: string };
    const worktreePath = await getWorktreePath(projectId);
    const svc = new LearningsService(worktreePath);
    const synth = new SkillSynthesizer(svc, worktreePath);
    const items = synth.listSuggestedSkills(projectId);
    return { items };
  });

  app.post("/api/learnings/skills/suggested/:id/approve", async (request) => {
    const { id } = request.params as { id: string };
    const { projectId } = (request.body || {}) as { projectId?: string };
    const worktreePath = await getWorktreePath(projectId);
    const svc = new LearningsService(worktreePath);
    const synth = new SkillSynthesizer(svc, worktreePath);
    const item = synth.approveSkill(id);
    return { item };
  });

  app.post("/api/learnings/skills/suggested/:id/dismiss", async (request) => {
    const { id } = request.params as { id: string };
    const { projectId } = (request.body || {}) as { projectId?: string };
    const worktreePath = await getWorktreePath(projectId);
    const svc = new LearningsService(worktreePath);
    const synth = new SkillSynthesizer(svc, worktreePath);
    const item = synth.dismissSkill(id);
    return { item };
  });

  // ---- Cross-Project Global Knowledge ----

  app.get("/api/learnings/global", async (request) => {
    const query = request.query as { techFingerprint?: string; limit?: string; minConfidence?: string };
    const pool = new GlobalKnowledgePool();
    const fingerprint = query.techFingerprint ? query.techFingerprint.split(",").map((s) => s.trim()) : [];
    const items = await pool.queryRelevant(fingerprint, {
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      minConfidence: query.minConfidence ? parseFloat(query.minConfidence) : undefined,
    });
    return { items };
  });

  app.get("/api/learnings/global/principles", async () => {
    const pool = new GlobalKnowledgePool();
    const items = await pool.consolidateGlobal();
    // Return existing principles rather than re-consolidating
    const { prisma } = await import("../db");
    const principles = await prisma.globalPrinciple.findMany({
      orderBy: { confidence: "desc" },
    });
    return { items: principles };
  });
}
