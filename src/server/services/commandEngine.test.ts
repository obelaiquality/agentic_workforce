import { describe, expect, it } from "vitest";
import { buildCommandPlan, isCommandAllowedForToolType, normalizeCommandInput, tokenizeCommand } from "./commandEngine";

describe("tokenizeCommand", () => {
  it("splits simple command strings", () => {
    expect(tokenizeCommand("npm run build")).toEqual(["npm", "run", "build"]);
  });

  it("preserves quoted arguments", () => {
    expect(tokenizeCommand('node -e "console.log(123)"')).toEqual(["node", "-e", "console.log(123)"]);
  });
});

describe("buildCommandPlan", () => {
  it("marks shell metacharacters as shell-approved plans", () => {
    expect(buildCommandPlan("npm test && rm -rf /tmp")).toMatchObject({
      kind: "shell_approved",
      displayCommand: "npm test && rm -rf /tmp",
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
});
