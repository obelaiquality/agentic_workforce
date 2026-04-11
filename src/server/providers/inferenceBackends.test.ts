import { describe, expect, it } from "vitest";
import {
  listOnPremInferenceBackends,
  resolveOnPremInferenceBackend,
  buildStartupCommand,
  buildStartupCommandForBaseUrl,
  buildFimPrompt,
} from "./inferenceBackends";

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

  it("builds MLX startup commands against a dedicated base URL", () => {
    const mlx = resolveOnPremInferenceBackend("mlx-lm");
    const cmd = buildStartupCommandForBaseUrl(mlx, "Qwen/Qwen3.5-0.8B", "http://127.0.0.1:8001/v1");
    expect(cmd).toContain("--host 127.0.0.1");
    expect(cmd).toContain("--port 8001");
    expect(cmd).toContain("--model \"Qwen/Qwen3.5-0.8B\"");
  });

  it("builds transformers startup commands against a dedicated base URL", () => {
    const transformers = resolveOnPremInferenceBackend("transformers-openai");
    const cmd = buildStartupCommandForBaseUrl(
      transformers,
      "mlx-community/Qwen3.5-4B-4bit",
      "http://127.0.0.1:8010/v1"
    );
    expect(cmd).toContain("scripts/local_qwen_openai_server.py");
    expect(cmd).toContain("--host 127.0.0.1");
    expect(cmd).toContain("--port 8010");
    expect(cmd).toContain("--model \"mlx-community/Qwen3.5-4B-4bit\"");
  });

  it("resolves default backend when backendId is null", () => {
    const resolved = resolveOnPremInferenceBackend(null);
    expect(resolved.id).toBe("mlx-lm");
  });

  it("resolves default backend when backendId is undefined", () => {
    const resolved = resolveOnPremInferenceBackend(undefined);
    expect(resolved.id).toBe("mlx-lm");
  });

  it("resolves default backend when backendId is empty string", () => {
    const resolved = resolveOnPremInferenceBackend("");
    expect(resolved.id).toBe("mlx-lm");
  });

  it("adds speculative decoding when vramMb is not provided (undefined)", () => {
    const vllm = resolveOnPremInferenceBackend("vllm-openai");
    const cmd = buildStartupCommand(vllm, "Qwen/Qwen3.5-4B", {
      enableSpeculativeDecoding: true,
      // vramMb intentionally omitted
    });
    expect(cmd).toContain("--speculative-model Qwen/Qwen3-0.6B");
    expect(cmd).toContain("--num-speculative-tokens 5");
  });

  it("builds vllm startup command against a dedicated base URL", () => {
    const vllm = resolveOnPremInferenceBackend("vllm-openai");
    const cmd = buildStartupCommandForBaseUrl(
      vllm,
      "Qwen/Qwen3.5-4B",
      "http://192.168.1.100:9000/v1"
    );
    expect(cmd).toContain("vllm serve");
    expect(cmd).toContain("--host 192.168.1.100");
    expect(cmd).toContain("--port 9000");
    expect(cmd).toContain("--enable-prefix-caching");
  });

  it("builds sglang startup command against a dedicated base URL", () => {
    const sglang = resolveOnPremInferenceBackend("sglang");
    const cmd = buildStartupCommandForBaseUrl(
      sglang,
      "Qwen/Qwen3.5-4B",
      "http://10.0.0.5:30000/v1"
    );
    expect(cmd).toContain("sglang.launch_server");
    expect(cmd).toContain("--host 10.0.0.5");
    expect(cmd).toContain("--port 30000");
  });

  it("builds trtllm startup command against a dedicated base URL", () => {
    const trtllm = resolveOnPremInferenceBackend("trtllm-openai");
    const cmd = buildStartupCommandForBaseUrl(
      trtllm,
      "Qwen/Qwen3.5-4B",
      "http://127.0.0.1:7000/v1"
    );
    expect(cmd).toContain("trtllm-serve");
    expect(cmd).toContain("--host 127.0.0.1");
    expect(cmd).toContain("--port 7000");
  });

  it("builds llama-cpp startup command against a dedicated base URL", () => {
    const llamaCpp = resolveOnPremInferenceBackend("llama-cpp-openai");
    const cmd = buildStartupCommandForBaseUrl(
      llamaCpp,
      "test-model",
      "http://127.0.0.1:8080/v1"
    );
    expect(cmd).toContain("llama-server");
    expect(cmd).toContain("--host 127.0.0.1");
    expect(cmd).toContain("--port 8080");
    expect(cmd).toContain("--cache-prompt");
  });

  it("builds ollama startup command (always returns 'ollama serve')", () => {
    const ollama = resolveOnPremInferenceBackend("ollama-openai");
    const cmd = buildStartupCommandForBaseUrl(
      ollama,
      "llama3",
      "http://127.0.0.1:11434/v1"
    );
    expect(cmd).toBe("ollama serve");
  });

  it("falls back to buildStartupCommand for unknown backend id in buildStartupCommandForBaseUrl", () => {
    // Create a fake backend descriptor with unknown id
    const fakeBackend = {
      ...resolveOnPremInferenceBackend("mlx-lm"),
      id: "unknown-backend" as any,
      startupCommandTemplate: "custom-server --model {{model}}",
    };
    const cmd = buildStartupCommandForBaseUrl(
      fakeBackend,
      "test-model",
      "http://127.0.0.1:5000/v1"
    );
    expect(cmd).toContain("custom-server --model test-model");
  });

  it("parseHostPort falls back to backend default when baseUrl is invalid", () => {
    const mlx = resolveOnPremInferenceBackend("mlx-lm");
    // Pass an invalid URL to trigger the catch branch in parseHostPort
    const cmd = buildStartupCommandForBaseUrl(
      mlx,
      "test-model",
      "not-a-valid-url"
    );
    // Should use the fallback host/port from mlx baseUrlDefault (127.0.0.1:8000)
    expect(cmd).toContain("--host 127.0.0.1");
    expect(cmd).toContain("--port 8000");
  });

  it("omits speculative decoding when enableSpeculativeDecoding is false", () => {
    const vllm = resolveOnPremInferenceBackend("vllm-openai");
    const cmd = buildStartupCommand(vllm, "Qwen/Qwen3.5-4B", {
      enableSpeculativeDecoding: false,
      vramMb: 16384,
    });
    expect(cmd).not.toContain("--speculative-model");
  });

  it("builds basic startup command without options", () => {
    const mlx = resolveOnPremInferenceBackend("mlx-lm");
    const cmd = buildStartupCommand(mlx, "Qwen/Qwen3.5-0.8B");
    expect(cmd).toContain("mlx_lm.server");
    expect(cmd).toContain("--model Qwen/Qwen3.5-0.8B");
  });
});
