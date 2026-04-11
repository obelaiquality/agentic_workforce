import { describe, it, expect } from "vitest";
import {
  tokenizeCommand,
  normalizeCommandInput,
  buildCommandPlan,
  commandPlanToRecord,
  commandPlanFromRecord,
  isCommandAllowedForToolType,
  classifyCommandFlags,
  spawnArgsForSafeSpec,
  DESTRUCTIVE_PATTERNS,
  NETWORK_PATTERNS,
  INSTALL_PATTERNS,
} from "./commandSpecs";

describe("tokenizeCommand", () => {
  it("splits simple commands", () => {
    expect(tokenizeCommand("npm test")).toEqual(["npm", "test"]);
    expect(tokenizeCommand("git status")).toEqual(["git", "status"]);
  });

  it("handles quoted arguments", () => {
    expect(tokenizeCommand('git commit -m "fix bug"')).toEqual(["git", "commit", "-m", "fix bug"]);
    expect(tokenizeCommand("echo 'hello world'")).toEqual(["echo", "hello world"]);
  });

  it("handles escaped characters", () => {
    expect(tokenizeCommand("echo hello\\ world")).toEqual(["echo", "hello world"]);
  });

  it("throws on unterminated quotes", () => {
    expect(() => tokenizeCommand('echo "unclosed')).toThrow("unterminated");
  });

  it("throws on trailing escape", () => {
    expect(() => tokenizeCommand("echo \\")).toThrow("unterminated");
  });
});

describe("normalizeCommandInput", () => {
  it("normalizes simple command", () => {
    const result = normalizeCommandInput("npm", ["test"]);
    expect(result.binary).toBe("npm");
    expect(result.args).toEqual(["test"]);
  });

  it("rejects empty commands", () => {
    expect(() => normalizeCommandInput("")).toThrow("empty");
    expect(() => normalizeCommandInput("  ")).toThrow("empty");
  });

  it("rejects unsafe binary names", () => {
    expect(() => normalizeCommandInput("rm;whoami")).toThrow("not allowed");
    expect(() => normalizeCommandInput("foo bar", ["--flag\x00inject"])).toThrow("not allowed");
  });

  it("rejects arguments with newlines", () => {
    expect(() => normalizeCommandInput("echo", ["hello\nworld"])).toThrow("not allowed");
    expect(() => normalizeCommandInput("echo", ["hello\rworld"])).toThrow("not allowed");
  });
});

describe("buildCommandPlan", () => {
  it("classifies safe package manager commands", () => {
    const plan = buildCommandPlan("npm test");
    expect(plan.kind).toBe("safe");
    if (plan.kind === "safe") {
      expect(plan.spec.kind).toBe("package_manager");
    }
  });

  it("classifies safe git readonly commands", () => {
    const plan = buildCommandPlan("git status");
    expect(plan.kind).toBe("safe");
    if (plan.kind === "safe") {
      expect(plan.spec.kind).toBe("git_readonly");
    }
  });

  it("classifies cargo commands as safe", () => {
    const plan = buildCommandPlan("cargo test");
    expect(plan.kind).toBe("safe");
  });

  it("classifies pytest commands as safe", () => {
    const plan = buildCommandPlan("pytest -v");
    expect(plan.kind).toBe("safe");
  });

  it("classifies repo inspect commands as safe", () => {
    const plan = buildCommandPlan("grep -r TODO src/");
    expect(plan.kind).toBe("safe");
  });

  it("marks commands with shell metacharacters as shell_approved", () => {
    expect(buildCommandPlan("npm test && npm run build").kind).toBe("shell_approved");
    expect(buildCommandPlan("echo $HOME").kind).toBe("shell_approved");
    expect(buildCommandPlan("cat file | grep foo").kind).toBe("shell_approved");
    expect(buildCommandPlan("echo `whoami`").kind).toBe("shell_approved");
  });

  it("detects expanded shell metacharacters (parens, braces, dollar)", () => {
    expect(buildCommandPlan("echo $(whoami)").kind).toBe("shell_approved");
    expect(buildCommandPlan("echo ${PATH}").kind).toBe("shell_approved");
  });
});

