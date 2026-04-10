import type { SlashCommandDefinition } from "./commandTypes";
import type { CommandRegistry } from "./commandRegistry";

// ---------------------------------------------------------------------------
// Built-in slash command definitions
// ---------------------------------------------------------------------------

const commitCommand: SlashCommandDefinition = {
  name: "commit",
  description: "Review staged changes and create a git commit with a descriptive message.",
  aliases: ["c"],
  handler: async (_args, _context) => ({
    type: "action",
    content: "Reviewing staged changes and preparing commit...",
    metadata: { command: "commit" },
  }),
};

const debugCommand: SlashCommandDefinition = {
  name: "debug",
  description: "Start debug mode to investigate issues with extra diagnostics.",
  aliases: ["d"],
  handler: async (_args, _context) => ({
    type: "action",
    content: "Entering debug mode. Diagnostics enabled.",
    metadata: { command: "debug", mode: "debug" },
  }),
};

const planCommand: SlashCommandDefinition = {
  name: "plan",
  description: "Enter plan mode to create an implementation plan before coding.",
  aliases: ["p"],
  handler: async (_args, _context) => ({
    type: "action",
    content: "Entering plan mode. Provide your objective and I will create an implementation plan.",
    metadata: { command: "plan", mode: "plan" },
  }),
};

const verifyCommand: SlashCommandDefinition = {
  name: "verify",
  description: "Run verification checks: lint, test, and build.",
  aliases: ["v"],
  handler: async (_args, _context) => ({
    type: "action",
    content: "Running verification (lint, test, build)...",
    metadata: { command: "verify" },
  }),
};

const statusCommand: SlashCommandDefinition = {
  name: "status",
  description: "Show the current execution status and active run information.",
  aliases: ["s"],
  handler: async (_args, context) => ({
    type: "message",
    content: context.runId
      ? `Active run: ${context.runId} | Project: ${context.projectId ?? "none"}`
      : "No active run.",
    metadata: { command: "status", runId: context.runId ?? null },
  }),
};

const helpCommand: SlashCommandDefinition = {
  name: "help",
  description: "List all available slash commands.",
  aliases: ["h", "?"],
  handler: async (_args, _context) => ({
    type: "message",
    content: [
      "Available commands:",
      "  /commit  (c)   — Create a git commit",
      "  /debug   (d)   — Start debug mode",
      "  /plan    (p)   — Enter plan mode",
      "  /verify  (v)   — Run lint, test, build",
      "  /status  (s)   — Show execution status",
      "  /help    (h,?) — Show this help",
    ].join("\n"),
    metadata: { command: "help" },
  }),
};

// ---------------------------------------------------------------------------
// All built-in commands
// ---------------------------------------------------------------------------

export const builtinCommands: SlashCommandDefinition[] = [
  commitCommand,
  debugCommand,
  planCommand,
  verifyCommand,
  statusCommand,
  helpCommand,
];

/**
 * Register all built-in slash commands into a CommandRegistry.
 */
export function registerBuiltinCommands(registry: CommandRegistry): void {
  for (const command of builtinCommands) {
    registry.register(command);
  }
}
