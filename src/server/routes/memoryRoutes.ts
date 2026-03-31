import type { FastifyInstance } from "fastify";
import { MemoryService, memoryAgeLabel, memoryAgeDays, type EpisodicMemory } from "../services/memoryService";
import { RepoService } from "../services/repoService";

// ---------------------------------------------------------------------------
// Secret scanning — prevent credentials from being stored in memory
// ---------------------------------------------------------------------------

const SECRET_PATTERNS = [
  /(?:sk|pk|api)[_-](?:live|test|prod)?[_-]?[a-zA-Z0-9]{20,}/i,  // API keys
  /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}/,                    // GitHub tokens
  /xox[bpas]-[A-Za-z0-9-]{10,}/,                                    // Slack tokens
  /AKIA[0-9A-Z]{16}/,                                                // AWS access keys
  /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/,                   // Private keys
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,                     // JWTs
];

function containsSecret(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryListItem {
  id: string;
  taskDescription: string;
  summary: string;
  outcome: "success" | "failure" | "partial";
  keyFiles: string[];
  lessons: string[];
  createdAt: string;
  ageLabel: string;
  ageDays: number;
}

export interface MemoryStats {
  episodicCount: number;
  oldestCreatedAt: string | null;
  newestCreatedAt: string | null;
  successCount: number;
  failureCount: number;
  partialCount: number;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerMemoryRoutes(deps: {
  app: FastifyInstance;
  repoService: RepoService;
}) {
  const { app } = deps;
  const memoryInstances = new Map<string, MemoryService>();

  function getMemoryForProject(worktreePath: string): MemoryService {
    let service = memoryInstances.get(worktreePath);
    if (!service) {
      service = new MemoryService(worktreePath);
      service.loadEpisodicMemory();
      memoryInstances.set(worktreePath, service);
    }
    return service;
  }

  // ── List all episodic memories for a project ───────────────────────

  app.get<{
    Querystring: { worktreePath: string; search?: string; outcome?: string; limit?: string };
  }>("/api/v1/memory", async (request) => {
    const { worktreePath, search, outcome, limit } = request.query;
    if (!worktreePath) {
      return { error: "worktreePath is required", memories: [], stats: null };
    }

    const service = getMemoryForProject(worktreePath);
    let memories: EpisodicMemory[];

    if (search) {
      memories = service.getRelevantEpisodicMemories(search);
    } else {
      // Return all memories, newest first
      memories = service.getRelevantEpisodicMemories("");
      // getRelevant returns by score; for "list all" we want recency order
      memories = [...memories].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    }

    // Filter by outcome if specified
    if (outcome && (outcome === "success" || outcome === "failure" || outcome === "partial")) {
      memories = memories.filter((m) => m.outcome === outcome);
    }

    // Apply limit
    const maxItems = Math.min(parseInt(limit ?? "50", 10) || 50, 200);
    memories = memories.slice(0, maxItems);

    const items: MemoryListItem[] = memories.map((m) => ({
      ...m,
      ageLabel: memoryAgeLabel(m.createdAt),
      ageDays: memoryAgeDays(m.createdAt),
    }));

    // Compute stats from the full set (not filtered)
    const allMemories = service.getRelevantEpisodicMemories("");
    const stats: MemoryStats = {
      episodicCount: service.episodicCount(),
      oldestCreatedAt: allMemories.length > 0
        ? allMemories.reduce((oldest, m) =>
            new Date(m.createdAt) < new Date(oldest.createdAt) ? m : oldest,
          ).createdAt
        : null,
      newestCreatedAt: allMemories.length > 0
        ? allMemories.reduce((newest, m) =>
            new Date(m.createdAt) > new Date(newest.createdAt) ? m : newest,
          ).createdAt
        : null,
      successCount: allMemories.filter((m) => m.outcome === "success").length,
      failureCount: allMemories.filter((m) => m.outcome === "failure").length,
      partialCount: allMemories.filter((m) => m.outcome === "partial").length,
    };

    return { memories: items, stats };
  });

  // ── Get a single memory by ID ─────────────────────────────────────

  app.get<{
    Params: { id: string };
    Querystring: { worktreePath: string };
  }>("/api/v1/memory/:id", async (request, reply) => {
    const { worktreePath } = request.query;
    if (!worktreePath) {
      return reply.code(400).send({ error: "worktreePath is required" });
    }

    const service = getMemoryForProject(worktreePath);
    const all = service.getRelevantEpisodicMemories("");
    const memory = all.find((m) => m.id === request.params.id);

    if (!memory) {
      return reply.code(404).send({ error: "Memory not found" });
    }

    return {
      ...memory,
      ageLabel: memoryAgeLabel(memory.createdAt),
      ageDays: memoryAgeDays(memory.createdAt),
    };
  });

  // ── Create a new episodic memory ──────────────────────────────────

  app.post<{
    Body: {
      worktreePath: string;
      taskDescription: string;
      summary: string;
      outcome: "success" | "failure" | "partial";
      keyFiles?: string[];
      lessons?: string[];
    };
  }>("/api/v1/memory", async (request, reply) => {
    const { worktreePath, taskDescription, summary, outcome, keyFiles, lessons } = request.body;

    if (!worktreePath || !taskDescription || !summary || !outcome) {
      return reply.code(400).send({ error: "worktreePath, taskDescription, summary, and outcome are required" });
    }

    // Secret scanning
    const allText = [taskDescription, summary, ...(lessons ?? [])].join(" ");
    if (containsSecret(allText)) {
      return reply.code(400).send({
        error: "Memory content appears to contain sensitive credentials. Remove secrets before saving.",
      });
    }

    const service = getMemoryForProject(worktreePath);
    const memory = service.addEpisodicMemory({
      taskDescription,
      summary,
      outcome,
      keyFiles,
      lessons,
    });

    return {
      ...memory,
      ageLabel: memoryAgeLabel(memory.createdAt),
      ageDays: memoryAgeDays(memory.createdAt),
    };
  });

  // ── Delete a memory by ID ────────────────────────────────────────

  app.delete<{
    Params: { id: string };
    Querystring: { worktreePath: string };
  }>("/api/v1/memory/:id", async (request, reply) => {
    const { worktreePath } = request.query;
    if (!worktreePath) {
      return reply.code(400).send({ error: "worktreePath is required" });
    }

    const service = getMemoryForProject(worktreePath);
    // Access internal episodic array via the eviction mechanism
    // We need to find and remove the specific memory
    const all = service.getRelevantEpisodicMemories("");
    const target = all.find((m) => m.id === request.params.id);

    if (!target) {
      return reply.code(404).send({ error: "Memory not found" });
    }

    // Remove by evicting all, then re-adding all except the target
    // This is safe because episodic memory is small (max 50)
    const remaining = all.filter((m) => m.id !== request.params.id);
    service.clearAll();
    for (const m of remaining) {
      service.addEpisodicMemory({
        taskDescription: m.taskDescription,
        summary: m.summary,
        outcome: m.outcome,
        keyFiles: m.keyFiles,
        lessons: m.lessons,
      });
    }

    return { deleted: true, id: request.params.id };
  });

  // ── Get memory stats (for mission snapshot) ──────────────────────

  app.get<{
    Querystring: { worktreePath: string };
  }>("/api/v1/memory/stats", async (request) => {
    const { worktreePath } = request.query;
    if (!worktreePath) {
      return { stats: null };
    }

    const service = getMemoryForProject(worktreePath);
    const composition = service.compose("", undefined);

    return {
      stats: {
        ...composition.stats,
        episodicTotal: service.episodicCount(),
        workingTotal: service.workingCount(),
      },
    };
  });
}
