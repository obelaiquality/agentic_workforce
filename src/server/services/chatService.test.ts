import { beforeEach, describe, expect, it, vi } from "vitest";

/* ------------------------------------------------------------------ */
/*  Hoisted mocks for prisma, eventBus, and ProviderOrchestrator      */
/* ------------------------------------------------------------------ */

const mocks = vi.hoisted(() => ({
  prisma: {
    chatSession: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      update: vi.fn(),
    },
    chatMessage: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
    },
    auditEvent: {
      create: vi.fn(),
    },
    approvalRequest: {
      create: vi.fn(),
    },
  },
  publishEvent: vi.fn(),
  ProviderOrchestrator: vi.fn(),
}));

vi.mock("../db", () => ({ prisma: mocks.prisma }));
vi.mock("../eventBus", () => ({ publishEvent: mocks.publishEvent }));
vi.mock("./providerOrchestrator", () => ({
  ProviderOrchestrator: mocks.ProviderOrchestrator,
}));

import { ChatService } from "./chatService";
import type { ChatMessageDto, ChatSessionDto } from "../../shared/contracts";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeSession(overrides: Partial<any> = {}) {
  return {
    id: "session-1",
    repoId: "repo-1",
    title: "Test Session",
    providerId: "openai",
    createdAt: new Date("2026-03-28T12:00:00.000Z"),
    updatedAt: new Date("2026-03-28T12:30:00.000Z"),
    metadata: { providerSession: { sessionId: "ext-123" } },
    ...overrides,
  };
}

function makeMessage(overrides: Partial<any> = {}) {
  return {
    id: "msg-1",
    sessionId: "session-1",
    role: "user",
    content: "Hello",
    createdAt: new Date("2026-03-28T12:05:00.000Z"),
    metadata: { modelRole: "coder_default" },
    ...overrides,
  };
}

function buildMockOrchestrator() {
  const mockAdapter = {
    createSession: vi.fn().mockResolvedValue({ sessionId: "ext-123" }),
  };

  const orchestrator = {
    getActiveProvider: vi.fn().mockResolvedValue("openai"),
    getProviderAdapter: vi.fn().mockReturnValue(mockAdapter),
    streamChatWithRetry: vi.fn().mockResolvedValue({
      accountId: "acct-1",
      providerId: "openai",
      usage: { promptTokens: 100, completionTokens: 50 },
      session: { previousResponseId: "resp-1" },
    }),
  };

  mocks.ProviderOrchestrator.mockReturnValue(orchestrator);
  return orchestrator;
}

