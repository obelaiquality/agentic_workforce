import type { ToolDefinition, ToolContext } from "../tools/types";
import type {
  PermissionPolicy,
  PermissionHook,
  PermissionCheckResult,
  PermissionDecisionResult,
  PermissionMode,
} from "./types";
import type { SafetyClassifier } from "./safetyClassifier";

/** Tool names that represent file operations */
const FILE_OPERATION_TOOLS = new Set(["write_file", "edit_file", "read_file"]);

/**
 * Permission policy engine that evaluates tool permissions through policies and hooks
 */
export class PermissionPolicyEngine {
  private policies: PermissionPolicy[] = [];
  private hooks: PermissionHook[] = [];
  private mode: PermissionMode = "default";
  private safetyClassifier?: SafetyClassifier;

  /**
   * Set the active permission mode
   */
  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  /**
   * Get the active permission mode
   */
  getMode(): PermissionMode {
    return this.mode;
  }

  /**
   * Set the safety classifier instance (used in "auto" mode)
   */
  setSafetyClassifier(classifier: SafetyClassifier): void {
    this.safetyClassifier = classifier;
  }

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
    // --- Mode-based short-circuits (before hooks/policies) ---
    const modeDecision = await this.evaluateMode(tool, input);
    if (modeDecision) {
      return modeDecision;
    }

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
   * Evaluate the active permission mode and return a decision if the mode
   * short-circuits normal policy evaluation.  Returns null when the mode
   * is "default" (fall through to standard logic).
   */
  private async evaluateMode(tool: ToolDefinition, input: unknown): Promise<PermissionCheckResult | null> {
    switch (this.mode) {
      case "bypass":
        return {
          decision: "allow",
          requiresApproval: false,
          reasons: ["Bypass mode — all tools auto-approved"],
          source: "policy",
        };

      case "plan":
        if (tool.permission.readOnly) {
          return {
            decision: "allow",
            requiresApproval: false,
            reasons: ["Plan mode — read-only tool auto-approved"],
            source: "policy",
          };
        }
        return {
          decision: "approval_required",
          requiresApproval: true,
          reasons: ["Plan mode — mutating tool requires approval"],
          source: "policy",
        };

      case "acceptEdits":
        if (FILE_OPERATION_TOOLS.has(tool.name)) {
          return {
            decision: "allow",
            requiresApproval: false,
            reasons: ["AcceptEdits mode — file operation auto-approved"],
            source: "policy",
          };
        }
        if (tool.name === "bash" || tool.name === "shell") {
          return {
            decision: "approval_required",
            requiresApproval: true,
            reasons: ["AcceptEdits mode — bash requires approval"],
            source: "policy",
          };
        }
        // For other tools, fall through to normal policy evaluation
        return null;

      case "auto": {
        if (!this.safetyClassifier) {
          // No classifier available — fall through to default behavior
          return null;
        }
        // Extract command for classification
        const command = this.extractCommandForClassifier(input);
        if (!command) {
          // Non-command tools: fall through to normal evaluation
          return null;
        }
        const classification = await this.safetyClassifier.classifyCommand(command);
        if (classification === "safe") {
          return {
            decision: "allow",
            requiresApproval: false,
            reasons: [`Auto mode — classifier rated command as safe`],
            source: "policy",
          };
        }
        if (classification === "dangerous") {
          return {
            decision: "deny",
            requiresApproval: false,
            reasons: [`Auto mode — classifier rated command as dangerous`],
            source: "policy",
          };
        }
        // "risky" — require approval
        return {
          decision: "approval_required",
          requiresApproval: true,
          reasons: [`Auto mode — classifier rated command as risky`],
          source: "policy",
        };
      }

      case "default":
      default:
        return null; // Fall through to normal evaluation
    }
  }

  /**
   * Extract a command string from tool input for safety classification.
   */
  private extractCommandForClassifier(input: unknown): string | null {
    if (typeof input === "string") return input;
    if (typeof input === "object" && input !== null) {
      const obj = input as Record<string, unknown>;
      if (typeof obj.command === "string") return obj.command;
      if (typeof obj.cmd === "string") return obj.cmd;
    }
    return null;
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
   * Clear all policies, hooks, and reset mode (for testing)
   */
  reset(): void {
    this.policies = [];
    this.hooks = [];
    this.mode = "default";
    this.safetyClassifier = undefined;
  }
}