describe("pattern detection", () => {
  it("detects destructive patterns", () => {
    expect(DESTRUCTIVE_PATTERNS.some((p) => p.test("rm -rf /"))).toBe(true);
    expect(DESTRUCTIVE_PATTERNS.some((p) => p.test("git reset --hard"))).toBe(true);
    expect(DESTRUCTIVE_PATTERNS.some((p) => p.test("git clean -fdx"))).toBe(true);
    expect(DESTRUCTIVE_PATTERNS.some((p) => p.test("npm test"))).toBe(false);
  });

  it("detects network patterns", () => {
    expect(NETWORK_PATTERNS.some((p) => p.test("curl https://example.com"))).toBe(true);
    expect(NETWORK_PATTERNS.some((p) => p.test("wget file.tar.gz"))).toBe(true);
    expect(NETWORK_PATTERNS.some((p) => p.test("npm test"))).toBe(false);
  });

  it("detects install patterns", () => {
    expect(INSTALL_PATTERNS.some((p) => p.test("npm install lodash"))).toBe(true);
    expect(INSTALL_PATTERNS.some((p) => p.test("pnpm install"))).toBe(true);
    expect(INSTALL_PATTERNS.some((p) => p.test("npm test"))).toBe(false);
  });
});

describe("buildCommandPlan additional specs", () => {
  it("classifies python -m pytest as safe pytest spec", () => {
    const plan = buildCommandPlan("python", ["-m", "pytest", "-v"]);
    expect(plan.kind).toBe("safe");
    if (plan.kind === "safe") {
      expect(plan.spec.kind).toBe("pytest");
      if (plan.spec.kind === "pytest") {
        expect(plan.spec.binary).toBe("python");
      }
    }
  });

  it("classifies python3 -m pytest as safe pytest spec", () => {
    const plan = buildCommandPlan("python3", ["-m", "pytest"]);
    expect(plan.kind).toBe("safe");
    if (plan.kind === "safe") {
      expect(plan.spec.kind).toBe("pytest");
      if (plan.spec.kind === "pytest") {
        expect(plan.spec.binary).toBe("python3");
      }
    }
  });

  it("classifies pnpm, yarn, bun as safe package_manager", () => {
    for (const manager of ["pnpm", "yarn", "bun"] as const) {
      const plan = buildCommandPlan(manager, ["install"]);
      expect(plan.kind).toBe("safe");
      if (plan.kind === "safe") {
        expect(plan.spec.kind).toBe("package_manager");
        if (plan.spec.kind === "package_manager") {
          expect(plan.spec.manager).toBe(manager);
        }
      }
    }
  });

  it("classifies cat, find, ls, rg as repo_inspect", () => {
    for (const binary of ["cat", "find", "ls", "rg"] as const) {
      const plan = buildCommandPlan(binary, ["somefile"]);
      expect(plan.kind).toBe("safe");
      if (plan.kind === "safe") {
        expect(plan.spec.kind).toBe("repo_inspect");
        if (plan.spec.kind === "repo_inspect") {
          expect(plan.spec.binary).toBe(binary);
        }
      }
    }
  });

  it("classifies all readonly git subcommands as safe", () => {
    for (const sub of ["branch", "diff", "log", "ls-files", "rev-parse", "show", "status"]) {
      const plan = buildCommandPlan("git", [sub]);
      expect(plan.kind).toBe("safe");
      if (plan.kind === "safe") {
        expect(plan.spec.kind).toBe("git_readonly");
      }
    }
  });

  it("classifies unknown binary as shell_approved", () => {
    const plan = buildCommandPlan("myCustomTool", ["--flag"]);
    expect(plan.kind).toBe("shell_approved");
    if (plan.kind === "shell_approved") {
      expect(plan.shellCommand).toContain("myCustomTool");
    }
  });

  it("classifies git with non-readonly subcommand as shell_approved", () => {
    const plan = buildCommandPlan("git", ["push", "origin", "main"]);
    expect(plan.kind).toBe("shell_approved");
  });

  it("classifies python without -m pytest as shell_approved", () => {
    const plan = buildCommandPlan("python", ["script.py"]);
    expect(plan.kind).toBe("shell_approved");
  });
});

describe("commandPlanToRecord", () => {
  it("serializes a safe plan to a record", () => {
    const plan = buildCommandPlan("npm test");
    const record = commandPlanToRecord(plan);
    expect(record.kind).toBe("safe");
    expect(record.displayCommand).toBe("npm test");
    expect(record.binary).toBe("npm");
    expect(record.args).toEqual(["test"]);
    expect(record).toHaveProperty("spec");
  });

  it("serializes a shell_approved plan to a record", () => {
    const plan = buildCommandPlan("npm test && npm run build");
    const record = commandPlanToRecord(plan);
    expect(record.kind).toBe("shell_approved");
    expect(record).toHaveProperty("shellCommand");
    expect(record.displayCommand).toContain("npm");
  });
});

