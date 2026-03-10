import { describe, expect, it } from "vitest";
import { listOnPremInferenceBackends, resolveOnPremInferenceBackend, buildStartupCommand, buildFimPrompt } from "./inferenceBackends";

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

  it("includes JSON mode support flags", () => {
    const backends = listOnPremInferenceBackends();
    const vllm = backends.find((b) => b.id === "vllm-openai");
    const mlx = backends.find((b) => b.id === "mlx-lm");
    const ollama = backends.find((b) => b.id === "ollama-openai");
    expect(vllm?.supportsJsonMode).toBe(true);
    expect(mlx?.supportsJsonMode).toBe(false);
    expect(ollama?.supportsJsonMode).toBe(true);
  });

  it("includes prefix caching support descriptors", () => {
    const backends = listOnPremInferenceBackends();
    const vllm = backends.find((b) => b.id === "vllm-openai");
    const mlx = backends.find((b) => b.id === "mlx-lm");
    const transformers = backends.find((b) => b.id === "transformers-openai");
    expect(vllm?.supportsPrefixCaching?.supported).toBe(true);
    expect(vllm?.supportsPrefixCaching?.flag).toBe("--enable-prefix-caching");
    expect(mlx?.supportsPrefixCaching?.supported).toBe(true);
    expect(mlx?.supportsPrefixCaching?.automatic).toBe(true);
    expect(transformers?.supportsPrefixCaching?.supported).toBe(false);
  });

  it("includes constrained decoding flags", () => {
    const backends = listOnPremInferenceBackends();
    const vllm = backends.find((b) => b.id === "vllm-openai");
    const llamaCpp = backends.find((b) => b.id === "llama-cpp-openai");
    const mlx = backends.find((b) => b.id === "mlx-lm");
    expect(vllm?.supportsConstrainedDecoding).toBe(true);
    expect(vllm?.constrainedDecodingMethod).toBe("json_schema");
    expect(llamaCpp?.supportsConstrainedDecoding).toBe(true);
    expect(llamaCpp?.constrainedDecodingMethod).toBe("gbnf_grammar");
    expect(mlx?.supportsConstrainedDecoding).toBe(false);
  });

  it("includes caching flags in startup commands where applicable", () => {
    const backends = listOnPremInferenceBackends();
    const vllm = backends.find((b) => b.id === "vllm-openai");
    const llamaCpp = backends.find((b) => b.id === "llama-cpp-openai");
    expect(vllm?.startupCommandTemplate).toContain("--enable-prefix-caching");
    expect(llamaCpp?.startupCommandTemplate).toContain("--cache-prompt");
  });

  it("includes FIM support flags for Qwen-compatible backends", () => {
    const backends = listOnPremInferenceBackends();
    const vllm = backends.find((b) => b.id === "vllm-openai");
    const mlx = backends.find((b) => b.id === "mlx-lm");
    const sglang = backends.find((b) => b.id === "sglang");
    const transformers = backends.find((b) => b.id === "transformers-openai");
    expect(vllm?.supportsFim).toBe(true);
    expect(vllm?.fimTokenFormat?.prefix).toBe("<|fim_prefix|>");
    expect(mlx?.supportsFim).toBe(true);
    expect(sglang?.supportsFim).toBe(true);
    expect(transformers?.supportsFim).toBe(false);
  });

  it("includes speculative decoding config for CUDA backends", () => {
    const backends = listOnPremInferenceBackends();
    const vllm = backends.find((b) => b.id === "vllm-openai");
    const sglang = backends.find((b) => b.id === "sglang");
    const mlx = backends.find((b) => b.id === "mlx-lm");
    expect(vllm?.speculativeDecoding?.supported).toBe(true);
    expect(vllm?.speculativeDecoding?.draftModelId).toBe("Qwen/Qwen3-0.6B");
    expect(vllm?.speculativeDecoding?.numSpeculativeTokens).toBe(5);
    expect(sglang?.speculativeDecoding?.supported).toBe(true);
    expect(mlx?.speculativeDecoding?.supported).toBe(false);
  });

  it("builds startup command with speculative decoding when supported and VRAM sufficient", () => {
    const vllm = resolveOnPremInferenceBackend("vllm-openai");
    const cmd = buildStartupCommand(vllm, "Qwen/Qwen3.5-4B", {
      enableSpeculativeDecoding: true,
      vramMb: 8192,
    });
    expect(cmd).toContain("--speculative-model Qwen/Qwen3-0.6B");
    expect(cmd).toContain("--num-speculative-tokens 5");
  });

  it("omits speculative decoding when VRAM is insufficient", () => {
    const vllm = resolveOnPremInferenceBackend("vllm-openai");
    const cmd = buildStartupCommand(vllm, "Qwen/Qwen3.5-4B", {
      enableSpeculativeDecoding: true,
      vramMb: 512,
    });
    expect(cmd).not.toContain("--speculative-model");
  });

  it("omits speculative decoding for unsupported backends", () => {
    const mlx = resolveOnPremInferenceBackend("mlx-lm");
    const cmd = buildStartupCommand(mlx, "test-model", {
      enableSpeculativeDecoding: true,
      vramMb: 16384,
    });
    expect(cmd).not.toContain("--speculative-model");
  });

  it("builds FIM prompt for supported backends", () => {
    const vllm = resolveOnPremInferenceBackend("vllm-openai");
    const prompt = buildFimPrompt(vllm, "function hello() {\n", "\n}\n");
    expect(prompt).toBe("<|fim_prefix|>function hello() {\n<|fim_suffix|>\n}\n<|fim_middle|>");
  });

  it("returns null FIM prompt for unsupported backends", () => {
    const transformers = resolveOnPremInferenceBackend("transformers-openai");
    const prompt = buildFimPrompt(transformers, "prefix", "suffix");
    expect(prompt).toBeNull();
  });
});
