import { describe, it, expect } from "vitest";
import {
  tokenizeCommand,
  normalizeCommandInput,
  buildCommandPlan,
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
