import { describe, expect, it } from "vitest";
import { mapRepoToProjectBinding } from "./projectBindings";

describe("projectBindings", () => {
  describe("mapRepoToProjectBinding", () => {
    it("maps a minimal repo record to project binding", () => {
      const repo = {
        id: "repo-1",
        displayName: "Test Project",
        sourceKind: "local_attached",
        sourceUri: "/path/to/project",
        repoRoot: "/path/to/project",
        managedWorktreeRoot: "/path/to/worktrees",
        defaultBranch: "main",
        active: true,
        attachedAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-02T00:00:00.000Z",
      };

      const result = mapRepoToProjectBinding(repo);

      expect(result).toEqual({
        id: "repo-1",
        displayName: "Test Project",
        sourceKind: "local_attached",
        canonicalRoot: "/path/to/project",
        mirrorPath: null,
        activeWorktreePath: "/path/to/worktrees/active",
        githubRepoId: null,
        githubInstallationId: null,
        defaultBranch: "main",
        active: true,
        codeGraphStatus: "not_indexed",
        guidelineProfileVersion: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-02T00:00:00.000Z",
        metadata: {},
      });
    });

    it("maps managed_pack sourceKind to managed_demo_pack", () => {
      const repo = {
        id: "repo-1",
        displayName: "Demo Pack",
        sourceKind: "managed_pack",
        sourceUri: "pack://demo",
        repoRoot: "/path/to/demo",
        managedWorktreeRoot: "/path/to/worktrees",
        defaultBranch: "main",
        active: true,
        attachedAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-02T00:00:00.000Z",
      };

      const result = mapRepoToProjectBinding(repo);

      expect(result.sourceKind).toBe("managed_demo_pack");
    });

    it("maps github_app_bound sourceKind correctly", () => {
      const repo = {
        id: "repo-1",
        displayName: "GitHub Project",
        sourceKind: "github_app_bound",
        sourceUri: "https://github.com/user/repo",
        repoRoot: "/path/to/repo",
        managedWorktreeRoot: "/path/to/worktrees",
        defaultBranch: "main",
        active: true,
        attachedAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-02T00:00:00.000Z",
      };

      const result = mapRepoToProjectBinding(repo);

      expect(result.sourceKind).toBe("github_app_bound");
    });

    it("extracts metadata fields when provided", () => {
      const repo = {
        id: "repo-1",
        displayName: "GitHub Project",
        sourceKind: "github_app_bound",
        sourceUri: "https://github.com/user/repo",
        repoRoot: "/path/to/repo",
        managedWorktreeRoot: "/path/to/worktrees",
        defaultBranch: "main",
        active: true,
        attachedAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-02T00:00:00.000Z",
        metadata: {
          mirror_path: "/path/to/mirror",
          active_worktree_path: "/custom/worktree/path",
          github_repo_id: "123456",
          github_installation_id: "789",
          code_graph_status: "indexed",
          custom_field: "custom_value",
        },
      };

      const result = mapRepoToProjectBinding(repo);

      expect(result.mirrorPath).toBe("/path/to/mirror");
      expect(result.activeWorktreePath).toBe("/custom/worktree/path");
      expect(result.githubRepoId).toBe("123456");
      expect(result.githubInstallationId).toBe("789");
      expect(result.codeGraphStatus).toBe("indexed");
      expect(result.metadata).toEqual({
        mirror_path: "/path/to/mirror",
        active_worktree_path: "/custom/worktree/path",
        github_repo_id: "123456",
        github_installation_id: "789",
        code_graph_status: "indexed",
        custom_field: "custom_value",
      });
    });

    it("handles missing metadata gracefully", () => {
      const repo = {
        id: "repo-1",
        displayName: "Test Project",
        sourceKind: "local_attached",
        sourceUri: "/path/to/project",
        repoRoot: "/path/to/project",
        managedWorktreeRoot: "/path/to/worktrees",
        defaultBranch: "main",
        active: true,
        attachedAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-02T00:00:00.000Z",
        metadata: undefined,
      };

      const result = mapRepoToProjectBinding(repo);

      expect(result.mirrorPath).toBeNull();
      expect(result.activeWorktreePath).toBe("/path/to/worktrees/active");
      expect(result.githubRepoId).toBeNull();
      expect(result.githubInstallationId).toBeNull();
      expect(result.codeGraphStatus).toBe("not_indexed");
      expect(result.metadata).toEqual({});
    });

    it("handles partial metadata gracefully", () => {
      const repo = {
        id: "repo-1",
        displayName: "Test Project",
        sourceKind: "local_attached",
        sourceUri: "/path/to/project",
        repoRoot: "/path/to/project",
        managedWorktreeRoot: "/path/to/worktrees",
        defaultBranch: "main",
        active: true,
        attachedAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-02T00:00:00.000Z",
        metadata: {
          github_repo_id: "123",
          other_field: 42,
        },
      };

      const result = mapRepoToProjectBinding(repo);

      expect(result.mirrorPath).toBeNull();
      expect(result.githubRepoId).toBe("123");
      expect(result.githubInstallationId).toBeNull();
      expect(result.codeGraphStatus).toBe("not_indexed");
    });

    it("accepts custom guidelineProfileVersion", () => {
      const repo = {
        id: "repo-1",
        displayName: "Test Project",
        sourceKind: "local_attached",
        sourceUri: "/path/to/project",
        repoRoot: "/path/to/project",
        managedWorktreeRoot: "/path/to/worktrees",
        defaultBranch: "main",
        active: true,
        attachedAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-02T00:00:00.000Z",
      };

      const result = mapRepoToProjectBinding(repo, 5);

      expect(result.guidelineProfileVersion).toBe(5);
    });

    it("defaults guidelineProfileVersion to 1", () => {
      const repo = {
        id: "repo-1",
        displayName: "Test Project",
        sourceKind: "local_attached",
        sourceUri: "/path/to/project",
        repoRoot: "/path/to/project",
        managedWorktreeRoot: "/path/to/worktrees",
        defaultBranch: "main",
        active: true,
        attachedAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-02T00:00:00.000Z",
      };

      const result = mapRepoToProjectBinding(repo);

      expect(result.guidelineProfileVersion).toBe(1);
    });

    it("uses empty repoRoot as null in canonicalRoot", () => {
      const repo = {
        id: "repo-1",
        displayName: "Test Project",
        sourceKind: "local_attached",
        sourceUri: "/path/to/project",
        repoRoot: "",
        managedWorktreeRoot: "/path/to/worktrees",
        defaultBranch: "main",
        active: true,
        attachedAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-02T00:00:00.000Z",
      };

      const result = mapRepoToProjectBinding(repo);

      expect(result.canonicalRoot).toBeNull();
    });

    it("ignores non-string metadata values for typed fields", () => {
      const repo = {
        id: "repo-1",
        displayName: "Test Project",
        sourceKind: "local_attached",
        sourceUri: "/path/to/project",
        repoRoot: "/path/to/project",
        managedWorktreeRoot: "/path/to/worktrees",
        defaultBranch: "main",
        active: true,
        attachedAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-02T00:00:00.000Z",
        metadata: {
          mirror_path: 123, // wrong type
          github_repo_id: true, // wrong type
          active_worktree_path: ["array"], // wrong type
          code_graph_status: { obj: "value" }, // wrong type
        },
      };

      const result = mapRepoToProjectBinding(repo);

      expect(result.mirrorPath).toBeNull();
      expect(result.githubRepoId).toBeNull();
      expect(result.activeWorktreePath).toBe("/path/to/worktrees/active");
      expect(result.codeGraphStatus).toBe("not_indexed");
    });
  });
});
