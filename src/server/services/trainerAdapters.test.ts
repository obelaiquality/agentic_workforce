import { describe, expect, it } from "vitest";
import { HfLoraLocalTrainerAdapter } from "./trainerAdapters";

describe("trainer adapters", () => {
  it("attempts non-sft stages with the multi-stage trainer script", { timeout: 30000 }, async () => {
    const adapter = new HfLoraLocalTrainerAdapter();
    const result = await adapter.run({
      runId: "run-1",
      datasetPath: "/tmp/dataset.jsonl",
      outputDir: "/tmp/out",
      stage: "orpo",
      studentModelId: "Qwen/Qwen3.5-0.8B",
      pythonCommand: "python3",
      maxSteps: 8,
      perDeviceBatchSize: 1,
      gradientAccumulationSteps: 8,
      learningRate: 0.0002,
      loraRank: 8,
      loraAlpha: 16,
      maxSeqLength: 1024,
      orpoBeta: 0.1,
      toolRewardScale: 0.6,
    });

    expect(result.status).toBe("failed");
    expect(result.reasonCode).toBe("dataset_insufficient");
  });
});
