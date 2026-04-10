import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { loadAgentDefinitions } from "./agentDefinitionLoader";

describe("loadAgentDefinitions", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-def-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array when .agentic-workforce directory does not exist", () => {
    const result = loadAgentDefinitions(tmpDir);
    expect(result).toEqual([]);
  });

  it("returns empty array when agents.json does not exist", () => {
    fs.mkdirSync(path.join(tmpDir, ".agentic-workforce"), { recursive: true });
    const result = loadAgentDefinitions(tmpDir);
    expect(result).toEqual([]);
  });

  it("loads valid agent definitions", () => {
    const agentsDir = path.join(tmpDir, ".agentic-workforce");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir, "agents.json"),
      JSON.stringify([
        {
          name: "code-reviewer",
          description: "Reviews code for quality",
          systemPrompt: "You are a code reviewer.",
          allowedTools: ["read_file", "bash"],
          modelRole: "review_deep",
          maxIterations: 10,
        },
        {
          name: "test-writer",
          description: "Writes tests",
          modelRole: "coder_default",
        },
      ]),
    );

    const result = loadAgentDefinitions(tmpDir);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("code-reviewer");
    expect(result[0].systemPrompt).toBe("You are a code reviewer.");
    expect(result[0].allowedTools).toEqual(["read_file", "bash"]);
    expect(result[0].modelRole).toBe("review_deep");
    expect(result[0].maxIterations).toBe(10);
    expect(result[1].name).toBe("test-writer");
    expect(result[1].systemPrompt).toBeUndefined();
  });

  it("returns empty array for invalid JSON", () => {
    const agentsDir = path.join(tmpDir, ".agentic-workforce");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, "agents.json"), "not valid json");

    const result = loadAgentDefinitions(tmpDir);
    expect(result).toEqual([]);
  });

  it("returns empty array for invalid schema (not an array)", () => {
    const agentsDir = path.join(tmpDir, ".agentic-workforce");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir, "agents.json"),
      JSON.stringify({ name: "single-agent", description: "not an array" }),
    );

    const result = loadAgentDefinitions(tmpDir);
    expect(result).toEqual([]);
  });

  it("returns empty array when an entry is missing required fields", () => {
    const agentsDir = path.join(tmpDir, ".agentic-workforce");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir, "agents.json"),
      JSON.stringify([{ name: "missing-description" }]),
    );

    const result = loadAgentDefinitions(tmpDir);
    expect(result).toEqual([]);
  });

  it("returns empty array for invalid model role", () => {
    const agentsDir = path.join(tmpDir, ".agentic-workforce");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir, "agents.json"),
      JSON.stringify([
        {
          name: "bad-role",
          description: "Has an invalid model role",
          modelRole: "super_magic",
        },
      ]),
    );

    const result = loadAgentDefinitions(tmpDir);
    expect(result).toEqual([]);
  });

  it("handles minimal valid definitions", () => {
    const agentsDir = path.join(tmpDir, ".agentic-workforce");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir, "agents.json"),
      JSON.stringify([{ name: "minimal", description: "Just the basics" }]),
    );

    const result = loadAgentDefinitions(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("minimal");
    expect(result[0].description).toBe("Just the basics");
    expect(result[0].systemPrompt).toBeUndefined();
    expect(result[0].allowedTools).toBeUndefined();
    expect(result[0].modelRole).toBeUndefined();
    expect(result[0].maxIterations).toBeUndefined();
  });
});
