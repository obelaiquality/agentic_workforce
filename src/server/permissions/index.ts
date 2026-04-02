/**
 * Permission system for tool execution
 *
 * Provides a flexible policy-based permission system with hooks for
 * controlling tool access and requiring approvals.
 */

export type {
  PermissionDecisionResult,
  PermissionCheckResult,
  PermissionPolicy,
  PermissionHook,
} from "./types";

export { PermissionPolicyEngine } from "./policyEngine";
export { SafetyClassifier } from "./safetyClassifier";

export {
  autoApproveReadOnly,
  requireApprovalForDestructive,
  denyDangerousCommands,
  requireApprovalForInstall,
  requireApprovalForNetwork,
  autoApproveInTestMode,
  autoApproveGitReadOnly,
  DEFAULT_POLICIES,
} from "./defaultPolicies";
