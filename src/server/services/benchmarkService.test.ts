import { describe, expect, it, vi, beforeEach } from "vitest";
import { BenchmarkService } from "./benchmarkService";
import type {
  BenchmarkProject,
  BenchmarkTask,
  BenchmarkRun,
  BenchmarkScorecard,
  OutcomeEvidence,
} from "../../shared/contracts";

// ── Mock dependencies ──────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  mockPrisma: {
    benchmarkProject: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    benchmarkTask: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    benchmarkRun: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    benchmarkScorecard: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    benchmarkOutcomeEvidence: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    benchmarkExampleCandidate: {
      upsert: vi.fn(),
    },
    shareableRunReport: {
      upsert: vi.fn(),
    },
    repoRegistry: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    projectBlueprint: {
      findFirst: vi.fn(),
    },
    retrievalTrace: {
      findMany: vi.fn(),
    },
    verificationBundle: {
      findFirst: vi.fn(),
    },
  },
  mockPublishEvent: vi.fn(),
  mockV2EventService: {
    appendEvent: vi.fn().mockResolvedValue(undefined),
  },
  mockRepoService: {
    getRepo: vi.fn(),
    getGuidelines: vi.fn(),
    importManagedPack: vi.fn(),
    attachLocalRepo: vi.fn(),
  },
  mockExecutionService: {
    planExecution: vi.fn(),
    startExecution: vi.fn(),
    verifyExecution: vi.fn(),
  },
  mockFs: {
    readdirSync: vi.fn(),
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    cpSync: vi.fn(),
    rmSync: vi.fn(),
  },
  mockExecSync: vi.fn(),
  mockYAML: {
    parse: vi.fn(),
  },
}));

vi.mock("../db", () => ({
  prisma: mocks.mockPrisma,
}));

vi.mock("../eventBus", () => ({
  publishEvent: mocks.mockPublishEvent,
}));

vi.mock("./v2EventService", () => ({
  V2EventService: vi.fn(() => mocks.mockV2EventService),
}));

vi.mock("./repoService", () => ({
  RepoService: vi.fn(() => mocks.mockRepoService),
}));

vi.mock("./executionService", () => ({
  ExecutionService: vi.fn(() => mocks.mockExecutionService),
}));

vi.mock("node:fs", () => ({
  default: mocks.mockFs,
}));

vi.mock("node:child_process", () => ({
  execSync: mocks.mockExecSync,
}));

vi.mock("yaml", () => ({
  default: mocks.mockYAML,
}));

vi.mock("./verificationPolicy", () => ({
  buildVerificationCommandPlans: vi.fn((cmds) => cmds.map((c: string) => ({ command: c }))),
}));

vi.mock("./providerOrchestrator", () => ({
  applyEscalationPolicy: vi.fn((role) => role),
}));

