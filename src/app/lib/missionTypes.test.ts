// @vitest-environment jsdom
import { describe, it, expect } from "vitest";

describe("missionTypes exports", () => {
  it("module is importable", async () => {
    const mod = await import("./missionTypes");
    expect(mod).toBeDefined();
  });
});
