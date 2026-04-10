import { describe, it, expect, beforeEach, vi } from "vitest";
import { AgentMessageBus, type AgentMessage, type MessageType } from "./agentMessageBus";

describe("AgentMessageBus", () => {
  let bus: AgentMessageBus;

  beforeEach(() => {
    bus = new AgentMessageBus();
    bus.registerAgent("agent-1");
    bus.registerAgent("agent-2");
    bus.registerAgent("agent-3");
  });

  // ---------------------------------------------------------------------------
  // send / getMessages
  // ---------------------------------------------------------------------------

  describe("send and getMessages", () => {
    it("should send a message to a specific agent", () => {
      bus.send({
        from: "agent-1",
        to: "agent-2",
        type: "FileUpdate",
        payload: { file: "test.ts" },
        priority: "normal",
      });

      const messages = bus.getMessages("agent-2");
      expect(messages).toHaveLength(1);
      expect(messages[0].from).toBe("agent-1");
      expect(messages[0].to).toBe("agent-2");
      expect(messages[0].type).toBe("FileUpdate");
      expect(messages[0].payload).toEqual({ file: "test.ts" });
    });

    it("should return a unique message ID", () => {
      const id1 = bus.send({
        from: "agent-1",
        to: "agent-2",
        type: "FileUpdate",
        payload: {},
        priority: "normal",
      });

      const id2 = bus.send({
        from: "agent-1",
        to: "agent-2",
        type: "FileUpdate",
        payload: {},
        priority: "normal",
      });

      expect(id1).toBeTruthy();
      expect(id2).toBeTruthy();
      expect(id1).not.toBe(id2);
    });

    it("should generate a timestamp on the message", () => {
      bus.send({
        from: "agent-1",
        to: "agent-2",
        type: "FileUpdate",
        payload: {},
        priority: "normal",
      });

      const messages = bus.getMessages("agent-2");
      expect(messages[0].timestamp).toBeTruthy();
      // Verify it's a valid ISO timestamp
      expect(new Date(messages[0].timestamp).toISOString()).toBe(messages[0].timestamp);
    });

    it("should not deliver messages to unrelated agents", () => {
      bus.send({
        from: "agent-1",
        to: "agent-2",
        type: "FileUpdate",
        payload: {},
        priority: "normal",
      });

      expect(bus.getMessages("agent-1")).toHaveLength(0);
      expect(bus.getMessages("agent-3")).toHaveLength(0);
    });

    it("should support multiple messages in queue", () => {
      bus.send({ from: "agent-1", to: "agent-2", type: "FileUpdate", payload: { n: 1 }, priority: "normal" });
      bus.send({ from: "agent-1", to: "agent-2", type: "DiscoveryResult", payload: { n: 2 }, priority: "normal" });
      bus.send({ from: "agent-3", to: "agent-2", type: "BlockageReport", payload: { n: 3 }, priority: "normal" });

      const messages = bus.getMessages("agent-2");
      expect(messages).toHaveLength(3);
    });

    it("should filter messages by type", () => {
      bus.send({ from: "agent-1", to: "agent-2", type: "FileUpdate", payload: {}, priority: "normal" });
      bus.send({ from: "agent-1", to: "agent-2", type: "DiscoveryResult", payload: {}, priority: "normal" });
      bus.send({ from: "agent-1", to: "agent-2", type: "FileUpdate", payload: {}, priority: "normal" });

      const fileUpdates = bus.getMessages("agent-2", "FileUpdate");
      expect(fileUpdates).toHaveLength(2);
      expect(fileUpdates.every((m) => m.type === "FileUpdate")).toBe(true);
    });

    it("should return empty array for agent with no messages", () => {
      expect(bus.getMessages("agent-1")).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // broadcast
  // ---------------------------------------------------------------------------

  describe("broadcast", () => {
    it("should deliver message to all agents except sender", () => {
      bus.broadcast("agent-1", "DiscoveryResult", { finding: "bug" });

      expect(bus.getMessages("agent-1")).toHaveLength(0);
      expect(bus.getMessages("agent-2")).toHaveLength(1);
      expect(bus.getMessages("agent-3")).toHaveLength(1);

      const msg = bus.getMessages("agent-2")[0];
      expect(msg.from).toBe("agent-1");
      expect(msg.to).toBe("*");
      expect(msg.type).toBe("DiscoveryResult");
      expect(msg.payload).toEqual({ finding: "bug" });
    });

    it("should use default normal priority", () => {
      bus.broadcast("agent-1", "DiscoveryResult", {});

      const msg = bus.getMessages("agent-2")[0];
      expect(msg.priority).toBe("normal");
    });

    it("should accept custom priority", () => {
      bus.broadcast("agent-1", "BlockageReport", { critical: true }, "high");

      const msg = bus.getMessages("agent-2")[0];
      expect(msg.priority).toBe("high");
    });

    it("should send via to=* internally", () => {
      bus.send({
        from: "agent-1",
        to: "*",
        type: "Custom",
        payload: { test: true },
        priority: "low",
      });

      // Should reach agent-2 and agent-3 but not agent-1
      expect(bus.getMessages("agent-1")).toHaveLength(0);
      expect(bus.getMessages("agent-2")).toHaveLength(1);
      expect(bus.getMessages("agent-3")).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // subscribe
  // ---------------------------------------------------------------------------

  describe("subscribe", () => {
    it("should notify subscriber when message is sent", () => {
      const handler = vi.fn();
      bus.subscribe("agent-2", "FileUpdate", handler);

      bus.send({
        from: "agent-1",
        to: "agent-2",
        type: "FileUpdate",
        payload: { file: "test.ts" },
        priority: "normal",
      });

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0].type).toBe("FileUpdate");
      expect(handler.mock.calls[0][0].from).toBe("agent-1");
    });

    it("should not notify subscriber for different message types", () => {
      const handler = vi.fn();
      bus.subscribe("agent-2", "FileUpdate", handler);

      bus.send({
        from: "agent-1",
        to: "agent-2",
        type: "DiscoveryResult",
        payload: {},
        priority: "normal",
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it("should not notify subscriber for messages to other agents", () => {
      const handler = vi.fn();
      bus.subscribe("agent-2", "FileUpdate", handler);

      bus.send({
        from: "agent-1",
        to: "agent-3",
        type: "FileUpdate",
        payload: {},
        priority: "normal",
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it("should notify subscriber on broadcast", () => {
      const handler = vi.fn();
      bus.subscribe("agent-2", "BlockageReport", handler);

      bus.broadcast("agent-1", "BlockageReport", { blocked: true });

      expect(handler).toHaveBeenCalledOnce();
    });

    it("should not notify sender's subscriber on broadcast", () => {
      const handler = vi.fn();
      bus.subscribe("agent-1", "BlockageReport", handler);

      bus.broadcast("agent-1", "BlockageReport", { blocked: true });

      expect(handler).not.toHaveBeenCalled();
    });

    it("should support multiple subscribers for the same type", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      bus.subscribe("agent-2", "FileUpdate", handler1);
      bus.subscribe("agent-2", "FileUpdate", handler2);

      bus.send({
        from: "agent-1",
        to: "agent-2",
        type: "FileUpdate",
        payload: {},
        priority: "normal",
      });

      expect(handler1).toHaveBeenCalledOnce();
      expect(handler2).toHaveBeenCalledOnce();
    });

    it("should return unsubscribe function", () => {
      const handler = vi.fn();
      const unsub = bus.subscribe("agent-2", "FileUpdate", handler);

      // First message triggers handler
      bus.send({ from: "agent-1", to: "agent-2", type: "FileUpdate", payload: {}, priority: "normal" });
      expect(handler).toHaveBeenCalledOnce();

      // Unsubscribe
      unsub();

      // Second message should not trigger handler
      bus.send({ from: "agent-1", to: "agent-2", type: "FileUpdate", payload: {}, priority: "normal" });
      expect(handler).toHaveBeenCalledOnce(); // still just once
    });

    it("should register agent queue when subscribing for unregistered agent", () => {
      const newBus = new AgentMessageBus();
      const handler = vi.fn();

      // Subscribe without prior registerAgent
      newBus.subscribe("new-agent", "FileUpdate", handler);

      // Should be able to receive messages
      newBus.registerAgent("sender");
      newBus.send({
        from: "sender",
        to: "new-agent",
        type: "FileUpdate",
        payload: {},
        priority: "normal",
      });

      expect(handler).toHaveBeenCalledOnce();
      expect(newBus.getMessages("new-agent")).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // priority ordering
  // ---------------------------------------------------------------------------

  describe("priority ordering", () => {
    it("should return high-priority messages before normal and low", () => {
      bus.send({ from: "agent-1", to: "agent-2", type: "Custom", payload: { n: 1 }, priority: "low" });
      bus.send({ from: "agent-1", to: "agent-2", type: "Custom", payload: { n: 2 }, priority: "high" });
      bus.send({ from: "agent-1", to: "agent-2", type: "Custom", payload: { n: 3 }, priority: "normal" });

      const messages = bus.getMessages("agent-2");
      expect(messages).toHaveLength(3);
      expect(messages[0].priority).toBe("high");
      expect(messages[1].priority).toBe("normal");
      expect(messages[2].priority).toBe("low");
    });

    it("should maintain timestamp order within same priority", () => {
      bus.send({ from: "agent-1", to: "agent-2", type: "Custom", payload: { n: 1 }, priority: "normal" });
      bus.send({ from: "agent-1", to: "agent-2", type: "Custom", payload: { n: 2 }, priority: "normal" });
      bus.send({ from: "agent-1", to: "agent-2", type: "Custom", payload: { n: 3 }, priority: "normal" });

      const messages = bus.getMessages("agent-2");
      expect(messages).toHaveLength(3);

      // Within same priority, messages should be in timestamp order (oldest first)
      for (let i = 1; i < messages.length; i++) {
        expect(messages[i - 1].timestamp <= messages[i].timestamp).toBe(true);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // queue limits (FIFO eviction)
  // ---------------------------------------------------------------------------

  describe("queue limits", () => {
    it("should evict oldest messages when queue exceeds 100", () => {
      // Send 105 messages to agent-2
      for (let i = 0; i < 105; i++) {
        bus.send({
          from: "agent-1",
          to: "agent-2",
          type: "Custom",
          payload: { index: i },
          priority: "normal",
        });
      }

      const messages = bus.getMessages("agent-2");
      expect(messages).toHaveLength(100);

      // The oldest 5 messages (index 0-4) should have been evicted
      const payloads = messages.map((m) => (m.payload as { index: number }).index);
      expect(payloads).not.toContain(0);
      expect(payloads).not.toContain(4);
      expect(payloads).toContain(5);
      expect(payloads).toContain(104);
    });
  });

  // ---------------------------------------------------------------------------
  // clearMessages
  // ---------------------------------------------------------------------------

  describe("clearMessages", () => {
    it("should clear all messages for an agent", () => {
      bus.send({ from: "agent-1", to: "agent-2", type: "FileUpdate", payload: {}, priority: "normal" });
      bus.send({ from: "agent-1", to: "agent-2", type: "Custom", payload: {}, priority: "high" });

      expect(bus.getMessages("agent-2")).toHaveLength(2);

      bus.clearMessages("agent-2");
      expect(bus.getMessages("agent-2")).toHaveLength(0);
    });

    it("should not affect other agents' messages", () => {
      bus.send({ from: "agent-1", to: "agent-2", type: "FileUpdate", payload: {}, priority: "normal" });
      bus.send({ from: "agent-1", to: "agent-3", type: "FileUpdate", payload: {}, priority: "normal" });

      bus.clearMessages("agent-2");

      expect(bus.getMessages("agent-2")).toHaveLength(0);
      expect(bus.getMessages("agent-3")).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // registerAgent
  // ---------------------------------------------------------------------------

  describe("registerAgent", () => {
    it("should be idempotent", () => {
      bus.registerAgent("agent-1"); // already registered in beforeEach
      bus.registerAgent("agent-1");

      // Should still work fine
      bus.send({ from: "agent-2", to: "agent-1", type: "Custom", payload: {}, priority: "normal" });
      expect(bus.getMessages("agent-1")).toHaveLength(1);
    });

    it("should allow newly registered agents to receive broadcasts", () => {
      bus.registerAgent("agent-new");

      bus.broadcast("agent-1", "DiscoveryResult", { data: "test" });

      expect(bus.getMessages("agent-new")).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // message types
  // ---------------------------------------------------------------------------

  describe("message types", () => {
    it("should support all defined message types", () => {
      const types: MessageType[] = [
        "FileUpdate",
        "DiscoveryResult",
        "BlockageReport",
        "ReviewRequest",
        "Custom",
      ];

      for (const type of types) {
        bus.send({
          from: "agent-1",
          to: "agent-2",
          type,
          payload: { type },
          priority: "normal",
        });
      }

      const messages = bus.getMessages("agent-2");
      expect(messages).toHaveLength(5);

      for (const type of types) {
        const filtered = bus.getMessages("agent-2", type);
        expect(filtered).toHaveLength(1);
        expect(filtered[0].type).toBe(type);
      }
    });
  });
});
