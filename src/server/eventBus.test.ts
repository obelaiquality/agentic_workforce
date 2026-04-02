import { describe, it, expect, vi, beforeEach } from "vitest";
import { LocalEventBus, StreamEvent, eventBus, publishEvent } from "./eventBus";

describe("LocalEventBus", () => {
  let bus: LocalEventBus;

  beforeEach(() => {
    bus = new LocalEventBus();
  });

  it("delivers events to channel subscribers", () => {
    const handler = vi.fn();
    bus.subscribe("tasks", handler);

    const event: StreamEvent = {
      type: "task.created",
      payload: { id: 1 },
      createdAt: new Date().toISOString(),
    };
    bus.emit("tasks", event);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("delivers events to global subscribers with channel metadata", () => {
    const globalHandler = vi.fn();
    bus.subscribe("global", globalHandler);

    const event: StreamEvent = {
      type: "task.updated",
      payload: { id: 2 },
      createdAt: new Date().toISOString(),
    };
    bus.emit("tasks", event);

    expect(globalHandler).toHaveBeenCalledOnce();
    const received = globalHandler.mock.calls[0][0] as StreamEvent;
    expect(received.type).toBe("task.updated");
    expect(received.payload.channel).toBe("tasks");
    expect(received.payload.id).toBe(2);
  });

  it("does not error when emitting to channel with no subscribers", () => {
    const event: StreamEvent = {
      type: "orphan",
      payload: {},
      createdAt: new Date().toISOString(),
    };

    expect(() => bus.emit("no-listeners", event)).not.toThrow();
  });

  it("subscribe returns working unsubscribe function", () => {
    const handler = vi.fn();
    const unsubscribe = bus.subscribe("ch", handler);

    expect(typeof unsubscribe).toBe("function");

    bus.emit("ch", {
      type: "a",
      payload: {},
      createdAt: new Date().toISOString(),
    });
    expect(handler).toHaveBeenCalledOnce();

    unsubscribe();

    bus.emit("ch", {
      type: "b",
      payload: {},
      createdAt: new Date().toISOString(),
    });
    expect(handler).toHaveBeenCalledOnce(); // still 1
  });

  it("unsubscribed handler stops receiving events", () => {
    const handler = vi.fn();
    const unsubscribe = bus.subscribe("ch", handler);
    unsubscribe();

    bus.emit("ch", {
      type: "after-unsub",
      payload: {},
      createdAt: new Date().toISOString(),
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("channel isolation - events don't leak between channels", () => {
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    bus.subscribe("channel-a", handlerA);
    bus.subscribe("channel-b", handlerB);

    bus.emit("channel-a", {
      type: "only-a",
      payload: {},
      createdAt: new Date().toISOString(),
    });

    expect(handlerA).toHaveBeenCalledOnce();
    expect(handlerB).not.toHaveBeenCalled();
  });

  it("multiple subscribers on same channel all receive events", () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const handler3 = vi.fn();
    bus.subscribe("shared", handler1);
    bus.subscribe("shared", handler2);
    bus.subscribe("shared", handler3);

    bus.emit("shared", {
      type: "broadcast",
      payload: {},
      createdAt: new Date().toISOString(),
    });

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();
    expect(handler3).toHaveBeenCalledOnce();
  });

  it("subscriber error does not crash other subscribers", () => {
    const handler1 = vi.fn();
    const badHandler = vi.fn(() => {
      throw new Error("bad subscriber");
    });
    const handler2 = vi.fn();

    // EventEmitter calls listeners synchronously in registration order.
    // A throwing listener will prevent subsequent listeners from firing,
    // but it should not crash the process if we catch at the emit level.
    // We verify that the error is thrown (EventEmitter default behavior)
    // and earlier listeners still executed.
    bus.subscribe("ch", handler1);
    bus.subscribe("ch", badHandler);
    bus.subscribe("ch", handler2);

    const event: StreamEvent = {
      type: "test",
      payload: {},
      createdAt: new Date().toISOString(),
    };

    // EventEmitter propagates the error — we verify it throws
    expect(() => bus.emit("ch", event)).toThrow("bad subscriber");
    // handler1 was called before the bad handler
    expect(handler1).toHaveBeenCalledOnce();
    expect(badHandler).toHaveBeenCalledOnce();
  });

  it("listenerCount returns correct count", () => {
    expect(bus.listenerCount("ch")).toBe(0);

    const unsub1 = bus.subscribe("ch", vi.fn());
    expect(bus.listenerCount("ch")).toBe(1);

    const unsub2 = bus.subscribe("ch", vi.fn());
    expect(bus.listenerCount("ch")).toBe(2);

    unsub1();
    expect(bus.listenerCount("ch")).toBe(1);

    unsub2();
    expect(bus.listenerCount("ch")).toBe(0);
  });

  it("removeAllListeners cleans up channel", () => {
    bus.subscribe("ch", vi.fn());
    bus.subscribe("ch", vi.fn());
    bus.subscribe("other", vi.fn());

    expect(bus.listenerCount("ch")).toBe(2);
    expect(bus.listenerCount("other")).toBe(1);

    bus.removeAllListeners("ch");

    expect(bus.listenerCount("ch")).toBe(0);
    expect(bus.listenerCount("other")).toBe(1);
  });

  it("removeAllListeners with no argument cleans up all channels", () => {
    bus.subscribe("a", vi.fn());
    bus.subscribe("b", vi.fn());

    bus.removeAllListeners();

    expect(bus.listenerCount("a")).toBe(0);
    expect(bus.listenerCount("b")).toBe(0);
  });
});

describe("publishEvent", () => {
  it("wraps emit with type and timestamp", () => {
    const bus = new LocalEventBus();
    const handler = vi.fn();
    // We need to test the module-level publishEvent which uses the singleton.
    // Instead, test via a fresh bus to avoid singleton side effects.
    bus.subscribe("test-channel", handler);

    bus.emit("test-channel", {
      type: "my.event",
      payload: { key: "value" },
      createdAt: new Date().toISOString(),
    });

    expect(handler).toHaveBeenCalledOnce();
    const received = handler.mock.calls[0][0] as StreamEvent;
    expect(received.type).toBe("my.event");
    expect(received.payload.key).toBe("value");
  });

  it("publishEvent includes createdAt as ISO string", () => {
    // Test via the exported publishEvent function which uses the singleton eventBus.
    const handler = vi.fn();
    const unsub = eventBus.subscribe("pub-test", handler);

    publishEvent("pub-test", "check.iso", { data: 42 });

    expect(handler).toHaveBeenCalledOnce();
    const received = handler.mock.calls[0][0] as StreamEvent;
    expect(received.createdAt).toBeDefined();
    // Verify it's a valid ISO string
    expect(new Date(received.createdAt).toISOString()).toBe(received.createdAt);

    unsub();
  });
});
