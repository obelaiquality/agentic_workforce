import { describe, it, expect } from "vitest";

describe("commands/commandTypes exports", () => {
  it("module is importable without error", async () => {
    const mod = await import("./commandTypes");
    expect(mod).toBeDefined();
  });
});
