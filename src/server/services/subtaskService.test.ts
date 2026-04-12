import { beforeEach, describe, expect, it, vi } from "vitest";
import { SubtaskService, type SubtaskPersistence } from "./subtaskService";

function createMemoryPersistence(): SubtaskPersistence & {
  events: Array<{ parentTicketId: string; subtask: any }>;
} {
  return {
    events: [],
    async list(parentTicketId) {
      const byId = new Map<string, any>();
      for (const event of this.events.filter((item) => item.parentTicketId === parentTicketId)) {
        byId.set(event.subtask.id, { ...event.subtask });
      }
      return Array.from(byId.values());
    },
    async save(parentTicketId, event) {
      this.events.push({ parentTicketId, subtask: { ...event.subtask } });
    },
  };
}

describe("SubtaskService", () => {
  let persistence: ReturnType<typeof createMemoryPersistence>;
  let service: SubtaskService;

  beforeEach(() => {
    persistence = createMemoryPersistence();
    service = new SubtaskService(persistence);
  });

  it("creates and updates subtasks with derived blocked state", async () => {
    const first = await service.createSubtask({
      parentTicketId: "ticket-1",
      title: "Build API",
      description: "Create the API layer",
    });
    const second = await service.createSubtask({
      parentTicketId: "ticket-1",
      title: "Write tests",
      description: "Verify the API",
      dependencies: [first.id],
    });

    expect(second.blocked).toBe(true);
    expect(second.blockedBy).toEqual([first.id]);

    await service.updateSubtask({
      parentTicketId: "ticket-1",
      subtaskId: first.id,
      status: "done",
    });

    const items = await service.listSubtasks("ticket-1", { includeCompleted: true });
    const unblocked = items.find((item) => item.id === second.id);
    expect(unblocked?.blocked).toBe(false);
    expect(unblocked?.blockedBy).toEqual([]);
  });

  it("persists subtasks across service instances", async () => {
    const created = await service.createSubtask({
      parentTicketId: "ticket-1",
      title: "Persist me",
      description: "Stored in persistence",
      estimatedComplexity: "high",
    });

    await service.updateSubtask({
      parentTicketId: "ticket-1",
      subtaskId: created.id,
      status: "in_progress",
      notes: "Started implementation",
    });

    const reloaded = new SubtaskService(persistence);
    const items = await reloaded.listSubtasks("ticket-1", { includeCompleted: true });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: created.id,
      status: "in_progress",
      risk: "high",
      notes: ["Started implementation"],
    });
  });

  it("returns null when updating a missing subtask", async () => {
    const result = await service.updateSubtask({
      parentTicketId: "ticket-1",
      subtaskId: "missing",
      status: "done",
    });

    expect(result).toBeNull();
  });

  it("filters out completed subtasks by default in listSubtasks", async () => {
    const first = await service.createSubtask({
      parentTicketId: "ticket-2",
      title: "Task A",
      description: "First task",
    });
    await service.createSubtask({
      parentTicketId: "ticket-2",
      title: "Task B",
      description: "Second task",
    });

    await service.updateSubtask({
      parentTicketId: "ticket-2",
      subtaskId: first.id,
      status: "done",
    });

    const withoutCompleted = await service.listSubtasks("ticket-2");
    expect(withoutCompleted.length).toBe(1);
    expect(withoutCompleted[0].title).toBe("Task B");

    const withCompleted = await service.listSubtasks("ticket-2", { includeCompleted: true });
    expect(withCompleted.length).toBe(2);
  });

  it("getSubtask returns a specific subtask", async () => {
    const created = await service.createSubtask({
      parentTicketId: "ticket-3",
      title: "Find me",
      description: "Specific subtask",
      priority: "p0",
    });

    const found = await service.getSubtask("ticket-3", created.id);
    expect(found).not.toBeNull();
    expect(found!.title).toBe("Find me");
    expect(found!.priority).toBe("p0");
  });

  it("getSubtask returns null for non-existent subtask", async () => {
    const found = await service.getSubtask("ticket-nonexistent", "sub-missing");
    expect(found).toBeNull();
  });

  it("clear removes all cached subtasks", async () => {
    await service.createSubtask({
      parentTicketId: "ticket-4",
      title: "Cached task",
      description: "Will be cleared",
    });

    service.clear();

    // After clearing cache, listing from persistence should still work
    const items = await service.listSubtasks("ticket-4", { includeCompleted: true });
    // Persistence still has data, so items should be available
    expect(items.length).toBe(1);
  });

  it("works without persistence (cache-only mode)", async () => {
    const cacheOnlyService = new SubtaskService();

    const created = await cacheOnlyService.createSubtask({
      parentTicketId: "ticket-5",
      title: "Cache-only",
      description: "No persistence",
      estimatedComplexity: "low",
    });

    expect(created.risk).toBe("low");

    const items = await cacheOnlyService.listSubtasks("ticket-5", { includeCompleted: true });
    expect(items.length).toBe(1);
    expect(items[0].title).toBe("Cache-only");
  });

  it("maps estimatedComplexity to risk correctly", async () => {
    const lowTask = await service.createSubtask({
      parentTicketId: "ticket-6",
      title: "Low",
      description: "Low complexity",
      estimatedComplexity: "low",
    });
    expect(lowTask.risk).toBe("low");

    const highTask = await service.createSubtask({
      parentTicketId: "ticket-6",
      title: "High",
      description: "High complexity",
      estimatedComplexity: "high",
    });
    expect(highTask.risk).toBe("high");

    const medTask = await service.createSubtask({
      parentTicketId: "ticket-6",
      title: "Medium",
      description: "Medium complexity",
      estimatedComplexity: "medium",
    });
    expect(medTask.risk).toBe("medium");

    const defaultTask = await service.createSubtask({
      parentTicketId: "ticket-6",
      title: "Default",
      description: "No complexity specified",
    });
    expect(defaultTask.risk).toBe("medium");
  });

  it("derives blocked status from explicit blocked status", async () => {
    const task = await service.createSubtask({
      parentTicketId: "ticket-7",
      title: "Will be blocked",
      description: "Explicitly blocked",
    });

    await service.updateSubtask({
      parentTicketId: "ticket-7",
      subtaskId: task.id,
      status: "blocked",
    });

    const items = await service.listSubtasks("ticket-7", { includeCompleted: true });
    const blockedTask = items.find((item) => item.id === task.id);
    expect(blockedTask!.blocked).toBe(true);
  });

  it("updateSubtask preserves notes when no new note is provided", async () => {
    const task = await service.createSubtask({
      parentTicketId: "ticket-8",
      title: "Track notes",
      description: "Notes test",
    });

    await service.updateSubtask({
      parentTicketId: "ticket-8",
      subtaskId: task.id,
      notes: "First note",
    });

    const updated = await service.updateSubtask({
      parentTicketId: "ticket-8",
      subtaskId: task.id,
      status: "in_progress",
    });

    expect(updated!.notes).toEqual(["First note"]);
  });

  it("listSubtasks returns empty array for unknown parent", async () => {
    const items = await service.listSubtasks("unknown-parent");
    expect(items).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Claim lifecycle tests
  // -----------------------------------------------------------------------

  describe("claimSubtask", () => {
    it("successfully claims an unclaimed subtask", async () => {
      const task = await service.createSubtask({
        parentTicketId: "ticket-claim-1",
        title: "Claimable",
        description: "Can be claimed",
      });

      const result = await service.claimSubtask({
        parentTicketId: "ticket-claim-1",
        subtaskId: task.id,
        agentId: "agent-A",
      });

      expect(result.success).toBe(true);
      expect(result.subtask).not.toBeNull();
      expect(result.subtask!.claimedBy).toBe("agent-A");
      expect(result.subtask!.claimedAt).toBeTruthy();
      expect(result.subtask!.claimExpiry).toBeTruthy();
      expect(result.subtask!.version).toBe(2);
    });

    it("rejects claim when already claimed by another agent", async () => {
      const task = await service.createSubtask({
        parentTicketId: "ticket-claim-2",
        title: "Already claimed",
        description: "Will be claimed first",
      });

      await service.claimSubtask({
        parentTicketId: "ticket-claim-2",
        subtaskId: task.id,
        agentId: "agent-A",
      });

      const result = await service.claimSubtask({
        parentTicketId: "ticket-claim-2",
        subtaskId: task.id,
        agentId: "agent-B",
      });

      expect(result.success).toBe(false);
      expect(result.reason).toBe("already_claimed");
      expect(result.subtask!.claimedBy).toBe("agent-A");
    });

    it("allows re-claim of an expired claim", async () => {
      const task = await service.createSubtask({
        parentTicketId: "ticket-claim-3",
        title: "Will expire",
        description: "Claim will expire",
      });

      // Claim with 1ms expiry so it expires immediately
      await service.claimSubtask({
        parentTicketId: "ticket-claim-3",
        subtaskId: task.id,
        agentId: "agent-A",
        expiryMs: 1,
      });

      // Wait a tiny bit to ensure expiry
      await new Promise((resolve) => setTimeout(resolve, 5));

      const result = await service.claimSubtask({
        parentTicketId: "ticket-claim-3",
        subtaskId: task.id,
        agentId: "agent-B",
      });

      expect(result.success).toBe(true);
      expect(result.subtask!.claimedBy).toBe("agent-B");
    });

    it("allows same agent to re-claim", async () => {
      const task = await service.createSubtask({
        parentTicketId: "ticket-claim-4",
        title: "Re-claimable",
        description: "Same agent re-claims",
      });

      await service.claimSubtask({
        parentTicketId: "ticket-claim-4",
        subtaskId: task.id,
        agentId: "agent-A",
      });

      const result = await service.claimSubtask({
        parentTicketId: "ticket-claim-4",
        subtaskId: task.id,
        agentId: "agent-A",
      });

      expect(result.success).toBe(true);
      expect(result.subtask!.claimedBy).toBe("agent-A");
    });

    it("returns not_found for non-existent subtask", async () => {
      const result = await service.claimSubtask({
        parentTicketId: "ticket-claim-5",
        subtaskId: "nonexistent",
        agentId: "agent-A",
      });

      expect(result.success).toBe(false);
      expect(result.reason).toBe("not_found");
      expect(result.subtask).toBeNull();
    });
  });

  describe("releaseClaimSubtask", () => {
    it("allows claiming agent to release", async () => {
      const task = await service.createSubtask({
        parentTicketId: "ticket-release-1",
        title: "Releasable",
        description: "Will be released",
      });

      await service.claimSubtask({
        parentTicketId: "ticket-release-1",
        subtaskId: task.id,
        agentId: "agent-A",
      });

      const released = await service.releaseClaimSubtask({
        parentTicketId: "ticket-release-1",
        subtaskId: task.id,
        agentId: "agent-A",
      });

      expect(released).not.toBeNull();
      expect(released!.claimedBy).toBeNull();
      expect(released!.claimedAt).toBeNull();
      expect(released!.claimExpiry).toBeNull();
    });

    it("rejects release by non-claiming agent", async () => {
      const task = await service.createSubtask({
        parentTicketId: "ticket-release-2",
        title: "Not yours",
        description: "Cannot be released by other agent",
      });

      await service.claimSubtask({
        parentTicketId: "ticket-release-2",
        subtaskId: task.id,
        agentId: "agent-A",
      });

      const released = await service.releaseClaimSubtask({
        parentTicketId: "ticket-release-2",
        subtaskId: task.id,
        agentId: "agent-B",
      });

      expect(released).toBeNull();
    });

    it("allows release of expired claim by any agent", async () => {
      const task = await service.createSubtask({
        parentTicketId: "ticket-release-3",
        title: "Expired claim",
        description: "Expired, anyone can release",
      });

      await service.claimSubtask({
        parentTicketId: "ticket-release-3",
        subtaskId: task.id,
        agentId: "agent-A",
        expiryMs: 1,
      });

      await new Promise((resolve) => setTimeout(resolve, 5));

      const released = await service.releaseClaimSubtask({
        parentTicketId: "ticket-release-3",
        subtaskId: task.id,
        agentId: "agent-B",
      });

      expect(released).not.toBeNull();
      expect(released!.claimedBy).toBeNull();
    });

    it("returns null for non-existent subtask", async () => {
      const released = await service.releaseClaimSubtask({
        parentTicketId: "ticket-release-4",
        subtaskId: "nonexistent",
        agentId: "agent-A",
      });

      expect(released).toBeNull();
    });
  });

  describe("updateSubtaskWithVersion", () => {
    it("succeeds when version matches", async () => {
      const task = await service.createSubtask({
        parentTicketId: "ticket-version-1",
        title: "Versioned",
        description: "Version check",
      });

      const result = await service.updateSubtaskWithVersion({
        parentTicketId: "ticket-version-1",
        subtaskId: task.id,
        expectedVersion: 1,
        status: "in_progress",
      });

      expect(result.success).toBe(true);
      expect(result.subtask!.version).toBe(2);
      expect(result.subtask!.status).toBe("in_progress");
    });

    it("fails with version_conflict when version mismatches", async () => {
      const task = await service.createSubtask({
        parentTicketId: "ticket-version-2",
        title: "Conflict",
        description: "Will conflict",
      });

      const result = await service.updateSubtaskWithVersion({
        parentTicketId: "ticket-version-2",
        subtaskId: task.id,
        expectedVersion: 99,
        status: "in_progress",
      });

      expect(result.success).toBe(false);
      expect(result.reason).toBe("version_conflict");
      expect(result.subtask!.status).toBe("backlog");
    });

    it("returns not_found for non-existent subtask", async () => {
      const result = await service.updateSubtaskWithVersion({
        parentTicketId: "ticket-version-3",
        subtaskId: "nonexistent",
        expectedVersion: 1,
      });

      expect(result.success).toBe(false);
      expect(result.reason).toBe("not_found");
      expect(result.subtask).toBeNull();
    });
  });

  describe("auto-expiry on listSubtasks", () => {
    it("automatically releases expired claims when listing", async () => {
      const task = await service.createSubtask({
        parentTicketId: "ticket-autoexpiry-1",
        title: "Auto-expire",
        description: "Claim will auto-expire on list",
      });

      await service.claimSubtask({
        parentTicketId: "ticket-autoexpiry-1",
        subtaskId: task.id,
        agentId: "agent-A",
        expiryMs: 1,
      });

      await new Promise((resolve) => setTimeout(resolve, 5));

      const items = await service.listSubtasks("ticket-autoexpiry-1", { includeCompleted: true });
      const found = items.find((item) => item.id === task.id);

      expect(found!.claimedBy).toBeNull();
      expect(found!.claimedAt).toBeNull();
      expect(found!.claimExpiry).toBeNull();
    });
  });

  describe("version field initialization", () => {
    it("creates subtasks with version 1", async () => {
      const task = await service.createSubtask({
        parentTicketId: "ticket-version-init",
        title: "Has version",
        description: "Version should be 1",
      });

      expect(task.version).toBe(1);
    });
  });
});

