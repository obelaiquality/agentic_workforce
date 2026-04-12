import { describe, it, expect, beforeEach } from "vitest";
import {
  loadAgentRoles,
  getAgentRole,
  listAgentRoles,
  _resetRoleCache,
} from "./index";
import type { AgentRoleDefinition } from "./index";

// ---------------------------------------------------------------------------
// Expected role IDs — all 20 roles
// ---------------------------------------------------------------------------

const EXPECTED_ROLE_IDS = [
  // Development (6)
  "executor",
  "frontend-developer",
  "backend-developer",
  "test-engineer",
  "debugger",
  "refactorer",
  // Review (4)
  "code-reviewer",
  "security-reviewer",
  "performance-reviewer",
  "api-reviewer",
  // Architecture (4)
  "architect",
  "information-architect",
  "api-designer",
  "documentation-writer",
  // Operations (3)
  "devops-engineer",
  "dependency-expert",
  "git-master",
  // Strategy (3)
  "product-manager",
  "quality-strategist",
  "tech-lead",
];

const VALID_CATEGORIES = [
  "development",
  "review",
  "architecture",
  "operations",
  "strategy",
];

const VALID_MODEL_ROLES = [
  "utility_fast",
  "coder_default",
  "review_deep",
  "overseer_escalation",
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Agent Role Catalog", () => {
  beforeEach(() => {
    _resetRoleCache();
  });

  describe("loadAgentRoles", () => {
    it("loads all 20 role definitions", () => {
      const roles = loadAgentRoles();
      expect(roles.size).toBe(20);
    });

    it("returns the same cached instance on subsequent calls", () => {
      const first = loadAgentRoles();
      const second = loadAgentRoles();
      expect(first).toBe(second);
    });

    it("contains every expected role ID", () => {
      const roles = loadAgentRoles();
      for (const id of EXPECTED_ROLE_IDS) {
        expect(roles.has(id), `Missing role: ${id}`).toBe(true);
      }
    });
  });

  describe("getAgentRole", () => {
    it("returns the correct role for a valid ID", () => {
      const role = getAgentRole("executor");
      expect(role).not.toBeNull();
      expect(role!.id).toBe("executor");
      expect(role!.name).toBe("Executor");
    });

    it("returns null for an unknown ID", () => {
      const role = getAgentRole("nonexistent-role-xyz");
      expect(role).toBeNull();
    });

    it("returns null for an empty string", () => {
      const role = getAgentRole("");
      expect(role).toBeNull();
    });
  });

  describe("listAgentRoles", () => {
    it("returns all 20 roles", () => {
      const roles = listAgentRoles();
      expect(roles.length).toBe(20);
    });

    it("returns roles sorted by category then name", () => {
      const roles = listAgentRoles();
      const categoryOrder: Record<string, number> = {
        development: 0,
        review: 1,
        architecture: 2,
        operations: 3,
        strategy: 4,
      };

      for (let i = 1; i < roles.length; i++) {
        const prevCat = categoryOrder[roles[i - 1].category] ?? 99;
        const currCat = categoryOrder[roles[i].category] ?? 99;
        if (prevCat === currCat) {
          expect(
            roles[i - 1].name.localeCompare(roles[i].name) <= 0,
            `Expected "${roles[i - 1].name}" to come before "${roles[i].name}" alphabetically`
          ).toBe(true);
        } else {
          expect(prevCat).toBeLessThan(currCat);
        }
      }
    });

    it("returns AgentRoleDefinition objects (not raw JSON)", () => {
      const roles = listAgentRoles();
      for (const role of roles) {
        expect(typeof role.id).toBe("string");
        expect(typeof role.name).toBe("string");
      }
    });
  });

  describe("individual role validation", () => {
    for (const roleId of EXPECTED_ROLE_IDS) {
      describe(`role: ${roleId}`, () => {
        let role: AgentRoleDefinition;

        beforeEach(() => {
          _resetRoleCache();
          const loaded = getAgentRole(roleId);
          expect(loaded, `Role "${roleId}" should exist`).not.toBeNull();
          role = loaded!;
        });

        it("has a valid id matching the expected ID", () => {
          expect(role.id).toBe(roleId);
        });

        it("has a non-empty name", () => {
          expect(typeof role.name).toBe("string");
          expect(role.name.length).toBeGreaterThan(0);
        });

        it("has a non-empty description", () => {
          expect(typeof role.description).toBe("string");
          expect(role.description.length).toBeGreaterThan(0);
        });

        it("has a valid category", () => {
          expect(VALID_CATEGORIES).toContain(role.category);
        });

        it("has a substantial systemPrompt (at least 200 characters)", () => {
          expect(typeof role.systemPrompt).toBe("string");
          expect(role.systemPrompt.length).toBeGreaterThan(200);
        });

        it("has systemPrompt with multiple paragraphs", () => {
          const paragraphs = role.systemPrompt
            .split("\n\n")
            .filter((p) => p.trim().length > 0);
          expect(
            paragraphs.length,
            `systemPrompt should have 3+ paragraphs, found ${paragraphs.length}`
          ).toBeGreaterThanOrEqual(3);
        });

        it("has allowedTools as array of strings or null", () => {
          if (role.allowedTools !== null) {
            expect(Array.isArray(role.allowedTools)).toBe(true);
            for (const tool of role.allowedTools) {
              expect(typeof tool).toBe("string");
            }
          }
        });

        it("has a valid preferredModelRole", () => {
          expect(VALID_MODEL_ROLES).toContain(role.preferredModelRole);
        });

        it("has non-empty verificationRequirements array", () => {
          expect(Array.isArray(role.verificationRequirements)).toBe(true);
          expect(role.verificationRequirements.length).toBeGreaterThan(0);
          for (const req of role.verificationRequirements) {
            expect(typeof req).toBe("string");
            expect(req.length).toBeGreaterThan(0);
          }
        });

        it("has non-empty escalationTriggers array", () => {
          expect(Array.isArray(role.escalationTriggers)).toBe(true);
          expect(role.escalationTriggers.length).toBeGreaterThan(0);
          for (const trigger of role.escalationTriggers) {
            expect(typeof trigger).toBe("string");
            expect(trigger.length).toBeGreaterThan(0);
          }
        });
      });
    }
  });

  describe("category distribution", () => {
    it("has 6 development roles", () => {
      const roles = listAgentRoles().filter((r) => r.category === "development");
      expect(roles.length).toBe(6);
    });

    it("has 4 review roles", () => {
      const roles = listAgentRoles().filter((r) => r.category === "review");
      expect(roles.length).toBe(4);
    });

    it("has 4 architecture roles", () => {
      const roles = listAgentRoles().filter((r) => r.category === "architecture");
      expect(roles.length).toBe(4);
    });

    it("has 3 operations roles", () => {
      const roles = listAgentRoles().filter((r) => r.category === "operations");
      expect(roles.length).toBe(3);
    });

    it("has 3 strategy roles", () => {
      const roles = listAgentRoles().filter((r) => r.category === "strategy");
      expect(roles.length).toBe(3);
    });
  });
});
