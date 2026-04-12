import { describe, it, expect, beforeEach } from "vitest";
import { CommandRegistry } from "./commandRegistry";
import { builtinCommands, registerBuiltinCommands } from "./builtinCommands";

describe("builtinCommands", () => {
  it("defines the expected set of commands", () => {
    const names = builtinCommands.map((c) => c.name).sort();
    expect(names).toEqual([
      "clear", "commit", "compact", "debug", "diff", "help", "lint",
      "memory", "plan", "roles", "search", "status", "test", "undo", "verify",
    ]);
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

  it("makes /clear resolvable via alias /cls", () => {
    const result = registry.resolve("/cls");
    expect(result).not.toBeNull();
    expect(result!.command.name).toBe("clear");
  });

  it("makes /undo resolvable via alias /rollback", () => {
    const result = registry.resolve("/rollback");
    expect(result).not.toBeNull();
    expect(result!.command.name).toBe("undo");
  });

  it("makes /test resolvable via alias /t", () => {
    const result = registry.resolve("/t");
    expect(result).not.toBeNull();
    expect(result!.command.name).toBe("test");
  });

  it("makes /memory resolvable via alias /mem", () => {
    const result = registry.resolve("/mem");
    expect(result).not.toBeNull();
    expect(result!.command.name).toBe("memory");
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
    expect(result.content).toContain("/clear");
    expect(result.content).toContain("/compact");
    expect(result.content).toContain("/diff");
    expect(result.content).toContain("/undo");
    expect(result.content).toContain("/test");
    expect(result.content).toContain("/lint");
    expect(result.content).toContain("/search");
    expect(result.content).toContain("/memory");
    expect(result.content).toContain("/roles");
  });

  it("/clear handler returns action result", async () => {
    const clear = builtinCommands.find((c) => c.name === "clear")!;
    const result = await clear.handler(undefined, {});
    expect(result.type).toBe("action");
  });

  it("/compact handler returns action result", async () => {
    const compact = builtinCommands.find((c) => c.name === "compact")!;
    const result = await compact.handler(undefined, {});
    expect(result.type).toBe("action");
  });

  it("/diff handler shows no active run when empty", async () => {
    const diff = builtinCommands.find((c) => c.name === "diff")!;
    const result = await diff.handler(undefined, {});
    expect(result.content).toContain("No active run");
  });

  it("/diff handler mentions run when available", async () => {
    const diff = builtinCommands.find((c) => c.name === "diff")!;
    const result = await diff.handler(undefined, { runId: "r-1" });
    expect(result.content).toContain("Fetching diffs");
  });

  it("/undo handler returns action result", async () => {
    const undo = builtinCommands.find((c) => c.name === "undo")!;
    const result = await undo.handler(undefined, {});
    expect(result.type).toBe("action");
  });

  it("/test handler returns action result", async () => {
    const test = builtinCommands.find((c) => c.name === "test")!;
    const result = await test.handler(undefined, {});
    expect(result.type).toBe("action");
  });

  it("/lint handler returns action result", async () => {
    const lint = builtinCommands.find((c) => c.name === "lint")!;
    const result = await lint.handler(undefined, {});
    expect(result.type).toBe("action");
  });

  it("/search handler includes query in content", async () => {
    const search = builtinCommands.find((c) => c.name === "search")!;
    const result = await search.handler("myFunction", {});
    expect(result.content).toContain("myFunction");
  });

  it("/memory handler returns action result", async () => {
    const memory = builtinCommands.find((c) => c.name === "memory")!;
    const result = await memory.handler(undefined, {});
    expect(result.type).toBe("action");
  });

  it("/roles handler lists available roles", async () => {
    const roles = builtinCommands.find((c) => c.name === "roles")!;
    const result = await roles.handler(undefined, {});
    expect(result.type).toBe("message");
    expect(result.content).toContain("utility_fast");
    expect(result.content).toContain("coder_default");
    expect(result.content).toContain("review_deep");
    expect(result.content).toContain("overseer_escalation");
  });
});