describe("createPrismaSubtaskPersistence (mocked db)", async () => {
  const mockTicketEvents: Array<{ ticketId: string; type: string; payload: unknown; createdAt: Date }> = [];

  const mockPrisma = vi.hoisted(() => ({
    ticketEvent: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
  }));

  vi.mock("../db", () => ({ prisma: mockPrisma }));

  // Dynamic import after mock is in place
  const { createPrismaSubtaskPersistence } = await import("./subtaskService");

  beforeEach(() => {
    mockTicketEvents.length = 0;
    vi.clearAllMocks();

    mockPrisma.ticketEvent.findMany.mockImplementation(async ({ where }: any) => {
      return mockTicketEvents
        .filter((e) => e.ticketId === where.ticketId && e.type === where.type)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    });

    mockPrisma.ticketEvent.create.mockImplementation(async ({ data }: any) => {
      const event = { ...data, createdAt: new Date(), id: `evt-${mockTicketEvents.length}` };
      mockTicketEvents.push(event as any);
      return event;
    });
  });

  it("lists and saves subtask events via prisma", async () => {
    const persistence = createPrismaSubtaskPersistence();

    const subtask = {
      id: "sub-1",
      parentTicketId: "ticket-p1",
      title: "Test subtask",
      description: "Test desc",
      status: "backlog" as const,
      priority: "p2" as const,
      risk: "medium" as const,
      dependencies: [],
      notes: [],
      blockedBy: [],
      blocked: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await persistence.save("ticket-p1", { kind: "created", subtask });

    expect(mockPrisma.ticketEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ticketId: "ticket-p1",
        type: "ticket.subtask_upserted",
      }),
    });

    const items = await persistence.list("ticket-p1");
    expect(items.length).toBe(1);
    expect(items[0].id).toBe("sub-1");
  });

  it("skips events with missing subtask id during list", async () => {
    const persistence = createPrismaSubtaskPersistence();

    // Add a valid event
    mockTicketEvents.push({
      ticketId: "ticket-p2",
      type: "ticket.subtask_upserted",
      payload: { kind: "created", subtask: { id: "sub-valid", title: "Valid", dependencies: [] } },
      createdAt: new Date(),
    });

    // Add an invalid event with no subtask id
    mockTicketEvents.push({
      ticketId: "ticket-p2",
      type: "ticket.subtask_upserted",
      payload: { kind: "created", subtask: {} },
      createdAt: new Date(),
    });

    // Add an event with null payload
    mockTicketEvents.push({
      ticketId: "ticket-p2",
      type: "ticket.subtask_upserted",
      payload: null,
      createdAt: new Date(),
    });

    const items = await persistence.list("ticket-p2");
    expect(items.length).toBe(1);
    expect(items[0].id).toBe("sub-valid");
  });

  it("replays events to get latest state per subtask", async () => {
    const persistence = createPrismaSubtaskPersistence();

    const now = new Date().toISOString();

    // Initial creation
    mockTicketEvents.push({
      ticketId: "ticket-p3",
      type: "ticket.subtask_upserted",
      payload: {
        kind: "created",
        subtask: { id: "sub-replay", title: "Original", status: "backlog", dependencies: [], notes: [], blockedBy: [], blocked: false, createdAt: now, updatedAt: now },
      },
      createdAt: new Date(1000),
    });

    // Update
    mockTicketEvents.push({
      ticketId: "ticket-p3",
      type: "ticket.subtask_upserted",
      payload: {
        kind: "updated",
        subtask: { id: "sub-replay", title: "Updated", status: "in_progress", dependencies: [], notes: ["progress"], blockedBy: [], blocked: false, createdAt: now, updatedAt: now },
      },
      createdAt: new Date(2000),
    });

    const items = await persistence.list("ticket-p3");
    expect(items.length).toBe(1);
    expect(items[0].title).toBe("Updated");
    expect(items[0].status).toBe("in_progress");
  });
});
