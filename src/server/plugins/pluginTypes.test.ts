import { describe, it, expect } from "vitest";

describe("plugins/pluginTypes exports", () => {
  it("module is importable without error", async () => {
    const mod = await import("./pluginTypes");
    expect(mod).toBeDefined();
  });
});
