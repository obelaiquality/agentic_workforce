import { describe, it, expect, beforeEach } from "vitest";
import { CommandRegistry } from "./commandRegistry";
import type { SlashCommandDefinition, CommandResult } from "./commandTypes";

const noopHandler = async (): Promise<CommandResult> => ({
  type: "message",
  content: "ok",
});

function makeCommand(overrides?: Partial<SlashCommandDefinition>): SlashCommandDefinition {
  return {
    name: "test",
    description: "A test command",
    handler: noopHandler,
    ...overrides,
  };
}

describe("CommandRegistry", () => {
  let registry: CommandRegistry;

  beforeEach(() => {
    registry = new CommandRegistry();
  });

  describe("register", () => {
    it("registers a command", () => {
      registry.register(makeCommand());
      expect(registry.size).toBe(1);
    });

    it("throws on duplicate command name", () => {
      registry.register(makeCommand());
      expect(() => {
        registry.register(makeCommand());
      }).toThrow("Command already registered: test");
    });

    it("registers aliases", () => {
      registry.register(makeCommand({ name: "commit", aliases: ["c"] }));

      const result = registry.resolve("/c");
      expect(result).not.toBeNull();
      expect(result!.command.name).toBe("commit");
    });

    it("throws if alias conflicts with existing command name", () => {
      registry.register(makeCommand({ name: "c" }));
      expect(() => {
        registry.register(makeCommand({ name: "commit", aliases: ["c"] }));
      }).toThrow('Alias "c" conflicts with an existing command name');
    });

    it("throws if alias is already registered", () => {
      registry.register(makeCommand({ name: "cmd1", aliases: ["x"] }));
      expect(() => {
        registry.register(makeCommand({ name: "cmd2", aliases: ["x"] }));
      }).toThrow('Alias "x" is already registered');
    });

    it("throws if command name conflicts with existing alias", () => {
      registry.register(makeCommand({ name: "commit", aliases: ["c"] }));
      expect(() => {
        registry.register(makeCommand({ name: "c" }));
      }).toThrow("Command name conflicts with an existing alias: c");
    });
  });

  describe("resolve", () => {
    it("resolves a simple command", () => {
      registry.register(makeCommand({ name: "help" }));

      const result = registry.resolve("/help");
      expect(result).not.toBeNull();
      expect(result!.command.name).toBe("help");
      expect(result!.args).toBe("");
    });

    it("resolves a command with arguments", () => {
      registry.register(makeCommand({ name: "commit" }));

      const result = registry.resolve("/commit -m fix bug");
      expect(result).not.toBeNull();
      expect(result!.command.name).toBe("commit");
      expect(result!.args).toBe("-m fix bug");
    });

    it("resolves via alias", () => {
      registry.register(makeCommand({ name: "commit", aliases: ["c"] }));

      const result = registry.resolve("/c -m fix");
      expect(result).not.toBeNull();
      expect(result!.command.name).toBe("commit");
      expect(result!.args).toBe("-m fix");
    });

    it("returns null for unknown command", () => {
      registry.register(makeCommand({ name: "help" }));

      const result = registry.resolve("/unknown");
      expect(result).toBeNull();
    });

    it("returns null for non-slash input", () => {
      registry.register(makeCommand({ name: "help" }));

      const result = registry.resolve("help");
      expect(result).toBeNull();
    });

    it("trims whitespace from input", () => {
      registry.register(makeCommand({ name: "help" }));

      const result = registry.resolve("  /help  ");
      expect(result).not.toBeNull();
      expect(result!.command.name).toBe("help");
    });

    it("trims whitespace from args", () => {
      registry.register(makeCommand({ name: "commit" }));

      const result = registry.resolve("/commit   -m hello  ");
      expect(result).not.toBeNull();
      expect(result!.args).toBe("-m hello");
    });
  });

  describe("listCommands", () => {
    it("returns empty array when no commands registered", () => {
      expect(registry.listCommands()).toEqual([]);
    });

    it("returns all registered commands", () => {
      registry.register(makeCommand({ name: "alpha" }));
      registry.register(makeCommand({ name: "beta" }));

      const list = registry.listCommands();
      expect(list).toHaveLength(2);
      expect(list.map((c) => c.name).sort()).toEqual(["alpha", "beta"]);
    });
  });

  describe("isSlashCommand", () => {
    it("returns true for slash-prefixed input", () => {
      expect(registry.isSlashCommand("/help")).toBe(true);
      expect(registry.isSlashCommand("/commit -m fix")).toBe(true);
    });

    it("returns true for slash-prefixed input with leading whitespace", () => {
      expect(registry.isSlashCommand("  /help")).toBe(true);
    });

    it("returns false for non-slash input", () => {
      expect(registry.isSlashCommand("help")).toBe(false);
      expect(registry.isSlashCommand("commit -m fix")).toBe(false);
      expect(registry.isSlashCommand("")).toBe(false);
    });
  });
});