vi.mock("./shellDetect", () => ({
  detectShell: vi.fn(() => "/bin/bash"),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function makeMockProject(overrides?: Partial<BenchmarkProject>): any {
  return {
    id: "proj-1",
    repoId: "repo-1",
    projectKey: "test-project",
    displayName: "Test Project",
    sourceKind: "managed_pack",
    sourceUri: "/path/to/project",
    manifestPath: "/path/to/manifest.yaml",
    languages: ["typescript"],
    setupCommand: "npm install",
    verifyCommand: "npm test",
    resetCommand: "git reset --hard",
    installCommand: "npm ci",
    guidelineSources: ["README.md"],
    timeBudgetSec: 300,
    networkPolicy: "unrestricted",
    defaultProviderRole: "coder_default",
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeMockTask(overrides?: Partial<BenchmarkTask>): any {
  return {
    id: "task-1",
    projectId: "proj-1",
    taskKey: "task-key-1",
    title: "Test Task",
    category: "implement",
    prompt: "Implement a feature",
    expectedArtifacts: ["src/feature.ts"],
    requiredChecks: ["npm test"],
    requiredDocs: ["docs/feature.md"],
    hardFailIfMissing: [],
    scoringWeights: {},
    acceptanceCommands: ["npm run acceptance"],
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeMockRun(overrides?: Partial<BenchmarkRun>): any {
  return {
    id: "run-1",
    projectId: "proj-1",
    repoId: "repo-1",
    taskId: "task-1",
    mode: "api_regression",
    providerRole: "coder_default",
    status: "running",
    actor: "test-user",
    worktreePath: "/tmp/run-1",
    chatSessionId: null,
    routingDecisionId: null,
    metadata: {},
    startedAt: new Date(),
    completedAt: null,
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeMockRepo() {
  return {
    id: "repo-1",
    displayName: "Test Repo",
    managedWorktreeRoot: "/tmp/worktree",
    sourceKind: "managed_pack",
    sourceUri: "/path/to/repo",
  };
}

let service: BenchmarkService;

beforeEach(() => {
  vi.clearAllMocks();
  service = new BenchmarkService(
    mocks.mockV2EventService as any,
    mocks.mockRepoService as any,
    mocks.mockExecutionService as any
  );

  // Default mock implementations
  mocks.mockFs.existsSync.mockReturnValue(true);
  mocks.mockFs.readdirSync.mockReturnValue([]);
  mocks.mockFs.mkdirSync.mockReturnValue(undefined);
  mocks.mockFs.cpSync.mockReturnValue(undefined);
  mocks.mockExecSync.mockReturnValue("success");
});

// ── syncProjectManifests ───────────────────────────────────────────────────

describe("syncProjectManifests", () => {
  it("loads manifests from filesystem and upserts projects", async () => {
    mocks.mockFs.readdirSync.mockReturnValue([
      { name: "project-a", isDirectory: () => true },
      { name: "project-b", isDirectory: () => true },
    ] as any);

    mocks.mockFs.existsSync.mockImplementation((path: string) => {
      return path.includes("agentic-benchmark.yaml");
    });

    mocks.mockFs.readFileSync.mockReturnValue("yaml content");
    mocks.mockYAML.parse.mockReturnValue({
      projectId: "test-project",
      displayName: "Test Project",
      source: { kind: "managed_pack", uri: "/path/to/source" },
      languages: ["typescript"],
      setupCommand: "npm install",
      verifyCommand: "npm test",
      timeBudgetSec: 300,
      networkPolicy: "unrestricted",
      defaultProviderRole: "coder_default",
      guidelineSources: [],
      taskSpecs: [
        {
          taskId: "task-1",
          title: "Task 1",
          category: "implement",
          prompt: "Do something",
          expectedArtifacts: [],
          requiredChecks: [],
          requiredDocs: [],
          hardFailIfMissing: [],
        },
      ],
    });

    const mockProjectRow = {
      id: "proj-1",
      projectKey: "test-project",
      displayName: "Test Project",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mocks.mockPrisma.benchmarkProject.upsert.mockResolvedValue({
      ...mockProjectRow,
      repoId: null,
      sourceKind: "managed_pack",
      sourceUri: "/path/to/source",
      manifestPath: "path",
      languages: ["typescript"],
      setupCommand: "npm install",
      verifyCommand: "npm test",
      resetCommand: null,
      installCommand: null,
      guidelineSources: [],
      timeBudgetSec: 300,
      networkPolicy: "unrestricted",
      defaultProviderRole: "coder_default",
      metadata: {},
    });

    mocks.mockPrisma.benchmarkTask.upsert.mockResolvedValue({});

    const projects = await service.syncProjectManifests();

    expect(projects).toHaveLength(2);
    expect(mocks.mockPrisma.benchmarkProject.upsert).toHaveBeenCalledTimes(2);
    expect(mocks.mockPrisma.benchmarkTask.upsert).toHaveBeenCalledTimes(2);
  });

  it("handles manifests with resetCommand and installCommand", async () => {
    mocks.mockFs.readdirSync.mockReturnValue([
      { name: "project-a", isDirectory: () => true },
    ] as any);

    mocks.mockFs.existsSync.mockReturnValue(true);
    mocks.mockFs.readFileSync.mockReturnValue("yaml");
    mocks.mockYAML.parse.mockReturnValue({
      projectId: "test-project",
      displayName: "Test Project",
      source: { kind: "local_path", uri: "/local/path", ref: "main" },
      languages: ["go"],
      setupCommand: "make setup",
      verifyCommand: "make verify",
      resetCommand: "make reset",
      installCommand: "make install",
      timeBudgetSec: 600,
      networkPolicy: "offline",
      defaultProviderRole: "review_deep",
      guidelineSources: ["CONTRIBUTING.md"],
      taskSpecs: [],
    });

    mocks.mockPrisma.benchmarkProject.upsert.mockResolvedValue({
      id: "proj-1",
      projectKey: "test-project",
      resetCommand: "make reset",
      installCommand: "make install",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    await service.syncProjectManifests();

    expect(mocks.mockPrisma.benchmarkProject.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          resetCommand: "make reset",
          installCommand: "make install",
          metadata: { ref: "main" },
        }),
        update: expect.objectContaining({
          resetCommand: "make reset",
          installCommand: "make install",
          metadata: { ref: "main" },
        }),
      })
    );
  });

  it("skips directories without manifest files", async () => {
    mocks.mockFs.readdirSync.mockReturnValue([
      { name: "project-a", isDirectory: () => true },
      { name: "file.txt", isDirectory: () => false },
    ] as any);

    mocks.mockFs.existsSync.mockReturnValue(false);

    const projects = await service.syncProjectManifests();

    expect(projects).toHaveLength(0);
    expect(mocks.mockPrisma.benchmarkProject.upsert).not.toHaveBeenCalled();
  });
});

// ── listProjects ───────────────────────────────────────────────────────────

describe("listProjects", () => {
  it("syncs manifests then returns all projects", async () => {
    mocks.mockFs.readdirSync.mockReturnValue([]);
    mocks.mockPrisma.benchmarkProject.findMany.mockResolvedValue([
      {
        id: "proj-1",
        projectKey: "project-1",
        displayName: "Project 1",
        languages: ["typescript"],
        guidelineSources: [],
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any,
    ]);

    const projects = await service.listProjects();

    expect(projects).toHaveLength(1);
    expect(projects[0].projectKey).toBe("project-1");
    expect(mocks.mockPrisma.benchmarkProject.findMany).toHaveBeenCalledWith({
      orderBy: [{ displayName: "asc" }],
    });
  });
});

// ── getProject ─────────────────────────────────────────────────────────────

describe("getProject", () => {
  it("returns project with tasks", async () => {
    const mockProject = makeMockProject();
    const mockTask = makeMockTask();

    mocks.mockPrisma.benchmarkProject.findUnique.mockResolvedValue(mockProject);
    mocks.mockPrisma.benchmarkTask.findMany.mockResolvedValue([mockTask]);

    const result = await service.getProject("proj-1");

    expect(result).not.toBeNull();
    expect(result!.project.id).toBe("proj-1");
    expect(result!.tasks).toHaveLength(1);
    expect(result!.tasks[0].id).toBe("task-1");
  });

  it("returns null if project not found", async () => {
    mocks.mockPrisma.benchmarkProject.findUnique.mockResolvedValue(null);

    const result = await service.getProject("nonexistent");

    expect(result).toBeNull();
  });
});

// ── ensureRepoForProject ───────────────────────────────────────────────────

describe("ensureRepoForProject", () => {
  it("returns existing repo if repoId is set", async () => {
    const project = makeMockProject({ repoId: "repo-1" });
    const mockRepo = makeMockRepo();

    mocks.mockRepoService.getRepo.mockResolvedValue(mockRepo);

    const repo = await service.ensureRepoForProject(project);

    expect(repo).toEqual(mockRepo);
    expect(mocks.mockRepoService.getRepo).toHaveBeenCalledWith("repo-1");
  });

  it("imports managed_pack if not found", async () => {
    const project = makeMockProject({ repoId: null, sourceKind: "managed_pack" });
    const mockRepo = makeMockRepo();

    mocks.mockRepoService.getRepo.mockResolvedValue(null);
    mocks.mockPrisma.repoRegistry.findMany.mockResolvedValue([]);
    mocks.mockRepoService.importManagedPack.mockResolvedValue({ repo: mockRepo });
    mocks.mockPrisma.benchmarkProject.update.mockResolvedValue({});

    const repo = await service.ensureRepoForProject(project);

    expect(repo).toEqual(mockRepo);
    expect(mocks.mockRepoService.importManagedPack).toHaveBeenCalledWith({
      actor: "system",
      project_key: expect.any(String),
      display_name: project.displayName,
    });
  });

  it("attaches local_path repo if not found", async () => {
    const project = makeMockProject({
      repoId: null,
      sourceKind: "local_path",
      sourceUri: "/local/path",
    });
    const mockRepo = makeMockRepo();

    mocks.mockRepoService.getRepo.mockResolvedValue(null);
    mocks.mockPrisma.repoRegistry.findFirst.mockResolvedValue(null);
    mocks.mockRepoService.attachLocalRepo.mockResolvedValue({ repo: mockRepo });
    mocks.mockPrisma.benchmarkProject.update.mockResolvedValue({});

    const repo = await service.ensureRepoForProject(project);

    expect(repo).toEqual(mockRepo);
    expect(mocks.mockRepoService.attachLocalRepo).toHaveBeenCalledWith({
      actor: "system",
      source_path: "/local/path",
      display_name: project.displayName,
    });
  });

  it("finds existing managed_pack by sourceUri", async () => {
    const project = makeMockProject({
      repoId: null,
      sourceKind: "managed_pack",
      sourceUri: "/managed/pack",
    });
    const existingRepo = {
      id: "existing-repo",
      sourceUri: "/managed/pack",
      sourceKind: "managed_pack",
      metadata: {},
    };
    const mockRepo = makeMockRepo();

    // Only one call since repoId is null - directly calls getRepo after finding existing
    mocks.mockRepoService.getRepo.mockResolvedValue(mockRepo);
    mocks.mockPrisma.repoRegistry.findMany.mockResolvedValue([existingRepo as any]);
    mocks.mockPrisma.benchmarkProject.update.mockResolvedValue({});

    const repo = await service.ensureRepoForProject(project);

    expect(repo).toEqual(mockRepo);
    expect(mocks.mockPrisma.benchmarkProject.update).toHaveBeenCalledWith({
      where: { id: project.id },
      data: { repoId: existingRepo.id },
    });
    expect(mocks.mockRepoService.getRepo).toHaveBeenCalledWith("existing-repo");
  });

  it("returns null for unsupported source kind", async () => {
    const project = makeMockProject({ repoId: null, sourceKind: "unsupported" as any });

    mocks.mockRepoService.getRepo.mockResolvedValue(null);

    const repo = await service.ensureRepoForProject(project);

    expect(repo).toBeNull();
  });
});

// ── startRun ───────────────────────────────────────────────────────────────

describe("startRun", () => {
  it("creates a benchmark run and copies worktree", async () => {
    const mockProject = makeMockProject();
    const mockTask = makeMockTask();
    const mockRepo = makeMockRepo();
    const mockRun = makeMockRun();

    mocks.mockFs.readdirSync.mockReturnValue([]);
    mocks.mockPrisma.benchmarkProject.findUnique.mockResolvedValue(mockProject);
    mocks.mockPrisma.benchmarkTask.findUnique.mockResolvedValue(mockTask);
    mocks.mockRepoService.getRepo.mockResolvedValue(mockRepo);
    mocks.mockPrisma.benchmarkRun.create.mockResolvedValue(mockRun);
    mocks.mockPrisma.benchmarkOutcomeEvidence.create.mockResolvedValue({ id: "evidence-1" });
    mocks.mockExecSync.mockReturnValue("setup success");

    const result = await service.startRun({
      actor: "test-user",
      project_id: "proj-1",
      task_id: "task-1",
    });

    expect(result.run.id).toBe("run-1");
    expect(result.repo).toEqual(mockRepo);
    expect(result.project.id).toBe("proj-1");
    expect(result.task.id).toBe("task-1");
    expect(mocks.mockFs.cpSync).toHaveBeenCalled();
    expect(mocks.mockPrisma.benchmarkRun.create).toHaveBeenCalled();
    expect(mocks.mockPublishEvent).toHaveBeenCalledWith(
      "global",
      "benchmark.run.started",
      expect.any(Object)
    );
  });

  it("runs setup command if provided", async () => {
    const mockProject = makeMockProject({ setupCommand: "make setup" });
    const mockTask = makeMockTask();
    const mockRepo = makeMockRepo();
    const mockRun = makeMockRun();

    mocks.mockFs.readdirSync.mockReturnValue([]);
    mocks.mockPrisma.benchmarkProject.findUnique.mockResolvedValue(mockProject);
    mocks.mockPrisma.benchmarkTask.findUnique.mockResolvedValue(mockTask);
    mocks.mockRepoService.getRepo.mockResolvedValue(mockRepo);
    mocks.mockPrisma.benchmarkRun.create.mockResolvedValue(mockRun);
    mocks.mockPrisma.benchmarkOutcomeEvidence.create.mockResolvedValue({ id: "evidence-1" });
    mocks.mockExecSync.mockReturnValue("setup output");

    await service.startRun({
      actor: "test-user",
      project_id: "proj-1",
      task_id: "task-1",
    });

    expect(mocks.mockExecSync).toHaveBeenCalledWith(
      "make setup",
      expect.objectContaining({
        encoding: "utf8",
        shell: "/bin/bash",
      })
    );
    expect(mocks.mockPrisma.benchmarkOutcomeEvidence.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: "build_result",
        payload: expect.objectContaining({
          phase: "setup",
          command: "make setup",
        }),
      }),
    });
  });

  it("throws if project not found", async () => {
    mocks.mockFs.readdirSync.mockReturnValue([]);
    mocks.mockPrisma.benchmarkProject.findUnique.mockResolvedValue(null);

    await expect(
      service.startRun({
        actor: "test-user",
        project_id: "nonexistent",
        task_id: "task-1",
      })
    ).rejects.toThrow("Benchmark project not found");
  });

  it("throws if task not found", async () => {
    const mockProject = makeMockProject();

    mocks.mockFs.readdirSync.mockReturnValue([]);
    mocks.mockPrisma.benchmarkProject.findUnique.mockResolvedValue(mockProject);
    mocks.mockPrisma.benchmarkTask.findUnique.mockResolvedValue(null);

    await expect(
      service.startRun({
        actor: "test-user",
        project_id: "proj-1",
        task_id: "nonexistent",
      })
    ).rejects.toThrow("Benchmark task not found");
  });

  it("uses provided repo_id if given", async () => {
    const mockProject = makeMockProject();
    const mockTask = makeMockTask();
    const mockRepo = makeMockRepo();
    const mockRun = makeMockRun();

    mocks.mockFs.readdirSync.mockReturnValue([]);
    mocks.mockPrisma.benchmarkProject.findUnique.mockResolvedValue(mockProject);
    mocks.mockPrisma.benchmarkTask.findUnique.mockResolvedValue(mockTask);
    mocks.mockRepoService.getRepo.mockResolvedValue(mockRepo);
    mocks.mockPrisma.benchmarkRun.create.mockResolvedValue(mockRun);
    mocks.mockPrisma.benchmarkOutcomeEvidence.create.mockResolvedValue({ id: "evidence-1" });

    await service.startRun({
      actor: "test-user",
      project_id: "proj-1",
      task_id: "task-1",
      repo_id: "custom-repo-id",
    });

    expect(mocks.mockRepoService.getRepo).toHaveBeenCalledWith("custom-repo-id");
  });
});

// ── executeTask ────────────────────────────────────────────────────────────

describe("executeTask", () => {
  it("plans, starts, and verifies execution", async () => {
    const mockRun = makeMockRun();
    const mockTask = makeMockTask();
    const mockProject = makeMockProject();

    mocks.mockPrisma.benchmarkRun.findUnique.mockResolvedValue(mockRun);
    mocks.mockPrisma.benchmarkTask.findUnique.mockResolvedValue(mockTask);
    mocks.mockPrisma.benchmarkProject.findUnique.mockResolvedValue(mockProject);

    mocks.mockExecutionService.planExecution.mockResolvedValue({
      routingDecision: { id: "routing-1", modelRole: "coder_default", providerId: "provider-1" },
      contextManifest: { id: "manifest-1" },
      contextPack: { id: "pack-1" },
    });

    mocks.mockExecutionService.startExecution.mockResolvedValue({
      id: "attempt-1",
    });

    mocks.mockExecutionService.verifyExecution.mockResolvedValue({
      id: "verification-1",
    });

    mocks.mockPrisma.benchmarkRun.update.mockResolvedValue({
      ...mockRun,
      routingDecisionId: "routing-1",
    });

    const result = await service.executeTask("run-1", "test-user");

    expect(result.executionAttempt.id).toBe("attempt-1");
    expect(result.verification.id).toBe("verification-1");
    expect(mocks.mockExecutionService.planExecution).toHaveBeenCalled();
    expect(mocks.mockExecutionService.startExecution).toHaveBeenCalled();
    expect(mocks.mockExecutionService.verifyExecution).toHaveBeenCalled();
    expect(mocks.mockV2EventService.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "benchmark.task.started",
      })
    );
  });

  it("throws if run not found", async () => {
    mocks.mockPrisma.benchmarkRun.findUnique.mockResolvedValue(null);

    await expect(service.executeTask("nonexistent", "test-user")).rejects.toThrow(
      "Benchmark run not found"
    );
  });

  it("throws if task or project missing", async () => {
    const mockRun = makeMockRun();

    mocks.mockPrisma.benchmarkRun.findUnique.mockResolvedValue(mockRun);
    mocks.mockPrisma.benchmarkTask.findUnique.mockResolvedValue(null);

    await expect(service.executeTask("run-1", "test-user")).rejects.toThrow(
      "Benchmark run is missing project/task state"
    );
  });

  it("uses decompose query mode for decompose category", async () => {
    const mockRun = makeMockRun();
    const mockTask = makeMockTask({ category: "decompose" });
    const mockProject = makeMockProject();

    mocks.mockPrisma.benchmarkRun.findUnique.mockResolvedValue(mockRun);
    mocks.mockPrisma.benchmarkTask.findUnique.mockResolvedValue(mockTask);
    mocks.mockPrisma.benchmarkProject.findUnique.mockResolvedValue(mockProject);

    mocks.mockExecutionService.planExecution.mockResolvedValue({
      routingDecision: { id: "routing-1", modelRole: "review_deep", providerId: "provider-1" },
      contextManifest: { id: "manifest-1" },
      contextPack: { id: "pack-1" },
    });

    mocks.mockExecutionService.startExecution.mockResolvedValue({ id: "attempt-1" });
    mocks.mockExecutionService.verifyExecution.mockResolvedValue({ id: "verification-1" });
    mocks.mockPrisma.benchmarkRun.update.mockResolvedValue(mockRun);

    await service.executeTask("run-1", "test-user");

    expect(mocks.mockExecutionService.planExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        queryMode: "architecture",
      })
    );
  });
});

// ── scoreRun ───────────────────────────────────────────────────────────────

describe("scoreRun", () => {
  it("scores a passing run and creates scorecard", async () => {
    const mockRun = makeMockRun();
    const mockTask = makeMockTask();
    const mockProject = makeMockProject();

    mocks.mockPrisma.benchmarkRun.findUnique.mockResolvedValue(mockRun);
    mocks.mockPrisma.benchmarkTask.findUnique.mockResolvedValue(mockTask);
    mocks.mockPrisma.benchmarkProject.findUnique.mockResolvedValue(mockProject);
    mocks.mockRepoService.getGuidelines.mockResolvedValue({
      sourceRefs: ["README.md"],
    });
    mocks.mockPrisma.projectBlueprint.findFirst.mockResolvedValue(null);
    mocks.mockPrisma.retrievalTrace.findMany.mockResolvedValue([{ id: "trace-1" }]);
    mocks.mockPrisma.verificationBundle.findFirst.mockResolvedValue({
      pass: true,
      failures: [],
    });

    mocks.mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("npm test")) return "all tests passed";
      if (cmd.includes("git status")) return "";
      return "";
    });

    mocks.mockFs.existsSync.mockReturnValue(true);

    mocks.mockPrisma.benchmarkOutcomeEvidence.create
      .mockResolvedValueOnce({
        id: "ev-1",
        payload: { command: "npm test", ok: true, stdout: "success", stderr: "", exitCode: 0 },
      } as any)
      .mockResolvedValueOnce({
        id: "ev-2",
        payload: { changed_files: [" M src/feature.ts"] },
      } as any);

    const mockScorecard = {
      runId: "run-1",
      pass: true,
      totalScore: 80,
      functionalCorrectness: 40,
      guidelineAdherence: 15,
      verificationDiscipline: 10,
      patchQuality: 8,
      retrievalDiscipline: 5,
      policyCompliance: 2,
      latencyRecovery: 0,
      hardFailures: [],
      evidenceRefs: ["ev-1", "ev-2"],
      summary: "Passed",
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mocks.mockPrisma.benchmarkScorecard.upsert.mockResolvedValue(mockScorecard as any);
    mocks.mockPrisma.benchmarkRun.update.mockResolvedValue(mockRun);
    mocks.mockPrisma.shareableRunReport.upsert.mockResolvedValue({ id: "report-1" });
    mocks.mockPrisma.benchmarkExampleCandidate.upsert.mockResolvedValue({});
    mocks.mockPrisma.benchmarkRun.findUniqueOrThrow.mockResolvedValue(mockRun);
    mocks.mockPrisma.benchmarkOutcomeEvidence.findMany.mockResolvedValue([]);

    const result = await service.scoreRun("run-1", "test-user");

    expect(result.scorecard.pass).toBe(true);
    expect(mocks.mockPrisma.benchmarkScorecard.upsert).toHaveBeenCalled();
    expect(mocks.mockPrisma.benchmarkExampleCandidate.upsert).toHaveBeenCalled();
  });

  it("fails run with hard failures", async () => {
    const mockRun = makeMockRun();
    const mockTask = makeMockTask({ requiredDocs: ["missing.md"] });
    const mockProject = makeMockProject();

    mocks.mockPrisma.benchmarkRun.findUnique.mockResolvedValue(mockRun);
    mocks.mockPrisma.benchmarkTask.findUnique.mockResolvedValue(mockTask);
    mocks.mockPrisma.benchmarkProject.findUnique.mockResolvedValue(mockProject);
    mocks.mockRepoService.getGuidelines.mockResolvedValue(null);
    mocks.mockPrisma.projectBlueprint.findFirst.mockResolvedValue(null);
    mocks.mockPrisma.retrievalTrace.findMany.mockResolvedValue([]);
    mocks.mockPrisma.verificationBundle.findFirst.mockResolvedValue(null);

    mocks.mockFs.existsSync.mockReturnValue(false);

    mocks.mockExecSync.mockImplementation(() => {
      const error: any = new Error("Command failed");
      error.status = 1;
      error.stdout = "";
      error.stderr = "tests failed";
      throw error;
    });

    mocks.mockPrisma.benchmarkOutcomeEvidence.create
      .mockResolvedValueOnce({
        id: "ev-1",
        payload: { command: "npm test", ok: false, stdout: "", stderr: "tests failed", exitCode: 1 },
      } as any)
      .mockResolvedValueOnce({
        id: "ev-2",
        payload: { changed_files: [] },
      } as any);

    const mockScorecard = {
      runId: "run-1",
      pass: false,
      totalScore: 20,
      functionalCorrectness: 0,
      guidelineAdherence: 6,
      verificationDiscipline: 5,
      patchQuality: 4,
      retrievalDiscipline: 0,
      policyCompliance: 3,
      latencyRecovery: 2,
      hardFailures: ["required_doc_missing:missing.md", "verify_command_failed"],
      evidenceRefs: ["ev-1", "ev-2"],
      summary: "Failed",
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mocks.mockPrisma.benchmarkScorecard.upsert.mockResolvedValue(mockScorecard as any);
    mocks.mockPrisma.benchmarkRun.update.mockResolvedValue({ ...mockRun, status: "failed" });
    mocks.mockPrisma.shareableRunReport.upsert.mockResolvedValue({ id: "report-1" });
    mocks.mockPrisma.benchmarkRun.findUniqueOrThrow.mockResolvedValue(mockRun);
    mocks.mockPrisma.benchmarkOutcomeEvidence.findMany.mockResolvedValue([]);

    const result = await service.scoreRun("run-1", "test-user");

    expect(result.scorecard.pass).toBe(false);
    expect(mocks.mockV2EventService.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "benchmark.run.failed",
      })
    );
  });

  it("applies blueprint-based policy compliance scoring", async () => {
    const mockRun = makeMockRun();
    const mockTask = makeMockTask();
    const mockProject = makeMockProject();
    const mockBlueprint = {
      testingPolicy: { requiredForBehaviorChange: true },
      documentationPolicy: { updateUserFacingDocs: true, requiredDocPaths: ["docs/api.md"] },
      executionPolicy: { maxChangedFilesBeforeReview: 5 },
    };

    mocks.mockPrisma.benchmarkRun.findUnique.mockResolvedValue(mockRun);
    mocks.mockPrisma.benchmarkTask.findUnique.mockResolvedValue(mockTask);
    mocks.mockPrisma.benchmarkProject.findUnique.mockResolvedValue(mockProject);
    mocks.mockRepoService.getGuidelines.mockResolvedValue(null);
    mocks.mockPrisma.projectBlueprint.findFirst.mockResolvedValue(mockBlueprint);
    mocks.mockPrisma.retrievalTrace.findMany.mockResolvedValue([{ id: "trace-1" }]);
    mocks.mockPrisma.verificationBundle.findFirst.mockResolvedValue({ pass: true, failures: [] });

    mocks.mockFs.existsSync.mockReturnValue(true);
    mocks.mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("git status")) return " M src/api.ts\n M src/utils.ts";
      return "success";
    });

    mocks.mockPrisma.benchmarkOutcomeEvidence.create
      .mockResolvedValueOnce({
        id: "ev-1",
        payload: { command: "npm test", ok: true, stdout: "success", stderr: "", exitCode: 0 },
      } as any)
      .mockResolvedValueOnce({
        id: "ev-2",
        payload: { changed_files: [" M src/api.ts", " M src/utils.ts"] },
      } as any);
    mocks.mockPrisma.benchmarkScorecard.upsert.mockResolvedValue({
      runId: "run-1",
      pass: true,
      totalScore: 90,
      functionalCorrectness: 40,
      guidelineAdherence: 6,
      verificationDiscipline: 15,
      patchQuality: 10,
      retrievalDiscipline: 5,
      policyCompliance: 5,
      latencyRecovery: 5,
      hardFailures: [],
      evidenceRefs: ["ev-1", "ev-2"],
      summary: "Passed with blueprint",
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);
    mocks.mockPrisma.benchmarkRun.update.mockResolvedValue(mockRun);
    mocks.mockPrisma.shareableRunReport.upsert.mockResolvedValue({ id: "report-1" });
    mocks.mockPrisma.benchmarkExampleCandidate.upsert.mockResolvedValue({});
    mocks.mockPrisma.benchmarkRun.findUniqueOrThrow.mockResolvedValue(mockRun);
    mocks.mockPrisma.benchmarkOutcomeEvidence.findMany.mockResolvedValue([]);

    const result = await service.scoreRun("run-1", "test-user");

    expect(mocks.mockPrisma.benchmarkScorecard.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          policyCompliance: expect.any(Number),
        }),
      })
    );
  });

  it("throws if run not found", async () => {
    mocks.mockPrisma.benchmarkRun.findUnique.mockResolvedValue(null);

    await expect(service.scoreRun("nonexistent", "test-user")).rejects.toThrow(
      "Benchmark run not found"
    );
  });
});

