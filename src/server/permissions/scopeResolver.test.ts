import { describe, it, expect } from "vitest";
import { ScopeResolver } from "./scopeResolver";
import type { PermissionRuleSource } from "./scopeResolver";
import type { PermissionPolicy, PermissionCheckResult } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePolicy(name: string, priority: number, decision: PermissionCheckResult["decision"] = "allow"): PermissionPolicy {
  return {
    name,
    priority,
    matches: () => true,
    evaluate: () => ({
      decision,
      requiresApproval: decision === "approval_required",
      reasons: [`Policy ${name}`],
      source: "policy",
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ScopeResolver", () => {
  const resolver = new ScopeResolver();

  describe("resolve", () => {
    it("returns empty array when no sources provided", () => {
      expect(resolver.resolve([])).toEqual([]);
    });

    it("returns rules from a single scope unchanged", () => {
      const policy = makePolicy("policyA", 10);
      const sources: PermissionRuleSource[] = [
        { scope: "user", rules: [policy] },
      ];

      const result = resolver.resolve(sources);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("policyA");
    });

    it("merges rules from multiple scopes", () => {
      const sources: PermissionRuleSource[] = [
        { scope: "user", rules: [makePolicy("a", 10)] },
        { scope: "project", rules: [makePolicy("b", 20)] },
      ];

      const result = resolver.resolve(sources);
      expect(result).toHaveLength(2);
      expect(result.map((r) => r.name)).toEqual(["a", "b"]);
    });

    it("session scope overrides project scope for same-named policy", () => {
      const projectPolicy = makePolicy("shared", 10, "allow");
      const sessionPolicy = makePolicy("shared", 10, "deny");

      const sources: PermissionRuleSource[] = [
        { scope: "project", rules: [projectPolicy] },
        { scope: "session", rules: [sessionPolicy] },
      ];

      const result = resolver.resolve(sources);
      expect(result).toHaveLength(1);
      // Session should win — evaluate should return "deny"
      const evaluated = result[0].evaluate(
        { name: "test", permission: { scope: "repo.read" } },
        undefined,
        {} as any,
      );
      expect(evaluated.decision).toBe("deny");
    });

    it("project scope overrides user scope for same-named policy", () => {
      const userPolicy = makePolicy("shared", 5, "allow");
      const projectPolicy = makePolicy("shared", 5, "approval_required");

      const sources: PermissionRuleSource[] = [
        { scope: "user", rules: [userPolicy] },
        { scope: "project", rules: [projectPolicy] },
      ];

      const result = resolver.resolve(sources);
      expect(result).toHaveLength(1);
      const evaluated = result[0].evaluate(
        { name: "test", permission: { scope: "repo.read" } },
        undefined,
        {} as any,
      );
      expect(evaluated.decision).toBe("approval_required");
    });

    it("session scope overrides user scope for same-named policy", () => {
      const userPolicy = makePolicy("shared", 5, "allow");
      const sessionPolicy = makePolicy("shared", 5, "deny");

      const sources: PermissionRuleSource[] = [
        { scope: "user", rules: [userPolicy] },
        { scope: "session", rules: [sessionPolicy] },
      ];

      const result = resolver.resolve(sources);
      expect(result).toHaveLength(1);
      const evaluated = result[0].evaluate(
        { name: "test", permission: { scope: "repo.read" } },
        undefined,
        {} as any,
      );
      expect(evaluated.decision).toBe("deny");
    });

    it("returns merged policies sorted by policy priority", () => {
      const sources: PermissionRuleSource[] = [
        { scope: "user", rules: [makePolicy("low", 100), makePolicy("high", 1)] },
        { scope: "project", rules: [makePolicy("mid", 50)] },
      ];

      const result = resolver.resolve(sources);
      expect(result.map((r) => r.name)).toEqual(["high", "mid", "low"]);
    });

    it("handles multiple overrides across three scopes", () => {
      const sources: PermissionRuleSource[] = [
        { scope: "user", rules: [makePolicy("a", 10, "allow"), makePolicy("b", 20, "allow")] },
        { scope: "project", rules: [makePolicy("a", 10, "approval_required")] },
        { scope: "session", rules: [makePolicy("a", 10, "deny")] },
      ];

      const result = resolver.resolve(sources);
      expect(result).toHaveLength(2);

      // "a" should be session's version (deny)
      const policyA = result.find((r) => r.name === "a")!;
      expect(policyA.evaluate({ name: "test", permission: { scope: "repo.read" } }, undefined, {} as any).decision).toBe("deny");

      // "b" should remain from user scope (allow)
      const policyB = result.find((r) => r.name === "b")!;
      expect(policyB.evaluate({ name: "test", permission: { scope: "repo.read" } }, undefined, {} as any).decision).toBe("allow");
    });

    it("handles sources provided in any order", () => {
      // Provide session first, user last — should still resolve correctly
      const sources: PermissionRuleSource[] = [
        { scope: "session", rules: [makePolicy("x", 5, "deny")] },
        { scope: "user", rules: [makePolicy("x", 5, "allow")] },
      ];

      const result = resolver.resolve(sources);
      expect(result).toHaveLength(1);
      expect(result[0].evaluate({ name: "test", permission: { scope: "repo.read" } }, undefined, {} as any).decision).toBe("deny");
    });
  });

  describe("loadUserRules", () => {
    it("returns empty array (stub)", () => {
      expect(resolver.loadUserRules()).toEqual([]);
    });
  });

  describe("loadProjectRules", () => {
    it("returns empty array (stub)", () => {
      expect(resolver.loadProjectRules()).toEqual([]);
    });
  });
});
