import { describe, it, expect, vi, beforeEach } from "vitest";
import { LaneService } from "./laneService";
import type { AgentLane } from "../../shared/contracts";

const mockPrisma = vi.hoisted(() => ({
  agentLane: {
    create: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
  worktreeLease: {
    create: vi.fn(),
    updateMany: vi.fn(),
  },
}));

vi.mock("../db", () => ({
  prisma: mockPrisma,
}));

vi.mock("../eventBus", () => ({
  publishEvent: vi.fn(),
}));

vi.mock("node:fs", () => ({
  default: {
    mkdirSync: vi.fn(),
  },
}));

const mockSidecar = {
  heartbeat: vi.fn(),
};

const mockEvents = {
  appendEvent: vi.fn(),
};

describe("LaneService", () => {
  let service: LaneService;

  beforeEach(() => {
    vi.clearAllMocks();
    // @ts-expect-error - mock types
    service = new LaneService(mockSidecar, mockEvents);
  });

  describe("spawnLane", () => {
    it("creates lane with correct data and default lease time", async () => {
      const now = Date.now();
      const mockRow = {
        id: "lane-123",
        repoId: "repo-1",
        ticketId: "ticket-1",
        runId: "run-1",
        role: "coder",
        worktreePath: "/test/worktree/path",
        contextManifestId: null,
        leaseExpiresAt: new Date(now + 20 * 60 * 1000),
        lastHeartbeatAt: new Date(),
        state: "queued",
        metadata: { summary: "coder lane spawned" },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.agentLane.create.mockResolvedValue(mockRow);
      mockPrisma.worktreeLease.create.mockResolvedValue({});

      const result = await service.spawnLane({
        actor: "user-1",
        repo_id: "repo-1",
        ticket_id: "ticket-1",
        run_id: "run-1",
        role: "coder",
      });

      expect(mockPrisma.agentLane.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          repoId: "repo-1",
          ticketId: "ticket-1",
          runId: "run-1",
          role: "coder",
          state: "queued",
          contextManifestId: null,
        }),
      });

      expect(result.id).toBe("lane-123");
      expect(result.role).toBe("coder");
      expect(result.state).toBe("queued");
    });

    it("creates lane with custom lease minutes", async () => {
      const mockRow = {
        id: "lane-456",
        repoId: null,
        ticketId: "ticket-2",
        runId: null,
        role: "reviewer",
        worktreePath: "/path/to/worktree",
        contextManifestId: "ctx-1",
        leaseExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        lastHeartbeatAt: new Date(),
        state: "queued",
        metadata: { summary: "custom summary" },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.agentLane.create.mockResolvedValue(mockRow);
      mockPrisma.worktreeLease.create.mockResolvedValue({});

      const result = await service.spawnLane({
        actor: "user-2",
        ticket_id: "ticket-2",
        role: "reviewer",
        context_manifest_id: "ctx-1",
        lease_minutes: 60,
        summary: "custom summary",
      });

      expect(mockPrisma.agentLane.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          ticketId: "ticket-2",
          role: "reviewer",
          contextManifestId: "ctx-1",
        }),
      });

      expect(result.contextManifestId).toBe("ctx-1");
    });

    it("enforces minimum lease time of 1 minute", async () => {
      const mockRow = {
        id: "lane-789",
        repoId: null,
        ticketId: "ticket-3",
        runId: null,
        role: "coder",
        worktreePath: "/path",
        contextManifestId: null,
        leaseExpiresAt: new Date(Date.now() + 60 * 1000),
        lastHeartbeatAt: new Date(),
        state: "queued",
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.agentLane.create.mockResolvedValue(mockRow);
      mockPrisma.worktreeLease.create.mockResolvedValue({});

      await service.spawnLane({
        actor: "user-3",
        ticket_id: "ticket-3",
        role: "coder",
        lease_minutes: -5,
      });

      const createCall = mockPrisma.agentLane.create.mock.calls[0][0];
      const leaseTime = createCall.data.leaseExpiresAt.getTime() - Date.now();
      expect(leaseTime).toBeGreaterThanOrEqual(60 * 1000 - 50); // At least ~1 minute (allow small clock drift)
    });

    it("creates worktree lease with correct data", async () => {
      const mockRow = {
        id: "lane-999",
        repoId: "repo-2",
        ticketId: "ticket-4",
        runId: "run-4",
        role: "coder",
        worktreePath: "/path/to/worktree",
        contextManifestId: null,
        leaseExpiresAt: new Date(Date.now() + 20 * 60 * 1000),
        lastHeartbeatAt: new Date(),
        state: "queued",
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.agentLane.create.mockResolvedValue(mockRow);
      mockPrisma.worktreeLease.create.mockResolvedValue({});

      await service.spawnLane({
        actor: "user-4",
        repo_id: "repo-2",
        ticket_id: "ticket-4",
        run_id: "run-4",
        role: "coder",
      });

      expect(mockPrisma.worktreeLease.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          repoId: "repo-2",
          laneId: "lane-999",
          worktreePath: "/path/to/worktree",
          leaseOwner: "user-4",
          metadata: {
            ticket_id: "ticket-4",
            repo_id: "repo-2",
            run_id: "run-4",
          },
        }),
      });
    });

    it("sends sidecar heartbeat with correct metadata", async () => {
      const mockRow = {
        id: "lane-111",
        repoId: "repo-1",
        ticketId: "ticket-1",
        runId: "run-1",
        role: "coder",
        worktreePath: "/path/to/worktree",
        contextManifestId: null,
        leaseExpiresAt: new Date(),
        lastHeartbeatAt: new Date(),
        state: "queued",
        metadata: { summary: "test summary" },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.agentLane.create.mockResolvedValue(mockRow);
      mockPrisma.worktreeLease.create.mockResolvedValue({});

      await service.spawnLane({
        actor: "user-1",
        repo_id: "repo-1",
        ticket_id: "ticket-1",
        run_id: "run-1",
        role: "coder",
        summary: "test summary",
      });

      expect(mockSidecar.heartbeat).toHaveBeenCalledWith({
        agent_id: "lane-111",
        status: "queued",
        summary: "test summary",
        metadata_json: expect.stringContaining("ticket-1"),
      });

      const metadataJson = JSON.parse(mockSidecar.heartbeat.mock.calls[0][0].metadata_json);
      expect(metadataJson.ticket_id).toBe("ticket-1");
      expect(metadataJson.run_id).toBe("run-1");
      expect(metadataJson.role).toBe("coder");
      expect(metadataJson.repo_id).toBe("repo-1");
    });

    it("appends agent.spawned event", async () => {
      const mockRow = {
        id: "lane-222",
        repoId: "repo-1",
        ticketId: "ticket-1",
        runId: "run-1",
        role: "coder",
        worktreePath: "/path",
        contextManifestId: null,
        leaseExpiresAt: new Date(),
        lastHeartbeatAt: new Date(),
        state: "queued",
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.agentLane.create.mockResolvedValue(mockRow);
      mockPrisma.worktreeLease.create.mockResolvedValue({});

      await service.spawnLane({
        actor: "user-1",
        repo_id: "repo-1",
        ticket_id: "ticket-1",
        run_id: "run-1",
        role: "coder",
      });

      expect(mockEvents.appendEvent).toHaveBeenCalledWith({
        type: "agent.spawned",
        aggregateId: "run-1",
        actor: "user-1",
        payload: expect.objectContaining({
          lane_id: "lane-222",
          role: "coder",
          ticket_id: "ticket-1",
          run_id: "run-1",
        }),
      });
    });
  });

  describe("reclaimLane", () => {
    it("reclaims specific lane by id", async () => {
      const mockLane = {
        id: "lane-1",
        repoId: "repo-1",
        ticketId: "ticket-1",
        runId: "run-1",
        role: "coder",
        worktreePath: "/path",
        contextManifestId: null,
        leaseExpiresAt: new Date(),
        lastHeartbeatAt: new Date(),
        state: "queued",
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const updatedLane = { ...mockLane, state: "stale" };

      mockPrisma.agentLane.findMany.mockResolvedValue([mockLane]);
      mockPrisma.agentLane.update.mockResolvedValue(updatedLane);
      mockPrisma.worktreeLease.updateMany.mockResolvedValue({});

      const result = await service.reclaimLane({
        actor: "system",
        lane_id: "lane-1",
        reason: "manual_reclaim",
      });

      expect(mockPrisma.agentLane.findMany).toHaveBeenCalledWith({
        where: { id: "lane-1" },
      });

      expect(result).toHaveLength(1);
      expect(result[0].state).toBe("stale");
    });

    it("reclaims expired lanes without specific id", async () => {
      const now = new Date();
      const expiredLane1 = {
        id: "lane-1",
        repoId: null,
        ticketId: "ticket-1",
        runId: null,
        role: "coder",
        worktreePath: "/path1",
        contextManifestId: null,
        leaseExpiresAt: new Date(now.getTime() - 5000),
        lastHeartbeatAt: new Date(now.getTime() - 5000),
        state: "running",
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const expiredLane2 = {
        id: "lane-2",
        repoId: null,
        ticketId: "ticket-2",
        runId: null,
        role: "reviewer",
        worktreePath: "/path2",
        contextManifestId: null,
        leaseExpiresAt: new Date(now.getTime() - 10000),
        lastHeartbeatAt: new Date(now.getTime() - 10000),
        state: "queued",
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.agentLane.findMany.mockResolvedValue([expiredLane1, expiredLane2]);
      mockPrisma.agentLane.update
        .mockResolvedValueOnce({ ...expiredLane1, state: "stale" })
        .mockResolvedValueOnce({ ...expiredLane2, state: "stale" });
      mockPrisma.worktreeLease.updateMany.mockResolvedValue({});

      const result = await service.reclaimLane({
        actor: "system",
        reason: "stale_lease",
      });

      expect(result).toHaveLength(2);
      expect(result[0].state).toBe("stale");
      expect(result[1].state).toBe("stale");
    });

    it("updates lane metadata with reclaim reason", async () => {
      const mockLane = {
        id: "lane-1",
        repoId: null,
        ticketId: "ticket-1",
        runId: "run-1",
        role: "coder",
        worktreePath: "/path",
        contextManifestId: null,
        leaseExpiresAt: new Date(),
        lastHeartbeatAt: new Date(),
        state: "running",
        metadata: { existing: "data" },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const updatedLane = {
        ...mockLane,
        state: "stale",
        metadata: { existing: "data", reclaim_reason: "timeout" },
      };

      mockPrisma.agentLane.findMany.mockResolvedValue([mockLane]);
      mockPrisma.agentLane.update.mockResolvedValue(updatedLane);
      mockPrisma.worktreeLease.updateMany.mockResolvedValue({});

      await service.reclaimLane({
        actor: "system",
        lane_id: "lane-1",
        reason: "timeout",
      });

      expect(mockPrisma.agentLane.update).toHaveBeenCalledWith({
        where: { id: "lane-1" },
        data: {
          state: "stale",
          metadata: expect.objectContaining({
            existing: "data",
            reclaim_reason: "timeout",
          }),
        },
      });
    });

    it("expires worktree leases when reclaiming", async () => {
      const now = new Date();
      const mockLane = {
        id: "lane-1",
        repoId: "repo-1",
        ticketId: "ticket-1",
        runId: "run-1",
        role: "coder",
        worktreePath: "/path",
        contextManifestId: null,
        leaseExpiresAt: new Date(),
        lastHeartbeatAt: new Date(),
        state: "running",
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.agentLane.findMany.mockResolvedValue([mockLane]);
      mockPrisma.agentLane.update.mockResolvedValue({ ...mockLane, state: "stale" });
      mockPrisma.worktreeLease.updateMany.mockResolvedValue({});

      await service.reclaimLane({
        actor: "system",
        lane_id: "lane-1",
      });

      expect(mockPrisma.worktreeLease.updateMany).toHaveBeenCalledWith({
        where: { laneId: "lane-1" },
        data: {
          expiresAt: expect.any(Date),
        },
      });
    });

    it("appends agent.reclaimed events for each reclaimed lane", async () => {
      const mockLane = {
        id: "lane-1",
        repoId: null,
        ticketId: "ticket-1",
        runId: "run-1",
        role: "coder",
        worktreePath: "/path",
        contextManifestId: null,
        leaseExpiresAt: new Date(),
        lastHeartbeatAt: new Date(),
        state: "running",
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.agentLane.findMany.mockResolvedValue([mockLane]);
      mockPrisma.agentLane.update.mockResolvedValue({ ...mockLane, state: "stale" });
      mockPrisma.worktreeLease.updateMany.mockResolvedValue({});

      await service.reclaimLane({
        actor: "admin",
        lane_id: "lane-1",
        reason: "maintenance",
      });

      expect(mockEvents.appendEvent).toHaveBeenCalledWith({
        type: "agent.reclaimed",
        aggregateId: "run-1",
        actor: "admin",
        payload: {
          lane_id: "lane-1",
          reason: "maintenance",
        },
      });
    });

    it("uses default reason when not provided", async () => {
      const mockLane = {
        id: "lane-1",
        repoId: null,
        ticketId: "ticket-1",
        runId: null,
        role: "coder",
        worktreePath: "/path",
        contextManifestId: null,
        leaseExpiresAt: new Date(),
        lastHeartbeatAt: new Date(),
        state: "running",
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.agentLane.findMany.mockResolvedValue([mockLane]);
      mockPrisma.agentLane.update.mockResolvedValue({ ...mockLane, state: "stale" });
      mockPrisma.worktreeLease.updateMany.mockResolvedValue({});

      await service.reclaimLane({
        actor: "system",
        lane_id: "lane-1",
      });

      expect(mockPrisma.agentLane.update).toHaveBeenCalledWith({
        where: { id: "lane-1" },
        data: {
          state: "stale",
          metadata: expect.objectContaining({
            reclaim_reason: "stale_lease",
          }),
        },
      });
    });

    it("returns empty array when no lanes match criteria", async () => {
      mockPrisma.agentLane.findMany.mockResolvedValue([]);

      const result = await service.reclaimLane({
        actor: "system",
      });

      expect(result).toEqual([]);
      expect(mockPrisma.agentLane.update).not.toHaveBeenCalled();
    });
  });

  describe("listLanes", () => {
    it("lists all lanes without filter", async () => {
      const mockLanes = [
        {
          id: "lane-1",
          repoId: "repo-1",
          ticketId: "ticket-1",
          runId: "run-1",
          role: "coder",
          worktreePath: "/path1",
          contextManifestId: null,
          leaseExpiresAt: new Date(),
          lastHeartbeatAt: new Date(),
          state: "running",
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "lane-2",
          repoId: "repo-2",
          ticketId: "ticket-2",
          runId: "run-2",
          role: "reviewer",
          worktreePath: "/path2",
          contextManifestId: null,
          leaseExpiresAt: new Date(),
          lastHeartbeatAt: null,
          state: "queued",
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockPrisma.agentLane.findMany.mockResolvedValue(mockLanes);

      const result = await service.listLanes();

      expect(mockPrisma.agentLane.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: [{ updatedAt: "desc" }],
        take: 100,
      });

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("lane-1");
      expect(result[1].id).toBe("lane-2");
    });

    it("filters lanes by ticketId", async () => {
      const mockLanes = [
        {
          id: "lane-1",
          repoId: null,
          ticketId: "ticket-123",
          runId: null,
          role: "coder",
          worktreePath: "/path",
          contextManifestId: null,
          leaseExpiresAt: new Date(),
          lastHeartbeatAt: new Date(),
          state: "running",
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockPrisma.agentLane.findMany.mockResolvedValue(mockLanes);

      const result = await service.listLanes({ ticketId: "ticket-123" });

      expect(mockPrisma.agentLane.findMany).toHaveBeenCalledWith({
        where: { ticketId: "ticket-123" },
        orderBy: [{ updatedAt: "desc" }],
        take: 100,
      });

      expect(result).toHaveLength(1);
      expect(result[0].ticketId).toBe("ticket-123");
    });

    it("filters lanes by runId", async () => {
      const mockLanes = [
        {
          id: "lane-1",
          repoId: null,
          ticketId: "ticket-1",
          runId: "run-456",
          role: "coder",
          worktreePath: "/path",
          contextManifestId: null,
          leaseExpiresAt: new Date(),
          lastHeartbeatAt: new Date(),
          state: "running",
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockPrisma.agentLane.findMany.mockResolvedValue(mockLanes);

      const result = await service.listLanes({ runId: "run-456" });

      expect(mockPrisma.agentLane.findMany).toHaveBeenCalledWith({
        where: { runId: "run-456" },
        orderBy: [{ updatedAt: "desc" }],
        take: 100,
      });

      expect(result).toHaveLength(1);
      expect(result[0].runId).toBe("run-456");
    });

    it("filters lanes by both ticketId and runId", async () => {
      mockPrisma.agentLane.findMany.mockResolvedValue([]);

      await service.listLanes({ ticketId: "ticket-1", runId: "run-1" });

      expect(mockPrisma.agentLane.findMany).toHaveBeenCalledWith({
        where: { ticketId: "ticket-1", runId: "run-1" },
        orderBy: [{ updatedAt: "desc" }],
        take: 100,
      });
    });

    it("maps lane data correctly including null values", async () => {
      const mockLanes = [
        {
          id: "lane-1",
          repoId: null,
          ticketId: "ticket-1",
          runId: null,
          role: "coder",
          worktreePath: "/path",
          contextManifestId: null,
          leaseExpiresAt: new Date("2024-01-01T00:00:00Z"),
          lastHeartbeatAt: null,
          state: "queued",
          metadata: null,
          createdAt: new Date("2024-01-01T00:00:00Z"),
          updatedAt: new Date("2024-01-01T00:00:00Z"),
        },
      ];

      mockPrisma.agentLane.findMany.mockResolvedValue(mockLanes);

      const result = await service.listLanes();

      expect(result[0].repoId).toBeNull();
      expect(result[0].runId).toBeNull();
      expect(result[0].contextManifestId).toBeNull();
      expect(result[0].lastHeartbeatAt).toBeNull();
      expect(result[0].metadata).toEqual({});
    });
  });
});
