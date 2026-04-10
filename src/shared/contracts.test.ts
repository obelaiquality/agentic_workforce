import { describe, it, expect } from "vitest";

describe("shared/contracts exports", () => {
  it("module is importable without error", async () => {
    const mod = await import("./contracts");
    expect(mod).toBeDefined();
  });
});
