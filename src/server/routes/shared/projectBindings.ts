import path from "node:path";

function asRecord(value: unknown) {
  return (value ?? {}) as Record<string, unknown>;
}

export function mapRepoToProjectBinding(
  repo: {
    id: string;
    displayName: string;
    sourceKind: string;
    sourceUri: string;
    repoRoot: string;
    managedWorktreeRoot: string;
    defaultBranch: string;
    active: boolean;
    attachedAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
  },
  guidelineProfileVersion = 1
) {
  const metadata = asRecord(repo.metadata);
  return {
    id: repo.id,
    displayName: repo.displayName,
    sourceKind:
      repo.sourceKind === "managed_pack"
        ? "managed_demo_pack"
        : repo.sourceKind === "github_app_bound"
          ? "github_app_bound"
          : "local_attached",
    canonicalRoot: repo.repoRoot || null,
    mirrorPath: typeof metadata.mirror_path === "string" ? metadata.mirror_path : null,
    activeWorktreePath:
      typeof metadata.active_worktree_path === "string" ? metadata.active_worktree_path : path.join(repo.managedWorktreeRoot, "active"),
    githubRepoId: typeof metadata.github_repo_id === "string" ? metadata.github_repo_id : null,
    githubInstallationId: typeof metadata.github_installation_id === "string" ? metadata.github_installation_id : null,
    defaultBranch: repo.defaultBranch,
    active: repo.active,
    codeGraphStatus: typeof metadata.code_graph_status === "string" ? metadata.code_graph_status : "not_indexed",
    guidelineProfileVersion,
    createdAt: repo.attachedAt,
    updatedAt: repo.updatedAt,
    metadata,
  };
}
