import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────────
vi.mock("node:child_process", () => ({
  spawnSync: vi.fn().mockReturnValue({
    status: 0,
    stdout: "ok\n",
    stderr: "",
    error: null,
  }),
}));

vi.mock("../db", () => ({
  prisma: {
    approvalRequest: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation((opts: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: "approval-1",
          actionType: opts.data.actionType,
          payload: opts.data.payload,
          requestedAt: new Date("2025-01-01T00:00:00Z"),
          status: "pending",
        })
      ),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    runProjection: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    benchmarkOutcomeEvidence: {
      create: vi.fn().mockImplementation(() =>
        Promise.resolve({
          id: "evidence-1",
          runId: "run-1",
          kind: "tool_invocation",
          createdAt: new Date("2025-01-01T00:00:00Z"),
          payload: {},
        })
      ),
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

vi.mock("../eventBus", () => ({
  publishEvent: vi.fn(),
}));

vi.mock("./shellDetect", () => ({
  detectShell: () => "/bin/bash",
}));

vi.mock("./sensitiveRedaction", () => ({
  redactSensitiveText: vi.fn((v: string) => v),
  redactStringArray: vi.fn((v: string[]) => v),
}));

import { spawnSync } from "node:child_process";
import { prisma } from "../db";
import { publishEvent } from "../eventBus";
import { buildCommandPlan, isCommandAllowedForToolType, normalizeCommandInput, tokenizeCommand } from "./commandEngine";
import { CommandEngine } from "./commandEngine";
import { TicketService } from "./ticketService";

const mockPrisma = vi.mocked(prisma);
const mockSpawnSync = vi.mocked(spawnSync);
const mockPublishEvent = vi.mocked(publishEvent);

// ── Helpers ────────────────────────────────────────────────────────────────────
function stubTicketService(overrides: {
  getTicket?: () => Promise<unknown>;
  getTicketExecutionPolicy?: () => Promise<unknown>;
} = {}) {
  return {
    getTicket: overrides.getTicket ?? vi.fn().mockResolvedValue({ id: "ticket-1", repoId: "repo-1" }),
    getTicketExecutionPolicy: overrides.getTicketExecutionPolicy ?? vi.fn().mockResolvedValue({
      ticketId: "ticket-1",
      mode: "balanced",
      allowInstallCommands: true,
      allowNetworkCommands: true,
      requireApprovalFor: [],
      updatedAt: new Date(0).toISOString(),
      updatedBy: "system",
    }),
  } as unknown as TicketService;
}

describe("tokenizeCommand", () => {
  it("splits simple command strings", () => {
    expect(tokenizeCommand("npm run build")).toEqual(["npm", "run", "build"]);
  });

  it("preserves quoted arguments", () => {
    expect(tokenizeCommand('node -e "console.log(123)"')).toEqual(["node", "-e", "console.log(123)"]);
  });

  it("handles single quotes", () => {
    expect(tokenizeCommand("echo 'hello world'")).toEqual(["echo", "hello world"]);
  });

  it("handles escaped characters", () => {
    expect(tokenizeCommand('echo "hello\\"world"')).toEqual(["echo", 'hello"world']);
  });

  it("throws on unterminated quotes", () => {
    expect(() => tokenizeCommand('echo "hello')).toThrow("unterminated escape or quote");
  });

  it("throws on unterminated escape", () => {
    expect(() => tokenizeCommand("echo hello\\")).toThrow("unterminated escape or quote");
  });

  it("handles multiple spaces between tokens", () => {
    expect(tokenizeCommand("npm    run     build")).toEqual(["npm", "run", "build"]);
  });

  it("handles empty string", () => {
    expect(tokenizeCommand("")).toEqual([]);
  });

  it("handles mixed quotes", () => {
    expect(tokenizeCommand(`echo 'hello "world"' test`)).toEqual(["echo", 'hello "world"', "test"]);
  });
});

describe("buildCommandPlan", () => {
  it("marks shell metacharacters as shell-approved plans", () => {
    expect(buildCommandPlan("npm test && rm -rf /tmp")).toMatchObject({
      kind: "shell_approved",
      displayCommand: "npm test && rm -rf /tmp",
    });
  });

  it("creates safe plan for npm commands", () => {
    const plan = buildCommandPlan("npm run test");
    expect(plan).toMatchObject({
      kind: "safe",
      binary: "npm",
      args: ["run", "test"],
      spec: {
        kind: "package_manager",
        manager: "npm",
        args: ["run", "test"],
      },
    });
  });

  it("creates safe plan for git readonly commands", () => {
    const plan = buildCommandPlan("git status");
    expect(plan).toMatchObject({
      kind: "safe",
      binary: "git",
      args: ["status"],
      spec: {
        kind: "git_readonly",
        args: ["status"],
      },
    });
  });

  it("creates safe plan for repo inspection commands", () => {
    const plan = buildCommandPlan("rg pattern");
    expect(plan).toMatchObject({
      kind: "safe",
      binary: "rg",
      args: ["pattern"],
      spec: {
        kind: "repo_inspect",
        binary: "rg",
        args: ["pattern"],
      },
    });
  });

  it("creates safe plan for cargo", () => {
    const plan = buildCommandPlan("cargo build");
    expect(plan).toMatchObject({
      kind: "safe",
      binary: "cargo",
      spec: {
        kind: "cargo",
        args: ["build"],
      },
    });
  });

  it("creates safe plan for pytest", () => {
    const plan = buildCommandPlan("pytest test.py");
    expect(plan).toMatchObject({
      kind: "safe",
      binary: "pytest",
      spec: {
        kind: "pytest",
        binary: "pytest",
        args: ["test.py"],
      },
    });
  });

  it("creates safe plan for python -m pytest", () => {
    const plan = buildCommandPlan("python -m pytest test.py");
    expect(plan).toMatchObject({
      kind: "safe",
      binary: "python",
      spec: {
        kind: "pytest",
        binary: "python",
        args: ["-m", "pytest", "test.py"],
      },
    });
  });

  it("handles pipes as shell-approved", () => {
    const plan = buildCommandPlan("cat file.txt | grep pattern");
    expect(plan.kind).toBe("shell_approved");
  });

  it("handles redirects as shell-approved", () => {
    const plan = buildCommandPlan("echo test > output.txt");
    expect(plan.kind).toBe("shell_approved");
  });

  it("handles semicolons as shell-approved", () => {
    const plan = buildCommandPlan("npm install; npm test");
    expect(plan.kind).toBe("shell_approved");
  });

  it("handles backticks as shell-approved", () => {
    const plan = buildCommandPlan("echo `date`");
    expect(plan.kind).toBe("shell_approved");
  });

  it("handles command substitution as shell-approved", () => {
    const plan = buildCommandPlan("echo $(pwd)");
    expect(plan.kind).toBe("shell_approved");
  });

  it("handles complex pipelines", () => {
    const plan = buildCommandPlan("find . -name '*.ts' | xargs wc -l | sort -n");
    expect(plan).toMatchObject({
      kind: "shell_approved",
      shellCommand: "find . -name *.ts | xargs wc -l | sort -n",
    });
  });
});

describe("normalizeCommandInput", () => {
  it("uses explicit args when provided", () => {
    expect(normalizeCommandInput("npm", ["run", "build"])).toEqual({
      binary: "npm",
      args: ["run", "build"],
      displayCommand: "npm run build",
    });
  });

  it("tokenizes command when no args provided", () => {
    expect(normalizeCommandInput("npm run build")).toEqual({
      binary: "npm",
      args: ["run", "build"],
      displayCommand: "npm run build",
    });
  });

  it("throws on empty command", () => {
    expect(() => normalizeCommandInput("")).toThrow("Command is empty");
  });

  it("throws on whitespace-only command", () => {
    expect(() => normalizeCommandInput("   ")).toThrow("Command is empty");
  });

  it("throws on unsafe binary pattern", () => {
    expect(() => normalizeCommandInput("rm;ls")).toThrow("Command binary is not allowed");
  });

  it("throws on newline in args", () => {
    expect(() => normalizeCommandInput("npm", ["run\nbuild"])).toThrow("Command argument is not allowed");
  });

  it("allows safe special characters in binary", () => {
    expect(normalizeCommandInput("/usr/bin/node")).toMatchObject({
      binary: "/usr/bin/node",
    });
  });

  it("handles command with many args", () => {
    const result = normalizeCommandInput("node", ["script.js", "--flag", "value", "--other"]);
    expect(result.args).toEqual(["script.js", "--flag", "value", "--other"]);
  });
});

describe("isCommandAllowedForToolType", () => {
  it("allows read binaries for repo.read", () => {
    expect(isCommandAllowedForToolType("repo.read", "rg")).toBe(true);
    expect(isCommandAllowedForToolType("repo.read", "npm")).toBe(false);
  });

  it("restricts git.meta to git", () => {
    expect(isCommandAllowedForToolType("git.meta", "git")).toBe(true);
    expect(isCommandAllowedForToolType("git.meta", "node")).toBe(false);
  });

  describe("repo.read tool type", () => {
    const toolType = "repo.read";
    it("allows cat", () => {
      expect(isCommandAllowedForToolType(toolType, "cat")).toBe(true);
    });
    it("allows find", () => {
      expect(isCommandAllowedForToolType(toolType, "find")).toBe(true);
    });
    it("allows git", () => {
      expect(isCommandAllowedForToolType(toolType, "git")).toBe(true);
    });
    it("allows grep", () => {
      expect(isCommandAllowedForToolType(toolType, "grep")).toBe(true);
    });
    it("allows ls", () => {
      expect(isCommandAllowedForToolType(toolType, "ls")).toBe(true);
    });
    it("allows rg", () => {
      expect(isCommandAllowedForToolType(toolType, "rg")).toBe(true);
    });
    it("rejects npm", () => {
      expect(isCommandAllowedForToolType(toolType, "npm")).toBe(false);
    });
    it("rejects cargo", () => {
      expect(isCommandAllowedForToolType(toolType, "cargo")).toBe(false);
    });
  });

  describe("repo.edit tool type", () => {
    const toolType = "repo.edit";
    it("allows git", () => {
      expect(isCommandAllowedForToolType(toolType, "git")).toBe(true);
    });
    it("rejects npm", () => {
      expect(isCommandAllowedForToolType(toolType, "npm")).toBe(false);
    });
    it("rejects cat", () => {
      expect(isCommandAllowedForToolType(toolType, "cat")).toBe(false);
    });
  });

  describe("repo.verify tool type", () => {
    const toolType = "repo.verify";
    it("allows npm", () => {
      expect(isCommandAllowedForToolType(toolType, "npm")).toBe(true);
    });
    it("allows pnpm", () => {
      expect(isCommandAllowedForToolType(toolType, "pnpm")).toBe(true);
    });
    it("allows yarn", () => {
      expect(isCommandAllowedForToolType(toolType, "yarn")).toBe(true);
    });
    it("allows bun", () => {
      expect(isCommandAllowedForToolType(toolType, "bun")).toBe(true);
    });
    it("allows cargo", () => {
      expect(isCommandAllowedForToolType(toolType, "cargo")).toBe(true);
    });
    it("allows pytest", () => {
      expect(isCommandAllowedForToolType(toolType, "pytest")).toBe(true);
    });
    it("allows python", () => {
      expect(isCommandAllowedForToolType(toolType, "python")).toBe(true);
    });
    it("allows python3", () => {
      expect(isCommandAllowedForToolType(toolType, "python3")).toBe(true);
    });
    it("allows git", () => {
      expect(isCommandAllowedForToolType(toolType, "git")).toBe(true);
    });
    it("rejects rg", () => {
      expect(isCommandAllowedForToolType(toolType, "rg")).toBe(false);
    });
  });

  describe("repo.install tool type", () => {
    const toolType = "repo.install";
    it("allows npm", () => {
      expect(isCommandAllowedForToolType(toolType, "npm")).toBe(true);
    });
    it("allows pnpm", () => {
      expect(isCommandAllowedForToolType(toolType, "pnpm")).toBe(true);
    });
    it("allows yarn", () => {
      expect(isCommandAllowedForToolType(toolType, "yarn")).toBe(true);
    });
    it("allows bun", () => {
      expect(isCommandAllowedForToolType(toolType, "bun")).toBe(true);
    });
    it("rejects git", () => {
      expect(isCommandAllowedForToolType(toolType, "git")).toBe(false);
    });
    it("rejects cargo", () => {
      expect(isCommandAllowedForToolType(toolType, "cargo")).toBe(false);
    });
  });

  describe("git.meta tool type", () => {
    const toolType = "git.meta";
    it("allows git", () => {
      expect(isCommandAllowedForToolType(toolType, "git")).toBe(true);
    });
    it("rejects all other binaries", () => {
      expect(isCommandAllowedForToolType(toolType, "npm")).toBe(false);
      expect(isCommandAllowedForToolType(toolType, "cat")).toBe(false);
      expect(isCommandAllowedForToolType(toolType, "cargo")).toBe(false);
      expect(isCommandAllowedForToolType(toolType, "rg")).toBe(false);
    });
  });
});

describe("security and injection tests", () => {
  it("rejects command injection attempts via semicolon", () => {
    const plan = buildCommandPlan("npm install; rm -rf /");
    expect(plan.kind).toBe("shell_approved");
  });

  it("rejects command injection via pipe", () => {
    const plan = buildCommandPlan("npm install | evil-script");
    expect(plan.kind).toBe("shell_approved");
  });

  it("rejects command injection via backticks", () => {
    const plan = buildCommandPlan("npm install `malicious`");
    expect(plan.kind).toBe("shell_approved");
  });

  it("rejects command injection via dollar sign", () => {
    const plan = buildCommandPlan("npm install $(malicious)");
    expect(plan.kind).toBe("shell_approved");
  });

  it("rejects command injection via redirect", () => {
    const plan = buildCommandPlan("npm install > /etc/passwd");
    expect(plan.kind).toBe("shell_approved");
  });

  it("handles very long commands", () => {
    const longArg = "a".repeat(10000);
    const result = normalizeCommandInput("npm", ["run", longArg]);
    expect(result.args[1]).toBe(longArg);
  });

  it("handles many arguments", () => {
    const manyArgs = Array(1000).fill("arg");
    const result = normalizeCommandInput("npm", manyArgs);
    expect(result.args.length).toBe(1000);
  });
});

describe("edge cases", () => {
  it("handles empty args array", () => {
    const result = normalizeCommandInput("npm", []);
    expect(result).toEqual({
      binary: "npm",
      args: [],
      displayCommand: "npm",
    });
  });

  it("handles command with only binary", () => {
    const result = normalizeCommandInput("ls");
    expect(result).toEqual({
      binary: "ls",
      args: [],
      displayCommand: "ls",
    });
  });

  it("handles git commands with multiple subcommands", () => {
    const plan = buildCommandPlan("git log --oneline --graph");
    expect(plan).toMatchObject({
      kind: "safe",
      binary: "git",
      spec: {
        kind: "git_readonly",
        args: ["log", "--oneline", "--graph"],
      },
    });
  });

  it("handles non-readonly git commands as shell-approved", () => {
    const plan = buildCommandPlan("git commit -m message");
    expect(plan.kind).toBe("shell_approved");
  });

  it("handles package managers with different subcommands", () => {
    expect(buildCommandPlan("pnpm install").kind).toBe("safe");
    expect(buildCommandPlan("yarn add package").kind).toBe("safe");
    expect(buildCommandPlan("bun run dev").kind).toBe("safe");
  });

  it("preserves displayCommand with original formatting", () => {
    const plan = buildCommandPlan("npm run build");
    expect(plan.displayCommand).toBe("npm run build");
  });

  it("handles cat with multiple files", () => {
    const plan = buildCommandPlan("cat file1.txt file2.txt file3.txt");
    expect(plan).toMatchObject({
      kind: "safe",
      binary: "cat",
      spec: {
        kind: "repo_inspect",
        binary: "cat",
        args: ["file1.txt", "file2.txt", "file3.txt"],
      },
    });
  });

  it("handles find with complex args", () => {
    const plan = buildCommandPlan("find . -name *.ts -type f");
    expect(plan).toMatchObject({
      kind: "safe",
      binary: "find",
      spec: {
        kind: "repo_inspect",
        binary: "find",
      },
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// CommandEngine class tests — cover invoke(), listRunToolEvents(), and internal
// private methods (ensureTicketScope, assertWorktreeAllowed, evaluatePolicy,
// resolveToolType, runCommandPlan, classifyError, etc.)
// ════════════════════════════════════════════════════════════════════════════════

describe("CommandEngine", () => {
  let engine: CommandEngine;

  const baseInput = {
    runId: "run-1",
    ticketId: "ticket-1",
    repoId: "repo-1",
    stage: "build" as const,
    actor: "agent-1",
    worktreePath: "/tmp/work",
    command: "npm run test",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new CommandEngine(stubTicketService());

    // Reset common mocks to sensible defaults
    mockPrisma.runProjection.findUnique.mockResolvedValue(null);
    mockPrisma.approvalRequest.findFirst.mockResolvedValue(null);
    mockPrisma.approvalRequest.findUnique.mockResolvedValue(null);
    mockPrisma.benchmarkOutcomeEvidence.create.mockResolvedValue({
      id: "evidence-1",
      runId: "run-1",
      kind: "tool_invocation",
      createdAt: new Date("2025-01-01T00:00:00Z"),
      payload: {},
    } as any);
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: "ok\n",
      stderr: "",
      error: undefined,
    } as any);
  });

  // ── ensureTicketScope ────────────────────────────────────────────────────────

  describe("ensureTicketScope (via invoke)", () => {
    it("throws when ticket is not found", async () => {
      engine = new CommandEngine(
        stubTicketService({ getTicket: vi.fn().mockResolvedValue(null) })
      );
      await expect(engine.invoke(baseInput)).rejects.toThrow("Ticket not found");
    });

    it("throws when ticket repoId does not match", async () => {
      engine = new CommandEngine(
        stubTicketService({ getTicket: vi.fn().mockResolvedValue({ id: "ticket-1", repoId: "wrong-repo" }) })
      );
      await expect(engine.invoke(baseInput)).rejects.toThrow("does not belong to repo");
    });

    it("allows null repoId on both sides", async () => {
      engine = new CommandEngine(
        stubTicketService({
          getTicket: vi.fn().mockResolvedValue({ id: "ticket-1", repoId: null }),
        })
      );
      const input = { ...baseInput, repoId: "" };
      // Should not throw for ticket scope — may proceed
      const result = await engine.invoke(input);
      expect(result.event).toBeDefined();
    });
  });

  // ── assertWorktreeAllowed ────────────────────────────────────────────────────

  describe("assertWorktreeAllowed (via invoke)", () => {
    it("allows when no worktree_path set in run metadata", async () => {
      mockPrisma.runProjection.findUnique.mockResolvedValue({ metadata: {} } as any);
      const result = await engine.invoke(baseInput);
      expect(result.event).toBeDefined();
    });

    it("allows when worktree path matches exactly", async () => {
      mockPrisma.runProjection.findUnique.mockResolvedValue({
        metadata: { worktree_path: "/tmp/work" },
      } as any);
      const result = await engine.invoke({ ...baseInput, worktreePath: "/tmp/work" });
      expect(result.event).toBeDefined();
    });

    it("allows child paths under the allowed root", async () => {
      mockPrisma.runProjection.findUnique.mockResolvedValue({
        metadata: { worktree_path: "/tmp/work" },
      } as any);
      const result = await engine.invoke({ ...baseInput, worktreePath: "/tmp/work/subdir" });
      expect(result.event).toBeDefined();
    });

    it("rejects worktree that escapes allowed root", async () => {
      mockPrisma.runProjection.findUnique.mockResolvedValue({
        metadata: { worktree_path: "/tmp/work" },
      } as any);
      await expect(
        engine.invoke({ ...baseInput, worktreePath: "/etc/shadow" })
      ).rejects.toThrow("escapes the active worktree root");
    });

    it("falls back to workspace_path when worktree_path is not set", async () => {
      mockPrisma.runProjection.findUnique.mockResolvedValue({
        metadata: { workspace_path: "/tmp/work" },
      } as any);
      // exact match should be fine
      const result = await engine.invoke({ ...baseInput, worktreePath: "/tmp/work" });
      expect(result.event).toBeDefined();
    });

    it("rejects when workspace_path set and worktree escapes", async () => {
      mockPrisma.runProjection.findUnique.mockResolvedValue({
        metadata: { workspace_path: "/tmp/work" },
      } as any);
      await expect(
        engine.invoke({ ...baseInput, worktreePath: "/other/dir" })
      ).rejects.toThrow("escapes the active worktree root");
    });
  });

  // ── resolveToolType ──────────────────────────────────────────────────────────

  describe("resolveToolType (via invoke)", () => {
    it("uses explicit toolType when provided", async () => {
      const result = await engine.invoke({
        ...baseInput,
        command: "git status",
        toolType: "repo.read",
      });
      expect(result.event.toolType).toBe("repo.read");
    });

    it("detects install commands as repo.install", async () => {
      const result = await engine.invoke({
        ...baseInput,
        command: "npm install lodash",
      });
      expect(result.event.toolType).toBe("repo.install");
    });

    it("detects git commands as git.meta", async () => {
      const result = await engine.invoke({
        ...baseInput,
        command: "git status",
      });
      expect(result.event.toolType).toBe("git.meta");
    });

    it("detects repo inspect commands as repo.read", async () => {
      const result = await engine.invoke({
        ...baseInput,
        command: "rg pattern",
      });
      expect(result.event.toolType).toBe("repo.read");
    });

    it("defaults to repo.verify for unrecognized safe commands", async () => {
      const result = await engine.invoke({
        ...baseInput,
        command: "npm run test",
      });
      expect(result.event.toolType).toBe("repo.verify");
    });
  });

  // ── isCommandAllowedForToolType check in invoke ──────────────────────────────

  describe("binary allowlist enforcement", () => {
    it("throws when safe binary is not allowed for explicit toolType", async () => {
      await expect(
        engine.invoke({
          ...baseInput,
          command: "npm run test",
          toolType: "repo.read",
        })
      ).rejects.toThrow("not allowed for tool type");
    });
  });

  // ── evaluatePolicy ───────────────────────────────────────────────────────────

  describe("evaluatePolicy (via invoke)", () => {
    it("denies destructive commands outright", async () => {
      const result = await engine.invoke({
        ...baseInput,
        command: "rm -rf /tmp/test",
      });
      expect(result.event.policyDecision).toBe("denied");
      expect(result.result).toBeNull();
    });

    it("requires approval for shell_approved plans", async () => {
      const result = await engine.invoke({
        ...baseInput,
        command: "npm test && echo done",
      });
      expect(result.event.policyDecision).toBe("approval_required");
      expect(result.result).toBeNull();
    });

    it("requires approval in strict mode for any command", async () => {
      engine = new CommandEngine(
        stubTicketService({
          getTicketExecutionPolicy: vi.fn().mockResolvedValue({
            ticketId: "ticket-1",
            mode: "strict",
            allowInstallCommands: true,
            allowNetworkCommands: true,
            requireApprovalFor: [],
            updatedAt: new Date(0).toISOString(),
            updatedBy: "system",
          }),
        })
      );
      const result = await engine.invoke({
        ...baseInput,
        command: "npm run test",
      });
      expect(result.event.policyDecision).toBe("approval_required");
    });

    it("requires approval for install commands in balanced mode", async () => {
      engine = new CommandEngine(
        stubTicketService({
          getTicketExecutionPolicy: vi.fn().mockResolvedValue({
            ticketId: "ticket-1",
            mode: "balanced",
            allowInstallCommands: true,
            allowNetworkCommands: true,
            requireApprovalFor: [],
            updatedAt: new Date(0).toISOString(),
            updatedBy: "system",
          }),
        })
      );
      const result = await engine.invoke({
        ...baseInput,
        command: "npm install lodash",
      });
      expect(result.event.policyDecision).toBe("approval_required");
    });

    it("allows install commands in full_access mode", async () => {
      engine = new CommandEngine(
        stubTicketService({
          getTicketExecutionPolicy: vi.fn().mockResolvedValue({
            ticketId: "ticket-1",
            mode: "full_access",
            allowInstallCommands: true,
            allowNetworkCommands: true,
            requireApprovalFor: [],
            updatedAt: new Date(0).toISOString(),
            updatedBy: "system",
          }),
        })
      );
      const result = await engine.invoke({
        ...baseInput,
        command: "npm install lodash",
      });
      expect(result.event.policyDecision).toBe("allowed");
    });

    it("requires approval when requireApprovalFor includes wildcard '*'", async () => {
      engine = new CommandEngine(
        stubTicketService({
          getTicketExecutionPolicy: vi.fn().mockResolvedValue({
            ticketId: "ticket-1",
            mode: "full_access",
            allowInstallCommands: true,
            allowNetworkCommands: true,
            requireApprovalFor: ["*"],
            updatedAt: new Date(0).toISOString(),
            updatedBy: "system",
          }),
        })
      );
      const result = await engine.invoke({
        ...baseInput,
        command: "npm run test",
      });
      expect(result.event.policyDecision).toBe("approval_required");
    });

    it("requires approval when requireApprovalFor includes the specific toolType", async () => {
      engine = new CommandEngine(
        stubTicketService({
          getTicketExecutionPolicy: vi.fn().mockResolvedValue({
            ticketId: "ticket-1",
            mode: "full_access",
            allowInstallCommands: true,
            allowNetworkCommands: true,
            requireApprovalFor: ["repo.verify"],
            updatedAt: new Date(0).toISOString(),
            updatedBy: "system",
          }),
        })
      );
      const result = await engine.invoke({
        ...baseInput,
        command: "npm run test",
      });
      expect(result.event.policyDecision).toBe("approval_required");
    });

    it("requires approval when requireApprovalFor includes repo.install and command is install", async () => {
      engine = new CommandEngine(
        stubTicketService({
          getTicketExecutionPolicy: vi.fn().mockResolvedValue({
            ticketId: "ticket-1",
            mode: "full_access",
            allowInstallCommands: true,
            allowNetworkCommands: true,
            requireApprovalFor: ["repo.install"],
            updatedAt: new Date(0).toISOString(),
            updatedBy: "system",
          }),
        })
      );
      const result = await engine.invoke({
        ...baseInput,
        command: "npm install lodash",
      });
      expect(result.event.policyDecision).toBe("approval_required");
    });

    it("requires approval when allowInstallCommands is false and command is install", async () => {
      engine = new CommandEngine(
        stubTicketService({
          getTicketExecutionPolicy: vi.fn().mockResolvedValue({
            ticketId: "ticket-1",
            mode: "full_access",
            allowInstallCommands: false,
            allowNetworkCommands: true,
            requireApprovalFor: [],
            updatedAt: new Date(0).toISOString(),
            updatedBy: "system",
          }),
        })
      );
      const result = await engine.invoke({
        ...baseInput,
        command: "npm install lodash",
      });
      expect(result.event.policyDecision).toBe("approval_required");
    });

    it("requires approval when allowNetworkCommands is false and command is network", async () => {
      engine = new CommandEngine(
        stubTicketService({
          getTicketExecutionPolicy: vi.fn().mockResolvedValue({
            ticketId: "ticket-1",
            mode: "full_access",
            allowInstallCommands: true,
            allowNetworkCommands: false,
            requireApprovalFor: [],
            updatedAt: new Date(0).toISOString(),
            updatedBy: "system",
          }),
        })
      );
      const result = await engine.invoke({
        ...baseInput,
        command: "curl https://example.com",
      });
      expect(result.event.policyDecision).toBe("approval_required");
    });

    it("requires approval when requireApprovalFor includes network and command is network", async () => {
      engine = new CommandEngine(
        stubTicketService({
          getTicketExecutionPolicy: vi.fn().mockResolvedValue({
            ticketId: "ticket-1",
            mode: "full_access",
            allowInstallCommands: true,
            allowNetworkCommands: true,
            requireApprovalFor: ["network"],
            updatedAt: new Date(0).toISOString(),
            updatedBy: "system",
          }),
        })
      );
      const result = await engine.invoke({
        ...baseInput,
        command: "curl https://example.com",
      });
      expect(result.event.policyDecision).toBe("approval_required");
    });
  });

  // ── runCommandPlan ───────────────────────────────────────────────────────────

  describe("runCommandPlan (via invoke)", () => {
    it("runs safe commands via spawnSync with the binary", async () => {
      const result = await engine.invoke({
        ...baseInput,
        command: "npm run test",
      });
      expect(result.event.policyDecision).toBe("allowed");
      expect(result.result?.ok).toBe(true);
      expect(mockSpawnSync).toHaveBeenCalled();
      const call = mockSpawnSync.mock.calls[0];
      expect(call[0]).toBe("npm");
    });

    it("returns stderr and exit code on failed commands", async () => {
      mockSpawnSync.mockReturnValue({
        status: 1,
        stdout: "",
        stderr: "error occurred",
        error: undefined,
      } as any);

      const result = await engine.invoke({
        ...baseInput,
        command: "npm run test",
      });
      expect(result.result?.ok).toBe(false);
      expect(result.result?.exitCode).toBe(1);
      expect(result.result?.stderr).toBe("error occurred");
    });

    it("handles spawn errors", async () => {
      mockSpawnSync.mockReturnValue({
        status: null,
        stdout: "",
        stderr: "",
        error: new Error("spawn failed"),
      } as any);

      const result = await engine.invoke({
        ...baseInput,
        command: "npm run test",
      });
      expect(result.result?.ok).toBe(false);
      expect(result.result?.stderr).toBe("spawn failed");
      expect(result.result?.exitCode).toBe(1);
    });

    it("catches thrown exceptions from spawnSync", async () => {
      const err = new Error("ENOENT") as any;
      err.stdout = "partial output";
      err.stderr = Buffer.from("error buffer");
      err.status = 127;
      mockSpawnSync.mockImplementation(() => { throw err; });

      const result = await engine.invoke({
        ...baseInput,
        command: "npm run test",
      });
      expect(result.result?.ok).toBe(false);
      expect(result.result?.exitCode).toBe(127);
      expect(result.result?.stdout).toBe("partial output");
    });

    it("handles thrown exceptions with Buffer stderr", async () => {
      const err = new Error("fail") as any;
      err.stdout = Buffer.from("buf stdout");
      err.stderr = Buffer.from("buf stderr");
      err.status = null;
      mockSpawnSync.mockImplementation(() => { throw err; });

      const result = await engine.invoke({
        ...baseInput,
        command: "npm run test",
      });
      expect(result.result?.stderr).toBe("buf stderr");
      expect(result.result?.stdout).toBe("buf stdout");
      expect(result.result?.exitCode).toBe(1);
    });

    it("handles thrown exceptions with no stdout/stderr", async () => {
      const err = new Error("minimal error") as any;
      mockSpawnSync.mockImplementation(() => { throw err; });

      const result = await engine.invoke({
        ...baseInput,
        command: "npm run test",
      });
      expect(result.result?.stderr).toBe("minimal error");
      expect(result.result?.stdout).toBe("");
    });

    it("uses EXECUTION_COMMAND_TIMEOUT_MS env var", async () => {
      const orig = process.env.EXECUTION_COMMAND_TIMEOUT_MS;
      process.env.EXECUTION_COMMAND_TIMEOUT_MS = "30000";
      try {
        await engine.invoke({ ...baseInput, command: "npm run test" });
        const opts = mockSpawnSync.mock.calls[0][2] as any;
        expect(opts.timeout).toBe(30000);
      } finally {
        if (orig !== undefined) process.env.EXECUTION_COMMAND_TIMEOUT_MS = orig;
        else delete process.env.EXECUTION_COMMAND_TIMEOUT_MS;
      }
    });

    it("clamps command timeout to minimum 15000ms", async () => {
      const orig = process.env.EXECUTION_COMMAND_TIMEOUT_MS;
      process.env.EXECUTION_COMMAND_TIMEOUT_MS = "100";
      try {
        await engine.invoke({ ...baseInput, command: "npm run test" });
        const opts = mockSpawnSync.mock.calls[0][2] as any;
        expect(opts.timeout).toBe(15000);
      } finally {
        if (orig !== undefined) process.env.EXECUTION_COMMAND_TIMEOUT_MS = orig;
        else delete process.env.EXECUTION_COMMAND_TIMEOUT_MS;
      }
    });

    it("clamps command timeout to maximum 240000ms", async () => {
      const orig = process.env.EXECUTION_COMMAND_TIMEOUT_MS;
      process.env.EXECUTION_COMMAND_TIMEOUT_MS = "999999";
      try {
        await engine.invoke({ ...baseInput, command: "npm run test" });
        const opts = mockSpawnSync.mock.calls[0][2] as any;
        expect(opts.timeout).toBe(240000);
      } finally {
        if (orig !== undefined) process.env.EXECUTION_COMMAND_TIMEOUT_MS = orig;
        else delete process.env.EXECUTION_COMMAND_TIMEOUT_MS;
      }
    });
  });

  // ── classifyError ────────────────────────────────────────────────────────────

  describe("classifyError (via invoke result)", () => {
    it("returns 'none' for successful commands", async () => {
      const result = await engine.invoke({ ...baseInput, command: "npm run test" });
      expect(result.event.errorClass).toBe("none");
    });

    it("returns 'command_failed' for denied commands", async () => {
      const result = await engine.invoke({
        ...baseInput,
        command: "rm -rf /tmp/test",
      });
      expect(result.event.errorClass).toBe("command_failed");
    });

    it("returns 'none' for approval_required commands", async () => {
      const result = await engine.invoke({
        ...baseInput,
        command: "echo test && echo done",
      });
      expect(result.event.errorClass).toBe("none");
    });

    it("detects infra_missing_tool for exit code 127", async () => {
      mockSpawnSync.mockReturnValue({
        status: 127,
        stdout: "",
        stderr: "command not found",
        error: undefined,
      } as any);

      const result = await engine.invoke({ ...baseInput, command: "npm run test" });
      expect(result.event.errorClass).toBe("infra_missing_tool");
    });

    it("detects infra_missing_tool for 'command not found' output", async () => {
      mockSpawnSync.mockReturnValue({
        status: 1,
        stdout: "",
        stderr: "bash: vitest: command not found",
        error: undefined,
      } as any);

      const result = await engine.invoke({ ...baseInput, command: "npm run test" });
      expect(result.event.errorClass).toBe("infra_missing_tool");
    });

    it("detects infra_missing_tool for 'not recognized' output (Windows)", async () => {
      mockSpawnSync.mockReturnValue({
        status: 1,
        stdout: "",
        stderr: "'vitest' is not recognized as an internal or external command",
        error: undefined,
      } as any);

      const result = await engine.invoke({ ...baseInput, command: "npm run test" });
      expect(result.event.errorClass).toBe("infra_missing_tool");
    });

    it("detects infra_missing_dependency for 'cannot find module'", async () => {
      mockSpawnSync.mockReturnValue({
        status: 1,
        stdout: "",
        stderr: "Error: Cannot find module 'lodash'",
        error: undefined,
      } as any);

      const result = await engine.invoke({ ...baseInput, command: "npm run test" });
      expect(result.event.errorClass).toBe("infra_missing_dependency");
    });

    it("detects infra_missing_dependency for 'module not found'", async () => {
      mockSpawnSync.mockReturnValue({
        status: 1,
        stdout: "Module not found: react\n",
        stderr: "",
        error: undefined,
      } as any);

      const result = await engine.invoke({ ...baseInput, command: "npm run test" });
      expect(result.event.errorClass).toBe("infra_missing_dependency");
    });

    it("detects infra_missing_dependency for 'no module named'", async () => {
      mockSpawnSync.mockReturnValue({
        status: 1,
        stdout: "",
        stderr: "ImportError: No module named 'flask'",
        error: undefined,
      } as any);

      const result = await engine.invoke({ ...baseInput, command: "npm run test" });
      expect(result.event.errorClass).toBe("infra_missing_dependency");
    });

    it("detects infra_missing_dependency for 'missing dependency'", async () => {
      mockSpawnSync.mockReturnValue({
        status: 1,
        stdout: "",
        stderr: "Error: missing dependency for package",
        error: undefined,
      } as any);

      const result = await engine.invoke({ ...baseInput, command: "npm run test" });
      expect(result.event.errorClass).toBe("infra_missing_dependency");
    });

    it("detects infra_missing_dependency for 'ERR! missing'", async () => {
      mockSpawnSync.mockReturnValue({
        status: 1,
        stdout: "",
        stderr: "npm ERR! missing: lodash@^4.17.21",
        error: undefined,
      } as any);

      const result = await engine.invoke({ ...baseInput, command: "npm run test" });
      expect(result.event.errorClass).toBe("infra_missing_dependency");
    });

    it("detects timeout for exit code 124", async () => {
      mockSpawnSync.mockReturnValue({
        status: 124,
        stdout: "",
        stderr: "",
        error: undefined,
      } as any);

      const result = await engine.invoke({ ...baseInput, command: "npm run test" });
      expect(result.event.errorClass).toBe("timeout");
    });

    it("detects timeout for 'timed out' in output", async () => {
      mockSpawnSync.mockReturnValue({
        status: 1,
        stdout: "",
        stderr: "Process timed out after 30s",
        error: undefined,
      } as any);

      const result = await engine.invoke({ ...baseInput, command: "npm run test" });
      expect(result.event.errorClass).toBe("timeout");
    });

    it("returns 'command_failed' for generic failures", async () => {
      mockSpawnSync.mockReturnValue({
        status: 1,
        stdout: "",
        stderr: "some random error",
        error: undefined,
      } as any);

      const result = await engine.invoke({ ...baseInput, command: "npm run test" });
      expect(result.event.errorClass).toBe("command_failed");
    });
  });

  // ── ensureCommandApproval ────────────────────────────────────────────────────

  describe("ensureCommandApproval (via invoke)", () => {
    it("creates an approval request and publishes event when approval required", async () => {
      const result = await engine.invoke({
        ...baseInput,
        command: "npm test && echo done",
      });
      expect(result.event.policyDecision).toBe("approval_required");
      expect(mockPrisma.approvalRequest.create).toHaveBeenCalled();
      expect(mockPublishEvent).toHaveBeenCalledWith(
        "global",
        "approval.requested",
        expect.objectContaining({
          run_id: "run-1",
          ticket_id: "ticket-1",
        })
      );
    });

    it("reuses existing pending approval request if found", async () => {
      mockPrisma.approvalRequest.findFirst.mockResolvedValue({
        id: "existing-approval",
        status: "pending",
        actionType: "command_tool_invocation",
        payload: {},
        requestedAt: new Date(),
      } as any);

      const result = await engine.invoke({
        ...baseInput,
        command: "npm test && echo done",
      });
      expect(result.event.policyDecision).toBe("approval_required");
      // Should NOT call create because existing was found
      expect(mockPrisma.approvalRequest.create).not.toHaveBeenCalled();
      expect(result.event.approvalId).toBe("existing-approval");
    });
  });

  // ── resolveApprovedCommandOverride ───────────────────────────────────────────

  describe("resolveApprovedCommandOverride (via invoke)", () => {
    it("uses approved command plan when approvedApprovalId is provided", async () => {
      mockPrisma.approvalRequest.findUnique.mockResolvedValue({
        id: "approved-1",
        status: "approved",
        actionType: "command_tool_invocation",
        payload: {
          run_id: "run-1",
          ticket_id: "ticket-1",
          stage: "build",
          command_plan: {
            kind: "shell_approved",
            displayCommand: "npm test && echo done",
            binary: "npm",
            args: ["test"],
            shellCommand: "npm test && echo done",
          },
          worktree_path: "/tmp/approved-work",
        },
      } as any);

      const result = await engine.invoke({
        ...baseInput,
        command: "npm run test",
        approvedApprovalId: "approved-1",
      });
      // Should be "allowed" because approved override bypasses policy
      expect(result.event.policyDecision).toBe("allowed");
    });

    it("ignores approval with wrong status", async () => {
      mockPrisma.approvalRequest.findUnique.mockResolvedValue({
        id: "rejected-1",
        status: "rejected",
        actionType: "command_tool_invocation",
        payload: {},
      } as any);

      const result = await engine.invoke({
        ...baseInput,
        command: "npm run test",
        approvedApprovalId: "rejected-1",
      });
      // Proceeds as if no override
      expect(result.event.policyDecision).toBe("allowed");
    });

    it("ignores approval with wrong actionType", async () => {
      mockPrisma.approvalRequest.findUnique.mockResolvedValue({
        id: "wrong-type",
        status: "approved",
        actionType: "something_else",
        payload: {},
      } as any);

      const result = await engine.invoke({
        ...baseInput,
        command: "npm run test",
        approvedApprovalId: "wrong-type",
      });
      expect(result.event.policyDecision).toBe("allowed");
    });

    it("ignores approval with mismatched runId", async () => {
      mockPrisma.approvalRequest.findUnique.mockResolvedValue({
        id: "wrong-run",
        status: "approved",
        actionType: "command_tool_invocation",
        payload: {
          run_id: "different-run",
          ticket_id: "ticket-1",
          stage: "build",
        },
      } as any);

      const result = await engine.invoke({
        ...baseInput,
        command: "npm run test",
        approvedApprovalId: "wrong-run",
      });
      expect(result.event.policyDecision).toBe("allowed");
    });

    it("ignores approval with mismatched ticketId", async () => {
      mockPrisma.approvalRequest.findUnique.mockResolvedValue({
        id: "wrong-ticket",
        status: "approved",
        actionType: "command_tool_invocation",
        payload: {
          run_id: "run-1",
          ticket_id: "different-ticket",
          stage: "build",
        },
      } as any);

      const result = await engine.invoke({
        ...baseInput,
        command: "npm run test",
        approvedApprovalId: "wrong-ticket",
      });
      expect(result.event.policyDecision).toBe("allowed");
    });

    it("ignores approval with invalid stage in payload", async () => {
      mockPrisma.approvalRequest.findUnique.mockResolvedValue({
        id: "bad-stage",
        status: "approved",
        actionType: "command_tool_invocation",
        payload: {
          run_id: "run-1",
          ticket_id: "ticket-1",
          stage: "invalid_stage",
        },
      } as any);

      const result = await engine.invoke({
        ...baseInput,
        command: "npm run test",
        approvedApprovalId: "bad-stage",
      });
      expect(result.event.policyDecision).toBe("allowed");
    });

    it("returns null when approvalId is not provided", async () => {
      const result = await engine.invoke({
        ...baseInput,
        command: "npm run test",
      });
      expect(result.event.policyDecision).toBe("allowed");
    });

    it("uses requestedPlan when approved override has null commandPlan", async () => {
      mockPrisma.approvalRequest.findUnique.mockResolvedValue({
        id: "approved-null-plan",
        status: "approved",
        actionType: "command_tool_invocation",
        payload: {
          run_id: "run-1",
          ticket_id: "ticket-1",
          stage: "build",
          command_plan: { kind: "invalid" }, // commandPlanFromRecord will return null
          worktree_path: "/tmp/work",
        },
      } as any);

      // requestedPlan from input.command will be used as fallback
      const result = await engine.invoke({
        ...baseInput,
        command: "npm run test",
        approvedApprovalId: "approved-null-plan",
      });
      expect(result.event.command).toBe("npm run test");
    });

    it("denies destructive command even when approved", async () => {
      mockPrisma.approvalRequest.findUnique.mockResolvedValue({
        id: "approved-destructive",
        status: "approved",
        actionType: "command_tool_invocation",
        payload: {
          run_id: "run-1",
          ticket_id: "ticket-1",
          stage: "build",
          command_plan: {
            kind: "shell_approved",
            displayCommand: "rm -rf /tmp/test",
            binary: "rm",
            args: ["-rf", "/tmp/test"],
            shellCommand: "rm -rf /tmp/test",
          },
          worktree_path: "/tmp/work",
        },
      } as any);

      const result = await engine.invoke({
        ...baseInput,
        command: "rm -rf /tmp/test",
        approvedApprovalId: "approved-destructive",
      });
      expect(result.event.policyDecision).toBe("denied");
    });
  });

  // ── invoke full pipeline ─────────────────────────────────────────────────────

  describe("invoke — full pipeline", () => {
    it("stores evidence in benchmarkOutcomeEvidence", async () => {
      await engine.invoke({ ...baseInput, command: "npm run test" });
      expect(mockPrisma.benchmarkOutcomeEvidence.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          runId: "run-1",
          kind: "tool_invocation",
          payload: expect.objectContaining({
            runId: "run-1",
            ticketId: "ticket-1",
            stage: "build",
          }),
        }),
      });
    });

    it("publishes command.tool.invocation event", async () => {
      await engine.invoke({ ...baseInput, command: "npm run test" });
      expect(mockPublishEvent).toHaveBeenCalledWith(
        "global",
        "command.tool.invocation",
        expect.objectContaining({
          runId: "run-1",
          ticketId: "ticket-1",
          stage: "build",
        })
      );
    });

    it("populates summary for successful command", async () => {
      const result = await engine.invoke({ ...baseInput, command: "npm run test" });
      expect(result.event.summary).toBe("Command completed successfully");
    });

    it("populates summary for denied command", async () => {
      engine = new CommandEngine(
        stubTicketService({
          getTicketExecutionPolicy: vi.fn().mockResolvedValue({
            ticketId: "ticket-1",
            mode: "balanced",
            allowInstallCommands: true,
            allowNetworkCommands: true,
            requireApprovalFor: [],
            updatedAt: new Date(0).toISOString(),
            updatedBy: "system",
          }),
        })
      );
      const result = await engine.invoke({
        ...baseInput,
        command: "rm -rf /tmp/test",
      });
      expect(result.event.summary).toContain("denied");
    });

    it("populates summary for failed command", async () => {
      mockSpawnSync.mockReturnValue({
        status: 1,
        stdout: "",
        stderr: "error",
        error: undefined,
      } as any);

      const result = await engine.invoke({ ...baseInput, command: "npm run test" });
      expect(result.event.summary).toContain("failed with exit code 1");
    });

    it("uses commandPlan directly when provided instead of building from command", async () => {
      const plan = buildCommandPlan("npm run test");
      const result = await engine.invoke({
        ...baseInput,
        command: undefined,
        commandPlan: plan,
      });
      expect(result.event.command).toBe("npm run test");
    });

    it("uses args param when no command or commandPlan", async () => {
      const result = await engine.invoke({
        ...baseInput,
        command: "npm",
        args: ["run", "test"],
      });
      expect(result.event).toBeDefined();
    });

    it("includes riskLevel in event payload, defaulting to medium", async () => {
      const r1 = await engine.invoke({ ...baseInput, command: "npm run test" });
      const createPayload = (mockPrisma.benchmarkOutcomeEvidence.create.mock.calls[0][0] as any).data.payload;
      expect(createPayload.riskLevel).toBe("medium");
    });

    it("passes explicit riskLevel through", async () => {
      await engine.invoke({ ...baseInput, command: "npm run test", riskLevel: "high" });
      const createPayload = (mockPrisma.benchmarkOutcomeEvidence.create.mock.calls[0][0] as any).data.payload;
      expect(createPayload.riskLevel).toBe("high");
    });
  });

  // ── listRunToolEvents ────────────────────────────────────────────────────────

  describe("listRunToolEvents", () => {
    it("returns empty array when no events exist", async () => {
      mockPrisma.benchmarkOutcomeEvidence.findMany.mockResolvedValue([]);
      const events = await engine.listRunToolEvents("run-1");
      expect(events).toEqual([]);
    });

    it("maps valid tool invocation rows to ToolInvocationEvent", async () => {
      mockPrisma.benchmarkOutcomeEvidence.findMany.mockResolvedValue([
        {
          id: "ev-1",
          runId: "run-1",
          kind: "tool_invocation",
          createdAt: new Date("2025-01-01T00:00:00Z"),
          payload: {
            ticketId: "ticket-1",
            stage: "build",
            toolType: "repo.verify",
            command: "npm run test",
            args: ["run", "test"],
            cwd: "/tmp/work",
            policyDecision: "allowed",
            exitCode: 0,
            durationMs: 500,
            summary: "ok",
            errorClass: "none",
            approval_id: "approval-1",
          },
        },
      ] as any);

      const events = await engine.listRunToolEvents("run-1");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        id: "ev-1",
        runId: "run-1",
        ticketId: "ticket-1",
        stage: "build",
        toolType: "repo.verify",
        command: "npm run test",
        args: ["run", "test"],
        cwd: "/tmp/work",
        policyDecision: "allowed",
        exitCode: 0,
        durationMs: 500,
        summary: "ok",
        errorClass: "none",
        approvalId: "approval-1",
      });
    });

    it("filters out rows with invalid stage", async () => {
      mockPrisma.benchmarkOutcomeEvidence.findMany.mockResolvedValue([
        {
          id: "ev-1",
          runId: "run-1",
          kind: "tool_invocation",
          createdAt: new Date(),
          payload: {
            stage: "invalid_stage",
            toolType: "repo.verify",
          },
        },
      ] as any);

      const events = await engine.listRunToolEvents("run-1");
      expect(events).toHaveLength(0);
    });

    it("filters out rows with invalid toolType", async () => {
      mockPrisma.benchmarkOutcomeEvidence.findMany.mockResolvedValue([
        {
          id: "ev-1",
          runId: "run-1",
          kind: "tool_invocation",
          createdAt: new Date(),
          payload: {
            stage: "build",
            toolType: "invalid_tool",
          },
        },
      ] as any);

      const events = await engine.listRunToolEvents("run-1");
      expect(events).toHaveLength(0);
    });

    it("defaults errorClass to 'none' for unknown values", async () => {
      mockPrisma.benchmarkOutcomeEvidence.findMany.mockResolvedValue([
        {
          id: "ev-1",
          runId: "run-1",
          kind: "tool_invocation",
          createdAt: new Date("2025-01-01T00:00:00Z"),
          payload: {
            ticketId: "ticket-1",
            stage: "build",
            toolType: "repo.verify",
            command: "npm test",
            args: [],
            cwd: "/tmp",
            policyDecision: "allowed",
            exitCode: 0,
            durationMs: 100,
            summary: "ok",
            errorClass: "unknown_error_class",
          },
        },
      ] as any);

      const events = await engine.listRunToolEvents("run-1");
      expect(events[0].errorClass).toBe("none");
    });

    it("defaults policyDecision to 'denied' for unknown values", async () => {
      mockPrisma.benchmarkOutcomeEvidence.findMany.mockResolvedValue([
        {
          id: "ev-1",
          runId: "run-1",
          kind: "tool_invocation",
          createdAt: new Date("2025-01-01T00:00:00Z"),
          payload: {
            ticketId: "ticket-1",
            stage: "build",
            toolType: "repo.verify",
            command: "npm test",
            args: [],
            cwd: "/tmp",
            policyDecision: "unknown_policy",
            exitCode: 0,
            durationMs: 100,
            summary: "ok",
            errorClass: "none",
          },
        },
      ] as any);

      const events = await engine.listRunToolEvents("run-1");
      expect(events[0].policyDecision).toBe("denied");
    });

    it("falls back to approvalId from payload.approvalId field", async () => {
      mockPrisma.benchmarkOutcomeEvidence.findMany.mockResolvedValue([
        {
          id: "ev-1",
          runId: "run-1",
          kind: "tool_invocation",
          createdAt: new Date("2025-01-01T00:00:00Z"),
          payload: {
            ticketId: "ticket-1",
            stage: "build",
            toolType: "repo.verify",
            command: "npm test",
            args: [],
            cwd: "/tmp",
            policyDecision: "allowed",
            exitCode: 0,
            durationMs: 100,
            summary: "ok",
            errorClass: "none",
            approvalId: "from-approvalId-field",
          },
        },
      ] as any);

      const events = await engine.listRunToolEvents("run-1");
      expect(events[0].approvalId).toBe("from-approvalId-field");
    });

    it("returns null approvalId when neither field exists", async () => {
      mockPrisma.benchmarkOutcomeEvidence.findMany.mockResolvedValue([
        {
          id: "ev-1",
          runId: "run-1",
          kind: "tool_invocation",
          createdAt: new Date("2025-01-01T00:00:00Z"),
          payload: {
            ticketId: "ticket-1",
            stage: "build",
            toolType: "repo.verify",
            command: "npm test",
            args: [],
            cwd: "/tmp",
            policyDecision: "allowed",
            exitCode: 0,
            durationMs: 100,
            summary: "ok",
            errorClass: "none",
          },
        },
      ] as any);

      const events = await engine.listRunToolEvents("run-1");
      expect(events[0].approvalId).toBeNull();
    });

    it("handles missing payload fields gracefully", async () => {
      mockPrisma.benchmarkOutcomeEvidence.findMany.mockResolvedValue([
        {
          id: "ev-1",
          runId: "run-1",
          kind: "tool_invocation",
          createdAt: new Date("2025-01-01T00:00:00Z"),
          payload: {
            stage: "scope",
            toolType: "repo.read",
          },
        },
      ] as any);

      const events = await engine.listRunToolEvents("run-1");
      expect(events).toHaveLength(1);
      expect(events[0].ticketId).toBe("");
      expect(events[0].command).toBe("");
      expect(events[0].args).toEqual([]);
      expect(events[0].cwd).toBe("");
      expect(events[0].exitCode).toBeNull();
      expect(events[0].durationMs).toBe(0);
      expect(events[0].summary).toBe("");
    });

    it("filters non-string items from args array", async () => {
      mockPrisma.benchmarkOutcomeEvidence.findMany.mockResolvedValue([
        {
          id: "ev-1",
          runId: "run-1",
          kind: "tool_invocation",
          createdAt: new Date("2025-01-01T00:00:00Z"),
          payload: {
            stage: "build",
            toolType: "repo.verify",
            ticketId: "t-1",
            command: "npm",
            args: ["run", 42, null, "test"],
            cwd: "/tmp",
            policyDecision: "allowed",
            exitCode: 0,
            durationMs: 0,
            summary: "",
            errorClass: "none",
          },
        },
      ] as any);

      const events = await engine.listRunToolEvents("run-1");
      expect(events[0].args).toEqual(["run", "test"]);
    });

    it("handles null payload gracefully", async () => {
      mockPrisma.benchmarkOutcomeEvidence.findMany.mockResolvedValue([
        {
          id: "ev-1",
          runId: "run-1",
          kind: "tool_invocation",
          createdAt: new Date("2025-01-01T00:00:00Z"),
          payload: null,
        },
      ] as any);

      const events = await engine.listRunToolEvents("run-1");
      // null payload produces no stage/toolType, so it gets filtered out
      expect(events).toHaveLength(0);
    });

    it("maps all valid stage values", async () => {
      const stages = ["scope", "build", "review", "escalate"] as const;
      for (const stage of stages) {
        mockPrisma.benchmarkOutcomeEvidence.findMany.mockResolvedValue([
          {
            id: `ev-${stage}`,
            runId: "run-1",
            kind: "tool_invocation",
            createdAt: new Date("2025-01-01T00:00:00Z"),
            payload: {
              stage,
              toolType: "repo.verify",
              ticketId: "t",
              command: "npm test",
              args: [],
              cwd: "/tmp",
              policyDecision: "allowed",
              exitCode: 0,
              durationMs: 0,
              summary: "",
              errorClass: "none",
            },
          },
        ] as any);

        const events = await engine.listRunToolEvents("run-1");
        expect(events).toHaveLength(1);
        expect(events[0].stage).toBe(stage);
      }
    });

    it("maps all valid toolType values", async () => {
      const toolTypes = ["repo.read", "repo.edit", "repo.verify", "repo.install", "git.meta"] as const;
      for (const toolType of toolTypes) {
        mockPrisma.benchmarkOutcomeEvidence.findMany.mockResolvedValue([
          {
            id: `ev-${toolType}`,
            runId: "run-1",
            kind: "tool_invocation",
            createdAt: new Date("2025-01-01T00:00:00Z"),
            payload: {
              stage: "build",
              toolType,
              ticketId: "t",
              command: "test",
              args: [],
              cwd: "/tmp",
              policyDecision: "allowed",
              exitCode: 0,
              durationMs: 0,
              summary: "",
              errorClass: "none",
            },
          },
        ] as any);

        const events = await engine.listRunToolEvents("run-1");
        expect(events).toHaveLength(1);
        expect(events[0].toolType).toBe(toolType);
      }
    });
  });
});
