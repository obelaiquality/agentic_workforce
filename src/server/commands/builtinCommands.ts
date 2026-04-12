import type { SlashCommandDefinition } from "./commandTypes";
import type { CommandRegistry } from "./commandRegistry";
import { listAgentRoles } from "../execution/agentRoles/index";

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
      "  /commit   (c)        — Create a git commit",
      "  /debug    (d)        — Start debug mode",
      "  /plan     (p)        — Enter plan mode",
      "  /verify   (v)        — Run lint, test, build",
      "  /status   (s)        — Show execution status",
      "  /clear    (cls)      — Clear conversation context",
      "  /compact             — Trigger context compaction",
      "  /diff                — Show pending file changes",
      "  /undo     (rollback) — Roll back last edit",
      "  /test     (t)        — Run project tests",
      "  /lint     (l)        — Run project linter",
      "  /search              — Search codebase",
      "  /memory   (mem)      — Show episodic memory",
      "  /roles               — List agent roles",
      "  /help     (h,?)      — Show this help",
    ].join("\n"),
    metadata: { command: "help" },
  }),
};

const clearCommand: SlashCommandDefinition = {
  name: "clear",
  description: "Clear conversation context and start fresh.",
  aliases: ["cls"],
  handler: async (_args, _context) => ({
    type: "action",
    content: "Conversation context cleared.",
    metadata: { command: "clear" },
  }),
};

const compactCommand: SlashCommandDefinition = {
  name: "compact",
  description: "Trigger context compaction to free up token budget.",
  handler: async (_args, _context) => ({
    type: "action",
    content: "Running context compaction...",
    metadata: { command: "compact" },
  }),
};

const diffCommand: SlashCommandDefinition = {
  name: "diff",
  description: "Show pending file changes from the current run.",
  handler: async (_args, context) => ({
    type: "action",
    content: context.runId ? "Fetching diffs for the current run..." : "No active run.",
    metadata: { command: "diff", runId: context.runId ?? null },
  }),
};

const undoCommand: SlashCommandDefinition = {
  name: "undo",
  description: "Roll back the last file edit made by the agent.",
  aliases: ["rollback"],
  handler: async (_args, _context) => ({
    type: "action",
    content: "Rolling back last edit...",
    metadata: { command: "undo" },
  }),
};

const testCommand: SlashCommandDefinition = {
  name: "test",
  description: "Run the project test suite.",
  aliases: ["t"],
  handler: async (_args, _context) => ({
    type: "action",
    content: "Running tests...",
    metadata: { command: "test" },
  }),
};

const lintCommand: SlashCommandDefinition = {
  name: "lint",
  description: "Run the project linter.",
  aliases: ["l"],
  handler: async (_args, _context) => ({
    type: "action",
    content: "Running linter...",
    metadata: { command: "lint" },
  }),
};

const searchCommand: SlashCommandDefinition = {
  name: "search",
  description: "Search the codebase for a pattern or symbol.",
  handler: async (args, _context) => ({
    type: "action",
    content: `Searching codebase for "${args}"...`,
    metadata: { command: "search", query: args },
  }),
};

const memoryCommand: SlashCommandDefinition = {
  name: "memory",
  description: "Show or search episodic memory from past runs.",
  aliases: ["mem"],
  handler: async (_args, _context) => ({
    type: "action",
    content: "Loading memory records...",
    metadata: { command: "memory" },
  }),
};

const rolesCommand: SlashCommandDefinition = {
  name: "roles",
  description: "List available agent roles and their capabilities.",
  handler: async (_args, _context) => {
    const roles = listAgentRoles();
    const lines: string[] = ["Available agent roles:"];
    let currentCategory = "";

    for (const role of roles) {
      if (role.category !== currentCategory) {
        currentCategory = role.category;
        lines.push("");
        lines.push(`  [${currentCategory.toUpperCase()}]`);
      }
      const modelTag = role.preferredModelRole;
      lines.push(`    ${role.id.padEnd(24)} ${role.name} (${modelTag})`);
      lines.push(`${"".padEnd(28)} ${role.description.slice(0, 80)}${role.description.length > 80 ? "..." : ""}`);
    }

    lines.push("");
    lines.push(`  ${roles.length} roles available across ${new Set(roles.map((r) => r.category)).size} categories.`);

    return {
      type: "message",
      content: lines.join("\n"),
      metadata: { command: "roles", roleCount: roles.length },
    };
  },
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
  clearCommand,
  compactCommand,
  diffCommand,
  undoCommand,
  testCommand,
  lintCommand,
  searchCommand,
  memoryCommand,
  rolesCommand,
];

/**
 * Register all built-in slash commands into a CommandRegistry.
 */
export function registerBuiltinCommands(registry: CommandRegistry): void {
  for (const command of builtinCommands) {
    registry.register(command);
  }
}
