import { describe, it, expect, beforeEach } from "vitest";
import { CommandRegistry } from "./commandRegistry";
import { builtinCommands, registerBuiltinCommands } from "./builtinCommands";

describe("builtinCommands", () => {
  it("defines the expected set of commands", () => {
    const names = builtinCommands.map((c) => c.name).sort();
    expect(names).toEqual(["commit", "debug", "help", "plan", "status", "verify"]);
  });

  it("every command has a description", () => {
    for (const cmd of builtinCommands) {
      expect(cmd.description).toBeTruthy();
    }
  });

  it("every command has a handler", () => {
    for (const cmd of builtinCommands) {
      expect(typeof cmd.handler).toBe("function");
    }
  });
});

describe("registerBuiltinCommands", () => {
  let registry: CommandRegistry;

  beforeEach(() => {
    registry = new CommandRegistry();
    registerBuiltinCommands(registry);
  });

  it("registers all built-in commands", () => {
    expect(registry.size).toBe(builtinCommands.length);
  });

  it("makes /commit resolvable", () => {
    const result = registry.resolve("/commit");
    expect(result).not.toBeNull();
    expect(result!.command.name).toBe("commit");
  });

  it("makes /c alias resolvable for commit", () => {
    const result = registry.resolve("/c");
    expect(result).not.toBeNull();
    expect(result!.command.name).toBe("commit");
  });

  it("makes /help resolvable", () => {
    const result = registry.resolve("/help");
    expect(result).not.toBeNull();
    expect(result!.command.name).toBe("help");
  });

  it("makes /? alias resolvable for help", () => {
    const result = registry.resolve("/?");
    expect(result).not.toBeNull();
    expect(result!.command.name).toBe("help");
  });

  it("makes /debug resolvable", () => {
    const result = registry.resolve("/debug");
    expect(result).not.toBeNull();
    expect(result!.command.name).toBe("debug");
  });

  it("makes /status resolvable via alias /s", () => {
    const result = registry.resolve("/s");
    expect(result).not.toBeNull();
    expect(result!.command.name).toBe("status");
  });
});

describe("command handlers", () => {
  it("/commit handler returns action result", async () => {
    const commit = builtinCommands.find((c) => c.name === "commit")!;
    const result = await commit.handler(undefined, {});
    expect(result.type).toBe("action");
    expect(result.content).toBeTruthy();
  });

  it("/debug handler returns action result", async () => {
    const debug = builtinCommands.find((c) => c.name === "debug")!;
    const result = await debug.handler(undefined, {});
    expect(result.type).toBe("action");
  });

  it("/plan handler returns action result", async () => {
    const plan = builtinCommands.find((c) => c.name === "plan")!;
    const result = await plan.handler(undefined, {});
    expect(result.type).toBe("action");
  });

  it("/verify handler returns action result", async () => {
    const verify = builtinCommands.find((c) => c.name === "verify")!;
    const result = await verify.handler(undefined, {});
    expect(result.type).toBe("action");
  });

  it("/status handler shows run info when available", async () => {
    const status = builtinCommands.find((c) => c.name === "status")!;
    const result = await status.handler(undefined, {
      runId: "run-123",
      projectId: "proj-abc",
    });
    expect(result.type).toBe("message");
    expect(result.content).toContain("run-123");
    expect(result.content).toContain("proj-abc");
  });

  it("/status handler shows no active run when context is empty", async () => {
    const status = builtinCommands.find((c) => c.name === "status")!;
    const result = await status.handler(undefined, {});
    expect(result.type).toBe("message");
    expect(result.content).toContain("No active run");
  });

  it("/help handler lists commands", async () => {
    const help = builtinCommands.find((c) => c.name === "help")!;
    const result = await help.handler(undefined, {});
    expect(result.type).toBe("message");
    expect(result.content).toContain("/commit");
    expect(result.content).toContain("/debug");
    expect(result.content).toContain("/plan");
    expect(result.content).toContain("/verify");
    expect(result.content).toContain("/status");
    expect(result.content).toContain("/help");
  });
});