describe("commandPlanFromRecord", () => {
  it("deserializes a safe plan record", () => {
    const plan = buildCommandPlan("cargo test");
    const record = commandPlanToRecord(plan);
    const restored = commandPlanFromRecord(record);
    expect(restored).not.toBeNull();
    expect(restored!.kind).toBe("safe");
    expect(restored!.binary).toBe("cargo");
  });

  it("deserializes a shell_approved plan record", () => {
    const plan = buildCommandPlan("npm test && echo done");
    const record = commandPlanToRecord(plan);
    const restored = commandPlanFromRecord(record);
    expect(restored).not.toBeNull();
    expect(restored!.kind).toBe("shell_approved");
  });

  it("returns null for non-object input", () => {
    expect(commandPlanFromRecord(null)).toBeNull();
    expect(commandPlanFromRecord("string")).toBeNull();
    expect(commandPlanFromRecord(42)).toBeNull();
    expect(commandPlanFromRecord(undefined)).toBeNull();
  });

  it("returns null for array input", () => {
    expect(commandPlanFromRecord([1, 2, 3])).toBeNull();
  });

  it("returns null for object missing required fields", () => {
    expect(commandPlanFromRecord({ kind: "safe" })).toBeNull();
    expect(commandPlanFromRecord({ displayCommand: "npm test", binary: "npm" })).toBeNull();
    expect(commandPlanFromRecord({ displayCommand: "npm test", binary: "npm", args: "not-array" })).toBeNull();
  });

  it("returns null for safe kind without spec", () => {
    const result = commandPlanFromRecord({
      kind: "safe",
      displayCommand: "npm test",
      binary: "npm",
      args: ["test"],
      // no spec
    });
    expect(result).toBeNull();
  });

  it("returns null for safe kind with array spec", () => {
    const result = commandPlanFromRecord({
      kind: "safe",
      displayCommand: "npm test",
      binary: "npm",
      args: ["test"],
      spec: [1, 2],
    });
    expect(result).toBeNull();
  });

  it("returns null for shell_approved kind without shellCommand", () => {
    const result = commandPlanFromRecord({
      kind: "shell_approved",
      displayCommand: "npm test",
      binary: "npm",
      args: ["test"],
      // no shellCommand
    });
    expect(result).toBeNull();
  });

  it("returns null for unknown kind", () => {
    const result = commandPlanFromRecord({
      kind: "unknown",
      displayCommand: "npm test",
      binary: "npm",
      args: ["test"],
    });
    expect(result).toBeNull();
  });

  it("filters non-string args", () => {
    const result = commandPlanFromRecord({
      kind: "shell_approved",
      displayCommand: "npm test",
      binary: "npm",
      args: ["test", 42, null, "run"],
      shellCommand: "npm test 42 run",
    });
    expect(result).not.toBeNull();
    expect(result!.args).toEqual(["test", "run"]);
  });
});

describe("isCommandAllowedForToolType", () => {
  it("allows repo.read tool type for cat, find, git, grep, ls, rg", () => {
    for (const binary of ["cat", "find", "git", "grep", "ls", "rg"]) {
      expect(isCommandAllowedForToolType("repo.read", binary)).toBe(true);
    }
  });

  it("disallows repo.read for npm", () => {
    expect(isCommandAllowedForToolType("repo.read", "npm")).toBe(false);
  });

  it("allows repo.verify for test runners and package managers", () => {
    for (const binary of ["bun", "cargo", "git", "npm", "pnpm", "pytest", "python", "python3", "yarn"]) {
      expect(isCommandAllowedForToolType("repo.verify", binary)).toBe(true);
    }
  });

  it("disallows repo.verify for cat", () => {
    expect(isCommandAllowedForToolType("repo.verify", "cat")).toBe(false);
  });

  it("allows repo.edit for git only", () => {
    expect(isCommandAllowedForToolType("repo.edit", "git")).toBe(true);
    expect(isCommandAllowedForToolType("repo.edit", "npm")).toBe(false);
  });

  it("allows repo.install for package managers", () => {
    for (const binary of ["bun", "npm", "pnpm", "yarn"]) {
      expect(isCommandAllowedForToolType("repo.install", binary)).toBe(true);
    }
    expect(isCommandAllowedForToolType("repo.install", "cargo")).toBe(false);
  });

  it("allows git.meta for git only", () => {
    expect(isCommandAllowedForToolType("git.meta", "git")).toBe(true);
    expect(isCommandAllowedForToolType("git.meta", "npm")).toBe(false);
  });
});

