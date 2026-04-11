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
    executionAttempt: {
      findMany: vi.fn(),
    },
    verificationBundle: {
      findFirst: vi.fn(),
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

  it("listStarters returns the project starters catalog", () => {
    const service = new ProjectScaffoldService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const starters = service.listStarters();
    expect(Array.isArray(starters)).toBe(true);
    expect(starters.length).toBeGreaterThan(0);
    expect(starters.some((s) => s.id === "neutral_baseline")).toBe(true);
  });

  it("bootstrapEmptyProject delegates to repoService and returns project, blueprint", async () => {
    const mockBlueprint = { version: 1 };
    const repoService = {
      bootstrapEmptyProject: vi.fn().mockResolvedValue({
        repo: { id: "repo-new", displayName: "New Project" },
        blueprint: mockBlueprint,
      }),
    };
    const blueprintService = {
      generate: vi.fn().mockResolvedValue({ version: 2 }),
    };

    const service = new ProjectScaffoldService(
      repoService as never,
      blueprintService as never,
      {} as never,
      {} as never,
    );

    const result = await service.bootstrapEmptyProject({
      actor: "tester",
      folderPath: "/tmp/test-project",
    });

    expect(repoService.bootstrapEmptyProject).toHaveBeenCalledWith({
      actor: "tester",
      folderPath: "/tmp/test-project",
      displayName: undefined,
      starterId: null,
      initializeGit: true,
    });
    expect(result.project.id).toBe("repo-new");
    expect(result.blueprint).toBe(mockBlueprint);
  });

  it("bootstrapEmptyProject generates blueprint if bootstrap returns no blueprint", async () => {
    const generatedBlueprint = { version: 2 };
    const repoService = {
      bootstrapEmptyProject: vi.fn().mockResolvedValue({
        repo: { id: "repo-2" },
        blueprint: null,
      }),
    };
    const blueprintService = {
      generate: vi.fn().mockResolvedValue(generatedBlueprint),
    };

    const service = new ProjectScaffoldService(
      repoService as never,
      blueprintService as never,
      {} as never,
      {} as never,
    );

    const result = await service.bootstrapEmptyProject({
      actor: "tester",
      folderPath: "/tmp/test-project-2",
      displayName: "My Project",
      starterId: "neutral_baseline",
      initializeGit: false,
    });

    expect(blueprintService.generate).toHaveBeenCalledWith("repo-2");
    expect(result.blueprint).toBe(generatedBlueprint);
    expect(result.starterId).toBe("neutral_baseline");
  });

  it("plan returns a scaffold plan for typescript_vite_react", async () => {
    const blueprintService = {
      get: vi.fn().mockResolvedValue({
        version: 1,
        testingPolicy: {
          defaultCommands: ["npm test"],
          requiredForBehaviorChange: true,
          fullSuitePolicy: "always",
        },
        documentationPolicy: {
          requiredDocPaths: ["README.md"],
          updateUserFacingDocs: true,
          updateRunbooksWhenOpsChange: false,
        },
        executionPolicy: {
          allowParallelExecution: false,
        },
      }),
    };

    const service = new ProjectScaffoldService(
      {} as never,
      blueprintService as never,
      {} as never,
      {} as never,
    );

    const plan = await service.plan("proj-1", "typescript_vite_react");
    expect(plan.projectId).toBe("proj-1");
    expect(plan.targetFiles.length).toBeGreaterThan(0);
    expect(plan.targetFiles).toContain("package.json");
    expect(plan.requiredTests).toContain("src/App.test.tsx");
  });

  it("plan returns a neutral baseline plan", async () => {
    const blueprintService = {
      get: vi.fn().mockResolvedValue({
        version: 1,
        documentationPolicy: {
          requiredDocPaths: ["CHANGELOG.md"],
        },
      }),
    };

    const service = new ProjectScaffoldService(
      {} as never,
      blueprintService as never,
      {} as never,
      {} as never,
    );

    const plan = await service.plan("proj-1", "neutral_baseline");
    expect(plan.projectId).toBe("proj-1");
    expect(plan.targetFiles).toContain(".gitignore");
    expect(plan.targetFiles).toContain("README.md");
    expect(plan.targetFiles).toContain("AGENTS.md");
    expect(plan.requiredTests).toEqual([]);
    expect(plan.verificationCommands).toEqual([]);
    expect(plan.requiredDocs).toContain("CHANGELOG.md");
  });

  it("plan returns neutral baseline plan with null blueprint", async () => {
    const blueprintService = {
      get: vi.fn().mockResolvedValue(null),
    };

    const service = new ProjectScaffoldService(
      {} as never,
      blueprintService as never,
      {} as never,
      {} as never,
    );

    const plan = await service.plan("proj-1", "neutral_baseline");
    expect(plan.blueprintVersion).toBe(1);
    expect(plan.requiredDocs).toContain("README.md");
    expect(plan.requiredDocs).toContain("AGENTS.md");
  });

  it("execute throws when repo is not found", async () => {
    const repoService = {
      getRepo: vi.fn().mockResolvedValue(null),
    };
    const service = new ProjectScaffoldService(
      repoService as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.execute({ actor: "user", projectId: "no-repo" })).rejects.toThrow("Repo not found: no-repo");
  });

  it("neutral_baseline does not overwrite existing non-empty files", async () => {
    const worktreeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentic-no-overwrite-"));
    // Pre-create a non-empty README.md
    fs.writeFileSync(path.join(worktreeRoot, "README.md"), "# Existing README\n", "utf8");
    // Pre-create a non-empty AGENTS.md
    fs.writeFileSync(path.join(worktreeRoot, "AGENTS.md"), "# Existing Charter\n", "utf8");
    // Pre-create a .gitignore with all lines already present
    fs.writeFileSync(
      path.join(worktreeRoot, ".gitignore"),
      ".DS_Store\n*.log\n.env\n.env.local\n.idea/\n.vscode/\n",
      "utf8",
    );

    const repoService = {
      getRepo: vi.fn().mockResolvedValue({ id: "repo-1", displayName: "Existing", metadata: {} }),
      getActiveWorktreePath: vi.fn().mockResolvedValue(worktreeRoot),
      refreshGuidelines: vi.fn().mockResolvedValue(undefined),
      refreshIndex: vi.fn().mockResolvedValue(undefined),
    };
    const blueprintService = {
      get: vi.fn().mockResolvedValue({ version: 1, documentationPolicy: { requiredDocPaths: [] } }),
      generate: vi.fn().mockResolvedValue({ version: 2 }),
    };

    const service = new ProjectScaffoldService(
      repoService as never,
      blueprintService as never,
      { startExecution: vi.fn(), verifyExecution: vi.fn() } as never,
      {} as never,
    );

    const result = await service.execute({
      actor: "user",
      projectId: "repo-1",
      starterId: "neutral_baseline",
    });

    // No files should be applied since they all already exist with content
    expect(result.result.appliedFiles).toEqual([]);
    expect(result.result.status).toBe("completed");

    // Verify existing files were not overwritten
    expect(fs.readFileSync(path.join(worktreeRoot, "README.md"), "utf8")).toBe("# Existing README\n");
  });

  it("neutral_baseline merges new lines into existing gitignore", async () => {
    const worktreeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentic-merge-gitignore-"));
    // Pre-create a .gitignore with only some lines
    fs.writeFileSync(path.join(worktreeRoot, ".gitignore"), "node_modules/\n", "utf8");

    const repoService = {
      getRepo: vi.fn().mockResolvedValue({ id: "repo-1", displayName: "Partial", metadata: {} }),
      getActiveWorktreePath: vi.fn().mockResolvedValue(worktreeRoot),
      refreshGuidelines: vi.fn().mockResolvedValue(undefined),
      refreshIndex: vi.fn().mockResolvedValue(undefined),
    };
    const blueprintService = {
      get: vi.fn().mockResolvedValue({ version: 1, documentationPolicy: { requiredDocPaths: [] } }),
      generate: vi.fn().mockResolvedValue({ version: 2 }),
    };

    const service = new ProjectScaffoldService(
      repoService as never,
      blueprintService as never,
      { startExecution: vi.fn(), verifyExecution: vi.fn() } as never,
      {} as never,
    );

    const result = await service.execute({
      actor: "user",
      projectId: "repo-1",
      starterId: "neutral_baseline",
    });

    expect(result.result.appliedFiles).toContain(".gitignore");
    const content = fs.readFileSync(path.join(worktreeRoot, ".gitignore"), "utf8");
    expect(content).toContain("node_modules/");
    expect(content).toContain(".DS_Store");
    expect(content).toContain(".env");
  });

  it("neutral_baseline writes to empty existing files", async () => {
    const worktreeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentic-empty-files-"));
    // Create empty README
    fs.writeFileSync(path.join(worktreeRoot, "README.md"), "", "utf8");

    const repoService = {
      getRepo: vi.fn().mockResolvedValue({ id: "repo-1", displayName: "Empty Files", metadata: {} }),
      getActiveWorktreePath: vi.fn().mockResolvedValue(worktreeRoot),
      refreshGuidelines: vi.fn().mockResolvedValue(undefined),
      refreshIndex: vi.fn().mockResolvedValue(undefined),
    };
    const blueprintService = {
      get: vi.fn().mockResolvedValue({ version: 1, documentationPolicy: { requiredDocPaths: [] } }),
      generate: vi.fn().mockResolvedValue({ version: 2 }),
    };

    const service = new ProjectScaffoldService(
      repoService as never,
      blueprintService as never,
      { startExecution: vi.fn(), verifyExecution: vi.fn() } as never,
      {} as never,
    );

    const result = await service.execute({
      actor: "user",
      projectId: "repo-1",
      starterId: "neutral_baseline",
    });

    // Empty README should be overwritten
    expect(result.result.appliedFiles).toContain("README.md");
    const content = fs.readFileSync(path.join(worktreeRoot, "README.md"), "utf8");
    expect(content).toContain("# Empty Files");
  });

  describe("getStatus", () => {
    it("returns status from starter_last_result metadata", async () => {
      const repoService = {
        getRepo: vi.fn().mockResolvedValue({
          id: "repo-1",
          metadata: {
            starter_applied_at: "2026-01-01T00:00:00Z",
            starter_last_result: {
              status: "completed",
              applied_files: ["README.md", "AGENTS.md"],
              run_id: "run-99",
              verification_bundle_id: "vb-1",
              report_id: "rpt-1",
            },
          },
          updatedAt: "2026-01-01T00:00:00Z",
        }),
      };

      const service = new ProjectScaffoldService(
        repoService as never,
        {} as never,
        {} as never,
        {} as never,
      );

      const status = await service.getStatus("repo-1");
      expect(status).not.toBeNull();
      expect(status!.status).toBe("completed");
      expect(status!.appliedFiles).toEqual(["README.md", "AGENTS.md"]);
      expect(status!.runId).toBe("run-99");
      expect(status!.verificationBundleId).toBe("vb-1");
      expect(status!.reportId).toBe("rpt-1");
    });

    it("returns status from starter_last_result with missing applied_at (falls back to updatedAt)", async () => {
      const repoService = {
        getRepo: vi.fn().mockResolvedValue({
          id: "repo-1",
          metadata: {
            starter_last_result: {
              status: "completed",
              applied_files: ["README.md"],
              run_id: null,
              verification_bundle_id: null,
              report_id: null,
            },
          },
          updatedAt: "2025-06-01T00:00:00Z",
        }),
      };

      const service = new ProjectScaffoldService(
        repoService as never,
        {} as never,
        {} as never,
        {} as never,
      );

      const status = await service.getStatus("repo-1");
      expect(status).not.toBeNull();
      expect(status!.startedAt).toBe("2025-06-01T00:00:00Z");
      expect(status!.runId).toBeNull();
    });

    it("returns null when no starter result and no scaffold execution attempts", async () => {
      const repoService = {
        getRepo: vi.fn().mockResolvedValue({
          id: "repo-1",
          metadata: {},
          updatedAt: "2025-01-01T00:00:00Z",
        }),
      };
      mocks.prisma.executionAttempt.findMany.mockResolvedValue([]);

      const service = new ProjectScaffoldService(
        repoService as never,
        {} as never,
        {} as never,
        {} as never,
      );

      const status = await service.getStatus("repo-1");
      expect(status).toBeNull();
    });

    it("returns status from execution attempt when no starter metadata", async () => {
      const repoService = {
        getRepo: vi.fn().mockResolvedValue({
          id: "repo-1",
          metadata: {},
          updatedAt: "2025-01-01T00:00:00Z",
        }),
      };
      mocks.prisma.executionAttempt.findMany.mockResolvedValue([
        {
          id: "attempt-1",
          runId: "run-42",
          status: "completed",
          changedFiles: ["src/App.tsx", "package.json"],
          metadata: { scaffold_template: "typescript_vite_react" },
          startedAt: new Date("2025-06-01"),
          completedAt: new Date("2025-06-01T01:00:00Z"),
        },
      ]);
      mocks.prisma.verificationBundle.findFirst.mockResolvedValue({
        id: "vb-2",
        pass: true,
      });
      mocks.prisma.shareableRunReport.findUnique.mockResolvedValue({
        id: "rpt-2",
      });

      const service = new ProjectScaffoldService(
        repoService as never,
        {} as never,
        {} as never,
        {} as never,
      );

      const status = await service.getStatus("repo-1");
      expect(status).not.toBeNull();
      expect(status!.runId).toBe("run-42");
      expect(status!.executionAttemptId).toBe("attempt-1");
      expect(status!.status).toBe("completed");
      expect(status!.appliedFiles).toEqual(["src/App.tsx", "package.json"]);
      expect(status!.verificationBundleId).toBe("vb-2");
      expect(status!.reportId).toBe("rpt-2");
    });

    it("returns needs_review when verification did not pass", async () => {
      const repoService = {
        getRepo: vi.fn().mockResolvedValue({
          id: "repo-1",
          metadata: {},
        }),
      };
      mocks.prisma.executionAttempt.findMany.mockResolvedValue([
        {
          id: "attempt-fail",
          runId: "run-fail",
          status: "completed",
          changedFiles: [],
          metadata: { scaffold_template: "typescript_vite_react" },
          startedAt: new Date("2025-06-01"),
          completedAt: null,
        },
      ]);
      mocks.prisma.verificationBundle.findFirst.mockResolvedValue({
        id: "vb-fail",
        pass: false,
      });
      mocks.prisma.shareableRunReport.findUnique.mockResolvedValue(null);

      const service = new ProjectScaffoldService(
        repoService as never,
        {} as never,
        {} as never,
        {} as never,
      );

      const status = await service.getStatus("repo-1");
      expect(status!.status).toBe("needs_review");
      expect(status!.reportId).toBeNull();
      expect(status!.completedAt).toBeNull();
    });

    it("returns attempt status when no verification bundle exists", async () => {
      const repoService = {
        getRepo: vi.fn().mockResolvedValue({
          id: "repo-1",
          metadata: {},
        }),
      };
      mocks.prisma.executionAttempt.findMany.mockResolvedValue([
        {
          id: "attempt-pending",
          runId: "run-pending",
          status: "running",
          changedFiles: null,
          metadata: { scaffold_template: "typescript_vite_react" },
          startedAt: new Date("2025-06-01"),
          completedAt: null,
        },
      ]);
      mocks.prisma.verificationBundle.findFirst.mockResolvedValue(null);
      mocks.prisma.shareableRunReport.findUnique.mockResolvedValue(null);

      const service = new ProjectScaffoldService(
        repoService as never,
        {} as never,
        {} as never,
        {} as never,
      );

      const status = await service.getStatus("repo-1");
      expect(status!.status).toBe("running");
      expect(status!.appliedFiles).toEqual([]);
    });

    it("filters out non-string items from appliedFiles", async () => {
      const repoService = {
        getRepo: vi.fn().mockResolvedValue({
          id: "repo-1",
          metadata: {
            starter_last_result: {
              status: "completed",
              applied_files: ["README.md", 123, null, "AGENTS.md"],
              run_id: "run-1",
            },
          },
          updatedAt: "2025-01-01",
        }),
      };

      const service = new ProjectScaffoldService(
        repoService as never,
        {} as never,
        {} as never,
        {} as never,
      );

      const status = await service.getStatus("repo-1");
      expect(status!.appliedFiles).toEqual(["README.md", "AGENTS.md"]);
    });

    it("skips non-scaffold execution attempts", async () => {
      const repoService = {
        getRepo: vi.fn().mockResolvedValue({
          id: "repo-1",
          metadata: {},
        }),
      };
      mocks.prisma.executionAttempt.findMany.mockResolvedValue([
        {
          id: "attempt-no-scaffold",
          runId: "run-normal",
          status: "completed",
          changedFiles: ["file.ts"],
          metadata: { some_other_key: true },
          startedAt: new Date("2025-06-01"),
          completedAt: new Date("2025-06-01"),
        },
      ]);

      const service = new ProjectScaffoldService(
        repoService as never,
        {} as never,
        {} as never,
        {} as never,
      );

      const status = await service.getStatus("repo-1");
      expect(status).toBeNull();
    });

    it("handles repo with null metadata gracefully", async () => {
      const repoService = {
        getRepo: vi.fn().mockResolvedValue({
          id: "repo-1",
          metadata: null,
        }),
      };
      mocks.prisma.executionAttempt.findMany.mockResolvedValue([]);

      const service = new ProjectScaffoldService(
        repoService as never,
        {} as never,
        {} as never,
        {} as never,
      );

      const status = await service.getStatus("repo-1");
      expect(status).toBeNull();
    });

    it("handles null repo gracefully", async () => {
      const repoService = {
        getRepo: vi.fn().mockResolvedValue(null),
      };
      mocks.prisma.executionAttempt.findMany.mockResolvedValue([]);

      const service = new ProjectScaffoldService(
        repoService as never,
        {} as never,
        {} as never,
        {} as never,
      );

      const status = await service.getStatus("repo-1");
      expect(status).toBeNull();
    });

    it("uses repo updatedAt when starter_applied_at is not a string", async () => {
      const repoService = {
        getRepo: vi.fn().mockResolvedValue({
          id: "repo-1",
          metadata: {
            starter_applied_at: 12345,
            starter_last_result: {
              status: "completed",
              applied_files: [],
            },
          },
          updatedAt: "2025-12-01T00:00:00Z",
        }),
      };

      const service = new ProjectScaffoldService(
        repoService as never,
        {} as never,
        {} as never,
        {} as never,
      );

      const status = await service.getStatus("repo-1");
      expect(status!.startedAt).toBe("2025-12-01T00:00:00Z");
    });

    it("falls back to now when no updatedAt and no starter_applied_at", async () => {
      const repoService = {
        getRepo: vi.fn().mockResolvedValue({
          id: "repo-1",
          metadata: {
            starter_last_result: {
              status: "completed",
              applied_files: [],
            },
          },
        }),
      };

      const service = new ProjectScaffoldService(
        repoService as never,
        {} as never,
        {} as never,
        {} as never,
      );

      const status = await service.getStatus("repo-1");
      expect(status!.startedAt).toBeTruthy();
      // Should be a recent ISO string
      const parsed = Date.parse(status!.startedAt);
      expect(parsed).toBeGreaterThan(Date.now() - 5000);
    });
  });

  describe("execute with needs_review result", () => {
    it("returns needs_review when verification does not pass", async () => {
      const repoService = {
        getRepo: vi.fn().mockResolvedValue({ id: "repo-1", displayName: "Test" }),
        getActiveWorktreePath: vi.fn().mockResolvedValue("/tmp/test"),
        refreshGuidelines: vi.fn().mockResolvedValue(undefined),
        refreshIndex: vi.fn().mockResolvedValue(undefined),
      };
      const blueprintService = {
        get: vi.fn().mockResolvedValue({
          version: 1,
          testingPolicy: { defaultCommands: [], requiredForBehaviorChange: false, fullSuitePolicy: "never" },
          documentationPolicy: { requiredDocPaths: [], updateUserFacingDocs: false, updateRunbooksWhenOpsChange: false },
          executionPolicy: { allowParallelExecution: false },
          providerPolicy: { executionProfileId: "balanced" },
        }),
        generate: vi.fn().mockResolvedValue({ version: 2 }),
      };
      const executionService = {
        startExecution: vi.fn().mockResolvedValue({ id: "att-1", changedFiles: ["a.ts"] }),
        verifyExecution: vi.fn().mockResolvedValue({ id: "vb-1", pass: false }),
      };
      const providerOrchestrator = {
        getModelRoleBinding: vi.fn().mockResolvedValue({ providerId: "openai-responses" }),
      };

      mocks.prisma.shareableRunReport.findUnique.mockResolvedValue(null);

      const service = new ProjectScaffoldService(
        repoService as never,
        blueprintService as never,
        executionService as never,
        providerOrchestrator as never,
      );

      const result = await service.execute({ actor: "user", projectId: "repo-1" });
      expect(result.result.status).toBe("needs_review");
      expect(result.result.reportId).toBeNull();
    });
  });
});
