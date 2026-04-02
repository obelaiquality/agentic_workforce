import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  autoApproveReadOnly,
  denyDangerousCommands,
  requireApprovalForInstall,
  requireApprovalForNetwork,
  autoApproveInTestMode,
  autoApproveGitReadOnly,
  requireApprovalForDestructive,
  DEFAULT_POLICIES,
} from "./defaultPolicies";
import type { ToolPermission } from "../tools/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTool(name: string, perm: Partial<ToolPermission> = {}) {
  return {
    name,
    permission: {
      scope: perm.scope ?? ("repo.read" as const),
      readOnly: perm.readOnly,
      destructive: perm.destructive,
      requiresApproval: perm.requiresApproval,
    } as ToolPermission,
  };
}

const dummyCtx = {} as any;

// ---------------------------------------------------------------------------
// autoApproveReadOnly
// ---------------------------------------------------------------------------

describe("autoApproveReadOnly", () => {
  it("matches tools with readOnly=true", () => {
    expect(autoApproveReadOnly.matches(makeTool("read_file", { readOnly: true }), undefined)).toBe(true);
  });

  it("does not match tools without readOnly", () => {
    expect(autoApproveReadOnly.matches(makeTool("write_file"), undefined)).toBe(false);
  });

  it("evaluates to allow", () => {
    const result = autoApproveReadOnly.evaluate(makeTool("read_file", { readOnly: true }), undefined, dummyCtx);
    expect(result.decision).toBe("allow");
    expect(result.requiresApproval).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// denyDangerousCommands
// ---------------------------------------------------------------------------

describe("denyDangerousCommands", () => {
  const bashTool = makeTool("bash", { scope: "repo.edit" });

  it.each([
    ["rm -rf /", "rm -rf /"],
    ["rm -rf ~", "rm -rf ~"],
    ["rm -rf ..", "rm -rf .."],
    ["DROP TABLE users;", "DROP TABLE users;"],
    ["DROP DATABASE prod;", "DROP DATABASE prod;"],
    ["DELETE FROM users ;", "DELETE FROM users ;"],
    ["TRUNCATE TABLE users", "TRUNCATE TABLE users"],
    ["git push --force origin main", "git push --force origin main"],
    ["git push -f main", "git push -f main"],
    ["sudo rm -rf /var", "sudo rm -rf /var"],
    ["dd if=/dev/zero of=/dev/sda", "dd if=/dev/zero of=/dev/sda"],
    ["mkfs.ext4 /dev/sda1", "mkfs.ext4 /dev/sda1"],
  ])("matches dangerous command: %s", (_label, cmd) => {
    expect(denyDangerousCommands.matches(bashTool, { command: cmd })).toBe(true);
  });

  it.each([
    ["ls -la", "ls -la"],
    ["git push origin feature", "git push origin feature"],
    ["npm test", "npm test"],
    ["echo hello", "echo hello"],
    ["rm temp.txt", "rm temp.txt"],
  ])("does not match safe command: %s", (_label, cmd) => {
    expect(denyDangerousCommands.matches(bashTool, { command: cmd })).toBe(false);
  });

  it("does not match non-bash tools", () => {
    const readTool = makeTool("read_file", { scope: "repo.read" });
    expect(denyDangerousCommands.matches(readTool, { command: "rm -rf /" })).toBe(false);
  });

  it("evaluates to deny", () => {
    const result = denyDangerousCommands.evaluate(bashTool, { command: "rm -rf /" }, dummyCtx);
    expect(result.decision).toBe("deny");
    expect(result.reasons.some((r) => r.includes("dangerous"))).toBe(true);
  });

  it("handles string input directly", () => {
    expect(denyDangerousCommands.matches(bashTool, "rm -rf /")).toBe(true);
  });

  it("handles missing command gracefully", () => {
    expect(denyDangerousCommands.matches(bashTool, {})).toBe(false);
    expect(denyDangerousCommands.matches(bashTool, null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// requireApprovalForInstall
// ---------------------------------------------------------------------------

describe("requireApprovalForInstall", () => {
  const bashTool = makeTool("bash");

  it.each([
    "npm install express",
    "npm i lodash",
    "yarn add react",
    "pip install flask",
    "cargo install ripgrep",
    "go get github.com/foo/bar",
  ])("matches install command: %s", (cmd) => {
    expect(requireApprovalForInstall.matches(bashTool, { command: cmd })).toBe(true);
  });

  it("matches tools with repo.install scope", () => {
    const installTool = makeTool("install_pkg", { scope: "repo.install" });
    expect(requireApprovalForInstall.matches(installTool, undefined)).toBe(true);
  });

  it("does not match non-install commands", () => {
    expect(requireApprovalForInstall.matches(bashTool, { command: "npm test" })).toBe(false);
  });

  it("evaluates to approval_required", () => {
    const result = requireApprovalForInstall.evaluate(bashTool, { command: "npm install foo" }, dummyCtx);
    expect(result.decision).toBe("approval_required");
    expect(result.requiresApproval).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// requireApprovalForNetwork
// ---------------------------------------------------------------------------

describe("requireApprovalForNetwork", () => {
  const bashTool = makeTool("bash");

  it.each([
    "curl https://example.com",
    "wget http://example.com/file.tar.gz",
    "ssh user@host",
    "scp file.txt user@host:/tmp",
    "nc localhost 8080",
    "telnet example.com 80",
    "ftp ftp.example.com",
  ])("matches network command: %s", (cmd) => {
    expect(requireApprovalForNetwork.matches(bashTool, { command: cmd })).toBe(true);
  });

  it("matches tools with network scope", () => {
    const netTool = makeTool("fetch_url", { scope: "network" });
    expect(requireApprovalForNetwork.matches(netTool, undefined)).toBe(true);
  });

  it("does not match non-network commands", () => {
    expect(requireApprovalForNetwork.matches(bashTool, { command: "echo hello" })).toBe(false);
  });

  it("evaluates to approval_required", () => {
    const result = requireApprovalForNetwork.evaluate(bashTool, { command: "curl http://example.com" }, dummyCtx);
    expect(result.decision).toBe("approval_required");
    expect(result.requiresApproval).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// autoApproveInTestMode
// ---------------------------------------------------------------------------

describe("autoApproveInTestMode", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("matches when NODE_ENV=test", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(autoApproveInTestMode.matches(makeTool("bash"), undefined)).toBe(true);
  });

  it("matches when VITEST=true", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VITEST", "true");
    expect(autoApproveInTestMode.matches(makeTool("bash"), undefined)).toBe(true);
  });

  it("does not match in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VITEST", "");
    expect(autoApproveInTestMode.matches(makeTool("bash"), undefined)).toBe(false);
  });

  it("evaluates to allow", () => {
    const result = autoApproveInTestMode.evaluate(makeTool("bash"), undefined, dummyCtx);
    expect(result.decision).toBe("allow");
    expect(result.requiresApproval).toBe(false);
    expect(result.reasons[0]).toMatch(/test mode/i);
  });
});

// ---------------------------------------------------------------------------
// autoApproveGitReadOnly
// ---------------------------------------------------------------------------

describe("autoApproveGitReadOnly", () => {
  const bashTool = makeTool("bash");

  it.each([
    "git status",
    "git diff",
    "git log",
    "git branch",
    "git show HEAD",
    "git rev-parse HEAD",
    "git ls-files",
    "git remote -v",
  ])("matches git read-only command: %s", (cmd) => {
    expect(autoApproveGitReadOnly.matches(bashTool, { command: cmd })).toBe(true);
  });

  it("matches tools with git.meta scope", () => {
    const gitTool = makeTool("git_status", { scope: "git.meta" });
    expect(autoApproveGitReadOnly.matches(gitTool, undefined)).toBe(true);
  });

  it.each([
    "git push origin main",
    "git commit -m 'msg'",
    "git reset --hard",
    "git checkout -b new-branch",
  ])("does not match git write command: %s", (cmd) => {
    expect(autoApproveGitReadOnly.matches(bashTool, { command: cmd })).toBe(false);
  });

  it("evaluates to allow", () => {
    const result = autoApproveGitReadOnly.evaluate(makeTool("bash"), { command: "git status" }, dummyCtx);
    expect(result.decision).toBe("allow");
    expect(result.requiresApproval).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// requireApprovalForDestructive
// ---------------------------------------------------------------------------

describe("requireApprovalForDestructive", () => {
  it("matches destructive tools", () => {
    expect(requireApprovalForDestructive.matches(makeTool("delete_file", { destructive: true }), undefined)).toBe(true);
  });

  it("does not match non-destructive tools", () => {
    expect(requireApprovalForDestructive.matches(makeTool("read_file"), undefined)).toBe(false);
  });

  it("evaluates to approval_required", () => {
    const result = requireApprovalForDestructive.evaluate(
      makeTool("delete_file", { destructive: true }),
      undefined,
      dummyCtx,
    );
    expect(result.decision).toBe("approval_required");
    expect(result.requiresApproval).toBe(true);
    expect(result.reasons[0]).toContain("destructive");
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_POLICIES
// ---------------------------------------------------------------------------

describe("DEFAULT_POLICIES", () => {
  it("contains exactly 7 policies", () => {
    expect(DEFAULT_POLICIES).toHaveLength(7);
  });

  it("is ordered by priority (ascending)", () => {
    for (let i = 1; i < DEFAULT_POLICIES.length; i++) {
      expect(DEFAULT_POLICIES[i].priority).toBeGreaterThanOrEqual(DEFAULT_POLICIES[i - 1].priority);
    }
  });

  it("has autoApproveInTestMode first (priority 0)", () => {
    expect(DEFAULT_POLICIES[0].name).toBe("autoApproveInTestMode");
  });

  it("has denyDangerousCommands second (priority 1)", () => {
    expect(DEFAULT_POLICIES[1].name).toBe("denyDangerousCommands");
  });

  it("has all expected policy names", () => {
    const names = DEFAULT_POLICIES.map((p) => p.name);
    expect(names).toContain("autoApproveReadOnly");
    expect(names).toContain("denyDangerousCommands");
    expect(names).toContain("requireApprovalForInstall");
    expect(names).toContain("requireApprovalForNetwork");
    expect(names).toContain("autoApproveInTestMode");
    expect(names).toContain("autoApproveGitReadOnly");
    expect(names).toContain("requireApprovalForDestructive");
  });
});
