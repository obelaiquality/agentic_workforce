import fs from "fs";
import path from "path";
import { fileURLToPath } from "node:url";
import type { ModelRole } from "../../../shared/contracts";

// ---------------------------------------------------------------------------
// Agent Role Definition — expanded role catalog for the agentic workforce
// ---------------------------------------------------------------------------

export type AgentRoleCategory =
  | "development"
  | "review"
  | "architecture"
  | "operations"
  | "strategy";

export interface AgentRoleDefinition {
  /** Unique role identifier (matches the JSON filename without extension) */
  id: string;
  /** Human-readable role name */
  name: string;
  /** Brief description of the role's purpose and expertise */
  description: string;
  /** Functional category for grouping and filtering */
  category: AgentRoleCategory;
  /** Multi-paragraph system prompt with detailed behavioral instructions */
  systemPrompt: string;
  /** Tools this role is allowed to use, or null for unrestricted access */
  allowedTools: string[] | null;
  /** Which model tier this role should preferably run on */
  preferredModelRole: ModelRole;
  /** Concrete verification actions required before task completion */
  verificationRequirements: string[];
  /** Conditions that should trigger escalation to a higher-capability model */
  escalationTriggers: string[];
}

// ---------------------------------------------------------------------------
// Internal cache — loaded once, reused thereafter
// ---------------------------------------------------------------------------

let cachedRoles: Map<string, AgentRoleDefinition> | null = null;

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Load all agent role definition JSON files from the agentRoles directory.
 *
 * Reads every `.json` file in the same directory as this module, parses it,
 * and returns a Map keyed by role id. Results are cached after first load.
 *
 * @returns Map of role id to AgentRoleDefinition
 */
export function loadAgentRoles(): Map<string, AgentRoleDefinition> {
  if (cachedRoles) {
    return cachedRoles;
  }

  const rolesDir = path.dirname(fileURLToPath(import.meta.url));
  const roles = new Map<string, AgentRoleDefinition>();

  let files: string[];
  try {
    files = fs.readdirSync(rolesDir).filter((f) => f.endsWith(".json"));
  } catch {
    return roles;
  }

  for (const file of files) {
    try {
      const filePath = path.join(rolesDir, file);
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed: AgentRoleDefinition = JSON.parse(raw);

      // Basic validation — ensure required fields exist
      if (
        typeof parsed.id === "string" &&
        typeof parsed.name === "string" &&
        typeof parsed.description === "string" &&
        typeof parsed.category === "string" &&
        typeof parsed.systemPrompt === "string" &&
        typeof parsed.preferredModelRole === "string" &&
        Array.isArray(parsed.verificationRequirements) &&
        Array.isArray(parsed.escalationTriggers)
      ) {
        roles.set(parsed.id, parsed);
      }
    } catch {
      // Skip invalid files silently
    }
  }

  cachedRoles = roles;
  return roles;
}

/**
 * Retrieve a single agent role definition by its id.
 *
 * @param roleId - The unique role identifier (e.g. "frontend-developer")
 * @returns The role definition, or null if not found
 */
export function getAgentRole(roleId: string): AgentRoleDefinition | null {
  const roles = loadAgentRoles();
  return roles.get(roleId) ?? null;
}

/**
 * List all available agent role definitions.
 *
 * @returns Array of all loaded AgentRoleDefinitions, sorted by category then name
 */
export function listAgentRoles(): AgentRoleDefinition[] {
  const roles = loadAgentRoles();
  const categoryOrder: Record<AgentRoleCategory, number> = {
    development: 0,
    review: 1,
    architecture: 2,
    operations: 3,
    strategy: 4,
  };

  return Array.from(roles.values()).sort((a, b) => {
    const catDiff =
      (categoryOrder[a.category] ?? 99) - (categoryOrder[b.category] ?? 99);
    if (catDiff !== 0) return catDiff;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Reset the internal cache, forcing a fresh reload on next access.
 * Primarily useful for testing.
 */
export function _resetRoleCache(): void {
  cachedRoles = null;
}
