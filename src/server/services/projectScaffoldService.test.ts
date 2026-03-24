import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    repoRegistry: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    shareableRunReport: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("../db", () => ({
  prisma: mocks.prisma,
}));

import { ProjectScaffoldService } from "./projectScaffoldService";

describe("ProjectScaffoldService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.repoRegistry.findUnique.mockResolvedValue({ metadata: {} });
    mocks.prisma.repoRegistry.update.mockResolvedValue({});
    mocks.prisma.shareableRunReport.findUnique.mockResolvedValue({ id: "report-1" });
  });

  it("uses the active coder role binding provider for scaffold execution", async () => {
    const repoService = {
      getRepo: vi.fn().mockResolvedValue({ id: "repo-1" }),
      getActiveWorktreePath: vi.fn().mockResolvedValue("/managed/worktrees/repo-1/active"),
      refreshGuidelines: vi.fn().mockResolvedValue(undefined),
      refreshIndex: vi.fn().mockResolvedValue(undefined),
    };
    const blueprintService = {
      get: vi.fn().mockResolvedValue({
        version: 2,
        testingPolicy: {
          defaultCommands: ["npm test", "npm run build"],
          requiredForBehaviorChange: true,
          fullSuitePolicy: "always",
        },
        documentationPolicy: {
          requiredDocPaths: ["README.md", "AGENTS.md"],
          updateUserFacingDocs: true,
          updateRunbooksWhenOpsChange: false,
        },
        executionPolicy: {
          allowParallelExecution: false,
        },
        providerPolicy: {
          executionProfileId: "balanced",
        },
      }),
      generate: vi.fn().mockResolvedValue({ version: 3 }),
    };
    const executionService = {
      startExecution: vi.fn().mockResolvedValue({
        id: "attempt-1",
        changedFiles: ["src/App.tsx"],
      }),
      verifyExecution: vi.fn().mockResolvedValue({
        id: "verification-1",
        pass: true,
      }),
    };
    const providerOrchestrator = {
      getModelRoleBinding: vi.fn().mockResolvedValue({
        role: "coder_default",
        providerId: "openai-responses",
        pluginId: null,
        model: "gpt-5.3-codex",
        temperature: 0.1,
        maxTokens: 1800,
        reasoningMode: "off",
      }),
    };

    const service = new ProjectScaffoldService(
      repoService as never,
      blueprintService as never,
      executionService as never,
      providerOrchestrator as never,
    );

    const result = await service.execute({
      actor: "user",
      projectId: "repo-1",
    });

    expect(providerOrchestrator.getModelRoleBinding).toHaveBeenCalledWith("coder_default");
    expect(executionService.startExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        repoId: "repo-1",
        modelRole: "coder_default",
        providerId: "openai-responses",
      }),
    );
    expect(result.result.status).toBe("completed");
    expect(result.result.reportId).toBe("report-1");
  });

  it("applies the neutral baseline without execution or command verification", async () => {
    const worktreeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentic-neutral-baseline-"));
    const repoService = {
      getRepo: vi.fn().mockResolvedValue({ id: "repo-1", displayName: "Fresh Project", metadata: {} }),
      getActiveWorktreePath: vi.fn().mockResolvedValue(worktreeRoot),
      refreshGuidelines: vi.fn().mockResolvedValue(undefined),
      refreshIndex: vi.fn().mockResolvedValue(undefined),
    };
    const blueprintService = {
      get: vi.fn().mockResolvedValue({ version: 1, documentationPolicy: { requiredDocPaths: [] } }),
      generate: vi.fn().mockResolvedValue({ version: 2 }),
    };
    const executionService = {
      startExecution: vi.fn(),
      verifyExecution: vi.fn(),
    };
    const providerOrchestrator = {
      getModelRoleBinding: vi.fn(),
    };

    const service = new ProjectScaffoldService(
      repoService as never,
      blueprintService as never,
      executionService as never,
      providerOrchestrator as never,
    );

    const result = await service.execute({
      actor: "user",
      projectId: "repo-1",
      starterId: "neutral_baseline",
    });

    expect(result.result.runId).toBeNull();
    expect(result.result.status).toBe("completed");
    expect(result.result.appliedFiles).toEqual(expect.arrayContaining(["README.md", "AGENTS.md", ".gitignore"]));
    expect(executionService.startExecution).not.toHaveBeenCalled();
    expect(executionService.verifyExecution).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(worktreeRoot, "README.md"))).toBe(true);
    expect(fs.existsSync(path.join(worktreeRoot, "AGENTS.md"))).toBe(true);
    expect(fs.existsSync(path.join(worktreeRoot, ".gitignore"))).toBe(true);
  });
});
