import { z } from "zod";

// ---------------------------------------------------------------------------
// Slash Command Definition
// ---------------------------------------------------------------------------

export interface SlashCommandDefinition {
  /** Command name without the leading slash (e.g. "commit", "debug") */
  name: string;
  /** Human-readable description shown in /help */
  description: string;
  /** Alternative names (e.g. "c" for "commit") */
  aliases?: string[];
  /** Optional Zod schema for argument validation */
  argsSchema?: z.ZodType;
  /** Execute the command */
  handler: (args: unknown, context: CommandContext) => Promise<CommandResult>;
}

// ---------------------------------------------------------------------------
// Command Context — injected into every command handler
// ---------------------------------------------------------------------------

export interface CommandContext {
  /** Active run identifier, if any */
  runId?: string;
  /** Active project identifier, if any */
  projectId?: string;
  /** Worktree path for the active project */
  worktreePath?: string;
}

// ---------------------------------------------------------------------------
// Command Result — returned by every command handler
// ---------------------------------------------------------------------------

export interface CommandResult {
  /** Result type: message for informational, action for side-effect, error for failure */
  type: "message" | "action" | "error";
  /** Human-readable content */
  content: string;
  /** Optional structured metadata */
  metadata?: Record<string, unknown>;
}
