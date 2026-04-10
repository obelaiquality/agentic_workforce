// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { executionModeLabel, modelRoleLabel, providerLabel } from "./missionLabels";

describe("modelRoleLabel", () => {
  it("returns 'Fast' for utility_fast", () => {
    expect(modelRoleLabel("utility_fast")).toBe("Fast");
  });

  it("returns 'Build' for coder_default", () => {
    expect(modelRoleLabel("coder_default")).toBe("Build");
  });

  it("returns 'Review' for review_deep", () => {
    expect(modelRoleLabel("review_deep")).toBe("Review");
  });

  it("returns 'Escalate' for overseer_escalation", () => {
    expect(modelRoleLabel("overseer_escalation")).toBe("Escalate");
  });

  it("returns 'Build' for null", () => {
    expect(modelRoleLabel(null)).toBe("Build");
  });

  it("returns 'Build' for undefined", () => {
    expect(modelRoleLabel(undefined)).toBe("Build");
  });
});

describe("providerLabel", () => {
  it("returns 'Local Qwen' for onprem-qwen", () => {
    expect(providerLabel("onprem-qwen")).toBe("Local Qwen");
  });

  it("returns 'OpenAI' for openai-responses", () => {
    expect(providerLabel("openai-responses")).toBe("OpenAI");
  });

  it("returns 'Qwen CLI' for qwen-cli", () => {
    expect(providerLabel("qwen-cli")).toBe("Qwen CLI");
  });

  it("returns 'OpenAI-Compatible' for openai-compatible", () => {
    expect(providerLabel("openai-compatible")).toBe("OpenAI-Compatible");
  });

  it("returns 'Provider' for null", () => {
    expect(providerLabel(null)).toBe("Provider");
  });

  it("returns 'Provider' for undefined", () => {
    expect(providerLabel(undefined)).toBe("Provider");
  });
});

describe("executionModeLabel", () => {
  it("returns 'Single Agent' for single_agent", () => {
    expect(executionModeLabel("single_agent")).toBe("Single Agent");
  });

  it("returns 'Parallel' for centralized_parallel", () => {
    expect(executionModeLabel("centralized_parallel")).toBe("Parallel");
  });

  it("returns 'Research Swarm' for research_swarm", () => {
    expect(executionModeLabel("research_swarm")).toBe("Research Swarm");
  });

  it("returns 'Route' for null", () => {
    expect(executionModeLabel(null)).toBe("Route");
  });

  it("returns 'Route' for undefined", () => {
    expect(executionModeLabel(undefined)).toBe("Route");
  });
});
