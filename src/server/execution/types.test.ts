import { describe, it, expect } from "vitest";

describe("execution/types exports", () => {
  it("module is importable without error", async () => {
    const mod = await import("./types");
    expect(mod).toBeDefined();
  });
});
