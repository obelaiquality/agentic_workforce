import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TicketStatus } from "../../../shared/contracts";

const mockPrisma = vi.hoisted(() => ({
  taskProjection: {
    upsert: vi.fn(),
  },
}));

vi.mock("../../db", () => ({
  prisma: mockPrisma,
}));

const { mapLegacyToLifecycle, syncTaskProjectionFromTicket } = await import("./ticketProjection");

describe("ticketProjection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("mapLegacyToLifecycle", () => {
    it("maps backlog to inactive", () => {
      expect(mapLegacyToLifecycle("backlog")).toBe("inactive");
    });

    it("maps ready to active", () => {
      expect(mapLegacyToLifecycle("ready")).toBe("active");
    });

    it("maps in_progress to in_progress", () => {
      expect(mapLegacyToLifecycle("in_progress")).toBe("in_progress");
    });

    it("maps blocked to blocked", () => {
      expect(mapLegacyToLifecycle("blocked")).toBe("blocked");
    });

    it("maps done to completed", () => {
      expect(mapLegacyToLifecycle("done")).toBe("completed");
    });

    it("returns active for unknown status", () => {
      expect(mapLegacyToLifecycle("unknown" as TicketStatus)).toBe("active");
    });
  });

  describe("syncTaskProjectionFromTicket", () => {
    it("creates a new task projection from ticket", async () => {
      const ticket = {
        id: "ticket-1",
        repoId: "repo-1",
        title: "Build feature X",
        description: "Implement the X feature",
        status: "in_progress" as TicketStatus,
        priority: "p1" as const,
        risk: "medium" as const,
        acceptanceCriteria: ["Criterion 1", "Criterion 2"],
        dependencies: ["ticket-2"],
      };

      mockPrisma.taskProjection.upsert.mockResolvedValue({
        id: "task-1",
        ticketId: ticket.id,
        repoId: ticket.repoId,
        title: ticket.title,
        description: ticket.description,
        status: "in_progress",
        priority: ticket.priority,
        risk: ticket.risk,
        acceptanceCriteria: ticket.acceptanceCriteria,
        dependencies: ticket.dependencies,
      });

      await syncTaskProjectionFromTicket(ticket);

      expect(mockPrisma.taskProjection.upsert).toHaveBeenCalledWith({
        where: { ticketId: "ticket-1" },
        update: {
          repoId: "repo-1",
          title: "Build feature X",
          description: "Implement the X feature",
          status: "in_progress",
          priority: "p1",
          risk: "medium",
          acceptanceCriteria: ["Criterion 1", "Criterion 2"],
          dependencies: ["ticket-2"],
        },
        create: {
          ticketId: "ticket-1",
          repoId: "repo-1",
          title: "Build feature X",
          description: "Implement the X feature",
          status: "in_progress",
          priority: "p1",
          risk: "medium",
          acceptanceCriteria: ["Criterion 1", "Criterion 2"],
          dependencies: ["ticket-2"],
        },
      });
    });

    it("maps ticket status to lifecycle status correctly", async () => {
      const ticket = {
        id: "ticket-2",
        repoId: "repo-1",
        title: "Task in backlog",
        description: "Not started yet",
        status: "backlog" as TicketStatus,
        priority: "p2" as const,
        risk: "low" as const,
        acceptanceCriteria: [],
        dependencies: [],
      };

      await syncTaskProjectionFromTicket(ticket);

      expect(mockPrisma.taskProjection.upsert).toHaveBeenCalledWith({
        where: { ticketId: "ticket-2" },
        update: expect.objectContaining({
          status: "inactive",
        }),
        create: expect.objectContaining({
          status: "inactive",
        }),
      });
    });

    it("handles ticket without repoId", async () => {
      const ticket = {
        id: "ticket-3",
        repoId: null,
        title: "Global task",
        description: "Not tied to a specific repo",
        status: "ready" as TicketStatus,
        priority: "p0" as const,
        risk: "high" as const,
        acceptanceCriteria: ["Must complete"],
        dependencies: [],
      };

      await syncTaskProjectionFromTicket(ticket);

      expect(mockPrisma.taskProjection.upsert).toHaveBeenCalledWith({
        where: { ticketId: "ticket-3" },
        update: expect.objectContaining({
          repoId: null,
          status: "active",
        }),
        create: expect.objectContaining({
          repoId: null,
          status: "active",
        }),
      });
    });

    it("handles ticket with undefined repoId", async () => {
      const ticket = {
        id: "ticket-4",
        title: "Task with undefined repo",
        description: "RepoId is undefined",
        status: "done" as TicketStatus,
        priority: "p3" as const,
        risk: "low" as const,
        acceptanceCriteria: [],
        dependencies: [],
      };

      await syncTaskProjectionFromTicket(ticket);

      expect(mockPrisma.taskProjection.upsert).toHaveBeenCalledWith({
        where: { ticketId: "ticket-4" },
        update: expect.objectContaining({
          repoId: null,
          status: "completed",
        }),
        create: expect.objectContaining({
          repoId: null,
          status: "completed",
        }),
      });
    });

    it("syncs all priority levels correctly", async () => {
      const priorities: Array<"p0" | "p1" | "p2" | "p3"> = ["p0", "p1", "p2", "p3"];

      for (const priority of priorities) {
        const ticket = {
          id: `ticket-${priority}`,
          repoId: "repo-1",
          title: `Task with ${priority}`,
          description: "Test priority",
          status: "ready" as TicketStatus,
          priority,
          risk: "medium" as const,
          acceptanceCriteria: [],
          dependencies: [],
        };

        await syncTaskProjectionFromTicket(ticket);

        expect(mockPrisma.taskProjection.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            update: expect.objectContaining({ priority }),
            create: expect.objectContaining({ priority }),
          }),
        );
      }
    });

    it("syncs all risk levels correctly", async () => {
      const risks: Array<"low" | "medium" | "high"> = ["low", "medium", "high"];

      for (const risk of risks) {
        const ticket = {
          id: `ticket-${risk}`,
          repoId: "repo-1",
          title: `Task with ${risk} risk`,
          description: "Test risk",
          status: "ready" as TicketStatus,
          priority: "p2" as const,
          risk,
          acceptanceCriteria: [],
          dependencies: [],
        };

        await syncTaskProjectionFromTicket(ticket);

        expect(mockPrisma.taskProjection.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            update: expect.objectContaining({ risk }),
            create: expect.objectContaining({ risk }),
          }),
        );
      }
    });

    it("handles empty arrays for acceptanceCriteria and dependencies", async () => {
      const ticket = {
        id: "ticket-empty",
        repoId: "repo-1",
        title: "Minimal task",
        description: "No criteria or deps",
        status: "ready" as TicketStatus,
        priority: "p2" as const,
        risk: "low" as const,
        acceptanceCriteria: [],
        dependencies: [],
      };

      await syncTaskProjectionFromTicket(ticket);

      expect(mockPrisma.taskProjection.upsert).toHaveBeenCalledWith({
        where: { ticketId: "ticket-empty" },
        update: expect.objectContaining({
          acceptanceCriteria: [],
          dependencies: [],
        }),
        create: expect.objectContaining({
          acceptanceCriteria: [],
          dependencies: [],
        }),
      });
    });

    it("handles multiple acceptance criteria and dependencies", async () => {
      const ticket = {
        id: "ticket-complex",
        repoId: "repo-1",
        title: "Complex task",
        description: "Many criteria and deps",
        status: "blocked" as TicketStatus,
        priority: "p1" as const,
        risk: "high" as const,
        acceptanceCriteria: ["Criterion A", "Criterion B", "Criterion C"],
        dependencies: ["ticket-1", "ticket-2", "ticket-3"],
      };

      await syncTaskProjectionFromTicket(ticket);

      expect(mockPrisma.taskProjection.upsert).toHaveBeenCalledWith({
        where: { ticketId: "ticket-complex" },
        update: expect.objectContaining({
          acceptanceCriteria: ["Criterion A", "Criterion B", "Criterion C"],
          dependencies: ["ticket-1", "ticket-2", "ticket-3"],
          status: "blocked",
        }),
        create: expect.objectContaining({
          acceptanceCriteria: ["Criterion A", "Criterion B", "Criterion C"],
          dependencies: ["ticket-1", "ticket-2", "ticket-3"],
          status: "blocked",
        }),
      });
    });

    it("propagates prisma errors", async () => {
      const ticket = {
        id: "ticket-error",
        repoId: "repo-1",
        title: "Error task",
        description: "This will fail",
        status: "ready" as TicketStatus,
        priority: "p2" as const,
        risk: "low" as const,
        acceptanceCriteria: [],
        dependencies: [],
      };

      const error = new Error("Database connection failed");
      mockPrisma.taskProjection.upsert.mockRejectedValue(error);

      await expect(syncTaskProjectionFromTicket(ticket)).rejects.toThrow("Database connection failed");
    });
  });
});
