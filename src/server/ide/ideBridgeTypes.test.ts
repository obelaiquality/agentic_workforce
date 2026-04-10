import { describe, it, expect } from "vitest";

describe("ide/ideBridgeTypes exports", () => {
  it("module is importable without error", async () => {
    const mod = await import("./ideBridgeTypes");
    expect(mod).toBeDefined();
  });
});