// ── listRuns ───────────────────────────────────────────────────────────────

describe("listRuns", () => {
  it("returns all runs when no repoId provided", async () => {
    const mockRuns = [makeMockRun(), makeMockRun({ id: "run-2" })];

    mocks.mockPrisma.benchmarkRun.findMany.mockResolvedValue(mockRuns);

    const runs = await service.listRuns();

    expect(runs).toHaveLength(2);
    expect(mocks.mockPrisma.benchmarkRun.findMany).toHaveBeenCalledWith({
      where: undefined,
      orderBy: { startedAt: "desc" },
      take: 100,
    });
  });

  it("filters by repoId when provided", async () => {
    const mockRuns = [makeMockRun({ repoId: "repo-1" })];

    mocks.mockPrisma.benchmarkRun.findMany.mockResolvedValue(mockRuns);

    const runs = await service.listRuns("repo-1");

    expect(runs).toHaveLength(1);
    expect(mocks.mockPrisma.benchmarkRun.findMany).toHaveBeenCalledWith({
      where: { repoId: "repo-1" },
      orderBy: { startedAt: "desc" },
      take: 100,
    });
  });
});

// ── getRun ─────────────────────────────────────────────────────────────────

describe("getRun", () => {
  it("returns run with scorecard and evidence", async () => {
    const mockRun = makeMockRun();
    const mockScorecard = {
      runId: "run-1",
      pass: true,
      totalScore: 85,
      functionalCorrectness: 40,
      guidelineAdherence: 15,
      verificationDiscipline: 10,
      patchQuality: 10,
      retrievalDiscipline: 5,
      policyCompliance: 3,
      latencyRecovery: 2,
      hardFailures: [],
      evidenceRefs: [],
      summary: "Test scorecard",
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const mockEvidence = [
      { id: "ev-1", runId: "run-1", kind: "test_result", path: null, payload: {}, createdAt: new Date() },
    ];

    mocks.mockPrisma.benchmarkRun.findUnique.mockResolvedValue(mockRun);
    mocks.mockPrisma.benchmarkScorecard.findUnique.mockResolvedValue(mockScorecard as any);
    mocks.mockPrisma.benchmarkOutcomeEvidence.findMany.mockResolvedValue(mockEvidence as any);

    const result = await service.getRun("run-1");

    expect(result).not.toBeNull();
    expect(result!.run.id).toBe("run-1");
    expect(result!.scorecard!.pass).toBe(true);
    expect(result!.evidence).toHaveLength(1);
  });

  it("returns null if run not found", async () => {
    mocks.mockPrisma.benchmarkRun.findUnique.mockResolvedValue(null);

    const result = await service.getRun("nonexistent");

    expect(result).toBeNull();
  });

  it("returns null scorecard if not found", async () => {
    const mockRun = makeMockRun();

    mocks.mockPrisma.benchmarkRun.findUnique.mockResolvedValue(mockRun);
    mocks.mockPrisma.benchmarkScorecard.findUnique.mockResolvedValue(null);
    mocks.mockPrisma.benchmarkOutcomeEvidence.findMany.mockResolvedValue([]);

    const result = await service.getRun("run-1");

    expect(result).not.toBeNull();
    expect(result!.scorecard).toBeNull();
  });
});

// ── listFailures ───────────────────────────────────────────────────────────

describe("listFailures", () => {
  it("returns failed scorecards", async () => {
    const mockFailures = [
      {
        runId: "run-1",
        pass: false,
        totalScore: 45,
        functionalCorrectness: 20,
        guidelineAdherence: 10,
        verificationDiscipline: 5,
        patchQuality: 5,
        retrievalDiscipline: 3,
        policyCompliance: 2,
        latencyRecovery: 0,
        hardFailures: ["verify_command_failed"],
        evidenceRefs: [],
        summary: "Failed test",
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    mocks.mockPrisma.benchmarkScorecard.findMany.mockResolvedValue(mockFailures as any);

    const failures = await service.listFailures();

    expect(failures).toHaveLength(1);
    expect(failures[0].pass).toBe(false);
    expect(mocks.mockPrisma.benchmarkScorecard.findMany).toHaveBeenCalledWith({
      where: { pass: false },
      orderBy: { updatedAt: "desc" },
      take: 50,
    });
  });
});

// ── getLeaderboard ─────────────────────────────────────────────────────────

describe("getLeaderboard", () => {
  it("returns scorecards ordered by score", async () => {
    const mockScores = [
      {
        runId: "run-1",
        pass: true,
        totalScore: 95,
        functionalCorrectness: 40,
        guidelineAdherence: 20,
        verificationDiscipline: 15,
        patchQuality: 10,
        retrievalDiscipline: 5,
        policyCompliance: 3,
        latencyRecovery: 2,
        hardFailures: [],
        evidenceRefs: [],
        summary: "High score",
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        runId: "run-2",
        pass: true,
        totalScore: 85,
        functionalCorrectness: 40,
        guidelineAdherence: 15,
        verificationDiscipline: 12,
        patchQuality: 10,
        retrievalDiscipline: 5,
        policyCompliance: 2,
        latencyRecovery: 1,
        hardFailures: [],
        evidenceRefs: [],
        summary: "Good score",
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    mocks.mockPrisma.benchmarkScorecard.findMany.mockResolvedValue(mockScores as any);

    const leaderboard = await service.getLeaderboard();

    expect(leaderboard).toHaveLength(2);
    expect(mocks.mockPrisma.benchmarkScorecard.findMany).toHaveBeenCalledWith({
      orderBy: [{ totalScore: "desc" }, { updatedAt: "desc" }],
      take: 100,
    });
  });
});
