import { describe, expect, it } from "vitest";
import { listOnPremInferenceBackends, resolveOnPremInferenceBackend } from "./inferenceBackends";

describe("On-prem inference backends", () => {
  it("exposes MLX as the default backend", () => {
    const first = listOnPremInferenceBackends()[0];
    expect(first.id).toBe("mlx-lm");
  });

  it("contains CUDA-specialized backends", () => {
    const backends = listOnPremInferenceBackends();
    expect(backends.some((backend) => backend.id === "sglang")).toBe(true);
    expect(backends.some((backend) => backend.id === "trtllm-openai")).toBe(true);
  });

  it("falls back to MLX when an unknown backend is requested", () => {
    const resolved = resolveOnPremInferenceBackend("unknown");
    expect(resolved.id).toBe("mlx-lm");
  });
});
