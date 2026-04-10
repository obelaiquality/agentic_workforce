import { describe, it, expect } from "vitest";
import { BUILT_IN_SPECIALIZATIONS } from "./agentSpecializations";

const EXPECTED_KEYS = ["planner", "implementer", "tester", "reviewer", "debugger", "refactorer", "documenter"];
const VALID_MODEL_ROLES = ["utility_fast", "coder_default", "review_deep"];

describe("BUILT_IN_SPECIALIZATIONS", () => {
  it("has all 7 expected keys", () => {
    expect(Object.keys(BUILT_IN_SPECIALIZATIONS).sort()).toEqual([...EXPECTED_KEYS].sort());
  });

  for (const key of EXPECTED_KEYS) {
    describe(`specialization: ${key}`, () => {
      it("has all required fields", () => {
        const spec = BUILT_IN_SPECIALIZATIONS[key];
        expect(spec).toBeDefined();
        expect(spec).toHaveProperty("name");
        expect(spec).toHaveProperty("description");
        expect(spec).toHaveProperty("systemPromptPrefix");
        expect(spec).toHaveProperty("preferredTools");
        expect(spec).toHaveProperty("modelRole");
        expect(spec).toHaveProperty("maxIterations");
      });

      it("name matches its record key", () => {
        expect(BUILT_IN_SPECIALIZATIONS[key].name).toBe(key);
      });

      it("modelRole is one of the valid roles", () => {
        expect(VALID_MODEL_ROLES).toContain(BUILT_IN_SPECIALIZATIONS[key].modelRole);
      });

      it("preferredTools is a non-empty array of strings", () => {
        const tools = BUILT_IN_SPECIALIZATIONS[key].preferredTools;
        expect(Array.isArray(tools)).toBe(true);
        expect(tools.length).toBeGreaterThan(0);
        for (const tool of tools) {
          expect(typeof tool).toBe("string");
        }
      });

      it("maxIterations is a positive integer", () => {
        const max = BUILT_IN_SPECIALIZATIONS[key].maxIterations;
        expect(max).toBeGreaterThan(0);
        expect(Number.isInteger(max)).toBe(true);
      });

      it("description is a non-empty string", () => {
        expect(typeof BUILT_IN_SPECIALIZATIONS[key].description).toBe("string");
        expect(BUILT_IN_SPECIALIZATIONS[key].description.length).toBeGreaterThan(0);
      });

      it("systemPromptPrefix is a non-empty string", () => {
        expect(typeof BUILT_IN_SPECIALIZATIONS[key].systemPromptPrefix).toBe("string");
        expect(BUILT_IN_SPECIALIZATIONS[key].systemPromptPrefix.length).toBeGreaterThan(0);
      });
    });
  }
});
