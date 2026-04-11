import { describe, expect, it } from "vitest";
import { listOnPremQwenModelPlugins, resolveOnPremQwenModelPlugin } from "./modelPlugins";

describe("OnPrem Qwen model plugins", () => {
  it("contains the 4B default plugin and legacy options", () => {
    const plugins = listOnPremQwenModelPlugins();
    expect(plugins.some((plugin) => plugin.id === "qwen3.5-0.8b")).toBe(true);
    expect(plugins.some((plugin) => plugin.id === "qwen3.5-4b")).toBe(true);
    expect(plugins.some((plugin) => plugin.id === "qwen2.5-coder-3b")).toBe(true);
  });

  it("falls back to default plugin when unknown id is requested", () => {
    const plugin = resolveOnPremQwenModelPlugin("unknown");
    expect(plugin.id).toBe("qwen3.5-4b");
  });

  it("returns default plugin when no pluginId is provided", () => {
    const plugin = resolveOnPremQwenModelPlugin();
    expect(plugin.id).toBe("qwen3.5-4b");
  });

  it("returns default plugin when pluginId is undefined", () => {
    const plugin = resolveOnPremQwenModelPlugin(undefined);
    expect(plugin.id).toBe("qwen3.5-4b");
  });
});
