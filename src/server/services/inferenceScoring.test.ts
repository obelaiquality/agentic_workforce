import { describe, expect, it } from "vitest";
import { getCandidateOrderForHardware, scoreBenchmark } from "./inferenceScoring";

describe("inference scoring", () => {
  it("scores faster/stabler samples higher", () => {
    const fast = scoreBenchmark({
      backendId: "mlx-lm",
      profile: "interactive",
      ttftMsP95: 550,
      outputTokPerSec: 110,
      latencyMsP95: 1050,
      errorRate: 0,
      memoryHeadroomPct: 62,
    });

    const slow = scoreBenchmark({
      backendId: "transformers-openai",
      profile: "interactive",
      ttftMsP95: 3200,
      outputTokPerSec: 14,
      latencyMsP95: 5200,
      errorRate: 0.3,
      memoryHeadroomPct: 28,
    });

    expect(fast).toBeGreaterThan(slow);
  });

  it("returns hardware-aware candidate order", () => {
    expect(getCandidateOrderForHardware("apple-silicon")[0]).toBe("mlx-lm");
    expect(getCandidateOrderForHardware("nvidia-cuda")[0]).toBe("sglang");
  });
});

