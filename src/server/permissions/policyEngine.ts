import type { ToolDefinition, ToolContext } from "../tools/types";
import type {
  PermissionPolicy,
  PermissionHook,
  PermissionCheckResult,
  PermissionDecisionResult,
} from "./types";

/**
 * Permission policy engine that evaluates tool permissions through policies and hooks
 */
export class PermissionPolicyEngine {
  private policies: PermissionPolicy[] = [];
  private hooks: PermissionHook[] = [];

  /**
   * Register a permission policy
   */
  addPolicy(policy: PermissionPolicy): void {
    this.policies.push(policy);
    // Keep policies sorted by priority (lower = higher priority)
    this.policies.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Register a permission hook
   */
  addHook(hook: PermissionHook): void {
    this.hooks.push(hook);
  }

  /**
   * Check permission for a tool invocation
   *
   * Evaluation flow:
   * 1. Run pre-hooks (can short-circuit)
   * 2. Find first matching policy (by priority)
   * 3. Evaluate policy
   * 4. Run post-hooks (can override)
   * 5. Default: use tool.permission metadata
   */
  async check(tool: ToolDefinition, input: unknown, ctx: ToolContext): Promise<PermissionCheckResult> {
    const toolMeta = { name: tool.name, permission: tool.permission };

    // 1. Run pre-hooks (can short-circuit entire evaluation)
    const preHooks = this.hooks.filter((h) => h.phase === "pre");
    for (const hook of preHooks) {
      const result = await hook.execute({
        tool: toolMeta,
        params: input,
        ctx,
      });
      if (result.override && result.decision) {
        return result.decision;
      }
    }

    // 2. Find first matching policy (sorted by priority)
    let decision: PermissionCheckResult | null = null;
    for (const policy of this.policies) {
      if (policy.matches(toolMeta, input)) {
        decision = policy.evaluate(toolMeta, input, ctx);
        break;
      }
    }

    // 3. If no policy matched, use default behavior based on tool metadata
    if (!decision) {
      decision = this.getDefaultDecision(tool, input, ctx);
    }

    // 4. Run post-hooks (can override the decision)
    const postHooks = this.hooks.filter((h) => h.phase === "post");
    for (const hook of postHooks) {
      const result = await hook.execute({
        tool: toolMeta,
        params: input,
        ctx,
        currentDecision: decision,
      });
      if (result.override && result.decision) {
        decision = result.decision;
      }
    }

    return decision;
  }

  /**
   * Get default permission decision based on tool metadata
   */
  private getDefaultDecision(tool: ToolDefinition, input: unknown, ctx: ToolContext): PermissionCheckResult {
    const { permission } = tool;

    // Static approval requirement
    if (permission.requiresApproval) {
      return {
        decision: "approval_required",
        requiresApproval: true,
        reasons: ["Tool requires static approval"],
        source: "default",
      };
    }

    // Dynamic approval check
    if (permission.checkApproval && permission.checkApproval(input, ctx)) {
      return {
        decision: "approval_required",
        requiresApproval: true,
        reasons: ["Tool's dynamic approval check returned true"],
        source: "default",
      };
    }

    // Default: allow read-only tools, require approval for others
    if (permission.readOnly) {
      return {
        decision: "allow",
        requiresApproval: false,
        reasons: ["Tool is read-only"],
        source: "default",
      };
    }

    // Destructive tools require approval by default
    if (permission.destructive) {
      return {
        decision: "approval_required",
        requiresApproval: true,
        reasons: ["Tool is destructive"],
        source: "default",
      };
    }

    // Default allow for non-destructive tools
    return {
      decision: "allow",
      requiresApproval: false,
      reasons: ["Default allow"],
      source: "default",
    };
  }

  /**
   * Get all registered policies (for inspection)
   */
  getPolicies(): readonly PermissionPolicy[] {
    return this.policies;
  }

  /**
   * Get all registered hooks (for inspection)
   */
  getHooks(): readonly PermissionHook[] {
    return this.hooks;
  }

  /**
   * Clear all policies and hooks (for testing)
   */
  reset(): void {
    this.policies = [];
    this.hooks = [];
  }
}
