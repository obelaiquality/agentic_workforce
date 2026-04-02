import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChallengeService } from "./challengeService";

const mockPrisma = vi.hoisted(() => ({
  distillEvalRun: {
    findUnique: vi.fn(),
  },
  challengeCandidate: {
    create: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
  },
  modelPluginRegistry: {
    findMany: vi.fn(),
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

describe("ChallengeService", () => {
  let service: ChallengeService;

  beforeEach(() => {
    vi.clearAllMocks();
    // @ts-expect-error - mock types
    service = new ChallengeService(mockEvents);
  });

  describe("registerCandidate", () => {
    it("creates candidate with pending_review status when eval passed", async () => {
      const mockEvalRun = {
        id: "eval-1",
        pass: true,
        metrics: { accuracy: 0.95, latency: 120 },
      };

      const mockCandidate = {
        id: "candidate-1",
        modelPluginId: "plugin-1",
        parentModelPluginId: null,
        datasetId: "dataset-1",
        evalRunId: "eval-1",
        status: "pending_review",
        metrics: { accuracy: 0.95, latency: 120 },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.distillEvalRun.findUnique.mockResolvedValue(mockEvalRun);
      mockPrisma.challengeCandidate.create.mockResolvedValue(mockCandidate);

      const result = await service.registerCandidate({
        actor: "user-1",
        model_plugin_id: "plugin-1",
        dataset_id: "dataset-1",
        eval_run_id: "eval-1",
      });

      expect(result.status).toBe("pending_review");
      expect(result.metrics).toEqual({ accuracy: 0.95, latency: 120 });
      expect(mockPrisma.challengeCandidate.create).toHaveBeenCalledWith({
        data: {
          modelPluginId: "plugin-1",
          parentModelPluginId: null,
          datasetId: "dataset-1",
          evalRunId: "eval-1",
          status: "pending_review",
          metrics: { accuracy: 0.95, latency: 120 },
        },
      });
    });

    it("creates candidate with draft status when eval failed", async () => {
      const mockEvalRun = {
        id: "eval-2",
        pass: false,
        metrics: { accuracy: 0.65, latency: 200 },
      };

      const mockCandidate = {
        id: "candidate-2",
        modelPluginId: "plugin-2",
        parentModelPluginId: "plugin-1",
        datasetId: "dataset-1",
        evalRunId: "eval-2",
        status: "draft",
        metrics: { accuracy: 0.65, latency: 200 },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.distillEvalRun.findUnique.mockResolvedValue(mockEvalRun);
      mockPrisma.challengeCandidate.create.mockResolvedValue(mockCandidate);

      const result = await service.registerCandidate({
        actor: "user-1",
        model_plugin_id: "plugin-2",
        parent_model_plugin_id: "plugin-1",
        dataset_id: "dataset-1",
        eval_run_id: "eval-2",
      });

      expect(result.status).toBe("draft");
    });

    it("creates candidate with draft status when eval run not found", async () => {
      mockPrisma.distillEvalRun.findUnique.mockResolvedValue(null);

      const mockCandidate = {
        id: "candidate-3",
        modelPluginId: "plugin-3",
        parentModelPluginId: null,
        datasetId: "dataset-1",
        evalRunId: "eval-3",
        status: "draft",
        metrics: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.challengeCandidate.create.mockResolvedValue(mockCandidate);

      const result = await service.registerCandidate({
        actor: "user-1",
        model_plugin_id: "plugin-3",
        dataset_id: "dataset-1",
        eval_run_id: "eval-3",
      });

      expect(result.status).toBe("draft");
    });

    it("handles parent model plugin id correctly", async () => {
      const mockEvalRun = {
        id: "eval-4",
        pass: true,
        metrics: {},
      };

      const mockCandidate = {
        id: "candidate-4",
        modelPluginId: "plugin-child",
        parentModelPluginId: "plugin-parent",
        datasetId: "dataset-1",
        evalRunId: "eval-4",
        status: "pending_review",
        metrics: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.distillEvalRun.findUnique.mockResolvedValue(mockEvalRun);
      mockPrisma.challengeCandidate.create.mockResolvedValue(mockCandidate);

      const result = await service.registerCandidate({
        actor: "user-1",
        model_plugin_id: "plugin-child",
        parent_model_plugin_id: "plugin-parent",
        dataset_id: "dataset-1",
        eval_run_id: "eval-4",
      });

      expect(result.parentModelPluginId).toBe("plugin-parent");
    });

    it("appends model.challenge.registered event", async () => {
      const mockEvalRun = {
        id: "eval-5",
        pass: true,
        metrics: {},
      };

      const mockCandidate = {
        id: "candidate-5",
        modelPluginId: "plugin-5",
        parentModelPluginId: null,
        datasetId: "dataset-1",
        evalRunId: "eval-5",
        status: "pending_review",
        metrics: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.distillEvalRun.findUnique.mockResolvedValue(mockEvalRun);
      mockPrisma.challengeCandidate.create.mockResolvedValue(mockCandidate);

      await service.registerCandidate({
        actor: "admin",
        model_plugin_id: "plugin-5",
        dataset_id: "dataset-1",
        eval_run_id: "eval-5",
      });

      expect(mockEvents.appendEvent).toHaveBeenCalledWith({
        type: "model.challenge.registered",
        aggregateId: "candidate-5",
        actor: "admin",
        payload: {
          challenge_candidate_id: "candidate-5",
          status: "pending_review",
          eval_run_id: "eval-5",
        },
      });
    });

    it("handles null metrics gracefully", async () => {
      const mockEvalRun = {
        id: "eval-6",
        pass: true,
        metrics: null,
      };

      const mockCandidate = {
        id: "candidate-6",
        modelPluginId: "plugin-6",
        parentModelPluginId: null,
        datasetId: "dataset-1",
        evalRunId: "eval-6",
        status: "pending_review",
        metrics: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.distillEvalRun.findUnique.mockResolvedValue(mockEvalRun);
      mockPrisma.challengeCandidate.create.mockResolvedValue(mockCandidate);

      const result = await service.registerCandidate({
        actor: "user-1",
        model_plugin_id: "plugin-6",
        dataset_id: "dataset-1",
        eval_run_id: "eval-6",
      });

      expect(result.metrics).toEqual({});
    });
  });

  describe("reviewCandidate", () => {
    it("updates candidate status to approved", async () => {
      const mockCandidate = {
        id: "candidate-1",
        modelPluginId: "plugin-1",
        parentModelPluginId: null,
        datasetId: "dataset-1",
        evalRunId: "eval-1",
        status: "approved",
        metrics: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.challengeCandidate.update.mockResolvedValue(mockCandidate);

      const result = await service.reviewCandidate({
        actor: "reviewer-1",
        candidate_id: "candidate-1",
        status: "approved",
      });

      expect(result.status).toBe("approved");
      expect(mockPrisma.challengeCandidate.update).toHaveBeenCalledWith({
        where: { id: "candidate-1" },
        data: { status: "approved" },
      });
    });

    it("updates candidate status to rejected", async () => {
      const mockCandidate = {
        id: "candidate-2",
        modelPluginId: "plugin-2",
        parentModelPluginId: null,
        datasetId: "dataset-1",
        evalRunId: "eval-2",
        status: "rejected",
        metrics: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.challengeCandidate.update.mockResolvedValue(mockCandidate);

      const result = await service.reviewCandidate({
        actor: "reviewer-1",
        candidate_id: "candidate-2",
        status: "rejected",
      });

      expect(result.status).toBe("rejected");
    });

    it("updates candidate status to promoted", async () => {
      const mockCandidate = {
        id: "candidate-3",
        modelPluginId: "plugin-3",
        parentModelPluginId: null,
        datasetId: "dataset-1",
        evalRunId: "eval-3",
        status: "promoted",
        metrics: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.challengeCandidate.update.mockResolvedValue(mockCandidate);

      const result = await service.reviewCandidate({
        actor: "admin",
        candidate_id: "candidate-3",
        status: "promoted",
      });

      expect(result.status).toBe("promoted");
    });

    it("appends model.promoted event when status is promoted", async () => {
      const mockCandidate = {
        id: "candidate-4",
        modelPluginId: "plugin-4",
        parentModelPluginId: null,
        datasetId: "dataset-1",
        evalRunId: "eval-4",
        status: "promoted",
        metrics: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.challengeCandidate.update.mockResolvedValue(mockCandidate);

      await service.reviewCandidate({
        actor: "admin",
        candidate_id: "candidate-4",
        status: "promoted",
      });

      expect(mockEvents.appendEvent).toHaveBeenCalledWith({
        type: "model.promoted",
        aggregateId: "candidate-4",
        actor: "admin",
        payload: {
          challenge_candidate_id: "candidate-4",
          status: "promoted",
        },
      });
    });

    it("appends model.promotion.pending_review event when status is not promoted", async () => {
      const mockCandidate = {
        id: "candidate-5",
        modelPluginId: "plugin-5",
        parentModelPluginId: null,
        datasetId: "dataset-1",
        evalRunId: "eval-5",
        status: "approved",
        metrics: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.challengeCandidate.update.mockResolvedValue(mockCandidate);

      await service.reviewCandidate({
        actor: "reviewer",
        candidate_id: "candidate-5",
        status: "approved",
      });

      expect(mockEvents.appendEvent).toHaveBeenCalledWith({
        type: "model.promotion.pending_review",
        aggregateId: "candidate-5",
        actor: "reviewer",
        payload: {
          challenge_candidate_id: "candidate-5",
          status: "approved",
        },
      });
    });
  });

  describe("getChampionVsChallenger", () => {
    it("returns champions and challengers", async () => {
      const mockChampions = [
        {
          pluginId: "plugin-champ-1",
          modelId: "model-1",
          active: true,
          promoted: true,
          paramsB: 4.0,
          updatedAt: new Date("2024-01-02"),
        },
        {
          pluginId: "plugin-champ-2",
          modelId: "model-2",
          active: true,
          promoted: true,
          paramsB: 0.8,
          updatedAt: new Date("2024-01-01"),
        },
      ];

      const mockChallengers = [
        {
          id: "challenger-1",
          modelPluginId: "plugin-chal-1",
          parentModelPluginId: "plugin-champ-1",
          datasetId: "dataset-1",
          evalRunId: "eval-1",
          status: "pending_review",
          metrics: { accuracy: 0.96 },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "challenger-2",
          modelPluginId: "plugin-chal-2",
          parentModelPluginId: null,
          datasetId: "dataset-2",
          evalRunId: "eval-2",
          status: "draft",
          metrics: { accuracy: 0.85 },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockPrisma.modelPluginRegistry.findMany.mockResolvedValue(mockChampions);
      mockPrisma.challengeCandidate.findMany.mockResolvedValue(mockChallengers);

      const result = await service.getChampionVsChallenger();

      expect(result.champions).toHaveLength(2);
      expect(result.challengers).toHaveLength(2);

      expect(result.champions[0].pluginId).toBe("plugin-champ-1");
      expect(result.champions[0].promoted).toBe(true);

      expect(result.challengers[0].id).toBe("challenger-1");
      expect(result.challengers[0].status).toBe("pending_review");
    });

    it("queries champions with promoted filter", async () => {
      mockPrisma.modelPluginRegistry.findMany.mockResolvedValue([]);
      mockPrisma.challengeCandidate.findMany.mockResolvedValue([]);

      await service.getChampionVsChallenger();

      expect(mockPrisma.modelPluginRegistry.findMany).toHaveBeenCalledWith({
        where: { promoted: true },
        orderBy: { updatedAt: "desc" },
      });
    });

    it("limits challengers to 50 results", async () => {
      mockPrisma.modelPluginRegistry.findMany.mockResolvedValue([]);
      mockPrisma.challengeCandidate.findMany.mockResolvedValue([]);

      await service.getChampionVsChallenger();

      expect(mockPrisma.challengeCandidate.findMany).toHaveBeenCalledWith({
        orderBy: { updatedAt: "desc" },
        take: 50,
      });
    });

    it("handles empty results", async () => {
      mockPrisma.modelPluginRegistry.findMany.mockResolvedValue([]);
      mockPrisma.challengeCandidate.findMany.mockResolvedValue([]);

      const result = await service.getChampionVsChallenger();

      expect(result.champions).toEqual([]);
      expect(result.challengers).toEqual([]);
    });

    it("formats champion data correctly", async () => {
      const mockChampions = [
        {
          pluginId: "plugin-1",
          modelId: "qwen-4b",
          active: true,
          promoted: true,
          paramsB: 4.0,
          updatedAt: new Date("2024-01-01T12:00:00Z"),
        },
      ];

      mockPrisma.modelPluginRegistry.findMany.mockResolvedValue(mockChampions);
      mockPrisma.challengeCandidate.findMany.mockResolvedValue([]);

      const result = await service.getChampionVsChallenger();

      expect(result.champions[0]).toEqual({
        pluginId: "plugin-1",
        modelId: "qwen-4b",
        active: true,
        promoted: true,
        paramsB: 4.0,
        updatedAt: "2024-01-01T12:00:00.000Z",
      });
    });

    it("formats challenger data correctly with null values", async () => {
      const mockChallengers = [
        {
          id: "challenger-1",
          modelPluginId: "plugin-1",
          parentModelPluginId: null,
          datasetId: "dataset-1",
          evalRunId: "eval-1",
          status: "draft",
          metrics: null,
          createdAt: new Date("2024-01-01T12:00:00Z"),
          updatedAt: new Date("2024-01-02T12:00:00Z"),
        },
      ];

      mockPrisma.modelPluginRegistry.findMany.mockResolvedValue([]);
      mockPrisma.challengeCandidate.findMany.mockResolvedValue(mockChallengers);

      const result = await service.getChampionVsChallenger();

      expect(result.challengers[0]).toEqual({
        id: "challenger-1",
        modelPluginId: "plugin-1",
        parentModelPluginId: null,
        datasetId: "dataset-1",
        evalRunId: "eval-1",
        status: "draft",
        metrics: {},
        createdAt: "2024-01-01T12:00:00.000Z",
        updatedAt: "2024-01-02T12:00:00.000Z",
      });
    });
  });
});
