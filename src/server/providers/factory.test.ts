import { describe, expect, it } from "vitest";
import { ProviderFactory } from "./factory";
import { OpenAiCompatibleAdapter, OnPremQwenAdapter } from "./stubAdapters";

describe("ProviderFactory", () => {
  it("resolves registered adapters", () => {
    const factory = new ProviderFactory();
    const openAi = new OpenAiCompatibleAdapter();

    factory.register(openAi);

    expect(factory.resolve("openai-compatible")).toBe(openAi);
  });

  it("throws on unknown provider", () => {
    const factory = new ProviderFactory();
    factory.register(new OnPremQwenAdapter());

    expect(() => factory.resolve("qwen-cli")).toThrowError(/not registered/i);
  });
});
