/**
 * Unit tests for logger.ts
 * Tests createLogger factory and all log-level methods.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { createLogger } from "./logger";

describe("createLogger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.DEBUG;
  });

  it("returns object with info, warn, error, debug methods", () => {
    const log = createLogger("Test");

    expect(typeof log.info).toBe("function");
    expect(typeof log.warn).toBe("function");
    expect(typeof log.error).toBe("function");
    expect(typeof log.debug).toBe("function");
  });

  it("info() calls console.log with ISO timestamp, [Module] tag, and args", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const log = createLogger("MyModule");

    log.info("hello");

    expect(spy).toHaveBeenCalledOnce();
    const [ts, tag, msg] = spy.mock.calls[0];
    // Timestamp should be a valid ISO string
    expect(() => new Date(ts as string).toISOString()).not.toThrow();
    expect(tag).toBe("[MyModule]");
    expect(msg).toBe("hello");
  });

  it("warn() calls console.warn with correct prefix", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = createLogger("Warn");

    log.warn("caution");

    expect(spy).toHaveBeenCalledOnce();
    const [ts, tag, msg] = spy.mock.calls[0];
    expect(() => new Date(ts as string).toISOString()).not.toThrow();
    expect(tag).toBe("[Warn]");
    expect(msg).toBe("caution");
  });

  it("error() calls console.error with correct prefix", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = createLogger("Err");

    log.error("failure");

    expect(spy).toHaveBeenCalledOnce();
    const [ts, tag, msg] = spy.mock.calls[0];
    expect(() => new Date(ts as string).toISOString()).not.toThrow();
    expect(tag).toBe("[Err]");
    expect(msg).toBe("failure");
  });

  it("debug() does NOT call console.debug when DEBUG is falsy", () => {
    delete process.env.DEBUG;
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const log = createLogger("D");

    log.debug("hidden");

    expect(spy).not.toHaveBeenCalled();
  });

  it("debug() calls console.debug when DEBUG is set", () => {
    process.env.DEBUG = "1";
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const log = createLogger("D");

    log.debug("visible");

    expect(spy).toHaveBeenCalledOnce();
    const [ts, tag, msg] = spy.mock.calls[0];
    expect(() => new Date(ts as string).toISOString()).not.toThrow();
    expect(tag).toBe("[D]");
    expect(msg).toBe("visible");
  });

  it("multiple args pass through to the underlying console method", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const log = createLogger("Multi");

    log.info("a", 42, { key: "val" });

    expect(spy).toHaveBeenCalledOnce();
    const args = spy.mock.calls[0];
    // args[0] = timestamp, args[1] = tag, args[2..] = user args
    expect(args[2]).toBe("a");
    expect(args[3]).toBe(42);
    expect(args[4]).toEqual({ key: "val" });
  });
});
