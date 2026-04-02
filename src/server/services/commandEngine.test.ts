import { describe, expect, it } from "vitest";
import { buildCommandPlan, isCommandAllowedForToolType, normalizeCommandInput, tokenizeCommand } from "./commandEngine";

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
