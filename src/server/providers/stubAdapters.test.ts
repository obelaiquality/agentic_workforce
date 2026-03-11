import { describe, expect, it } from "vitest";
import { resolveRoleScopedOnPremConfig } from "./stubAdapters";

describe("resolveRoleScopedOnPremConfig", () => {
  const baseConfig = {
    baseUrl: "http://127.0.0.1:8000/v1",
    apiKey: "",
    model: "mlx-community/Qwen3.5-4B-4bit",
    timeoutMs: 120000,
    temperature: 0.15,
    maxTokens: 1600,
    pluginId: "qwen3.5-4b",
    inferenceBackendId: "mlx-lm",
    reasoningMode: "off",
  } as const;

  it("falls back to the base config when no role config exists", () => {
    const resolved = resolveRoleScopedOnPremConfig(baseConfig, {}, "utility_fast");
    expect(resolved).toEqual(baseConfig);
  });

  it("merges a dedicated runtime for the requested role", () => {
    const resolved = resolveRoleScopedOnPremConfig(
      baseConfig,
      {
        utility_fast: {
          enabled: true,
          baseUrl: "http://127.0.0.1:8001/v1",
          pluginId: "qwen3.5-0.8b",
          model: "Qwen/Qwen3.5-0.8B",
          maxTokens: 900,
        },
      },
      "utility_fast"
    );

    expect(resolved.baseUrl).toBe("http://127.0.0.1:8001/v1");
    expect(resolved.pluginId).toBe("qwen3.5-0.8b");
    expect(resolved.model).toBe("Qwen/Qwen3.5-0.8B");
    expect(resolved.maxTokens).toBe(900);
    expect(resolved.inferenceBackendId).toBe("mlx-lm");
  });

  it("ignores a disabled dedicated runtime", () => {
    const resolved = resolveRoleScopedOnPremConfig(
      baseConfig,
      {
        utility_fast: {
          enabled: false,
          baseUrl: "http://127.0.0.1:8001/v1",
          pluginId: "qwen3.5-0.8b",
          model: "Qwen/Qwen3.5-0.8B",
        },
      },
      "utility_fast"
    );

    expect(resolved).toEqual(baseConfig);
  });
});
