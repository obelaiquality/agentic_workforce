import { describe, it, expect } from "vitest";
import * as ToolExports from "./index";

describe("tools barrel exports", () => {
  it("exports ToolRegistry", () => {
    expect(ToolExports.ToolRegistry).toBeDefined();
    expect(typeof ToolExports.ToolRegistry).toBe("function");
  });

  it("exports getDefaultToolRegistry", () => {
    expect(ToolExports.getDefaultToolRegistry).toBeDefined();
    expect(typeof ToolExports.getDefaultToolRegistry).toBe("function");
  });

  it("exports createToolRegistry", () => {
    expect(ToolExports.createToolRegistry).toBeDefined();
    expect(typeof ToolExports.createToolRegistry).toBe("function");
  });

  it("exports DeferredToolLoader", () => {
    expect(ToolExports.DeferredToolLoader).toBeDefined();
    expect(typeof ToolExports.DeferredToolLoader).toBe("function");
  });

  it("exports createDeferredToolLoader", () => {
    expect(ToolExports.createDeferredToolLoader).toBeDefined();
    expect(typeof ToolExports.createDeferredToolLoader).toBe("function");
  });

  it("exports createToolSearchTool", () => {
    expect(ToolExports.createToolSearchTool).toBeDefined();
    expect(typeof ToolExports.createToolSearchTool).toBe("function");
  });
});
