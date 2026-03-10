import type { OnPremInferenceBackendDescriptor, OnPremInferenceBackendId } from "../../shared/contracts";

const INFERENCE_BACKENDS: OnPremInferenceBackendDescriptor[] = [
  {
    id: "mlx-lm",
    label: "MLX-LM (Apple Silicon)",
    baseUrlDefault: "http://127.0.0.1:8000/v1",
    startupCommandTemplate:
      "python3 -m mlx_lm.server --model {{model}} --host 127.0.0.1 --port 8000 --temp 0.15 --max-tokens 1600",
    optimizedFor: "apple-silicon",
    notes: "Fastest local path on Apple Silicon for Qwen 0.8B-class smoke tests with low memory use.",
    supportsJsonMode: false,
    supportsPrefixCaching: { supported: true, automatic: true },
    supportsConstrainedDecoding: false,
    supportsFim: true,
    fimTokenFormat: { prefix: "<|fim_prefix|>", suffix: "<|fim_suffix|>", middle: "<|fim_middle|>" },
    speculativeDecoding: { supported: false },
  },
  {
    id: "vllm-openai",
    label: "vLLM (OpenAI Compatible)",
    baseUrlDefault: "http://127.0.0.1:8000/v1",
    startupCommandTemplate: "vllm serve {{model}} --host 127.0.0.1 --port 8000 --enable-prefix-caching",
    optimizedFor: "nvidia-cuda",
    notes: "Best throughput for NVIDIA servers and batch-heavy workloads.",
    supportsJsonMode: true,
    supportsPrefixCaching: { supported: true, flag: "--enable-prefix-caching" },
    supportsConstrainedDecoding: true,
    constrainedDecodingMethod: "json_schema",
    supportsFim: true,
    fimTokenFormat: { prefix: "<|fim_prefix|>", suffix: "<|fim_suffix|>", middle: "<|fim_middle|>" },
    speculativeDecoding: {
      supported: true,
      draftModelId: "Qwen/Qwen3-0.6B",
      numSpeculativeTokens: 5,
      flag: "--speculative-model",
    },
  },
  {
    id: "sglang",
    label: "SGLang (OpenAI Compatible)",
    baseUrlDefault: "http://127.0.0.1:30000/v1",
    startupCommandTemplate:
      "python3 -m sglang.launch_server --model-path {{model}} --host 127.0.0.1 --port 30000",
    optimizedFor: "nvidia-cuda",
    notes: "Strong low-latency CUDA serving path with solid tool-calling throughput.",
    supportsJsonMode: true,
    supportsPrefixCaching: { supported: true, automatic: true, method: "RadixAttention" },
    supportsConstrainedDecoding: true,
    constrainedDecodingMethod: "json_schema",
    supportsFim: true,
    fimTokenFormat: { prefix: "<|fim_prefix|>", suffix: "<|fim_suffix|>", middle: "<|fim_middle|>" },
    speculativeDecoding: {
      supported: true,
      draftModelId: "Qwen/Qwen3-0.6B",
      numSpeculativeTokens: 5,
      flag: "--speculative-model",
    },
  },
  {
    id: "trtllm-openai",
    label: "TensorRT-LLM (OpenAI Compatible)",
    baseUrlDefault: "http://127.0.0.1:8000/v1",
    startupCommandTemplate:
      "trtllm-serve {{model}} --host 127.0.0.1 --port 8000",
    optimizedFor: "nvidia-cuda",
    notes: "Optimized NVIDIA deployment path for top-end throughput and low latency.",
    supportsJsonMode: true,
    supportsPrefixCaching: { supported: true, automatic: true },
    supportsConstrainedDecoding: true,
    constrainedDecodingMethod: "json_schema",
    supportsFim: false,
    speculativeDecoding: { supported: false },
  },
  {
    id: "llama-cpp-openai",
    label: "llama.cpp server (OpenAI Compatible)",
    baseUrlDefault: "http://127.0.0.1:8080/v1",
    startupCommandTemplate:
      "llama-server --model /path/to/model.gguf --host 127.0.0.1 --port 8080 --ctx-size 32768 --cache-prompt",
    optimizedFor: "portable",
    notes: "Portable local runtime path when GGUF quantized weights are preferred.",
    supportsJsonMode: true,
    supportsPrefixCaching: { supported: true, flag: "--cache-prompt" },
    supportsConstrainedDecoding: true,
    constrainedDecodingMethod: "gbnf_grammar",
    supportsFim: true,
    fimTokenFormat: { prefix: "<|fim_prefix|>", suffix: "<|fim_suffix|>", middle: "<|fim_middle|>" },
    speculativeDecoding: { supported: false },
  },
  {
    id: "transformers-openai",
    label: "Transformers (OpenAI-Compatible Custom Server)",
    baseUrlDefault: "http://127.0.0.1:8000/v1",
    startupCommandTemplate:
      "python3 scripts/local_qwen_openai_server.py --backend transformers --model {{model}} --host 127.0.0.1 --port 8000",
    optimizedFor: "portable",
    notes: "Fallback option when specialized runtimes are unavailable.",
    supportsJsonMode: false,
    supportsPrefixCaching: { supported: false },
    supportsConstrainedDecoding: false,
    supportsFim: false,
    speculativeDecoding: { supported: false },
  },
  {
    id: "ollama-openai",
    label: "Ollama (OpenAI Compatible)",
    baseUrlDefault: "http://127.0.0.1:11434/v1",
    startupCommandTemplate: "ollama serve",
    optimizedFor: "portable",
    notes: "Quick local setup path with broad model catalog support.",
    supportsJsonMode: true,
    supportsPrefixCaching: { supported: true, flag: "--keep-alive" },
    supportsConstrainedDecoding: false,
    supportsFim: false,
    speculativeDecoding: { supported: false },
  },
];

export function listOnPremInferenceBackends() {
  return [...INFERENCE_BACKENDS];
}

export function buildStartupCommand(
  backend: OnPremInferenceBackendDescriptor,
  model: string,
  options?: { enableSpeculativeDecoding?: boolean; vramMb?: number }
): string {
  let command = backend.startupCommandTemplate.replaceAll("{{model}}", model);

  if (
    options?.enableSpeculativeDecoding &&
    backend.speculativeDecoding?.supported &&
    backend.speculativeDecoding.draftModelId &&
    backend.speculativeDecoding.flag
  ) {
    const minVramForSpec = 1024;
    if (!options.vramMb || options.vramMb >= minVramForSpec) {
      command += ` ${backend.speculativeDecoding.flag} ${backend.speculativeDecoding.draftModelId}`;
      if (backend.speculativeDecoding.numSpeculativeTokens) {
        command += ` --num-speculative-tokens ${backend.speculativeDecoding.numSpeculativeTokens}`;
      }
    }
  }

  return command;
}

export function buildFimPrompt(
  backend: OnPremInferenceBackendDescriptor,
  prefix: string,
  suffix: string
): string | null {
  if (!backend.supportsFim || !backend.fimTokenFormat) {
    return null;
  }
  const fmt = backend.fimTokenFormat;
  return `${fmt.prefix}${prefix}${fmt.suffix}${suffix}${fmt.middle}`;
}

export function resolveOnPremInferenceBackend(
  backendId?: string | null
): OnPremInferenceBackendDescriptor {
  if (!backendId) {
    return INFERENCE_BACKENDS[0];
  }

  return INFERENCE_BACKENDS.find((backend) => backend.id === (backendId as OnPremInferenceBackendId)) ?? INFERENCE_BACKENDS[0];
}
