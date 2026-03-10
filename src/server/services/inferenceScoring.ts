import type { InferenceBenchmarkProfile, OnPremInferenceBackendId } from "../../shared/contracts";

export interface BenchmarkSample {
  backendId: OnPremInferenceBackendId;
  profile: InferenceBenchmarkProfile;
  ttftMsP95: number;
  outputTokPerSec: number;
  latencyMsP95: number;
  errorRate: number;
  memoryHeadroomPct: number;
}

export function scoreBenchmark(sample: BenchmarkSample) {
  const ttftNorm = Math.max(0, Math.min(1, 1 - sample.ttftMsP95 / 4000));
  const tokNorm = Math.max(0, Math.min(1, sample.outputTokPerSec / 120));
  const latencyNorm = Math.max(0, Math.min(1, 1 - sample.latencyMsP95 / 6000));
  const stabilityNorm = Math.max(0, Math.min(1, 1 - sample.errorRate));
  return Number((0.35 * ttftNorm + 0.35 * tokNorm + 0.2 * latencyNorm + 0.1 * stabilityNorm).toFixed(6));
}

export function getCandidateOrderForHardware(hardware: "apple-silicon" | "nvidia-cuda" | "generic-cpu") {
  if (hardware === "apple-silicon") {
    return ["mlx-lm", "llama-cpp-openai", "transformers-openai", "ollama-openai"] as OnPremInferenceBackendId[];
  }
  if (hardware === "nvidia-cuda") {
    return ["sglang", "vllm-openai", "trtllm-openai", "ollama-openai", "llama-cpp-openai"] as OnPremInferenceBackendId[];
  }
  return ["llama-cpp-openai", "ollama-openai", "transformers-openai"] as OnPremInferenceBackendId[];
}

