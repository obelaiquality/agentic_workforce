import { describe, it, expect, beforeEach, vi } from "vitest";
import { GitHubService } from "./githubService";
import type { RepoService } from "./repoService";

// Mock dependencies - use vi.hoisted() for proper hoisting
const { mockRepoRegistry, mockGitHubInstallation, mockGitHubRepoBinding, mockGitHubPullRequestProjection, mockShareableRunReport } = vi.hoisted(() => ({
  mockRepoRegistry: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  mockGitHubInstallation: {
    upsert: vi.fn(),
  },
  mockGitHubRepoBinding: {
    upsert: vi.fn(),
  },
  mockGitHubPullRequestProjection: {
    create: vi.fn(),
    findMany: vi.fn(),
  },
  mockShareableRunReport: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
}));

vi.mock("../db", () => ({
  prisma: {
    repoRegistry: mockRepoRegistry,
    gitHubInstallation: mockGitHubInstallation,
    gitHubRepoBinding: mockGitHubRepoBinding,
    gitHubPullRequestProjection: mockGitHubPullRequestProjection,
    shareableRunReport: mockShareableRunReport,
  },
}));

vi.mock("../eventBus", () => ({
  publishEvent: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(() => "mock-git-output"),
}));

describe("GitHubService", () => {
  let service: GitHubService;
  let mockRepoService: RepoService;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create a mock RepoService
    mockRepoService = {
      cloneRepo: vi.fn(),
    } as unknown as RepoService;

    service = new GitHubService(mockRepoService);
  });

  describe("connectRepo", () => {
    it("should clone repo and create GitHub binding", async () => {
      const mockCloneResult = {
        repo: {
          id: "repo-123",
          displayName: "owner/repo",
          sourceKind: "local_attached",
          repoRoot: "/path/to/repo",
          managedWorktreeRoot: "/path/to/worktree",
          defaultBranch: "main",
          active: true,
          attachedAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-01"),
          metadata: {},
        },
        guidelines: null,
        snapshot: null,
      };

      const mockUpdatedRepo = {
        ...mockCloneResult.repo,
        sourceKind: "github_app_bound",
        metadata: {
          github_owner: "owner",
          github_repo: "repo",
          github_installation_id: "install-123",
          github_repo_id: "gh-repo-456",
        },
      };

      const mockBinding = {
        repoId: "repo-123",
        owner: "owner",
        repo: "repo",
        installationId: "install-123",
        githubRepoId: "gh-repo-456",
        defaultBranch: "main",
        permissions: {
          pullRequests: true,
          contents: true,
          checks: true,
          issues: true,
        },
        connectedAt: new Date("2024-01-01"),
        metadata: {
          clone_url: "https://github.com/owner/repo.git",
        },
      };

      (mockRepoService.cloneRepo as any).mockResolvedValue(mockCloneResult);
      mockRepoRegistry.update.mockResolvedValue(mockUpdatedRepo);
      mockGitHubInstallation.upsert.mockResolvedValue({});
      mockGitHubRepoBinding.upsert.mockResolvedValue(mockBinding);

      const result = await service.connectRepo({
        actor: "test-user",
        owner: "owner",
        repo: "repo",
        installation_id: "install-123",
        github_repo_id: "gh-repo-456",
        default_branch: "main",
      });

      expect(mockRepoService.cloneRepo).toHaveBeenCalledWith({
        actor: "test-user",
        url: "https://github.com/owner/repo.git",
        display_name: "owner/repo",
        branch: "main",
      });

      expect(mockRepoRegistry.update).toHaveBeenCalledWith({
        where: { id: "repo-123" },
        data: {
          sourceKind: "github_app_bound",
          sourceUri: "https://github.com/owner/repo.git",
          metadata: {
            github_owner: "owner",
            github_repo: "repo",
            github_installation_id: "install-123",
            github_repo_id: "gh-repo-456",
          },
        },
      });

      expect(mockGitHubInstallation.upsert).toHaveBeenCalled();
      expect(mockGitHubRepoBinding.upsert).toHaveBeenCalled();

      expect(result.project.id).toBe("repo-123");
      expect(result.project.sourceKind).toBe("github_app_bound");
      expect(result.github.owner).toBe("owner");
      expect(result.github.repo).toBe("repo");
    });

    it("should use default clone URL when not provided", async () => {
      const mockCloneResult = {
        repo: {
          id: "repo-123",
          displayName: "owner/repo",
          sourceKind: "local_attached",
          repoRoot: "/path/to/repo",
          managedWorktreeRoot: "/path/to/worktree",
          defaultBranch: "main",
          active: true,
          attachedAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-01"),
          metadata: {},
        },
        guidelines: null,
        snapshot: null,
      };

      (mockRepoService.cloneRepo as any).mockResolvedValue(mockCloneResult);
      mockRepoRegistry.update.mockResolvedValue({ ...mockCloneResult.repo, metadata: {} });
      mockGitHubRepoBinding.upsert.mockResolvedValue({
        repoId: "repo-123",
        owner: "owner",
        repo: "repo",
        installationId: null,
        githubRepoId: null,
        defaultBranch: "main",
        permissions: {},
        connectedAt: new Date("2024-01-01"),
        metadata: {},
      });

      await service.connectRepo({
        actor: "test-user",
        owner: "owner",
        repo: "repo",
      });

      expect(mockRepoService.cloneRepo).toHaveBeenCalledWith({
        actor: "test-user",
        url: "https://github.com/owner/repo.git",
        display_name: "owner/repo",
        branch: undefined,
      });
    });

    it("should use custom clone URL when provided", async () => {
      const mockCloneResult = {
        repo: {
          id: "repo-123",
          displayName: "Custom Repo",
          sourceKind: "local_attached",
          repoRoot: "/path/to/repo",
          managedWorktreeRoot: "/path/to/worktree",
          defaultBranch: "develop",
          active: true,
          attachedAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-01"),
          metadata: {},
        },
        guidelines: null,
        snapshot: null,
      };

      (mockRepoService.cloneRepo as any).mockResolvedValue(mockCloneResult);
      mockRepoRegistry.update.mockResolvedValue({ ...mockCloneResult.repo, metadata: {} });
      mockGitHubRepoBinding.upsert.mockResolvedValue({
        repoId: "repo-123",
        owner: "owner",
        repo: "repo",
        installationId: null,
        githubRepoId: null,
        defaultBranch: "develop",
        permissions: {},
        connectedAt: new Date("2024-01-01"),
        metadata: {},
      });

      await service.connectRepo({
        actor: "test-user",
        owner: "owner",
        repo: "repo",
        clone_url: "git@github.com:owner/repo.git",
        display_name: "Custom Repo",
        default_branch: "develop",
      });

      expect(mockRepoService.cloneRepo).toHaveBeenCalledWith({
        actor: "test-user",
        url: "git@github.com:owner/repo.git",
        display_name: "Custom Repo",
        branch: "develop",
      });
    });

    it("should skip installation upsert when installation_id is not provided", async () => {
      const mockCloneResult = {
        repo: {
          id: "repo-123",
          displayName: "owner/repo",
          sourceKind: "local_attached",
          repoRoot: "/path/to/repo",
          managedWorktreeRoot: "/path/to/worktree",
          defaultBranch: "main",
          active: true,
          attachedAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-01"),
          metadata: {},
        },
        guidelines: null,
        snapshot: null,
      };

      (mockRepoService.cloneRepo as any).mockResolvedValue(mockCloneResult);
      mockRepoRegistry.update.mockResolvedValue({ ...mockCloneResult.repo, metadata: {} });
      mockGitHubRepoBinding.upsert.mockResolvedValue({
        repoId: "repo-123",
        owner: "owner",
        repo: "repo",
        installationId: null,
        githubRepoId: null,
        defaultBranch: "main",
        permissions: {},
        connectedAt: new Date("2024-01-01"),
        metadata: {},
      });

      await service.connectRepo({
        actor: "test-user",
        owner: "owner",
        repo: "repo",
      });

      expect(mockGitHubInstallation.upsert).not.toHaveBeenCalled();
    });
  });

  describe("syncRepo", () => {
    it("should fetch git changes and update metadata", async () => {
      const mockRepo = {
        id: "repo-123",
        displayName: "owner/repo",
        sourceKind: "github_app_bound",
        repoRoot: "/path/to/repo",
        managedWorktreeRoot: "/path/to/worktree",
        defaultBranch: "main",
        active: true,
        attachedAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-01"),
        sourceUri: null,
        metadata: {
          mirror_path: "/path/to/mirror",
        },
      };

      const mockUpdatedRepo = {
        ...mockRepo,
        metadata: {
          mirror_path: "/path/to/mirror",
          last_synced_at: expect.any(String),
          last_synced_by: "test-user",
        },
      };

      mockRepoRegistry.findUnique.mockResolvedValue(mockRepo);
      mockRepoRegistry.update.mockResolvedValue(mockUpdatedRepo);

      const result = await service.syncRepo("test-user", "repo-123");

      expect(mockRepoRegistry.findUnique).toHaveBeenCalledWith({
        where: { id: "repo-123" },
      });

      expect(mockRepoRegistry.update).toHaveBeenCalledWith({
        where: { id: "repo-123" },
        data: {
          metadata: {
            mirror_path: "/path/to/mirror",
            last_synced_at: expect.any(String),
            last_synced_by: "test-user",
          },
        },
      });

      expect(result.repo).toBeDefined();
      expect(result.syncedAt).toBeTruthy();
    });

    it("should throw error when repo not found", async () => {
      mockRepoRegistry.findUnique.mockResolvedValue(null);

      await expect(
        service.syncRepo("test-user", "nonexistent-repo")
      ).rejects.toThrow("Repo not found: nonexistent-repo");
    });

    it("should use repoRoot when mirror_path is not in metadata", async () => {
      const mockRepo = {
        id: "repo-123",
        displayName: "owner/repo",
        sourceKind: "github_app_bound",
        repoRoot: "/path/to/repo",
        managedWorktreeRoot: "/path/to/worktree",
        defaultBranch: "main",
        active: true,
        attachedAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-01"),
        sourceUri: null,
        metadata: {},
      };

      mockRepoRegistry.findUnique.mockResolvedValue(mockRepo);
      mockRepoRegistry.update.mockResolvedValue({
        ...mockRepo,
        metadata: {
          last_synced_at: expect.any(String),
          last_synced_by: "test-user",
        },
      });

      await service.syncRepo("test-user", "repo-123");

      expect(mockRepoRegistry.update).toHaveBeenCalled();
    });

    it("should skip git fetch for non-github repos", async () => {
      const mockRepo = {
        id: "repo-123",
        displayName: "local-repo",
        sourceKind: "local_attached",
        repoRoot: "/path/to/repo",
        managedWorktreeRoot: "/path/to/worktree",
        defaultBranch: "main",
        active: true,
        attachedAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-01"),
        sourceUri: null,
        metadata: {
          mirror_path: "/path/to/mirror",
        },
      };

      mockRepoRegistry.findUnique.mockResolvedValue(mockRepo);
      mockRepoRegistry.update.mockResolvedValue({
        ...mockRepo,
        metadata: {
          mirror_path: "/path/to/mirror",
          last_synced_at: expect.any(String),
          last_synced_by: "test-user",
        },
      });

      const result = await service.syncRepo("test-user", "repo-123");

      expect(result.syncedAt).toBeTruthy();
    });
  });

  describe("listPullRequests", () => {
    it("should return list of pull requests for a repo", async () => {
      const mockPRs = [
        {
          id: "pr-1",
          repoId: "repo-123",
          runId: "run-1",
          pullNumber: 1,
          state: "open",
          branch: "feature-1",
          baseBranch: "main",
          title: "Add feature 1",
          url: "https://github.com/owner/repo/pull/1",
          metadata: { author: "user1" },
          createdAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-02"),
        },
        {
          id: "pr-2",
          repoId: "repo-123",
          runId: "run-2",
          pullNumber: 2,
          state: "draft_local_only",
          branch: "feature-2",
          baseBranch: "main",
          title: "Add feature 2",
          url: "",
          metadata: { relay_ready: false },
          createdAt: new Date("2024-01-03"),
          updatedAt: new Date("2024-01-04"),
        },
      ];

      mockGitHubPullRequestProjection.findMany.mockResolvedValue(mockPRs);

      const result = await service.listPullRequests("repo-123");

      expect(mockGitHubPullRequestProjection.findMany).toHaveBeenCalledWith({
        where: { repoId: "repo-123" },
        orderBy: { updatedAt: "desc" },
        take: 50,
      });

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("pr-1");
      expect(result[0].pullNumber).toBe(1);
      expect(result[0].state).toBe("open");
      expect(result[1].id).toBe("pr-2");
      expect(result[1].state).toBe("draft_local_only");
    });

    it("should return empty array when no PRs exist", async () => {
      mockGitHubPullRequestProjection.findMany.mockResolvedValue([]);

      const result = await service.listPullRequests("repo-123");

      expect(result).toEqual([]);
    });
  });

  describe("createLocalDraftPr", () => {
    it("should create a draft PR and shareable report", async () => {
      const mockPR = {
        id: "pr-1",
        repoId: "repo-123",
        runId: "run-1",
        pullNumber: 1700000000,
        state: "draft_local_only",
        branch: "feature-branch",
        baseBranch: "main",
        title: "Add new feature",
        url: "",
        metadata: {
          created_by: "test-user",
          relay_ready: false,
        },
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-01"),
      };

      const mockReport = {
        id: "report-1",
        runId: "run-1",
        repoId: "repo-123",
        summary: "Implemented new feature",
        scorecardId: null,
        pullRequestUrl: null,
        evidenceUrls: ["https://example.com/evidence"],
        metadata: {
          branch: "feature-branch",
          baseBranch: "main",
        },
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-01"),
      };

      mockGitHubPullRequestProjection.create.mockResolvedValue(mockPR);
      mockShareableRunReport.upsert.mockResolvedValue(mockReport);

      const result = await service.createLocalDraftPr({
        actor: "test-user",
        repoId: "repo-123",
        runId: "run-1",
        title: "Add new feature",
        summary: "Implemented new feature",
        branch: "feature-branch",
        baseBranch: "main",
        evidenceUrls: ["https://example.com/evidence"],
      });

      expect(mockGitHubPullRequestProjection.create).toHaveBeenCalledWith({
        data: {
          repoId: "repo-123",
          runId: "run-1",
          pullNumber: expect.any(Number),
          state: "draft_local_only",
          branch: "feature-branch",
          baseBranch: "main",
          title: "Add new feature",
          url: "",
          metadata: {
            created_by: "test-user",
            relay_ready: false,
          },
        },
      });

      expect(mockShareableRunReport.upsert).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        update: {
          repoId: "repo-123",
          summary: "Implemented new feature",
          evidenceUrls: ["https://example.com/evidence"],
          pullRequestUrl: null,
          metadata: {
            branch: "feature-branch",
            baseBranch: "main",
          },
        },
        create: {
          runId: "run-1",
          repoId: "repo-123",
          summary: "Implemented new feature",
          evidenceUrls: ["https://example.com/evidence"],
          metadata: {
            branch: "feature-branch",
            baseBranch: "main",
          },
        },
      });

      expect(result.pullRequest.id).toBe("pr-1");
      expect(result.pullRequest.state).toBe("draft_local_only");
      expect(result.report.id).toBe("report-1");
      expect(result.report.runId).toBe("run-1");
    });

    it("should handle missing evidenceUrls", async () => {
      const mockPR = {
        id: "pr-1",
        repoId: "repo-123",
        runId: "run-1",
        pullNumber: 1700000000,
        state: "draft_local_only",
        branch: "feature-branch",
        baseBranch: "main",
        title: "Add new feature",
        url: "",
        metadata: {
          created_by: "test-user",
          relay_ready: false,
        },
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-01"),
      };

      const mockReport = {
        id: "report-1",
        runId: "run-1",
        repoId: "repo-123",
        summary: "Implemented new feature",
        scorecardId: null,
        pullRequestUrl: null,
        evidenceUrls: [],
        metadata: {
          branch: "feature-branch",
          baseBranch: "main",
        },
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-01"),
      };

      mockGitHubPullRequestProjection.create.mockResolvedValue(mockPR);
      mockShareableRunReport.upsert.mockResolvedValue(mockReport);

      const result = await service.createLocalDraftPr({
        actor: "test-user",
        repoId: "repo-123",
        runId: "run-1",
        title: "Add new feature",
        summary: "Implemented new feature",
        branch: "feature-branch",
        baseBranch: "main",
      });

      expect(result.report.evidenceUrls).toEqual([]);
    });
  });

  describe("getShareReport", () => {
    it("should return a shareable report when it exists", async () => {
      const mockReport = {
        id: "report-1",
        runId: "run-1",
        repoId: "repo-123",
        summary: "Successfully implemented feature",
        scorecardId: "scorecard-1",
        pullRequestUrl: "https://github.com/owner/repo/pull/1",
        evidenceUrls: ["https://example.com/evidence1", "https://example.com/evidence2"],
        metadata: {
          branch: "feature-branch",
          baseBranch: "main",
          author: "test-user",
        },
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-02"),
      };

      mockShareableRunReport.findUnique.mockResolvedValue(mockReport);

      const result = await service.getShareReport("run-1");

      expect(mockShareableRunReport.findUnique).toHaveBeenCalledWith({
        where: { runId: "run-1" },
      });

      expect(result).not.toBeNull();
      expect(result!.id).toBe("report-1");
      expect(result!.runId).toBe("run-1");
      expect(result!.summary).toBe("Successfully implemented feature");
      expect(result!.scorecardId).toBe("scorecard-1");
      expect(result!.pullRequestUrl).toBe("https://github.com/owner/repo/pull/1");
      expect(result!.evidenceUrls).toEqual([
        "https://example.com/evidence1",
        "https://example.com/evidence2",
      ]);
      expect(result!.createdAt).toBeTruthy();
      expect(result!.updatedAt).toBeTruthy();
    });

    it("should return null when report does not exist", async () => {
      mockShareableRunReport.findUnique.mockResolvedValue(null);

      const result = await service.getShareReport("nonexistent-run");

      expect(mockShareableRunReport.findUnique).toHaveBeenCalledWith({
        where: { runId: "nonexistent-run" },
      });

      expect(result).toBeNull();
    });

    it("should handle non-array evidenceUrls", async () => {
      const mockReport = {
        id: "report-1",
        runId: "run-1",
        repoId: "repo-123",
        summary: "Test summary",
        scorecardId: null,
        pullRequestUrl: null,
        evidenceUrls: "not-an-array",
        metadata: {},
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-01"),
      };

      mockShareableRunReport.findUnique.mockResolvedValue(mockReport);

      const result = await service.getShareReport("run-1");

      expect(result!.evidenceUrls).toEqual([]);
    });

    it("should filter non-string values from evidenceUrls array", async () => {
      const mockReport = {
        id: "report-1",
        runId: "run-1",
        repoId: "repo-123",
        summary: "Test summary",
        scorecardId: null,
        pullRequestUrl: null,
        evidenceUrls: ["https://example.com/1", 123, null, "https://example.com/2", undefined],
        metadata: {},
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-01"),
      };

      mockShareableRunReport.findUnique.mockResolvedValue(mockReport);

      const result = await service.getShareReport("run-1");

      expect(result!.evidenceUrls).toEqual([
        "https://example.com/1",
        "https://example.com/2",
      ]);
    });
  });
});
