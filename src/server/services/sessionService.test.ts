import { describe, it, expect, vi, beforeEach } from "vitest";

const hoisted = vi.hoisted(() => ({
  prisma: {
    chatSession: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    chatMessage: {
      create: vi.fn(),
    },
  },
}));

const mockPrisma = hoisted.prisma;

vi.mock("../db", () => ({
  prisma: hoisted.prisma,
}));

import {
  listSessions,
  getSession,
  createSession,
  addMessage,
  updateSession,
  deleteSession,
} from "./sessionService";

describe("sessionService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("listSessions", () => {
    it("returns sessions with message counts", async () => {
      const now = new Date();
      mockPrisma.chatSession.findMany.mockResolvedValue([
        {
          id: "s1",
          title: "First session",
          repoId: "r1",
          providerId: "onprem-qwen",
          createdAt: now,
          updatedAt: now,
          metadata: {},
          _count: { messages: 5 },
          messages: [{ createdAt: now }],
        },
      ]);
      mockPrisma.chatSession.count.mockResolvedValue(1);

      const result = await listSessions({ repoId: "r1" });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe("s1");
      expect(result.items[0].messageCount).toBe(5);
      expect(result.total).toBe(1);
    });

    it("passes search filter to query", async () => {
      mockPrisma.chatSession.findMany.mockResolvedValue([]);
      mockPrisma.chatSession.count.mockResolvedValue(0);

      await listSessions({ search: "test query" });

      const where = mockPrisma.chatSession.findMany.mock.calls[0][0].where;
      expect(where.OR).toBeDefined();
    });

    it("applies pagination parameters", async () => {
      mockPrisma.chatSession.findMany.mockResolvedValue([]);
      mockPrisma.chatSession.count.mockResolvedValue(0);

      await listSessions({ limit: 10, offset: 20 });

      const args = mockPrisma.chatSession.findMany.mock.calls[0][0];
      expect(args.take).toBe(10);
      expect(args.skip).toBe(20);
    });
  });

  describe("getSession", () => {
    it("returns session with messages", async () => {
      const now = new Date();
      mockPrisma.chatSession.findUnique.mockResolvedValue({
        id: "s1",
        title: "Test",
        repoId: null,
        providerId: "onprem-qwen",
        createdAt: now,
        updatedAt: now,
        metadata: {},
        _count: { messages: 2 },
        messages: [
          { id: "m1", role: "user", content: "Hello", metadata: null, createdAt: now },
          { id: "m2", role: "assistant", content: "Hi", metadata: {}, createdAt: now },
        ],
      });

      const result = await getSession("s1");

      expect(result).not.toBeNull();
      expect(result!.messages).toHaveLength(2);
      expect(result!.messages[0].role).toBe("user");
    });

    it("returns null for missing session", async () => {
      mockPrisma.chatSession.findUnique.mockResolvedValue(null);

      const result = await getSession("nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("createSession", () => {
    it("creates a new session with defaults", async () => {
      const now = new Date();
      mockPrisma.chatSession.create.mockResolvedValue({
        id: "new-s1",
        title: "New Session",
        repoId: null,
        providerId: "onprem-qwen",
        createdAt: now,
        updatedAt: now,
        metadata: {},
      });

      const result = await createSession({ title: "New Session" });

      expect(result.id).toBe("new-s1");
      expect(result.title).toBe("New Session");
      expect(result.messageCount).toBe(0);
    });
  });

  describe("addMessage", () => {
    it("creates message and touches session", async () => {
      const now = new Date();
      mockPrisma.chatMessage.create.mockResolvedValue({
        id: "m1",
        role: "user",
        content: "Hello",
        metadata: null,
        createdAt: now,
      });
      mockPrisma.chatSession.update.mockResolvedValue({});

      const result = await addMessage({
        sessionId: "s1",
        role: "user",
        content: "Hello",
      });

      expect(result.id).toBe("m1");
      expect(result.content).toBe("Hello");
      expect(mockPrisma.chatSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "s1" },
        }),
      );
    });
  });

  describe("updateSession", () => {
    it("updates session title", async () => {
      const now = new Date();
      mockPrisma.chatSession.update.mockResolvedValue({
        id: "s1",
        title: "Updated",
        repoId: null,
        providerId: "onprem-qwen",
        createdAt: now,
        updatedAt: now,
        metadata: {},
        _count: { messages: 3 },
        messages: [],
      });

      const result = await updateSession("s1", { title: "Updated" });
      expect(result.title).toBe("Updated");
    });
  });

  describe("deleteSession", () => {
    it("deletes session by id", async () => {
      mockPrisma.chatSession.delete.mockResolvedValue({});

      await deleteSession("s1");

      expect(mockPrisma.chatSession.delete).toHaveBeenCalledWith({
        where: { id: "s1" },
      });
    });
  });
});
