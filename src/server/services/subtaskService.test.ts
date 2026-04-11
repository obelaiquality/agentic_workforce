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
