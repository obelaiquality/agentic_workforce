import { describe, it, expect } from "vitest";
import {
  buildBaseReminder,
  buildErrorReminder,
  buildEditReminder,
  buildJsonFormatReminder,
  shouldInjectReminder,
  injectReminders,
  BlueprintPolicies,
} from "./systemReminderService";

describe("systemReminderService", () => {
  describe("buildBaseReminder", () => {
    it("returns base reminder with no policies", () => {
      const result = buildBaseReminder();
      expect(result).toBe(
        "[System Reminder] Follow the established edit format strictly. Verify changes compile before completing."
      );
    });

    it("includes all policy clauses when full policies provided", () => {
      const policies: BlueprintPolicies = {
        testingRequired: true,
        docsRequired: true,
        protectedPaths: ["src/core", "config/prod.json"],
        approvalRequired: ["deploy"],
        maxChangedFiles: 5,
      };
      const result = buildBaseReminder(policies);
      expect(result).toContain("Follow the established edit format strictly.");
      expect(result).toContain("Tests are REQUIRED for behavior changes.");
      expect(result).toContain("Update documentation when user-facing behavior changes.");
      expect(result).toContain("Protected paths (require approval): src/core, config/prod.json");
      expect(result).toContain("Review required if changing more than 5 files.");
    });

    it("truncates when exceeding maxReminderTokens", () => {
      const policies: BlueprintPolicies = {
        testingRequired: true,
        docsRequired: true,
        protectedPaths: ["a/very/long/path/one", "a/very/long/path/two", "a/very/long/path/three"],
        maxChangedFiles: 3,
      };
      // Very low token budget to force truncation
      const result = buildBaseReminder(policies, 20);
      // 20 tokens * 4 = 80 chars max
      expect(result.length).toBeLessThanOrEqual(80);
      expect(result).toMatch(/\.\.\.$/);
    });
  });

  describe("buildErrorReminder", () => {
    it("returns the error reminder text", () => {
      expect(buildErrorReminder()).toBe(
        "[System Reminder] A tool error occurred. Check the error message carefully. If the same approach has failed multiple times, try an alternative strategy."
      );
    });
  });

  describe("buildEditReminder", () => {
    it("returns the edit reminder text", () => {
      expect(buildEditReminder()).toBe(
        "[System Reminder] After editing files, verify the changes are correct. Run tests if available. Ensure the edit doesn't break existing functionality."
      );
    });
  });

  describe("buildJsonFormatReminder", () => {
    it("returns the JSON format reminder text", () => {
      expect(buildJsonFormatReminder()).toBe(
        "[System Reminder] The next response MUST be valid JSON. Do not include commentary, markdown, or explanation outside the JSON object."
      );
    });
  });

  describe("shouldInjectReminder", () => {
    it("returns true at correct intervals (default 10)", () => {
      expect(shouldInjectReminder(10)).toBe(true);
      expect(shouldInjectReminder(20)).toBe(true);
      expect(shouldInjectReminder(30)).toBe(true);
    });

    it("returns false at non-interval counts", () => {
      expect(shouldInjectReminder(0)).toBe(false);
      expect(shouldInjectReminder(1)).toBe(false);
      expect(shouldInjectReminder(7)).toBe(false);
      expect(shouldInjectReminder(15)).toBe(false);
    });

    it("respects custom intervalMessages config", () => {
      expect(shouldInjectReminder(5, { intervalMessages: 5 })).toBe(true);
      expect(shouldInjectReminder(3, { intervalMessages: 5 })).toBe(false);
    });
  });

  describe("injectReminders", () => {
    const baseMessages = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ];

    it("appends interval reminder using buildBaseReminder", () => {
      const result = injectReminders({ messages: baseMessages, trigger: "interval" });
      expect(result).toHaveLength(3);
      expect(result[2].role).toBe("user");
      expect(result[2].content).toContain("[System Reminder] Follow the established edit format strictly.");
    });

    it("appends error reminder for error trigger", () => {
      const result = injectReminders({ messages: baseMessages, trigger: "error" });
      expect(result).toHaveLength(3);
      expect(result[2].content).toBe(buildErrorReminder());
    });

    it("appends edit reminder for edit trigger", () => {
      const result = injectReminders({ messages: baseMessages, trigger: "edit" });
      expect(result).toHaveLength(3);
      expect(result[2].content).toBe(buildEditReminder());
    });

    it("appends json_format reminder for json_format trigger", () => {
      const result = injectReminders({ messages: baseMessages, trigger: "json_format" });
      expect(result).toHaveLength(3);
      expect(result[2].content).toBe(buildJsonFormatReminder());
    });

    it("does not mutate the input messages array", () => {
      const original = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
      ];
      const originalLength = original.length;
      const result = injectReminders({ messages: original, trigger: "error" });
      expect(original).toHaveLength(originalLength);
      expect(result).not.toBe(original);
      expect(result).toHaveLength(originalLength + 1);
    });

    it("includes policy info in interval reminder when policies provided", () => {
      const policies: BlueprintPolicies = { testingRequired: true };
      const result = injectReminders({ messages: baseMessages, trigger: "interval", policies });
      expect(result[2].content).toContain("Tests are REQUIRED for behavior changes.");
    });
  });
});
