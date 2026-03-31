import Fastify from "fastify";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { MemoryService } from "../services/memoryService";
import type { RepoService } from "../services/repoService";

// Mock MemoryService
const mockMemoryService = {
  loadEpisodicMemory: vi.fn(),
  getRelevantEpisodicMemories: vi.fn(),
  episodicCount: vi.fn(),
  workingCount: vi.fn(),
  addEpisodicMemory: vi.fn(),
  clearAll: vi.fn(),
  compose: vi.fn(),
};

// Mock the MemoryService class
vi.mock("../services/memoryService", () => ({
  MemoryService: vi.fn(() => mockMemoryService),
  memoryAgeLabel: vi.fn((date: string) => "2 days ago"),
  memoryAgeDays: vi.fn((date: string) => 2),
}));

import { registerMemoryRoutes } from "./memoryRoutes";

function createHarness() {
  const app = Fastify();

  registerMemoryRoutes({
    app,
    repoService: {} as RepoService,
  });

  return { app };
}

describe("memoryRoutes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/v1/memory", () => {
    it("returns error when worktreePath is missing", async () => {
      const { app } = createHarness();

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/memory",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.error).toBe("worktreePath is required");
      expect(body.memories).toEqual([]);
      expect(body.stats).toBe(null);

      await app.close();
    });

    it("returns all memories with stats when worktreePath provided", async () => {
      const { app } = createHarness();

      const mockMemories = [
        {
          id: "mem-1",
          taskDescription: "Fix bug",
          summary: "Fixed login bug",
          outcome: "success" as const,
          keyFiles: ["src/auth.ts"],
          lessons: ["Always validate tokens"],
          createdAt: "2026-03-29T10:00:00Z",
        },
        {
          id: "mem-2",
          taskDescription: "Add feature",
          summary: "Added dashboard",
          outcome: "partial" as const,
          keyFiles: ["src/dashboard.ts"],
          lessons: [],
          createdAt: "2026-03-28T10:00:00Z",
        },
      ];

      mockMemoryService.getRelevantEpisodicMemories.mockReturnValue(mockMemories);
      mockMemoryService.episodicCount.mockReturnValue(2);

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/memory?worktreePath=/test/path",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.memories).toHaveLength(2);
      expect(body.memories[0].id).toBe("mem-1");
      expect(body.stats).toMatchObject({
        episodicCount: 2,
        successCount: 1,
        partialCount: 1,
        failureCount: 0,
      });

      await app.close();
    });

    it("filters memories by outcome when specified", async () => {
      const { app } = createHarness();

      const mockMemories = [
        {
          id: "mem-1",
          taskDescription: "Fix bug",
          summary: "Fixed login bug",
          outcome: "success" as const,
          keyFiles: [],
          lessons: [],
          createdAt: "2026-03-29T10:00:00Z",
        },
        {
          id: "mem-2",
          taskDescription: "Add feature",
          summary: "Failed to add",
          outcome: "failure" as const,
          keyFiles: [],
          lessons: [],
          createdAt: "2026-03-28T10:00:00Z",
        },
      ];

      mockMemoryService.getRelevantEpisodicMemories.mockReturnValue(mockMemories);
      mockMemoryService.episodicCount.mockReturnValue(2);

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/memory?worktreePath=/test/path&outcome=success",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.memories).toHaveLength(1);
      expect(body.memories[0].outcome).toBe("success");

      await app.close();
    });

    it("performs search when search param provided", async () => {
      const { app } = createHarness();

      const searchResults = [
        {
          id: "mem-1",
          taskDescription: "Fix authentication",
          summary: "Fixed auth bug",
          outcome: "success" as const,
          keyFiles: [],
          lessons: [],
          createdAt: "2026-03-29T10:00:00Z",
        },
      ];

      mockMemoryService.getRelevantEpisodicMemories.mockReturnValue(searchResults);
      mockMemoryService.episodicCount.mockReturnValue(1);

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/memory?worktreePath=/test/path&search=authentication",
      });

      expect(response.statusCode).toBe(200);
      expect(mockMemoryService.getRelevantEpisodicMemories).toHaveBeenCalledWith("authentication");

      await app.close();
    });

    it("respects limit parameter", async () => {
      const { app } = createHarness();

      const manyMemories = Array.from({ length: 100 }, (_, i) => ({
        id: `mem-${i}`,
        taskDescription: `Task ${i}`,
        summary: `Summary ${i}`,
        outcome: "success" as const,
        keyFiles: [],
        lessons: [],
        createdAt: "2026-03-29T10:00:00Z",
      }));

      mockMemoryService.getRelevantEpisodicMemories.mockReturnValue(manyMemories);
      mockMemoryService.episodicCount.mockReturnValue(100);

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/memory?worktreePath=/test/path&limit=10",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.memories).toHaveLength(10);

      await app.close();
    });
  });

  describe("GET /api/v1/memory/:id", () => {
    it("returns 400 when worktreePath is missing", async () => {
      const { app } = createHarness();

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/memory/mem-1",
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe("worktreePath is required");

      await app.close();
    });

    it("returns 404 when memory not found", async () => {
      const { app } = createHarness();

      mockMemoryService.getRelevantEpisodicMemories.mockReturnValue([]);

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/memory/nonexistent?worktreePath=/test/path",
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe("Memory not found");

      await app.close();
    });

    it("returns memory when found", async () => {
      const { app } = createHarness();

      const mockMemory = {
        id: "mem-1",
        taskDescription: "Fix bug",
        summary: "Fixed login bug",
        outcome: "success" as const,
        keyFiles: ["src/auth.ts"],
        lessons: ["Always validate tokens"],
        createdAt: "2026-03-29T10:00:00Z",
      };

      mockMemoryService.getRelevantEpisodicMemories.mockReturnValue([mockMemory]);

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/memory/mem-1?worktreePath=/test/path",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBe("mem-1");
      expect(body.taskDescription).toBe("Fix bug");
      expect(body.ageLabel).toBeDefined();
      expect(body.ageDays).toBeDefined();

      await app.close();
    });
  });

  describe("POST /api/v1/memory", () => {
    it("returns 400 when required fields are missing", async () => {
      const { app } = createHarness();

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/memory",
        payload: {
          worktreePath: "/test/path",
          taskDescription: "Fix bug",
          // missing summary and outcome
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toContain("required");

      await app.close();
    });

    it("returns 400 when content contains secrets", async () => {
      const { app } = createHarness();

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/memory",
        payload: {
          worktreePath: "/test/path",
          taskDescription: "Fix bug",
          summary: "Fixed authentication with key api_prod_abcdefghijklmnopqrstuv",
          outcome: "success",
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toContain("sensitive credentials");

      await app.close();
    });

    it("detects GitHub tokens in lessons", async () => {
      const { app } = createHarness();

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/memory",
        payload: {
          worktreePath: "/test/path",
          taskDescription: "Fix bug",
          summary: "Fixed authentication",
          outcome: "success",
          lessons: ["Use token ghp_1234567890abcdefghijklmnopqrstuvwxyz"],
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toContain("sensitive credentials");

      await app.close();
    });

    it("detects Slack tokens", async () => {
      const { app } = createHarness();

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/memory",
        payload: {
          worktreePath: "/test/path",
          taskDescription: "Fix bug",
          summary: "Token xoxb-1234567890-abcdefghijk",
          outcome: "success",
        },
      });

      expect(response.statusCode).toBe(400);

      await app.close();
    });

    it("detects AWS access keys", async () => {
      const { app } = createHarness();

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/memory",
        payload: {
          worktreePath: "/test/path",
          taskDescription: "Fix bug",
          summary: "Key AKIAIOSFODNN7EXAMPLE",
          outcome: "success",
        },
      });

      expect(response.statusCode).toBe(400);

      await app.close();
    });

    it("detects private keys", async () => {
      const { app } = createHarness();

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/memory",
        payload: {
          worktreePath: "/test/path",
          taskDescription: "Fix bug",
          summary: "-----BEGIN RSA PRIVATE KEY-----",
          outcome: "success",
        },
      });

      expect(response.statusCode).toBe(400);

      await app.close();
    });

    it("detects JWTs", async () => {
      const { app } = createHarness();

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/memory",
        payload: {
          worktreePath: "/test/path",
          taskDescription: "Fix bug",
          summary: "Token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0",
          outcome: "success",
        },
      });

      expect(response.statusCode).toBe(400);

      await app.close();
    });

    it("creates memory successfully when valid", async () => {
      const { app } = createHarness();

      const newMemory = {
        id: "mem-new",
        taskDescription: "Fix bug",
        summary: "Fixed login bug",
        outcome: "success" as const,
        keyFiles: ["src/auth.ts"],
        lessons: ["Always validate tokens"],
        createdAt: "2026-03-31T10:00:00Z",
      };

      mockMemoryService.addEpisodicMemory.mockReturnValue(newMemory);

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/memory",
        payload: {
          worktreePath: "/test/path",
          taskDescription: "Fix bug",
          summary: "Fixed login bug",
          outcome: "success",
          keyFiles: ["src/auth.ts"],
          lessons: ["Always validate tokens"],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBe("mem-new");
      expect(body.taskDescription).toBe("Fix bug");
      expect(mockMemoryService.addEpisodicMemory).toHaveBeenCalledWith({
        taskDescription: "Fix bug",
        summary: "Fixed login bug",
        outcome: "success",
        keyFiles: ["src/auth.ts"],
        lessons: ["Always validate tokens"],
      });

      await app.close();
    });

    it("creates memory with minimal fields", async () => {
      const { app } = createHarness();

      const newMemory = {
        id: "mem-new",
        taskDescription: "Simple task",
        summary: "Done",
        outcome: "success" as const,
        keyFiles: [],
        lessons: [],
        createdAt: "2026-03-31T10:00:00Z",
      };

      mockMemoryService.addEpisodicMemory.mockReturnValue(newMemory);

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/memory",
        payload: {
          worktreePath: "/test/path",
          taskDescription: "Simple task",
          summary: "Done",
          outcome: "success",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBe("mem-new");

      await app.close();
    });
  });

  describe("DELETE /api/v1/memory/:id", () => {
    it("returns 400 when worktreePath is missing", async () => {
      const { app } = createHarness();

      const response = await app.inject({
        method: "DELETE",
        url: "/api/v1/memory/mem-1",
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe("worktreePath is required");

      await app.close();
    });

    it("returns 404 when memory not found", async () => {
      const { app } = createHarness();

      mockMemoryService.getRelevantEpisodicMemories.mockReturnValue([]);

      const response = await app.inject({
        method: "DELETE",
        url: "/api/v1/memory/nonexistent?worktreePath=/test/path",
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe("Memory not found");

      await app.close();
    });

    it("deletes memory successfully", async () => {
      const { app } = createHarness();

      const mockMemories = [
        {
          id: "mem-1",
          taskDescription: "Task 1",
          summary: "Summary 1",
          outcome: "success" as const,
          keyFiles: [],
          lessons: [],
          createdAt: "2026-03-29T10:00:00Z",
        },
        {
          id: "mem-2",
          taskDescription: "Task 2",
          summary: "Summary 2",
          outcome: "success" as const,
          keyFiles: [],
          lessons: [],
          createdAt: "2026-03-28T10:00:00Z",
        },
      ];

      mockMemoryService.getRelevantEpisodicMemories.mockReturnValue(mockMemories);

      const response = await app.inject({
        method: "DELETE",
        url: "/api/v1/memory/mem-1?worktreePath=/test/path",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.deleted).toBe(true);
      expect(body.id).toBe("mem-1");
      expect(mockMemoryService.clearAll).toHaveBeenCalled();
      expect(mockMemoryService.addEpisodicMemory).toHaveBeenCalledTimes(1);
      expect(mockMemoryService.addEpisodicMemory).toHaveBeenCalledWith({
        taskDescription: "Task 2",
        summary: "Summary 2",
        outcome: "success",
        keyFiles: [],
        lessons: [],
      });

      await app.close();
    });
  });

  describe("GET /api/v1/memory/stats", () => {
    it("returns null when worktreePath is missing", async () => {
      const { app } = createHarness();

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/memory/stats",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.stats).toBe(null);

      await app.close();
    });

    it("returns stats when worktreePath provided", async () => {
      const { app } = createHarness();

      const mockComposition = {
        stats: {
          episodicUsed: 3,
          workingUsed: 5,
          relevanceScoreAvg: 0.85,
        },
      };

      mockMemoryService.compose.mockReturnValue(mockComposition);
      mockMemoryService.episodicCount.mockReturnValue(10);
      mockMemoryService.workingCount.mockReturnValue(15);

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/memory/stats?worktreePath=/test/path",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.stats).toMatchObject({
        episodicUsed: 3,
        workingUsed: 5,
        relevanceScoreAvg: 0.85,
        episodicTotal: 10,
        workingTotal: 15,
      });

      await app.close();
    });
  });
});