describe("classifyCommandFlags", () => {
  it("detects install commands", () => {
    expect(classifyCommandFlags("npm install lodash").install).toBe(true);
    expect(classifyCommandFlags("pnpm install").install).toBe(true);
    expect(classifyCommandFlags("yarn install").install).toBe(true);
    expect(classifyCommandFlags("bun install").install).toBe(true);
  });

  it("detects network commands", () => {
    expect(classifyCommandFlags("curl https://example.com").network).toBe(true);
    expect(classifyCommandFlags("wget file.tar.gz").network).toBe(true);
    expect(classifyCommandFlags("npm publish").network).toBe(true);
    expect(classifyCommandFlags("git clone repo").network).toBe(true);
  });

  it("detects destructive commands", () => {
    expect(classifyCommandFlags("rm -rf /tmp/dir").destructive).toBe(true);
    expect(classifyCommandFlags("git reset --hard").destructive).toBe(true);
    expect(classifyCommandFlags("git clean -fdx").destructive).toBe(true);
  });

  it("returns all false for benign commands", () => {
    const flags = classifyCommandFlags("npm test");
    expect(flags.install).toBe(false);
    expect(flags.network).toBe(false);
    expect(flags.destructive).toBe(false);
  });

  it("detects multiple flags simultaneously", () => {
    // This is contrived but tests the independence of flags
    const flags = classifyCommandFlags("npm install && curl example.com && rm -rf /tmp");
    expect(flags.install).toBe(true);
    expect(flags.network).toBe(true);
    expect(flags.destructive).toBe(true);
  });
});

describe("spawnArgsForSafeSpec", () => {
  it("returns correct spawn args for package_manager", () => {
    const result = spawnArgsForSafeSpec({
      kind: "package_manager",
      manager: "npm",
      args: ["test"],
    });
    expect(result).toEqual({ binary: "npm", args: ["test"] });
  });

  it("returns correct spawn args for pnpm", () => {
    const result = spawnArgsForSafeSpec({
      kind: "package_manager",
      manager: "pnpm",
      args: ["install"],
    });
    expect(result).toEqual({ binary: "pnpm", args: ["install"] });
  });

  it("returns correct spawn args for cargo", () => {
    const result = spawnArgsForSafeSpec({
      kind: "cargo",
      args: ["test", "--release"],
    });
    expect(result).toEqual({ binary: "cargo", args: ["test", "--release"] });
  });

  it("returns correct spawn args for pytest", () => {
    const result = spawnArgsForSafeSpec({
      kind: "pytest",
      binary: "pytest",
      args: ["-v"],
    });
    expect(result).toEqual({ binary: "pytest", args: ["-v"] });
  });

  it("returns correct spawn args for python -m pytest", () => {
    const result = spawnArgsForSafeSpec({
      kind: "pytest",
      binary: "python3",
      args: ["-m", "pytest", "-v"],
    });
    expect(result).toEqual({ binary: "python3", args: ["-m", "pytest", "-v"] });
  });

  it("returns correct spawn args for git_readonly", () => {
    const result = spawnArgsForSafeSpec({
      kind: "git_readonly",
      args: ["status"],
    });
    expect(result).toEqual({ binary: "git", args: ["status"] });
  });

  it("returns correct spawn args for repo_inspect", () => {
    const result = spawnArgsForSafeSpec({
      kind: "repo_inspect",
      binary: "grep",
      args: ["-r", "TODO", "src/"],
    });
    expect(result).toEqual({ binary: "grep", args: ["-r", "TODO", "src/"] });
  });

  it("returns correct spawn args for all repo_inspect binaries", () => {
    for (const binary of ["cat", "find", "grep", "ls", "rg"] as const) {
      const result = spawnArgsForSafeSpec({
        kind: "repo_inspect",
        binary,
        args: ["arg1"],
      });
      expect(result).toEqual({ binary, args: ["arg1"] });
    }
  });
});

describe("normalizeCommandInput edge cases", () => {
  it("tokenizes command string when no args are provided", () => {
    const result = normalizeCommandInput("git status --short");
    expect(result.binary).toBe("git");
    expect(result.args).toEqual(["status", "--short"]);
    expect(result.displayCommand).toBe("git status --short");
  });

  it("uses provided args array instead of tokenizing", () => {
    const result = normalizeCommandInput("git", ["commit", "-m", "fix bug"]);
    expect(result.binary).toBe("git");
    expect(result.args).toEqual(["commit", "-m", "fix bug"]);
  });

  it("handles empty args array by tokenizing command", () => {
    const result = normalizeCommandInput("npm test", []);
    expect(result.binary).toBe("npm");
    expect(result.args).toEqual(["test"]);
  });
});
