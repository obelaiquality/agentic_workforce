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
  },
  {
    id: "vllm-openai",
    label: "vLLM (OpenAI Compatible)",
    baseUrlDefault: "http://127.0.0.1:8000/v1",
    startupCommandTemplate: "vllm serve {{model}} --host 127.0.0.1 --port 8000",
    optimizedFor: "nvidia-cuda",
    notes: "Best throughput for NVIDIA servers and batch-heavy workloads.",
  },
  {
    id: "sglang",
    label: "SGLang (OpenAI Compatible)",
    baseUrlDefault: "http://127.0.0.1:30000/v1",
    startupCommandTemplate:
      "python3 -m sglang.launch_server --model-path {{model}} --host 127.0.0.1 --port 30000",
    optimizedFor: "nvidia-cuda",
    notes: "Strong low-latency CUDA serving path with solid tool-calling throughput.",
  },
  {
    id: "trtllm-openai",
    label: "TensorRT-LLM (OpenAI Compatible)",
    baseUrlDefault: "http://127.0.0.1:8000/v1",
    startupCommandTemplate:
      "trtllm-serve {{model}} --host 127.0.0.1 --port 8000",
    optimizedFor: "nvidia-cuda",
    notes: "Optimized NVIDIA deployment path for top-end throughput and low latency.",
  },
  {
    id: "llama-cpp-openai",
    label: "llama.cpp server (OpenAI Compatible)",
    baseUrlDefault: "http://127.0.0.1:8080/v1",
    startupCommandTemplate:
      "llama-server --model /path/to/model.gguf --host 127.0.0.1 --port 8080 --ctx-size 32768",
    optimizedFor: "portable",
    notes: "Portable local runtime path when GGUF quantized weights are preferred.",
  },
  {
    id: "transformers-openai",
    label: "Transformers (OpenAI-Compatible Custom Server)",
    baseUrlDefault: "http://127.0.0.1:8000/v1",
    startupCommandTemplate:
      "python3 scripts/local_qwen_openai_server.py --backend transformers --model {{model}} --host 127.0.0.1 --port 8000",
    optimizedFor: "portable",
    notes: "Fallback option when specialized runtimes are unavailable.",
  },
  {
    id: "ollama-openai",
    label: "Ollama (OpenAI Compatible)",
    baseUrlDefault: "http://127.0.0.1:11434/v1",
    startupCommandTemplate: "ollama serve",
    optimizedFor: "portable",
    notes: "Quick local setup path with broad model catalog support.",
  },
];

export function listOnPremInferenceBackends() {
  return [...INFERENCE_BACKENDS];
}

export function resolveOnPremInferenceBackend(
  backendId?: string | null
): OnPremInferenceBackendDescriptor {
  if (!backendId) {
    return INFERENCE_BACKENDS[0];
  }

  return INFERENCE_BACKENDS.find((backend) => backend.id === (backendId as OnPremInferenceBackendId)) ?? INFERENCE_BACKENDS[0];
}
