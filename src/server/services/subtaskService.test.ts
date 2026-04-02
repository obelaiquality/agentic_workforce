import { beforeEach, describe, expect, it } from "vitest";
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
});
