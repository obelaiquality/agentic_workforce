// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import * as AgenticExports from "./index";

describe("agentic barrel exports", () => {
  it("exports AgenticRunDeepPanel", () => {
    expect(AgenticExports.AgenticRunDeepPanel).toBeDefined();
  });

  it("exports RunReplayPanel", () => {
    expect(AgenticExports.RunReplayPanel).toBeDefined();
  });
});
