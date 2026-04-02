import type { ToolPermission } from "../tools/types";
import type { ToolContext } from "../tools/types";

/**
 * Permission decision result types
 */
export type PermissionDecisionResult = "allow" | "deny" | "approval_required";

/**
 * Result of a permission check
 */
export interface PermissionCheckResult {
  /** The final decision */
  decision: PermissionDecisionResult;
  /** Whether approval is required */
  requiresApproval: boolean;
  /** Human-readable reasons for the decision */
  reasons: string[];
  /** Source of the decision */
  source: "policy" | "hook" | "default";
}

/**
 * A permission policy that can match and evaluate tool permissions
 */
export interface PermissionPolicy {
  /** Unique policy name */
  name: string;
  /** Lower number = higher priority (evaluated first) */
  priority: number;
  /** Check if this policy applies to the given tool + input */
  matches(tool: { name: string; permission: ToolPermission }, input: unknown): boolean;
  /** Evaluate the policy and return a decision */
  evaluate(tool: { name: string; permission: ToolPermission }, input: unknown, ctx: ToolContext): PermissionCheckResult;
}

/**
 * A hook that can intercept and override permission decisions
 */
export interface PermissionHook {
  /** Unique hook name */
  name: string;
  /** When this hook runs */
  phase: "pre" | "post";
  /** Execute the hook logic */
  execute(input: {
    tool: { name: string; permission: ToolPermission };
    params: unknown;
    ctx: ToolContext;
    currentDecision?: PermissionCheckResult;
  }): Promise<{ override: boolean; decision?: PermissionCheckResult }>;
}
