import { describe, it, expect } from "vitest";
import * as PluginExports from "./index";

describe("plugins barrel exports", () => {
  it("exports PluginRegistry", () => {
    expect(PluginExports.PluginRegistry).toBeDefined();
    expect(typeof PluginExports.PluginRegistry).toBe("function");
  });

  it("exports PluginLoader", () => {
    expect(PluginExports.PluginLoader).toBeDefined();
    expect(typeof PluginExports.PluginLoader).toBe("function");
  });

  it("exports loadAgentDefinitions", () => {
    expect(PluginExports.loadAgentDefinitions).toBeDefined();
    expect(typeof PluginExports.loadAgentDefinitions).toBe("function");
  });
});
