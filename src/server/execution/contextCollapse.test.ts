import { describe, expect, it, beforeEach } from "vitest";
import { ContextCollapseService, type ConversationSummary } from "./contextCollapse";
import type { ConversationMessage } from "../tools/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessage(role: "system" | "user" | "assistant" | "tool_result", content: string): ConversationMessage {
  return { role, content };
}

function makeToolResultMessage(toolName: string, content: string): ConversationMessage {
  return {
    role: "tool_result",
    content,
    toolName,
    toolUseId: `tool-${toolName}-id`,
  };
}

// ---------------------------------------------------------------------------
// ContextCollapseService
// ---------------------------------------------------------------------------

describe("ContextCollapseService", () => {
  let service: ContextCollapseService;

  beforeEach(() => {
    service = new ContextCollapseService();
  });

  describe("storeSummary", () => {
    it("stores a summary for a run", () => {
      const summary: ConversationSummary = {
        id: "sum-1",
        runId: "run-1",
        turnStart: 0,
        turnEnd: 5,
        summary: "Test summary",
        tokensOriginal: 1000,
        tokensSummary: 50,
        createdAt: new Date().toISOString(),
      };

      service.storeSummary(summary);
      const summaries = service.getSummaries("run-1");

      expect(summaries).toHaveLength(1);
      expect(summaries[0]).toEqual(summary);
    });

    it("stores multiple summaries in sorted order", () => {
      const sum1: ConversationSummary = {
        id: "sum-1",
        runId: "run-1",
        turnStart: 10,
        turnEnd: 15,
        summary: "Later",
        tokensOriginal: 500,
        tokensSummary: 25,
        createdAt: new Date().toISOString(),
      };

      const sum2: ConversationSummary = {
        id: "sum-2",
        runId: "run-1",
        turnStart: 0,
        turnEnd: 5,
        summary: "Earlier",
        tokensOriginal: 500,
        tokensSummary: 25,
        createdAt: new Date().toISOString(),
      };

      service.storeSummary(sum1);
      service.storeSummary(sum2);

      const summaries = service.getSummaries("run-1");
      expect(summaries).toHaveLength(2);
      expect(summaries[0].turnStart).toBe(0);
      expect(summaries[1].turnStart).toBe(10);
    });
  });

  describe("projectConversation", () => {
    it("returns messages unchanged when pressure is below threshold", () => {
      const messages: ConversationMessage[] = [
        makeMessage("user", "hello"),
        makeMessage("assistant", "hi"),
      ];

      const result = service.projectConversation({
        runId: "run-1",
        messages,
        maxTokens: 10000,
        pressureThreshold: 0.6,
      });

      expect(result.collapsed).toBe(false);
      expect(result.turnsCollapsed).toBe(0);
      expect(result.messages).toEqual(messages);
    });

    it("returns messages unchanged when no summaries exist", () => {
      const messages: ConversationMessage[] = [
        makeMessage("user", "x".repeat(1000)),
        makeMessage("assistant", "y".repeat(1000)),
      ];

      const result = service.projectConversation({
        runId: "run-1",
        messages,
        maxTokens: 100,
        pressureThreshold: 0.6,
      });

      expect(result.collapsed).toBe(false);
      expect(result.turnsCollapsed).toBe(0);
      expect(result.messages).toEqual(messages);
    });

    it("replaces message ranges with summaries when pressure is high", () => {
      const messages: ConversationMessage[] = [];
      for (let i = 0; i < 20; i++) {
        messages.push(makeMessage("user", `msg-${i} ${"x".repeat(200)}`));
      }

      // Store a summary covering turns 0-9
      const summary: ConversationSummary = {
        id: "sum-1",
        runId: "run-1",
        turnStart: 0,
        turnEnd: 9,
        summary: "Turns 0-9: Initial setup completed",
        tokensOriginal: 5000,
        tokensSummary: 20,
        createdAt: new Date().toISOString(),
      };
      service.storeSummary(summary);

      const result = service.projectConversation({
        runId: "run-1",
        messages,
        maxTokens: 500,
        pressureThreshold: 0.6,
      });

      expect(result.collapsed).toBe(true);
      expect(result.turnsCollapsed).toBe(10); // turns 0-9 inclusive

      // First message should be the summary
      expect(result.messages[0].role).toBe("system");
      expect(result.messages[0].content).toContain("Turns 0-9");

      // Remaining messages should start from turn 10
      expect(result.messages[1].content).toContain("msg-10");
    });

    it("handles multiple non-overlapping summaries", () => {
      const messages: ConversationMessage[] = [];
      for (let i = 0; i < 30; i++) {
        messages.push(makeMessage("user", `msg-${i} ${"x".repeat(200)}`));
      }

      service.storeSummary({
        id: "sum-1",
        runId: "run-1",
        turnStart: 0,
        turnEnd: 9,
        summary: "Turns 0-9: Setup",
        tokensOriginal: 5000,
        tokensSummary: 20,
        createdAt: new Date().toISOString(),
      });

      service.storeSummary({
        id: "sum-2",
        runId: "run-1",
        turnStart: 15,
        turnEnd: 20,
        summary: "Turns 15-20: Processing",
        tokensOriginal: 3000,
        tokensSummary: 15,
        createdAt: new Date().toISOString(),
      });

      const result = service.projectConversation({
        runId: "run-1",
        messages,
        maxTokens: 500,
        pressureThreshold: 0.6,
      });

      expect(result.collapsed).toBe(true);
      expect(result.turnsCollapsed).toBe(16); // 10 + 6 turns

      // Should have: summary1, messages 10-14, summary2, messages 21-29
      const systemMessages = result.messages.filter(m => m.role === "system");
      expect(systemMessages).toHaveLength(2);
      expect(systemMessages[0].content).toContain("Turns 0-9");
      expect(systemMessages[1].content).toContain("Turns 15-20");
    });

    it("preserves messages between summaries and after last summary", () => {
      const messages: ConversationMessage[] = [];
      for (let i = 0; i < 15; i++) {
        messages.push(makeMessage("user", `msg-${i} ${"x".repeat(200)}`));
      }

      service.storeSummary({
        id: "sum-1",
        runId: "run-1",
        turnStart: 0,
        turnEnd: 4,
        summary: "Turns 0-4: Early phase",
        tokensOriginal: 2500,
        tokensSummary: 15,
        createdAt: new Date().toISOString(),
      });

      const result = service.projectConversation({
        runId: "run-1",
        messages,
        maxTokens: 500,
        pressureThreshold: 0.6,
      });

      // Should have: summary, messages 5-14
      expect(result.messages[0].role).toBe("system");
      expect(result.messages[1].content).toContain("msg-5");
      expect(result.messages[result.messages.length - 1].content).toContain("msg-14");
    });
  });

  describe("generateExtractSummary", () => {
    it("extracts tool names from tool_result messages", () => {
      const messages: ConversationMessage[] = [
        makeToolResultMessage("read_file", "file contents..."),
        makeToolResultMessage("bash", "command output..."),
        makeMessage("user", "do more"),
      ];

      const summary = service.generateExtractSummary(messages);

      expect(summary).toContain("read_file");
      expect(summary).toContain("bash");
      expect(summary).toContain("Tools:");
    });

    it("extracts file paths from messages", () => {
      const messages: ConversationMessage[] = [
        makeMessage("user", "read /path/to/file.ts"),
        makeMessage("assistant", "I read /another/path/config.json"),
      ];

      const summary = service.generateExtractSummary(messages);

      expect(summary).toContain("Files:");
      expect(summary).toContain("/path/to/file.ts");
    });

    it("extracts error messages", () => {
      const messages: ConversationMessage[] = [
        makeMessage("assistant", "I tried to run the command"),
        makeMessage("assistant", "Error: command not found"),
        makeMessage("user", "try again"),
      ];

      const summary = service.generateExtractSummary(messages);

      expect(summary).toContain("Errors:");
      expect(summary).toContain("Error: command not found");
    });

    it("extracts decision statements", () => {
      const messages: ConversationMessage[] = [
        makeMessage("assistant", "I will implement the feature using TypeScript"),
        makeMessage("assistant", "Decision: use React for the UI"),
      ];

      const summary = service.generateExtractSummary(messages);

      expect(summary).toContain("Actions:");
      expect(summary).toContain("will implement");
    });

    it("truncates to 500 chars", () => {
      const messages: ConversationMessage[] = [];
      for (let i = 0; i < 100; i++) {
        messages.push(makeToolResultMessage(`tool-${i}`, "output..."));
        messages.push(makeMessage("user", `/path/to/file-${i}.ts with error: failed to process`));
      }

      const summary = service.generateExtractSummary(messages);

      expect(summary.length).toBeLessThanOrEqual(500);
      if (summary.length === 500) {
        expect(summary).toContain("...");
      }
    });

    it("returns fallback message for empty messages", () => {
      const summary = service.generateExtractSummary([]);
      expect(summary).toBe("No activity.");
    });

    it("returns fallback for messages with no extractable info", () => {
      const messages: ConversationMessage[] = [
        makeMessage("user", "xyz"),
        makeMessage("assistant", "abc"),
      ];

      const summary = service.generateExtractSummary(messages);
      expect(summary).toBe("General conversation activity.");
    });
  });

  describe("createAndStoreSummary", () => {
    it("creates a summary for a message range", () => {
      const messages: ConversationMessage[] = [
        makeMessage("user", "task 1"),
        makeToolResultMessage("read_file", "content..."),
        makeMessage("assistant", "done"),
        makeMessage("user", "task 2"),
      ];

      const summary = service.createAndStoreSummary("run-1", messages, 0, 2);

      expect(summary.runId).toBe("run-1");
      expect(summary.turnStart).toBe(0);
      expect(summary.turnEnd).toBe(2);
      expect(summary.summary).toContain("Turns 0-2");
      expect(summary.summary).toContain("read_file");
      expect(summary.tokensOriginal).toBeGreaterThan(0);
      expect(summary.tokensSummary).toBeGreaterThan(0);
      expect(summary.tokensSummary).toBeLessThan(summary.tokensOriginal);
    });

    it("stores the created summary", () => {
      const messages: ConversationMessage[] = [
        makeMessage("user", "task 1"),
        makeMessage("assistant", "done"),
      ];

      service.createAndStoreSummary("run-1", messages, 0, 1);

      const summaries = service.getSummaries("run-1");
      expect(summaries).toHaveLength(1);
    });
  });

  describe("clearSummaries", () => {
    it("removes all summaries for a run", () => {
      service.storeSummary({
        id: "sum-1",
        runId: "run-1",
        turnStart: 0,
        turnEnd: 5,
        summary: "Test",
        tokensOriginal: 1000,
        tokensSummary: 50,
        createdAt: new Date().toISOString(),
      });

      expect(service.getSummaries("run-1")).toHaveLength(1);

      service.clearSummaries("run-1");

      expect(service.getSummaries("run-1")).toHaveLength(0);
    });

    it("does not affect other runs", () => {
      service.storeSummary({
        id: "sum-1",
        runId: "run-1",
        turnStart: 0,
        turnEnd: 5,
        summary: "Test 1",
        tokensOriginal: 1000,
        tokensSummary: 50,
        createdAt: new Date().toISOString(),
      });

      service.storeSummary({
        id: "sum-2",
        runId: "run-2",
        turnStart: 0,
        turnEnd: 5,
        summary: "Test 2",
        tokensOriginal: 1000,
        tokensSummary: 50,
        createdAt: new Date().toISOString(),
      });

      service.clearSummaries("run-1");

      expect(service.getSummaries("run-1")).toHaveLength(0);
      expect(service.getSummaries("run-2")).toHaveLength(1);
    });
  });

  describe("getSummaries", () => {
    it("returns empty array for unknown run", () => {
      const summaries = service.getSummaries("nonexistent-run");
      expect(summaries).toEqual([]);
    });

    it("returns all summaries for a run", () => {
      service.storeSummary({
        id: "sum-1",
        runId: "run-1",
        turnStart: 0,
        turnEnd: 5,
        summary: "Test 1",
        tokensOriginal: 1000,
        tokensSummary: 50,
        createdAt: new Date().toISOString(),
      });

      service.storeSummary({
        id: "sum-2",
        runId: "run-1",
        turnStart: 10,
        turnEnd: 15,
        summary: "Test 2",
        tokensOriginal: 1000,
        tokensSummary: 50,
        createdAt: new Date().toISOString(),
      });

      const summaries = service.getSummaries("run-1");
      expect(summaries).toHaveLength(2);
    });
  });

  describe("getCompressionStats", () => {
    it("returns zero stats for run with no summaries", () => {
      const stats = service.getCompressionStats("run-1");

      expect(stats.summaryCount).toBe(0);
      expect(stats.tokensOriginal).toBe(0);
      expect(stats.tokensSummary).toBe(0);
      expect(stats.compressionRatio).toBe(0);
    });

    it("calculates compression stats correctly", () => {
      service.storeSummary({
        id: "sum-1",
        runId: "run-1",
        turnStart: 0,
        turnEnd: 5,
        summary: "Test 1",
        tokensOriginal: 1000,
        tokensSummary: 50,
        createdAt: new Date().toISOString(),
      });

      service.storeSummary({
        id: "sum-2",
        runId: "run-1",
        turnStart: 10,
        turnEnd: 15,
        summary: "Test 2",
        tokensOriginal: 2000,
        tokensSummary: 100,
        createdAt: new Date().toISOString(),
      });

      const stats = service.getCompressionStats("run-1");

      expect(stats.summaryCount).toBe(2);
      expect(stats.tokensOriginal).toBe(3000);
      expect(stats.tokensSummary).toBe(150);
      expect(stats.compressionRatio).toBe(20); // 3000 / 150
    });
  });

  describe("integration: full collapse flow", () => {
    it("compresses a long conversation under memory pressure", () => {
      const messages: ConversationMessage[] = [];

      // Create a long conversation (30 messages)
      for (let i = 0; i < 30; i++) {
        messages.push(makeMessage("user", `task-${i} ${"x".repeat(200)}`));
      }

      // Create summaries for old ranges
      service.createAndStoreSummary("run-1", messages, 0, 9);
      service.createAndStoreSummary("run-1", messages, 10, 19);

      // Project with high pressure
      const result = service.projectConversation({
        runId: "run-1",
        messages,
        maxTokens: 1000,
        pressureThreshold: 0.5,
      });

      expect(result.collapsed).toBe(true);
      expect(result.turnsCollapsed).toBe(20);

      // Should have: 2 summaries + 10 recent messages
      expect(result.messages.length).toBe(12);

      const stats = service.getCompressionStats("run-1");
      expect(stats.compressionRatio).toBeGreaterThan(1);
    });

    it("preserves full history when pressure is low", () => {
      const messages: ConversationMessage[] = [
        makeMessage("user", "task 1"),
        makeMessage("assistant", "done 1"),
        makeMessage("user", "task 2"),
        makeMessage("assistant", "done 2"),
      ];

      service.createAndStoreSummary("run-1", messages, 0, 1);

      const result = service.projectConversation({
        runId: "run-1",
        messages,
        maxTokens: 100000,
        pressureThreshold: 0.6,
      });

      expect(result.collapsed).toBe(false);
      expect(result.messages).toEqual(messages);
    });
  });
});
