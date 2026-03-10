import { describe, expect, it, vi } from "vitest";
import type { ModelRole, ModelRoleBinding } from "../../shared/contracts";
import { applyEscalationPolicy } from "./providerOrchestrator";

// Test the default model role binding structure without database
// These mirror the defaults in ProviderOrchestrator.getModelRoleBindings

const DEFAULT_BINDINGS: Record<ModelRole, ModelRoleBinding> = {
  utility_fast: {
    role: "utility_fast",
    providerId: "onprem-qwen",
    pluginId: "qwen3.5-0.8b",
    model: "Qwen/Qwen3.5-0.8B",
    temperature: 0.1,
    maxTokens: 900,
    reasoningMode: "off",
  },
  coder_default: {
    role: "coder_default",
    providerId: "onprem-qwen",
    pluginId: "qwen3.5-4b",
    model: "mlx-community/Qwen3.5-4B-4bit",
    temperature: 0.12,
    maxTokens: 1800,
    reasoningMode: "off",
  },
  review_deep: {
    role: "review_deep",
    providerId: "onprem-qwen",
    pluginId: "qwen3.5-4b",
    model: "mlx-community/Qwen3.5-4B-4bit",
    temperature: 0.08,
    maxTokens: 2200,
    reasoningMode: "on",
  },
  overseer_escalation: {
    role: "overseer_escalation",
    providerId: "openai-responses",
    pluginId: null,
    model: "gpt-5-mini",
    temperature: 0.1,
    maxTokens: 2200,
  },
};

describe("Provider role bindings", () => {
  it("Fast maps to 0.8B local model", () => {
    const binding = DEFAULT_BINDINGS.utility_fast;
    expect(binding.providerId).toBe("onprem-qwen");
    expect(binding.model).toBe("Qwen/Qwen3.5-0.8B");
    expect(binding.reasoningMode).toBe("off");
  });

  it("Build maps to 4B local model", () => {
    const binding = DEFAULT_BINDINGS.coder_default;
    expect(binding.providerId).toBe("onprem-qwen");
    expect(binding.model).toBe("mlx-community/Qwen3.5-4B-4bit");
    expect(binding.reasoningMode).toBe("off");
  });

  it("Review maps to 4B with deeper reasoning", () => {
    const binding = DEFAULT_BINDINGS.review_deep;
    expect(binding.providerId).toBe("onprem-qwen");
    expect(binding.model).toBe("mlx-community/Qwen3.5-4B-4bit");
    expect(binding.reasoningMode).toBe("on");
    expect(binding.temperature).toBeLessThan(DEFAULT_BINDINGS.coder_default.temperature);
  });

  it("Escalate maps to OpenAI", () => {
    const binding = DEFAULT_BINDINGS.overseer_escalation;
    expect(binding.providerId).toBe("openai-responses");
    expect(binding.reasoningMode).toBeUndefined();
  });

  it("all four roles are defined", () => {
    const roles: ModelRole[] = ["utility_fast", "coder_default", "review_deep", "overseer_escalation"];
    for (const role of roles) {
      expect(DEFAULT_BINDINGS[role]).toBeDefined();
      expect(DEFAULT_BINDINGS[role].role).toBe(role);
    }
  });

  it("local models use lower temperatures than cloud", () => {
    expect(DEFAULT_BINDINGS.utility_fast.temperature).toBeLessThanOrEqual(0.15);
    expect(DEFAULT_BINDINGS.coder_default.temperature).toBeLessThanOrEqual(0.15);
    expect(DEFAULT_BINDINGS.review_deep.temperature).toBeLessThanOrEqual(0.15);
  });

  it("review has higher maxTokens than fast", () => {
    expect(DEFAULT_BINDINGS.review_deep.maxTokens).toBeGreaterThan(DEFAULT_BINDINGS.utility_fast.maxTokens);
  });

  it("coder has a plugin ID referencing 4B", () => {
    expect(DEFAULT_BINDINGS.coder_default.pluginId).toContain("4b");
  });

  it("fast has a plugin ID referencing 0.8B", () => {
    expect(DEFAULT_BINDINGS.utility_fast.pluginId).toContain("0.8b");
  });
});

describe("applyEscalationPolicy", () => {
  it("passes through non-escalation roles unchanged", () => {
    expect(applyEscalationPolicy("coder_default", "manual")).toBe("coder_default");
    expect(applyEscalationPolicy("utility_fast", "manual")).toBe("utility_fast");
    expect(applyEscalationPolicy("review_deep", "manual")).toBe("review_deep");
  });

  it("auto policy always allows escalation", () => {
    expect(applyEscalationPolicy("overseer_escalation", "auto")).toBe("overseer_escalation");
    expect(applyEscalationPolicy("overseer_escalation", "auto", "low")).toBe("overseer_escalation");
    expect(applyEscalationPolicy("overseer_escalation", "auto", "high")).toBe("overseer_escalation");
  });

  it("manual policy always blocks escalation", () => {
    expect(applyEscalationPolicy("overseer_escalation", "manual")).toBe("review_deep");
    expect(applyEscalationPolicy("overseer_escalation", "manual", "high")).toBe("review_deep");
    expect(applyEscalationPolicy("overseer_escalation", "manual", "low")).toBe("review_deep");
  });

  it("high_risk_only allows escalation when risk is high", () => {
    expect(applyEscalationPolicy("overseer_escalation", "high_risk_only", "high")).toBe("overseer_escalation");
  });

  it("high_risk_only blocks escalation when risk is not high", () => {
    expect(applyEscalationPolicy("overseer_escalation", "high_risk_only", "low")).toBe("review_deep");
    expect(applyEscalationPolicy("overseer_escalation", "high_risk_only", "medium")).toBe("review_deep");
    expect(applyEscalationPolicy("overseer_escalation", "high_risk_only")).toBe("review_deep");
  });

  it("defaults to high_risk_only when no policy is provided", () => {
    expect(applyEscalationPolicy("overseer_escalation", undefined, "high")).toBe("overseer_escalation");
    expect(applyEscalationPolicy("overseer_escalation", undefined, "medium")).toBe("review_deep");
    expect(applyEscalationPolicy("overseer_escalation", undefined)).toBe("review_deep");
  });
});
