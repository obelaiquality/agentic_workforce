import { describe, it, expect } from "vitest";
import * as PermExports from "./index";

describe("permissions barrel exports", () => {
  it("exports PermissionPolicyEngine", () => {
    expect(PermExports.PermissionPolicyEngine).toBeDefined();
    expect(typeof PermExports.PermissionPolicyEngine).toBe("function");
  });

  it("exports SafetyClassifier", () => {
    expect(PermExports.SafetyClassifier).toBeDefined();
    expect(typeof PermExports.SafetyClassifier).toBe("function");
  });

  it("exports DEFAULT_POLICIES", () => {
    expect(PermExports.DEFAULT_POLICIES).toBeDefined();
    expect(Array.isArray(PermExports.DEFAULT_POLICIES)).toBe(true);
  });

  it("exports autoApproveReadOnly", () => {
    expect(PermExports.autoApproveReadOnly).toBeDefined();
    expect(typeof PermExports.autoApproveReadOnly).toBe("object");
  });

  it("exports requireApprovalForDestructive", () => {
    expect(PermExports.requireApprovalForDestructive).toBeDefined();
    expect(typeof PermExports.requireApprovalForDestructive).toBe("object");
  });

  it("exports denyDangerousCommands", () => {
    expect(PermExports.denyDangerousCommands).toBeDefined();
    expect(typeof PermExports.denyDangerousCommands).toBe("object");
  });

  it("exports requireApprovalForInstall", () => {
    expect(PermExports.requireApprovalForInstall).toBeDefined();
    expect(typeof PermExports.requireApprovalForInstall).toBe("object");
  });

  it("exports requireApprovalForNetwork", () => {
    expect(PermExports.requireApprovalForNetwork).toBeDefined();
    expect(typeof PermExports.requireApprovalForNetwork).toBe("object");
  });

  it("exports autoApproveInTestMode", () => {
    expect(PermExports.autoApproveInTestMode).toBeDefined();
    expect(typeof PermExports.autoApproveInTestMode).toBe("object");
  });

  it("exports autoApproveGitReadOnly", () => {
    expect(PermExports.autoApproveGitReadOnly).toBeDefined();
    expect(typeof PermExports.autoApproveGitReadOnly).toBe("object");
  });
});