function buildService() {
  const orchestrator = buildMockOrchestrator();
  return new ChatService(orchestrator as any);
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("ChatService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.chatSession.findMany.mockResolvedValue([]);
    mocks.prisma.chatSession.findUnique.mockResolvedValue(null);
    mocks.prisma.chatSession.create.mockResolvedValue(makeSession());
    mocks.prisma.chatSession.update.mockResolvedValue(makeSession());
    mocks.prisma.chatMessage.findMany.mockResolvedValue([]);
    mocks.prisma.chatMessage.create.mockResolvedValue(makeMessage());
    mocks.prisma.auditEvent.create.mockResolvedValue({});
    mocks.prisma.approvalRequest.create.mockResolvedValue({});
  });

  /* ---- mapSession ---- */

  describe("listSessions (via mapSession)", () => {
    it("converts Date objects to ISO strings", async () => {
      const session = makeSession();
      mocks.prisma.chatSession.findMany.mockResolvedValue([session]);

      const service = buildService();
      const result = await service.listSessions();

      expect(result).toHaveLength(1);
      expect(result[0].createdAt).toBe("2026-03-28T12:00:00.000Z");
      expect(result[0].updatedAt).toBe("2026-03-28T12:30:00.000Z");
    });

    it("maps metadata correctly and handles null", async () => {
      const session1 = makeSession({ metadata: { key: "value" } });
      const session2 = makeSession({ metadata: null });
      mocks.prisma.chatSession.findMany.mockResolvedValue([session1, session2]);

      const service = buildService();
      const result = await service.listSessions();

      expect(result[0].metadata).toEqual({ key: "value" });
      expect(result[1].metadata).toBeUndefined();
    });

    it("preserves all session fields in DTO", async () => {
      const session = makeSession({
        id: "s-123",
        repoId: "repo-456",
        title: "My Chat",
        providerId: "openai",
      });
      mocks.prisma.chatSession.findMany.mockResolvedValue([session]);

      const service = buildService();
      const result = await service.listSessions();

      expect(result[0].id).toBe("s-123");
      expect(result[0].repoId).toBe("repo-456");
      expect(result[0].title).toBe("My Chat");
      expect(result[0].providerId).toBe("openai");
    });
  });

  /* ---- mapMessage ---- */

  describe("listMessages (via mapMessage)", () => {
    it("converts Date objects to ISO strings", async () => {
      const message = makeMessage();
      mocks.prisma.chatMessage.findMany.mockResolvedValue([message]);
      mocks.prisma.chatSession.findUnique.mockResolvedValue(makeSession());

      const service = buildService();
      const result = await service.listMessages("session-1");

      expect(result).toHaveLength(1);
      expect(result[0].createdAt).toBe("2026-03-28T12:05:00.000Z");
    });

    it("maps metadata correctly and handles null", async () => {
      const msg1 = makeMessage({ metadata: { test: "data" } });
      const msg2 = makeMessage({ metadata: null });
      mocks.prisma.chatMessage.findMany.mockResolvedValue([msg1, msg2]);
      mocks.prisma.chatSession.findUnique.mockResolvedValue(makeSession());

      const service = buildService();
      const result = await service.listMessages("session-1");

      expect(result[0].metadata).toEqual({ test: "data" });
      expect(result[1].metadata).toBeUndefined();
    });

    it("preserves all message fields in DTO", async () => {
      const message = makeMessage({
        id: "m-789",
        sessionId: "s-123",
        role: "assistant",
        content: "Response text",
      });
      mocks.prisma.chatMessage.findMany.mockResolvedValue([message]);
      mocks.prisma.chatSession.findUnique.mockResolvedValue(makeSession());

      const service = buildService();
      const result = await service.listMessages("s-123");

      expect(result[0].id).toBe("m-789");
      expect(result[0].sessionId).toBe("s-123");
      expect(result[0].role).toBe("assistant");
      expect(result[0].content).toBe("Response text");
    });
  });

  /* ---- parseActions ---- */

  describe("parseActions", () => {
    it("detects [ACTION:file_write] without payload", async () => {
      const session = makeSession();
      mocks.prisma.chatSession.findUnique.mockResolvedValue(session);
      mocks.prisma.chatMessage.findMany.mockResolvedValue([
        makeMessage({ role: "user", content: "Create a file" }),
      ]);
      mocks.prisma.chatMessage.create
        .mockResolvedValueOnce(makeMessage({ role: "user", content: "Create a file" }))
        .mockResolvedValueOnce(
          makeMessage({
            role: "assistant",
            content: "[ACTION:file_write] Creating file",
          })
        );

      const orchestrator = buildMockOrchestrator();
      orchestrator.streamChatWithRetry.mockImplementation((sessionId, messages, onToken) => {
        const text = "[ACTION:file_write] Creating file";
        for (const char of text) {
          onToken(char);
        }
        return Promise.resolve({
          accountId: "acct-1",
          providerId: "openai",
          usage: {},
          session: {},
        });
      });

      const service = buildService();
      await service.createUserMessage("session-1", "Create a file");

      // Wait for async runAssistantTurn to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mocks.prisma.approvalRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actionType: "file_write",
          }),
        })
      );
    });

    it("parses action with JSON payload", async () => {
      const session = makeSession();
      mocks.prisma.chatSession.findUnique.mockResolvedValue(session);
      mocks.prisma.chatMessage.findMany.mockResolvedValue([
        makeMessage({ role: "user", content: "Run command" }),
      ]);
      mocks.prisma.chatMessage.create
        .mockResolvedValueOnce(makeMessage({ role: "user", content: "Run command" }))
        .mockResolvedValueOnce(
          makeMessage({
            role: "assistant",
            content: '[ACTION:run_command payload={"cmd":"ls"}] Running',
          })
        );

      const orchestrator = buildMockOrchestrator();
      orchestrator.streamChatWithRetry.mockImplementation((sessionId, messages, onToken) => {
        const text = '[ACTION:run_command payload={"cmd":"ls"}] Running';
        for (const char of text) {
          onToken(char);
        }
        return Promise.resolve({
          accountId: "acct-1",
          providerId: "openai",
          usage: {},
          session: {},
        });
      });

      const service = buildService();
      await service.createUserMessage("session-1", "Run command");

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mocks.prisma.approvalRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actionType: "run_command",
            payload: expect.objectContaining({
              cmd: "ls",
              sessionId: "session-1",
            }),
          }),
        })
      );
    });

    it("handles invalid JSON payload gracefully", async () => {
      const session = makeSession();
      mocks.prisma.chatSession.findUnique.mockResolvedValue(session);
      mocks.prisma.chatMessage.findMany.mockResolvedValue([
        makeMessage({ role: "user", content: "Test" }),
      ]);
      mocks.prisma.chatMessage.create
        .mockResolvedValueOnce(makeMessage({ role: "user", content: "Test" }))
        .mockResolvedValueOnce(
          makeMessage({
            role: "assistant",
            content: '[ACTION:file_write payload={bad json}] Text',
          })
        );

      const orchestrator = buildMockOrchestrator();
      orchestrator.streamChatWithRetry.mockImplementation((sessionId, messages, onToken) => {
        const text = '[ACTION:file_write payload={bad json}] Text';
        for (const char of text) {
          onToken(char);
        }
        return Promise.resolve({
          accountId: "acct-1",
          providerId: "openai",
          usage: {},
          session: {},
        });
      });

      const service = buildService();
      await service.createUserMessage("session-1", "Test");

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mocks.prisma.approvalRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actionType: "file_write",
            payload: expect.objectContaining({
              raw: "{bad json}",
              sessionId: "session-1",
            }),
          }),
        })
      );
    });

    it("does not create approval for non-risky actions", async () => {
      const session = makeSession();
      mocks.prisma.chatSession.findUnique.mockResolvedValue(session);
      mocks.prisma.chatMessage.findMany.mockResolvedValue([
        makeMessage({ role: "user", content: "Test" }),
      ]);
      mocks.prisma.chatMessage.create
        .mockResolvedValueOnce(makeMessage({ role: "user", content: "Test" }))
        .mockResolvedValueOnce(
          makeMessage({
            role: "assistant",
            content: "[ACTION:read_file] Reading file",
          })
        );

      const orchestrator = buildMockOrchestrator();
      orchestrator.streamChatWithRetry.mockImplementation((sessionId, messages, onToken) => {
        const text = "[ACTION:read_file] Reading file";
        for (const char of text) {
          onToken(char);
        }
        return Promise.resolve({
          accountId: "acct-1",
          providerId: "openai",
          usage: {},
          session: {},
        });
      });

      const service = buildService();
      await service.createUserMessage("session-1", "Test");

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mocks.prisma.approvalRequest.create).not.toHaveBeenCalled();
    });
  });

  /* ---- ChatService.listSessions() ---- */

  describe("listSessions", () => {
    it("queries prisma with correct ordering and limit", async () => {
      mocks.prisma.chatSession.findMany.mockResolvedValue([]);

      const service = buildService();
      await service.listSessions();

      expect(mocks.prisma.chatSession.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { updatedAt: "desc" },
        take: 20,
      });
    });

    it("filters by repoId when provided", async () => {
      mocks.prisma.chatSession.findMany.mockResolvedValue([]);

      const service = buildService();
      await service.listSessions("repo-123");

      expect(mocks.prisma.chatSession.findMany).toHaveBeenCalledWith({
        where: { repoId: "repo-123" },
        orderBy: { updatedAt: "desc" },
        take: 20,
      });
    });

    it("returns mapped sessions", async () => {
      const sessions = [
        makeSession({ id: "s-1", title: "First" }),
        makeSession({ id: "s-2", title: "Second" }),
      ];
      mocks.prisma.chatSession.findMany.mockResolvedValue(sessions);

      const service = buildService();
      const result = await service.listSessions();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("s-1");
      expect(result[1].id).toBe("s-2");
    });
  });

  /* ---- ChatService.createSession() ---- */

  describe("createSession", () => {
    it("creates session with active provider", async () => {
      const session = makeSession({ title: "New Session" });
      mocks.prisma.chatSession.create.mockResolvedValue(session);

      const service = buildService();
      const result = await service.createSession("New Session");

      expect(mocks.prisma.chatSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          title: "New Session",
          providerId: "openai",
          repoId: null,
        }),
      });
      expect(result.title).toBe("New Session");
    });

    it("creates provider session and stores metadata", async () => {
      const session = makeSession({
        metadata: { providerSession: { sessionId: "ext-123" } },
      });
      mocks.prisma.chatSession.create.mockResolvedValue(session);

      const orchestrator = buildMockOrchestrator();
      const service = new ChatService(orchestrator as any);
      await service.createSession("Test");

      const adapter = orchestrator.getProviderAdapter("openai");
      expect(adapter.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { title: "Test" },
        })
      );
    });

    it("handles provider session creation failure gracefully", async () => {
      const orchestrator = buildMockOrchestrator();
      const adapter = orchestrator.getProviderAdapter("openai");
      adapter.createSession.mockRejectedValue(new Error("Provider error"));

      const session = makeSession({ metadata: undefined });
      mocks.prisma.chatSession.create.mockResolvedValue(session);

      const service = new ChatService(orchestrator as any);
      const result = await service.createSession("Test");

      expect(result).toBeDefined();
      expect(mocks.prisma.chatSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            metadata: undefined,
          }),
        })
      );
    });

    it("creates audit event for session creation", async () => {
      const session = makeSession({ id: "new-session" });
      mocks.prisma.chatSession.create.mockResolvedValue(session);

      const service = buildService();
      await service.createSession("Test");

      expect(mocks.prisma.auditEvent.create).toHaveBeenCalledWith({
        data: {
          actor: "user",
          eventType: "chat.session_created",
          payload: { sessionId: "new-session" },
        },
      });
    });

    it("associates session with repoId when provided", async () => {
      const session = makeSession({ repoId: "repo-456" });
      mocks.prisma.chatSession.create.mockResolvedValue(session);

      const service = buildService();
      await service.createSession("Test", "repo-456");

      expect(mocks.prisma.chatSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            repoId: "repo-456",
          }),
        })
      );
    });
  });

  /* ---- ChatService.listMessages() ---- */

  describe("listMessages", () => {
    it("queries prisma with correct sessionId and ordering", async () => {
      mocks.prisma.chatMessage.findMany.mockResolvedValue([]);
      mocks.prisma.chatSession.findUnique.mockResolvedValue(makeSession());

      const service = buildService();
      await service.listMessages("session-123");

      expect(mocks.prisma.chatMessage.findMany).toHaveBeenCalledWith({
        where: { sessionId: "session-123" },
        orderBy: { createdAt: "asc" },
      });
    });

    it("returns mapped messages in chronological order", async () => {
      const messages = [
        makeMessage({ id: "m-1", createdAt: new Date("2026-03-28T12:00:00.000Z") }),
        makeMessage({ id: "m-2", createdAt: new Date("2026-03-28T12:05:00.000Z") }),
      ];
      mocks.prisma.chatMessage.findMany.mockResolvedValue(messages);
      mocks.prisma.chatSession.findUnique.mockResolvedValue(makeSession());

      const service = buildService();
      const result = await service.listMessages("session-1");

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("m-1");
      expect(result[1].id).toBe("m-2");
    });
  });

  /* ---- ChatService.createUserMessage() ---- */

  describe("createUserMessage", () => {
    it("creates user message in database", async () => {
      const message = makeMessage({ content: "User input" });
      mocks.prisma.chatMessage.create.mockResolvedValueOnce(message);

      const service = buildService();
      const result = await service.createUserMessage("session-1", "User input");

      expect(mocks.prisma.chatMessage.create).toHaveBeenCalledWith({
        data: {
          sessionId: "session-1",
          role: "user",
          content: "User input",
          metadata: undefined,
        },
      });
      expect(result.content).toBe("User input");
    });

    it("stores modelRole in metadata when provided", async () => {
      const message = makeMessage({
        metadata: { modelRole: "utility_fast" },
      });
      mocks.prisma.chatMessage.create.mockResolvedValueOnce(message);

      const service = buildService();
      await service.createUserMessage("session-1", "Test", {
        modelRole: "utility_fast",
      });

      expect(mocks.prisma.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            metadata: expect.objectContaining({
              modelRole: "utility_fast",
            }),
          }),
        })
      );
    });

    it("merges custom metadata with modelRole", async () => {
      const message = makeMessage({
        metadata: { modelRole: "coder_default", customKey: "value" },
      });
      mocks.prisma.chatMessage.create.mockResolvedValueOnce(message);

      const service = buildService();
      await service.createUserMessage("session-1", "Test", {
        modelRole: "coder_default",
        metadata: { customKey: "value" },
      });

      expect(mocks.prisma.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            metadata: {
              modelRole: "coder_default",
              customKey: "value",
            },
          }),
        })
      );
    });

    it("updates session with preferredModelRole when modelRole is provided", async () => {
      const message = makeMessage();
      const session = makeSession({ metadata: { existing: "data" } });
      mocks.prisma.chatMessage.create.mockResolvedValueOnce(message);
      mocks.prisma.chatSession.findUnique.mockResolvedValue(session);

      const service = buildService();
      await service.createUserMessage("session-1", "Test", {
        modelRole: "review_deep",
      });

      expect(mocks.prisma.chatSession.update).toHaveBeenCalledWith({
        where: { id: "session-1" },
        data: {
          metadata: {
            existing: "data",
            preferredModelRole: "review_deep",
          },
        },
      });
    });

    it("publishes SSE event for user message", async () => {
      const message = makeMessage({ id: "msg-123", content: "Hello" });
      mocks.prisma.chatMessage.create.mockResolvedValueOnce(message);

      const service = buildService();
      await service.createUserMessage("session-1", "Hello");

      expect(mocks.publishEvent).toHaveBeenCalledWith(
        "session:session-1",
        "chat.message.user",
        expect.objectContaining({
          id: "msg-123",
          content: "Hello",
        })
      );
    });

    it("triggers assistant turn asynchronously", async () => {
      const userMsg = makeMessage({ role: "user", content: "Question" });
      const session = makeSession();
      mocks.prisma.chatMessage.create
        .mockResolvedValueOnce(userMsg)
        .mockResolvedValueOnce(makeMessage({ role: "assistant", content: "Answer" }));
      mocks.prisma.chatSession.findUnique.mockResolvedValue(session);
      mocks.prisma.chatMessage.findMany.mockResolvedValue([userMsg]);

      const orchestrator = buildMockOrchestrator();
      orchestrator.streamChatWithRetry.mockImplementation((sessionId, messages, onToken) => {
        onToken("Answer");
        return Promise.resolve({
          accountId: "acct-1",
          providerId: "openai",
          usage: {},
          session: {},
        });
      });

      const service = new ChatService(orchestrator as any);
      await service.createUserMessage("session-1", "Question");

      // Wait for async turn
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(orchestrator.streamChatWithRetry).toHaveBeenCalled();
    });
  });
});
