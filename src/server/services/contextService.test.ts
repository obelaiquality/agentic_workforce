import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ContextManifest, MemoryRecord, RetrievalTrace, WorkflowStateRecord } from "../../shared/contracts";

const mocks = vi.hoisted(() => ({
  prisma: {
    contextManifest: { findFirst: vi.fn(), create: vi.fn() },
    knowledgeIndexMetadata: { findMany: vi.fn() },
    codeGraphNode: { findMany: vi.fn() },
    workflowStateProjection: { create: vi.fn(), findFirst: vi.fn() },
    retrievalTrace: { create: vi.fn(), findMany: vi.fn() },
    memoryRecord: { create: vi.fn(), findMany: vi.fn() },
  },
  publishEvent: vi.fn(),
  v2EventService: { appendEvent: vi.fn() },
}));

vi.mock("../db", () => ({ prisma: mocks.prisma }));
vi.mock("../eventBus", () => ({ publishEvent: mocks.publishEvent }));
vi.mock("./v2EventService", () => ({ V2EventService: vi.fn(() => mocks.v2EventService) }));

import { ContextService } from "./contextService";
import { V2EventService } from "./v2EventService";

describe("ContextService", () => {
  let service: ContextService;
  let eventService: V2EventService;

  beforeEach(() => {
    vi.clearAllMocks();
    eventService = new V2EventService();
    service = new ContextService(eventService);
  });

  describe("materializeContext", () => {
    it("creates context manifest with version 1 when no previous exists", async () => {
      mocks.prisma.contextManifest.findFirst.mockResolvedValue(null);
      mocks.prisma.contextManifest.create.mockResolvedValue({
        id: "ctx-1",
        repoId: null,
        aggregateId: "run-123",
        aggregateType: "run",
        goal: "test goal",
        constraints: [],
        activeFiles: [],
        retrievalIds: [],
        memoryRefs: [],
        openQuestions: [],
        verificationPlan: [],
        rollbackPlan: [],
        policyScopes: [],
        version: 1,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mocks.prisma.workflowStateProjection.create.mockResolvedValue({
        id: "wf-1",
        repoId: null,
        aggregateId: "run-123",
        phase: "context",
        status: "ready",
        summary: "Context materialized for run",
        nextSteps: ["execute", "verify"],
        blockers: [],
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.materializeContext({
        actor: "test-user",
        aggregate_id: "run-123",
        aggregate_type: "run",
        goal: "test goal",
      });

      expect(result.context.version).toBe(1);
      expect(result.context.aggregateId).toBe("run-123");
      expect(mocks.prisma.contextManifest.create).toHaveBeenCalled();
    });

    it("increments version when previous context exists", async () => {
      mocks.prisma.contextManifest.findFirst.mockResolvedValue({
        id: "ctx-old",
        repoId: null,
        aggregateId: "run-123",
        aggregateType: "run",
        goal: "old goal",
        constraints: [],
        activeFiles: [],
        retrievalIds: [],
        memoryRefs: [],
        openQuestions: [],
        verificationPlan: [],
        rollbackPlan: [],
        policyScopes: [],
        version: 5,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mocks.prisma.contextManifest.create.mockResolvedValue({
        id: "ctx-new",
        repoId: null,
        aggregateId: "run-123",
        aggregateType: "run",
        goal: "new goal",
        constraints: [],
        activeFiles: [],
        retrievalIds: [],
        memoryRefs: [],
        openQuestions: [],
        verificationPlan: [],
        rollbackPlan: [],
        policyScopes: [],
        version: 6,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mocks.prisma.workflowStateProjection.create.mockResolvedValue({
        id: "wf-1",
        repoId: null,
        aggregateId: "run-123",
        phase: "context",
        status: "ready",
        summary: "Context materialized",
        nextSteps: [],
        blockers: [],
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.materializeContext({
        actor: "test-user",
        aggregate_id: "run-123",
        aggregate_type: "run",
        goal: "new goal",
      });

      expect(result.context.version).toBe(6);
    });

    it("creates retrieval trace when query is provided", async () => {
      mocks.prisma.contextManifest.findFirst.mockResolvedValue(null);
      mocks.prisma.contextManifest.create.mockResolvedValue({
        id: "ctx-1",
        repoId: null,
        aggregateId: "run-123",
        aggregateType: "run",
        goal: "test goal",
        constraints: [],
        activeFiles: [],
        retrievalIds: [],
        memoryRefs: [],
        openQuestions: [],
        verificationPlan: [],
        rollbackPlan: [],
        policyScopes: [],
        version: 1,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mocks.prisma.retrievalTrace.create.mockResolvedValue({
        id: "trace-1",
        repoId: null,
        aggregateId: "run-123",
        query: "test query",
        retrievalIds: [],
        results: [],
        createdAt: new Date(),
      });
      mocks.prisma.workflowStateProjection.create.mockResolvedValue({
        id: "wf-1",
        repoId: null,
        aggregateId: "run-123",
        phase: "context",
        status: "ready",
        summary: "Context materialized",
        nextSteps: [],
        blockers: [],
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.materializeContext({
        actor: "test-user",
        aggregate_id: "run-123",
        aggregate_type: "run",
        goal: "test goal",
        query: "test query",
      });

      expect(result.retrievalTrace).not.toBeNull();
      expect(result.retrievalTrace!.query).toBe("test query");
      expect(mocks.prisma.retrievalTrace.create).toHaveBeenCalled();
    });

    it("does not create retrieval trace when no query or retrieval_ids", async () => {
      mocks.prisma.contextManifest.findFirst.mockResolvedValue(null);
      mocks.prisma.contextManifest.create.mockResolvedValue({
        id: "ctx-1",
        repoId: null,
        aggregateId: "run-123",
        aggregateType: "run",
        goal: "test goal",
        constraints: [],
        activeFiles: [],
        retrievalIds: [],
        memoryRefs: [],
        openQuestions: [],
        verificationPlan: [],
        rollbackPlan: [],
        policyScopes: [],
        version: 1,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mocks.prisma.workflowStateProjection.create.mockResolvedValue({
        id: "wf-1",
        repoId: null,
        aggregateId: "run-123",
        phase: "context",
        status: "ready",
        summary: "Context materialized",
        nextSteps: [],
        blockers: [],
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.materializeContext({
        actor: "test-user",
        aggregate_id: "run-123",
        aggregate_type: "run",
        goal: "test goal",
      });

      expect(result.retrievalTrace).toBeNull();
      expect(mocks.prisma.retrievalTrace.create).not.toHaveBeenCalled();
    });

    it("includes all optional fields in context manifest", async () => {
      mocks.prisma.contextManifest.findFirst.mockResolvedValue(null);
      mocks.prisma.knowledgeIndexMetadata.findMany.mockResolvedValue([]);
      mocks.prisma.codeGraphNode.findMany.mockResolvedValue([]);
      mocks.prisma.contextManifest.create.mockResolvedValue({
        id: "ctx-1",
        repoId: "repo-1",
        aggregateId: "run-123",
        aggregateType: "ticket",
        goal: "test goal",
        constraints: ["constraint-1", "constraint-2"],
        activeFiles: ["file1.ts", "file2.ts"],
        retrievalIds: ["ret-1", "ret-2"],
        memoryRefs: ["mem-1"],
        openQuestions: ["question-1"],
        verificationPlan: ["verify-1"],
        rollbackPlan: ["rollback-1"],
        policyScopes: ["scope-1"],
        version: 1,
        metadata: { custom: "value" },
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mocks.prisma.retrievalTrace.create.mockResolvedValue({
        id: "trace-1",
        repoId: "repo-1",
        aggregateId: "run-123",
        query: "test goal",
        retrievalIds: ["ret-1", "ret-2"],
        results: [],
        createdAt: new Date(),
      });
      mocks.prisma.workflowStateProjection.create.mockResolvedValue({
        id: "wf-1",
        repoId: "repo-1",
        aggregateId: "run-123",
        phase: "context",
        status: "ready",
        summary: "Context materialized",
        nextSteps: [],
        blockers: [],
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.materializeContext({
        actor: "test-user",
        repo_id: "repo-1",
        aggregate_id: "run-123",
        aggregate_type: "ticket",
        goal: "test goal",
        constraints: ["constraint-1", "constraint-2"],
        active_files: ["file1.ts", "file2.ts"],
        retrieval_ids: ["ret-1", "ret-2"],
        memory_refs: ["mem-1"],
        open_questions: ["question-1"],
        verification_plan: ["verify-1"],
        rollback_plan: ["rollback-1"],
        policy_scopes: ["scope-1"],
        metadata: { custom: "value" },
      });

      expect(result.context.constraints).toEqual(["constraint-1", "constraint-2"]);
      expect(result.context.activeFiles).toEqual(["file1.ts", "file2.ts"]);
      expect(result.context.metadata).toEqual({ custom: "value" });
    });

    it("publishes event after materialization", async () => {
      mocks.prisma.contextManifest.findFirst.mockResolvedValue(null);
      mocks.prisma.contextManifest.create.mockResolvedValue({
        id: "ctx-1",
        repoId: null,
        aggregateId: "run-123",
        aggregateType: "run",
        goal: "test goal",
        constraints: [],
        activeFiles: [],
        retrievalIds: [],
        memoryRefs: [],
        openQuestions: [],
        verificationPlan: [],
        rollbackPlan: [],
        policyScopes: [],
        version: 1,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mocks.prisma.workflowStateProjection.create.mockResolvedValue({
        id: "wf-1",
        repoId: null,
        aggregateId: "run-123",
        phase: "context",
        status: "ready",
        summary: "Context materialized",
        nextSteps: [],
        blockers: [],
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.materializeContext({
        actor: "test-user",
        aggregate_id: "run-123",
        aggregate_type: "run",
        goal: "test goal",
      });

      expect(mocks.publishEvent).toHaveBeenCalledWith("global", "context.materialized", expect.any(Object));
      expect(mocks.v2EventService.appendEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "context.materialized",
          aggregateId: "run-123",
          actor: "test-user",
        })
      );
    });

    it("creates workflow state projection", async () => {
      mocks.prisma.contextManifest.findFirst.mockResolvedValue(null);
      mocks.prisma.contextManifest.create.mockResolvedValue({
        id: "ctx-1",
        repoId: null,
        aggregateId: "run-123",
        aggregateType: "run",
        goal: "test goal",
        constraints: [],
        activeFiles: [],
        retrievalIds: [],
        memoryRefs: [],
        openQuestions: [],
        verificationPlan: [],
        rollbackPlan: [],
        policyScopes: [],
        version: 1,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mocks.prisma.workflowStateProjection.create.mockResolvedValue({
        id: "wf-1",
        repoId: null,
        aggregateId: "run-123",
        phase: "context",
        status: "ready",
        summary: "Context materialized for run",
        nextSteps: ["execute", "verify"],
        blockers: [],
        metadata: { contextManifestId: "ctx-1" },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.materializeContext({
        actor: "test-user",
        aggregate_id: "run-123",
        aggregate_type: "run",
        goal: "test goal",
      });

      expect(mocks.prisma.workflowStateProjection.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            aggregateId: "run-123",
            phase: "context",
            status: "ready",
          }),
        })
      );
    });
  });

  describe("commitMemory", () => {
    it("creates memory record with all fields", async () => {
      const now = new Date();
      mocks.prisma.memoryRecord.create.mockResolvedValue({
        id: "mem-1",
        kind: "decision",
        repoId: null,
        aggregateId: "run-123",
        content: "test decision",
        citations: ["cite-1"],
        confidence: 0.9,
        staleAfter: now,
        metadata: { custom: "data" },
        createdAt: now,
        updatedAt: now,
      });

      const result = await service.commitMemory({
        actor: "test-user",
        aggregate_id: "run-123",
        kind: "decision",
        content: "test decision",
        citations: ["cite-1"],
        confidence: 0.9,
        stale_after: now.toISOString(),
        metadata: { custom: "data" },
      });

      expect(result.kind).toBe("decision");
      expect(result.content).toBe("test decision");
      expect(result.confidence).toBe(0.9);
      expect(mocks.prisma.memoryRecord.create).toHaveBeenCalled();
    });

    it("uses default confidence when not provided", async () => {
      const now = new Date();
      mocks.prisma.memoryRecord.create.mockResolvedValue({
        id: "mem-1",
        kind: "insight",
        repoId: null,
        aggregateId: "run-123",
        content: "test insight",
        citations: [],
        confidence: 0.7,
        staleAfter: null,
        metadata: {},
        createdAt: now,
        updatedAt: now,
      });

      const result = await service.commitMemory({
        actor: "test-user",
        aggregate_id: "run-123",
        kind: "insight",
        content: "test insight",
      });

      expect(result.confidence).toBe(0.7);
    });

    it("publishes memory.committed event", async () => {
      const now = new Date();
      mocks.prisma.memoryRecord.create.mockResolvedValue({
        id: "mem-1",
        kind: "constraint",
        repoId: null,
        aggregateId: "run-123",
        content: "test constraint",
        citations: [],
        confidence: 0.7,
        staleAfter: null,
        metadata: {},
        createdAt: now,
        updatedAt: now,
      });

      await service.commitMemory({
        actor: "test-user",
        aggregate_id: "run-123",
        kind: "constraint",
        content: "test constraint",
      });

      expect(mocks.v2EventService.appendEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "memory.committed",
          aggregateId: "run-123",
          actor: "test-user",
          payload: expect.objectContaining({
            memory_id: "mem-1",
            kind: "constraint",
          }),
        })
      );
    });
  });

  describe("getLatestContext", () => {
    it("returns latest context manifest by version", async () => {
      const now = new Date();
      mocks.prisma.contextManifest.findFirst.mockResolvedValue({
        id: "ctx-1",
        repoId: null,
        aggregateId: "run-123",
        aggregateType: "run",
        goal: "test goal",
        constraints: [],
        activeFiles: [],
        retrievalIds: [],
        memoryRefs: [],
        openQuestions: [],
        verificationPlan: [],
        rollbackPlan: [],
        policyScopes: [],
        version: 3,
        metadata: {},
        createdAt: now,
        updatedAt: now,
      });

      const result = await service.getLatestContext("run-123");

      expect(result).not.toBeNull();
      expect(result!.aggregateId).toBe("run-123");
      expect(result!.version).toBe(3);
    });

    it("returns null when no context exists", async () => {
      mocks.prisma.contextManifest.findFirst.mockResolvedValue(null);

      const result = await service.getLatestContext("run-999");

      expect(result).toBeNull();
    });
  });

  describe("getWorkflowState", () => {
    it("returns latest workflow state", async () => {
      const now = new Date();
      mocks.prisma.workflowStateProjection.findFirst.mockResolvedValue({
        id: "wf-1",
        repoId: null,
        aggregateId: "run-123",
        phase: "execute",
        status: "in_progress",
        summary: "Executing task",
        nextSteps: ["verify"],
        blockers: [],
        metadata: {},
        createdAt: now,
        updatedAt: now,
      });

      const result = await service.getWorkflowState("run-123");

      expect(result).not.toBeNull();
      expect(result!.phase).toBe("execute");
      expect(result!.status).toBe("in_progress");
    });

    it("returns null when no workflow state exists", async () => {
      mocks.prisma.workflowStateProjection.findFirst.mockResolvedValue(null);

      const result = await service.getWorkflowState("run-999");

      expect(result).toBeNull();
    });
  });

  describe("searchMemory", () => {
    it("returns empty array for empty query", async () => {
      const result = await service.searchMemory("");

      expect(result).toEqual([]);
      expect(mocks.prisma.memoryRecord.findMany).not.toHaveBeenCalled();
    });

    it("returns empty array for whitespace-only query", async () => {
      const result = await service.searchMemory("   ");

      expect(result).toEqual([]);
      expect(mocks.prisma.memoryRecord.findMany).not.toHaveBeenCalled();
    });

    it("searches memory records by content", async () => {
      const now = new Date();
      mocks.prisma.memoryRecord.findMany.mockResolvedValue([
        {
          id: "mem-1",
          kind: "decision",
          repoId: null,
          aggregateId: "run-123",
          content: "test decision about authentication",
          citations: [],
          confidence: 0.9,
          staleAfter: null,
          metadata: {},
          createdAt: now,
          updatedAt: now,
        },
      ]);

      const result = await service.searchMemory("authentication");

      expect(result).toHaveLength(1);
      expect(result[0].content).toContain("authentication");
      expect(mocks.prisma.memoryRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({
                content: expect.objectContaining({
                  contains: "authentication",
                }),
              }),
            ]),
          }),
        })
      );
    });

    it("limits results to 30 records", async () => {
      const now = new Date();
      const records = Array.from({ length: 50 }, (_, i) => ({
        id: `mem-${i}`,
        kind: "insight",
        repoId: null,
        aggregateId: `run-${i}`,
        content: `test insight ${i}`,
        citations: [],
        confidence: 0.7,
        staleAfter: null,
        metadata: {},
        createdAt: now,
        updatedAt: now,
      }));
      mocks.prisma.memoryRecord.findMany.mockResolvedValue(records.slice(0, 30));

      const result = await service.searchMemory("test");

      expect(result.length).toBeLessThanOrEqual(30);
      expect(mocks.prisma.memoryRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 30,
        })
      );
    });
  });

  describe("getRetrievalTrace", () => {
    it("returns retrieval traces for run", async () => {
      const now = new Date();
      mocks.prisma.retrievalTrace.findMany.mockResolvedValue([
        {
          id: "trace-1",
          repoId: null,
          aggregateId: "run-123",
          query: "test query",
          retrievalIds: ["ret-1", "ret-2"],
          results: [
            {
              id: "hit-1",
              source: "knowledge_base",
              path: "/docs/readme.md",
              snippet: "test snippet",
              score: 0.95,
              embedding_id: "emb-1",
            },
          ],
          createdAt: now,
        },
      ]);

      const result = await service.getRetrievalTrace("run-123");

      expect(result).toHaveLength(1);
      expect(result[0].query).toBe("test query");
      expect(result[0].retrievalIds).toEqual(["ret-1", "ret-2"]);
      expect(result[0].results).toHaveLength(1);
    });

    it("limits results to 20 traces", async () => {
      const now = new Date();
      mocks.prisma.retrievalTrace.findMany.mockResolvedValue([]);

      await service.getRetrievalTrace("run-123");

      expect(mocks.prisma.retrievalTrace.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 20,
        })
      );
    });

    it("handles empty results gracefully", async () => {
      mocks.prisma.retrievalTrace.findMany.mockResolvedValue([]);

      const result = await service.getRetrievalTrace("run-999");

      expect(result).toEqual([]);
    });
  });
});
