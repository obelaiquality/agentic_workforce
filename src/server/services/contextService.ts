import { prisma } from "../db";
import { publishEvent } from "../eventBus";
import type { ContextManifest, KnowledgeHit, MemoryRecord, RetrievalTrace, WorkflowStateRecord } from "../../shared/contracts";
import { V2EventService } from "./v2EventService";

interface MaterializeContextInput {
  actor: string;
  repo_id?: string;
  aggregate_id: string;
  aggregate_type: "ticket" | "run" | "lane";
  goal: string;
  query?: string;
  constraints?: string[];
  active_files?: string[];
  retrieval_ids?: string[];
  memory_refs?: string[];
  open_questions?: string[];
  verification_plan?: string[];
  rollback_plan?: string[];
  policy_scopes?: string[];
  metadata?: Record<string, unknown>;
}

interface CommitMemoryInput {
  actor: string;
  repo_id?: string;
  aggregate_id: string;
  kind: MemoryRecord["kind"];
  content: string;
  citations?: string[];
  confidence?: number;
  stale_after?: string | null;
  metadata?: Record<string, unknown>;
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function mapContext(row: {
  id: string;
  repoId: string | null;
  aggregateId: string;
  aggregateType: string;
  goal: string;
  constraints: unknown;
  activeFiles: unknown;
  retrievalIds: unknown;
  memoryRefs: unknown;
  openQuestions: unknown;
  verificationPlan: unknown;
  rollbackPlan: unknown;
  policyScopes: unknown;
  version: number;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}): ContextManifest {
  return {
    id: row.id,
    repoId: row.repoId,
    aggregateId: row.aggregateId,
    aggregateType: row.aggregateType as ContextManifest["aggregateType"],
    goal: row.goal,
    constraints: asStringArray(row.constraints),
    activeFiles: asStringArray(row.activeFiles),
    retrievalIds: asStringArray(row.retrievalIds),
    memoryRefs: asStringArray(row.memoryRefs),
    openQuestions: asStringArray(row.openQuestions),
    verificationPlan: asStringArray(row.verificationPlan),
    rollbackPlan: asStringArray(row.rollbackPlan),
    policyScopes: asStringArray(row.policyScopes),
    version: row.version,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapMemory(row: {
  id: string;
  kind: string;
  repoId: string | null;
  aggregateId: string;
  content: string;
  citations: unknown;
  confidence: number;
  staleAfter: Date | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}): MemoryRecord {
  return {
    id: row.id,
    kind: row.kind as MemoryRecord["kind"],
    repoId: row.repoId,
    aggregateId: row.aggregateId,
    content: row.content,
    citations: asStringArray(row.citations),
    confidence: row.confidence,
    staleAfter: row.staleAfter?.toISOString() ?? null,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapWorkflow(row: {
  id: string;
  repoId: string | null;
  aggregateId: string;
  phase: string;
  status: string;
  summary: string;
  nextSteps: unknown;
  blockers: unknown;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}): WorkflowStateRecord {
  return {
    id: row.id,
    repoId: row.repoId,
    aggregateId: row.aggregateId,
    phase: row.phase,
    status: row.status,
    summary: row.summary,
    nextSteps: asStringArray(row.nextSteps),
    blockers: asStringArray(row.blockers),
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapHit(row: { id: string; source: string; path: string; snippet: string; score: number; embeddingId: string | null }): KnowledgeHit {
  return {
    id: row.id,
    source: row.source,
    path: row.path,
    snippet: row.snippet,
    score: row.score,
    embedding_id: row.embeddingId,
  };
}

export class ContextService {
  constructor(private readonly events: V2EventService) {}

  async materializeContext(input: MaterializeContextInput): Promise<{ context: ContextManifest; retrievalTrace: RetrievalTrace | null }> {
    const latest = await prisma.contextManifest.findFirst({
      where: {
        aggregateId: input.aggregate_id,
        aggregateType: input.aggregate_type,
      },
      orderBy: { version: "desc" },
    });

    const results = input.retrieval_ids?.length
      ? [
          ...(await prisma.knowledgeIndexMetadata.findMany({
            where: { id: { in: input.retrieval_ids } },
            orderBy: [{ score: "desc" }, { updatedAt: "desc" }],
            take: 20,
          })),
          ...(
            await prisma.codeGraphNode.findMany({
              where: { id: { in: input.retrieval_ids } },
              orderBy: { updatedAt: "desc" },
              take: 20,
            })
          ).map((row) => ({
            id: row.id,
            source: `code_graph:${row.kind}`,
            path: row.path,
            snippet: (row.content || row.name).slice(0, 320),
            score: 1,
            embeddingId: null,
          })),
        ]
      : [];

    const context = await prisma.contextManifest.create({
      data: {
        repoId: input.repo_id || null,
        aggregateId: input.aggregate_id,
        aggregateType: input.aggregate_type,
        goal: input.goal,
        constraints: input.constraints || [],
        activeFiles: input.active_files || [],
        retrievalIds: input.retrieval_ids || [],
        memoryRefs: input.memory_refs || [],
        openQuestions: input.open_questions || [],
        verificationPlan: input.verification_plan || [],
        rollbackPlan: input.rollback_plan || [],
        policyScopes: input.policy_scopes || [],
        version: (latest?.version || 0) + 1,
        metadata: input.metadata || {},
      },
    });

    const retrievalTrace = input.query || input.retrieval_ids?.length
      ? await prisma.retrievalTrace.create({
          data: {
            repoId: input.repo_id || null,
            aggregateId: input.aggregate_id,
            query: input.query || input.goal,
            retrievalIds: input.retrieval_ids || [],
            results: results.map((row) => mapHit(row)),
            metadata: {
              aggregate_type: input.aggregate_type,
            },
          },
        })
      : null;

    await prisma.workflowStateProjection.create({
      data: {
        repoId: input.repo_id || null,
        aggregateId: input.aggregate_id,
        phase: "context",
        status: "ready",
        summary: `Context materialized for ${input.aggregate_type}`,
        nextSteps: ["execute", "verify"],
        blockers: [],
        metadata: {
          contextManifestId: context.id,
          retrievalTraceId: retrievalTrace?.id || null,
          repoId: input.repo_id || null,
        },
      },
    });

    await this.events.appendEvent({
      type: "context.materialized",
      aggregateId: input.aggregate_id,
      actor: input.actor,
      payload: {
        context_manifest_id: context.id,
        repo_id: input.repo_id || null,
        aggregate_type: input.aggregate_type,
        retrieval_trace_id: retrievalTrace?.id || null,
      },
    });

    publishEvent("global", "context.materialized", {
      aggregateId: input.aggregate_id,
      contextManifestId: context.id,
      retrievalTraceId: retrievalTrace?.id || null,
    });

    return {
      context: mapContext(context),
      retrievalTrace: retrievalTrace
        ? {
            id: retrievalTrace.id,
            repoId: retrievalTrace.repoId ?? null,
            aggregateId: retrievalTrace.aggregateId,
            query: retrievalTrace.query,
            retrievalIds: asStringArray(retrievalTrace.retrievalIds),
            results: Array.isArray(retrievalTrace.results) ? (retrievalTrace.results as KnowledgeHit[]) : [],
            createdAt: retrievalTrace.createdAt.toISOString(),
          }
        : null,
    };
  }

  async commitMemory(input: CommitMemoryInput) {
    const row = await prisma.memoryRecord.create({
      data: {
        repoId: input.repo_id || null,
        aggregateId: input.aggregate_id,
        kind: input.kind,
        content: input.content,
        citations: input.citations || [],
        confidence: typeof input.confidence === "number" ? input.confidence : 0.7,
        staleAfter: input.stale_after ? new Date(input.stale_after) : null,
        metadata: input.metadata || {},
      },
    });

    await this.events.appendEvent({
      type: "memory.committed",
      aggregateId: input.aggregate_id,
      actor: input.actor,
      payload: {
        memory_id: row.id,
        kind: input.kind,
      },
    });

    return mapMemory(row);
  }

  async getLatestContext(aggregateId: string) {
    const row = await prisma.contextManifest.findFirst({
      where: { aggregateId },
      orderBy: [{ version: "desc" }, { updatedAt: "desc" }],
    });

    return row ? mapContext(row) : null;
  }

  async getWorkflowState(aggregateId: string) {
    const row = await prisma.workflowStateProjection.findFirst({
      where: { aggregateId },
      orderBy: { updatedAt: "desc" },
    });
    return row ? mapWorkflow(row) : null;
  }

  async searchMemory(query: string) {
    if (!query.trim()) {
      return [];
    }

    const rows = await prisma.memoryRecord.findMany({
      where: {
        OR: [{ content: { contains: query, mode: "insensitive" } }],
      },
      orderBy: [{ confidence: "desc" }, { updatedAt: "desc" }],
      take: 30,
    });

    return rows.map(mapMemory);
  }

  async getRetrievalTrace(runId: string) {
    const rows = await prisma.retrievalTrace.findMany({
      where: { aggregateId: runId },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    return rows.map((row) => ({
      id: row.id,
      repoId: row.repoId ?? null,
      aggregateId: row.aggregateId,
      query: row.query,
      retrievalIds: asStringArray(row.retrievalIds),
      results: Array.isArray(row.results) ? (row.results as KnowledgeHit[]) : [],
      createdAt: row.createdAt.toISOString(),
    }));
  }
}
