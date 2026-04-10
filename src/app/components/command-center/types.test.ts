// @vitest-environment jsdom
import { describe, it, expect } from "vitest";

describe("command-center/types exports", () => {
  it("module is importable", async () => {
    const mod = await import("./types");
    expect(mod).toBeDefined();
  });
});
