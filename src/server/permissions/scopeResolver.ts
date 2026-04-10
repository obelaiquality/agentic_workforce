import type { PermissionPolicy } from "./types";

/**
 * Represents a set of permission rules from a specific scope.
 */
export interface PermissionRuleSource {
  scope: "user" | "project" | "session";
  rules: PermissionPolicy[];
}

/**
 * Priority map — higher numeric value means higher priority (wins conflicts).
 */
const SCOPE_PRIORITY: Record<PermissionRuleSource["scope"], number> = {
  user: 0,
  project: 1,
  session: 2,
};

/**
 * Resolves and merges permission rules from multiple scopes.
 *
 * When rules from different scopes share the same `name`, the rule from the
 * higher-priority scope wins (session > project > user).
 */
export class ScopeResolver {
  /**
   * Merge rules from multiple scopes.
   * Higher-priority scopes override lower-priority ones (matched by policy name).
   * The returned list is sorted by policy priority (lower number = evaluated first).
   */
  resolve(sources: PermissionRuleSource[]): PermissionPolicy[] {
    // Build a map keyed by policy name.
    // Process sources in ascending priority order so later (higher) scopes overwrite.
    const sorted = [...sources].sort(
      (a, b) => SCOPE_PRIORITY[a.scope] - SCOPE_PRIORITY[b.scope],
    );

    const merged = new Map<string, PermissionPolicy>();

    for (const source of sorted) {
      for (const rule of source.rules) {
        merged.set(rule.name, rule);
      }
    }

    // Return policies sorted by their own priority (lower = higher priority)
    return Array.from(merged.values()).sort((a, b) => a.priority - b.priority);
  }

  /**
   * Load user-level permission rules.
   * Reads from ~/.agentic-workforce/permissions.json
   * Stub: returns empty array for now.
   */
  loadUserRules(): PermissionPolicy[] {
    // TODO: read from ~/.agentic-workforce/permissions.json and deserialize
    return [];
  }

  /**
   * Load project-level permission rules.
   * Reads from .agentic-workforce/permissions.json in the repo root.
   * Stub: returns empty array for now.
   */
  loadProjectRules(): PermissionPolicy[] {
    // TODO: read from <repoRoot>/.agentic-workforce/permissions.json and deserialize
    return [];
  }
}
