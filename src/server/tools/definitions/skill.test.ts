import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ToolContext } from "../types";

// Mock the SkillService module to avoid filesystem/DB access
vi.mock("../../skills/skillService", () => {
  return {
    SkillService: vi.fn(),
  };
});

import { skillTool, setSkillService, getSkillService } from "./skill";
import type { SkillService } from "../../skills/skillService";

function createMockSkillService(overrides: Partial<SkillService> = {}): SkillService {
  return {
    listSkills: vi.fn(() => []),
    getSkill: vi.fn(() => null),
    startInvocation: vi.fn(async () => ({
      id: "inv_abc123",
      skillId: "builtin_commit",
      skillName: "commit",
      runId: "test-run",
      projectId: undefined,
      ticketId: null,
      args: null,
      status: "running" as const,
      output: null,
      childRunId: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
    })),
    completeInvocation: vi.fn(async () => null),
    failInvocation: vi.fn(async () => null),
    buildSkillPrompt: vi.fn(() => "Do the thing"),
    ...overrides,
  } as unknown as SkillService;
}

describe("skill tool definition", () => {
  let mockContext: ToolContext;
  let mockRecordEvent: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockRecordEvent = vi.fn(async () => {});

    mockContext = {
      runId: "test-run",
      repoId: "test-repo",
      ticketId: "test-ticket",
      worktreePath: "/tmp/test-project",
      actor: "agent:coder_default",
      stage: "build",
      conversationHistory: [],
      createApproval: vi.fn(async () => ({ id: "approval-1" })),
      recordEvent: mockRecordEvent,
    };
  });

  afterEach(() => {
    // Reset the singleton so tests are isolated
    setSkillService(null as unknown as SkillService);
  });

  it("has correct name and permission metadata", () => {
    expect(skillTool.name).toBe("skill");
    expect(skillTool.permission.scope).toBe("meta");
    expect(skillTool.permission.readOnly).toBe(false);
    expect(skillTool.alwaysLoad).toBe(true);
  });

  it("has correct input schema (skill_name required, args optional)", () => {
    const valid = skillTool.inputSchema.safeParse({ skill: "commit" });
    expect(valid.success).toBe(true);

    const withArgs = skillTool.inputSchema.safeParse({ skill: "verify", args: "--coverage" });
    expect(withArgs.success).toBe(true);

    const missing = skillTool.inputSchema.safeParse({});
    expect(missing.success).toBe(false);

    const wrongType = skillTool.inputSchema.safeParse({ skill: 123 });
    expect(wrongType.success).toBe(false);
  });

  it("returns error when skill name is unknown", async () => {
    const mockService = createMockSkillService({
      getSkill: vi.fn(() => null),
      listSkills: vi.fn(() => [
        { id: "builtin_commit", name: "commit", description: "Create a commit" },
      ]) as any,
    });
    setSkillService(mockService);

    const result = await skillTool.execute({ skill: "nonexistent" }, mockContext);

    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.error).toContain("not found");
      expect(result.error).toContain("nonexistent");
      expect(result.error).toContain("commit");
    }
  });

  it("records skill_invoked event on successful execution", async () => {
    const mockService = createMockSkillService({
      getSkill: vi.fn(() => ({
        id: "builtin_commit",
        name: "commit",
        description: "Create a commit",
        version: "1.0.0",
        contextMode: "inline" as const,
        allowedTools: ["bash", "read_file"],
        maxIterations: 10,
        systemPrompt: "Review changes and commit",
        referenceFiles: [],
        author: "system",
        tags: ["git"],
        builtIn: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
      buildSkillPrompt: vi.fn(() => "Review staged changes and create a commit"),
    });
    setSkillService(mockService);

    const result = await skillTool.execute({ skill: "commit" }, mockContext);

    expect(result.type).toBe("success");
    expect(mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "skill_invoked",
        payload: expect.objectContaining({
          skillId: "builtin_commit",
          skillName: "commit",
          contextMode: "inline",
        }),
      }),
    );
  });

  it("returns inline skill instructions for inline context mode", async () => {
    const mockService = createMockSkillService({
      getSkill: vi.fn(() => ({
        id: "builtin_verify",
        name: "verify",
        description: "Run verification",
        version: "1.0.0",
        contextMode: "inline" as const,
        allowedTools: ["bash"],
        maxIterations: 5,
        systemPrompt: "Run tests and lint",
        referenceFiles: [],
        author: "system",
        tags: ["ci"],
        builtIn: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
      buildSkillPrompt: vi.fn(() => "Run tests and lint"),
    });
    setSkillService(mockService);

    const result = await skillTool.execute({ skill: "verify" }, mockContext);

    expect(result.type).toBe("success");
    if (result.type === "success") {
      expect(result.content).toContain("[Skill: verify]");
      expect(result.content).toContain("Run tests and lint");
      expect(result.metadata?.contextMode).toBe("inline");
      expect(result.metadata?.skillName).toBe("verify");
    }
  });

  it("handles skill execution failure gracefully", async () => {
    const mockService = createMockSkillService({
      getSkill: vi.fn(() => ({
        id: "builtin_debug",
        name: "debug",
        description: "Debug issue",
        version: "1.0.0",
        contextMode: "inline" as const,
        allowedTools: [],
        maxIterations: null,
        systemPrompt: "Debug the issue",
        referenceFiles: [],
        author: "system",
        tags: [],
        builtIn: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
      buildSkillPrompt: vi.fn(() => {
        throw new Error("Template rendering failed");
      }),
    });
    setSkillService(mockService);

    const result = await skillTool.execute({ skill: "debug" }, mockContext);

    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.error).toContain("debug");
      expect(result.error).toContain("Template rendering failed");
    }

    expect(mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "skill_failed",
        payload: expect.objectContaining({
          error: "Template rendering failed",
        }),
      }),
    );
    expect(mockService.failInvocation).toHaveBeenCalled();
  });

  it("getSkillService returns a new instance if none was set", () => {
    // Reset to ensure no service is set
    setSkillService(null as unknown as SkillService);
    // getSkillService creates a default SkillService when none is set
    const service = getSkillService();
    expect(service).toBeDefined();
  });
});
