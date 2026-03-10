import type { ExecutionMode, ModelRole, ProviderId } from "../../shared/contracts";

export function modelRoleLabel(role: ModelRole | null | undefined) {
  switch (role) {
    case "utility_fast":
      return "Fast";
    case "coder_default":
      return "Build";
    case "review_deep":
      return "Review";
    case "overseer_escalation":
      return "Escalate";
    default:
      return "Build";
  }
}

export function providerLabel(providerId: ProviderId | null | undefined) {
  switch (providerId) {
    case "onprem-qwen":
      return "Local Qwen";
    case "openai-responses":
      return "OpenAI";
    case "qwen-cli":
      return "Qwen CLI";
    case "openai-compatible":
      return "OpenAI-Compatible";
    default:
      return "Provider";
  }
}

export function executionModeLabel(mode: ExecutionMode | null | undefined) {
  switch (mode) {
    case "single_agent":
      return "Single Agent";
    case "centralized_parallel":
      return "Parallel";
    case "research_swarm":
      return "Research Swarm";
    default:
      return "Route";
  }
}
