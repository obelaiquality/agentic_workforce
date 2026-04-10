import { describe, it, expect } from "vitest";
import * as CommandExports from "./index";

describe("commands barrel exports", () => {
  it("exports CommandRegistry", () => {
    expect(CommandExports.CommandRegistry).toBeDefined();
    expect(typeof CommandExports.CommandRegistry).toBe("function");
  });

  it("exports builtinCommands", () => {
    expect(CommandExports.builtinCommands).toBeDefined();
    expect(Array.isArray(CommandExports.builtinCommands)).toBe(true);
  });

  it("exports registerBuiltinCommands", () => {
    expect(CommandExports.registerBuiltinCommands).toBeDefined();
    expect(typeof CommandExports.registerBuiltinCommands).toBe("function");
  });
});
