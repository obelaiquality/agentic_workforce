import fs from "fs";
import path from "path";
import { z } from "zod";
import type { ModelRole } from "../../shared/contracts";

// ---------------------------------------------------------------------------
// Agent Definition — custom agent configurations from project files
// ---------------------------------------------------------------------------

export interface AgentDefinition {
  /** Unique agent name */
  name: string;
  /** Human-readable description */
  description: string;
  /** Custom system prompt for this agent */
  systemPrompt?: string;
  /** Restrict to specific tools by name */
  allowedTools?: string[];
  /** Model role to use for this agent */
  modelRole?: ModelRole;
  /** Max agentic loop iterations */
  maxIterations?: number;
}

// ---------------------------------------------------------------------------
// Validation schema
// ---------------------------------------------------------------------------

const agentDefinitionSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  systemPrompt: z.string().optional(),
  allowedTools: z.array(z.string()).optional(),
  modelRole: z.enum(["utility_fast", "coder_default", "review_deep", "overseer_escalation"]).optional(),
  maxIterations: z.number().int().positive().optional(),
});

const agentDefinitionsFileSchema = z.array(agentDefinitionSchema);

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Load custom agent definitions from a project's `.agentic-workforce/agents.json`.
 * Returns an empty array if the file doesn't exist or is invalid.
 */
export function loadAgentDefinitions(projectPath: string): AgentDefinition[] {
  const filePath = path.join(projectPath, ".agentic-workforce", "agents.json");

  if (!fs.existsSync(filePath)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    const validated = agentDefinitionsFileSchema.parse(parsed);
    return validated;
  } catch {
    return [];
  }
}
