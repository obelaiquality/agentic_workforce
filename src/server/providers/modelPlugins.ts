import type { OnPremQwenModelPlugin } from "../../shared/contracts";

const PLUGINS: OnPremQwenModelPlugin[] = [
  {
    id: "qwen3.5-4b",
    label: "Qwen 3.5 4B (MLX 4-bit)",
    hfRepo: "Qwen/Qwen3.5-4B",
    runtimeModel: "mlx-community/Qwen3.5-4B-4bit",
    paramsB: 4,
    maxContext: 262144,
    minVramGb: 4,
    recommendedBackend: "mlx-lm",
    notes:
      "Primary local coding rung. Uses the official Qwen 3.5 4B model family with an MLX 4-bit runtime artifact for lower disk and memory pressure on Apple Silicon.",
  },
  {
    id: "qwen2.5-coder-3b",
    label: "Qwen2.5 Coder 3B Instruct (Legacy)",
    hfRepo: "Qwen/Qwen2.5-Coder-3B-Instruct",
    runtimeModel: "Qwen/Qwen2.5-Coder-3B-Instruct",
    paramsB: 3,
    maxContext: 32768,
    minVramGb: 6,
    recommendedBackend: "mlx-lm",
    notes: "Legacy local coding rung kept for compatibility and regression testing.",
  },
  {
    id: "qwen3.5-0.8b",
    label: "Qwen 3.5 0.8B",
    hfRepo: "Qwen/Qwen3.5-0.8B",
    runtimeModel: "Qwen/Qwen3.5-0.8B",
    paramsB: 0.8,
    maxContext: 262144,
    minVramGb: 2,
    recommendedBackend: "mlx-lm",
    notes: "Fast local smoke-test baseline with native long-context support and strong Apple Silicon performance.",
  },
  {
    id: "qwen-custom",
    label: "Qwen Custom (Any Size)",
    hfRepo: "custom",
    runtimeModel: "custom",
    paramsB: 0,
    maxContext: 0,
    minVramGb: 0,
    recommendedBackend: "mlx-lm",
    notes: "Set any local runtime model id manually (1B/3B/7B/14B/etc.) with no UI rewrite.",
  },
];

export function listOnPremQwenModelPlugins() {
  return [...PLUGINS];
}

export function resolveOnPremQwenModelPlugin(pluginId?: string) {
  if (!pluginId) {
    return PLUGINS[0];
  }

  return PLUGINS.find((plugin) => plugin.id === pluginId) ?? PLUGINS[0];
}
