import { describe, it, expect } from "vitest";
import {
  PROJECT_STARTERS,
  DEFAULT_EMPTY_FOLDER_STARTER_ID,
  DEFAULT_STACK_STARTER_ID,
  isProjectStarterId,
  normalizeStarterMetadata,
  getProjectStarterCatalog,
} from "./projectStarterCatalog";

describe("projectStarterCatalog", () => {
  describe("PROJECT_STARTERS constant", () => {
    it("contains at least two starter entries", () => {
      expect(PROJECT_STARTERS.length).toBeGreaterThanOrEqual(2);
    });

    it("has neutral_baseline starter", () => {
      const neutralStarter = PROJECT_STARTERS.find((s) => s.id === "neutral_baseline");
      expect(neutralStarter).toBeDefined();
      expect(neutralStarter?.label).toBe("Neutral Baseline");
      expect(neutralStarter?.kind).toBe("generic");
      expect(neutralStarter?.recommended).toBe(true);
      expect(neutralStarter?.verificationMode).toBe("none");
    });

    it("has typescript_vite_react starter", () => {
      const tsStarter = PROJECT_STARTERS.find((s) => s.id === "typescript_vite_react");
      expect(tsStarter).toBeDefined();
      expect(tsStarter?.label).toBe("TypeScript App");
      expect(tsStarter?.kind).toBe("stack");
      expect(tsStarter?.recommended).toBe(false);
      expect(tsStarter?.verificationMode).toBe("commands");
    });

    it("all starters have required fields", () => {
      for (const starter of PROJECT_STARTERS) {
        expect(starter.id).toBeTruthy();
        expect(typeof starter.id).toBe("string");
        expect(starter.label).toBeTruthy();
        expect(typeof starter.label).toBe("string");
        expect(starter.description).toBeTruthy();
        expect(typeof starter.description).toBe("string");
        expect(starter.kind).toBeTruthy();
        expect(["generic", "stack"]).toContain(starter.kind);
        expect(typeof starter.recommended).toBe("boolean");
        expect(starter.verificationMode).toBeTruthy();
        expect(["none", "commands"]).toContain(starter.verificationMode);
      }
    });

    it("all starter IDs are unique", () => {
      const ids = PROJECT_STARTERS.map((s) => s.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  describe("DEFAULT_EMPTY_FOLDER_STARTER_ID", () => {
    it("is neutral_baseline", () => {
      expect(DEFAULT_EMPTY_FOLDER_STARTER_ID).toBe("neutral_baseline");
    });

    it("exists in PROJECT_STARTERS", () => {
      const exists = PROJECT_STARTERS.some((s) => s.id === DEFAULT_EMPTY_FOLDER_STARTER_ID);
      expect(exists).toBe(true);
    });
  });

  describe("DEFAULT_STACK_STARTER_ID", () => {
    it("is typescript_vite_react", () => {
      expect(DEFAULT_STACK_STARTER_ID).toBe("typescript_vite_react");
    });

    it("exists in PROJECT_STARTERS", () => {
      const exists = PROJECT_STARTERS.some((s) => s.id === DEFAULT_STACK_STARTER_ID);
      expect(exists).toBe(true);
    });
  });

  describe("isProjectStarterId", () => {
    it("returns true for valid starter IDs", () => {
      expect(isProjectStarterId("neutral_baseline")).toBe(true);
      expect(isProjectStarterId("typescript_vite_react")).toBe(true);
    });

    it("returns false for invalid starter IDs", () => {
      expect(isProjectStarterId("invalid_starter_id")).toBe(false);
      expect(isProjectStarterId("")).toBe(false);
      expect(isProjectStarterId("random-string")).toBe(false);
    });

    it("returns false for non-string values", () => {
      expect(isProjectStarterId(null)).toBe(false);
      expect(isProjectStarterId(undefined)).toBe(false);
      expect(isProjectStarterId(123)).toBe(false);
      expect(isProjectStarterId({})).toBe(false);
      expect(isProjectStarterId([])).toBe(false);
      expect(isProjectStarterId(true)).toBe(false);
    });
  });

  describe("normalizeStarterMetadata", () => {
    it("returns empty object for null input", () => {
      const result = normalizeStarterMetadata(null);
      expect(result).toEqual({});
    });

    it("returns empty object for undefined input", () => {
      const result = normalizeStarterMetadata(undefined);
      expect(result).toEqual({});
    });

    it("preserves existing metadata when no starter fields present", () => {
      const input = {
        customField: "value",
        anotherField: 123,
      };
      const result = normalizeStarterMetadata(input);
      expect(result).toEqual(input);
    });

    it("normalizes starter_id to starter_id", () => {
      const input = {
        starter_id: "neutral_baseline",
      };
      const result = normalizeStarterMetadata(input);
      expect(result.starter_id).toBe("neutral_baseline");
    });

    it("normalizes scaffold_template to starter_id", () => {
      const input = {
        scaffold_template: "typescript_vite_react",
      };
      const result = normalizeStarterMetadata(input);
      expect(result.starter_id).toBe("typescript_vite_react");
    });

    it("normalizes bootstrap_template to starter_id", () => {
      const input = {
        bootstrap_template: "neutral_baseline",
      };
      const result = normalizeStarterMetadata(input);
      expect(result.starter_id).toBe("neutral_baseline");
    });

    it("prefers starter_id over scaffold_template", () => {
      const input = {
        starter_id: "neutral_baseline",
        scaffold_template: "typescript_vite_react",
      };
      const result = normalizeStarterMetadata(input);
      expect(result.starter_id).toBe("neutral_baseline");
    });

    it("prefers scaffold_template over bootstrap_template", () => {
      const input = {
        scaffold_template: "typescript_vite_react",
        bootstrap_template: "neutral_baseline",
      };
      const result = normalizeStarterMetadata(input);
      expect(result.starter_id).toBe("typescript_vite_react");
    });

    it("adds creation_mode when valid starter_id found", () => {
      const input = {
        starter_id: "neutral_baseline",
      };
      const result = normalizeStarterMetadata(input);
      expect(result.creation_mode).toBe("starter");
    });

    it("does not override existing creation_mode", () => {
      const input = {
        starter_id: "neutral_baseline",
        creation_mode: "custom",
      };
      const result = normalizeStarterMetadata(input);
      expect(result.creation_mode).toBe("custom");
    });

    it("does not add creation_mode for invalid starter IDs", () => {
      const input = {
        starter_id: "invalid_id",
      };
      const result = normalizeStarterMetadata(input);
      expect(result.creation_mode).toBeUndefined();
    });

    it("does not modify input for invalid template values", () => {
      const input = {
        scaffold_template: "invalid_template",
        otherField: "value",
      };
      const result = normalizeStarterMetadata(input);
      expect(result.starter_id).toBeUndefined();
      expect(result.otherField).toBe("value");
    });

    it("handles non-string template values", () => {
      const input = {
        starter_id: 123,
      };
      const result = normalizeStarterMetadata(input);
      expect(result.starter_id).toBe(123);
      expect(result.creation_mode).toBeUndefined();
    });

    it("preserves all other metadata fields", () => {
      const input = {
        starter_id: "neutral_baseline",
        projectName: "My Project",
        version: "1.0.0",
        customData: {
          nested: "value",
        },
      };
      const result = normalizeStarterMetadata(input);
      expect(result.projectName).toBe("My Project");
      expect(result.version).toBe("1.0.0");
      expect(result.customData).toEqual({ nested: "value" });
    });

    it("handles complex metadata objects", () => {
      const input = {
        scaffold_template: "typescript_vite_react",
        projectConfig: {
          features: ["auth", "api"],
          environment: "production",
        },
        createdAt: "2025-01-01T00:00:00Z",
      };
      const result = normalizeStarterMetadata(input);
      expect(result.starter_id).toBe("typescript_vite_react");
      expect(result.creation_mode).toBe("starter");
      expect(result.projectConfig).toEqual({
        features: ["auth", "api"],
        environment: "production",
      });
      expect(result.createdAt).toBe("2025-01-01T00:00:00Z");
    });

    it("returns new object and does not mutate input", () => {
      const input = {
        starter_id: "neutral_baseline",
        original: "value",
      };
      const result = normalizeStarterMetadata(input);
      result.modified = "new_value";
      expect(input.modified).toBeUndefined();
      expect(result.modified).toBe("new_value");
    });
  });

  describe("getProjectStarterCatalog", () => {
    it("returns the PROJECT_STARTERS array", () => {
      const catalog = getProjectStarterCatalog();
      expect(catalog).toBe(PROJECT_STARTERS);
    });

    it("returns an array with at least two items", () => {
      const catalog = getProjectStarterCatalog();
      expect(Array.isArray(catalog)).toBe(true);
      expect(catalog.length).toBeGreaterThanOrEqual(2);
    });

    it("returns starters with correct structure", () => {
      const catalog = getProjectStarterCatalog();
      for (const starter of catalog) {
        expect(starter).toHaveProperty("id");
        expect(starter).toHaveProperty("label");
        expect(starter).toHaveProperty("description");
        expect(starter).toHaveProperty("kind");
        expect(starter).toHaveProperty("recommended");
        expect(starter).toHaveProperty("verificationMode");
      }
    });

    it("returns catalog containing default starters", () => {
      const catalog = getProjectStarterCatalog();
      const neutralExists = catalog.some((s) => s.id === DEFAULT_EMPTY_FOLDER_STARTER_ID);
      const stackExists = catalog.some((s) => s.id === DEFAULT_STACK_STARTER_ID);
      expect(neutralExists).toBe(true);
      expect(stackExists).toBe(true);
    });

    it("returns same reference on multiple calls", () => {
      const catalog1 = getProjectStarterCatalog();
      const catalog2 = getProjectStarterCatalog();
      expect(catalog1).toBe(catalog2);
    });
  });

  describe("catalog consistency", () => {
    it("neutral_baseline has correct configuration", () => {
      const neutral = PROJECT_STARTERS.find((s) => s.id === "neutral_baseline");
      expect(neutral?.kind).toBe("generic");
      expect(neutral?.verificationMode).toBe("none");
      expect(neutral?.recommended).toBe(true);
    });

    it("typescript_vite_react has correct configuration", () => {
      const tsStarter = PROJECT_STARTERS.find((s) => s.id === "typescript_vite_react");
      expect(tsStarter?.kind).toBe("stack");
      expect(tsStarter?.verificationMode).toBe("commands");
      expect(tsStarter?.recommended).toBe(false);
    });

    it("all generic starters have verificationMode none", () => {
      const genericStarters = PROJECT_STARTERS.filter((s) => s.kind === "generic");
      for (const starter of genericStarters) {
        expect(starter.verificationMode).toBe("none");
      }
    });

    it("all stack starters have verificationMode commands", () => {
      const stackStarters = PROJECT_STARTERS.filter((s) => s.kind === "stack");
      for (const starter of stackStarters) {
        expect(starter.verificationMode).toBe("commands");
      }
    });

    it("exactly one starter is recommended", () => {
      const recommendedStarters = PROJECT_STARTERS.filter((s) => s.recommended);
      expect(recommendedStarters.length).toBe(1);
      expect(recommendedStarters[0].id).toBe("neutral_baseline");
    });
  });
});
