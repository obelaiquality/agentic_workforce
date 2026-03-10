import { execFileSync } from "node:child_process";
import path from "node:path";
import { prisma } from "../db";
import { publishEvent } from "../eventBus";
import type { GitHubRepoBinding, ProjectBinding, RepoRegistration, ShareableRunReport } from "../../shared/contracts";
import { RepoService } from "./repoService";

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function toRecord(value: unknown) {
  return (value ?? {}) as Record<string, unknown>;
}

function runGit(args: string[], cwd?: string) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function mapProjectBinding(repo: RepoRegistration, guidelineProfileVersion = 1): ProjectBinding {
  const metadata = toRecord(repo.metadata);
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
      typeof metadata.active_worktree_path === "string"
        ? metadata.active_worktree_path
        : path.join(repo.managedWorktreeRoot, "active"),
    githubRepoId: typeof metadata.github_repo_id === "string" ? metadata.github_repo_id : null,
    githubInstallationId: typeof metadata.github_installation_id === "string" ? metadata.github_installation_id : null,
    defaultBranch: repo.defaultBranch,
    active: repo.active,
    codeGraphStatus:
      (typeof metadata.code_graph_status === "string" ? metadata.code_graph_status : "not_indexed") as ProjectBinding["codeGraphStatus"],
    guidelineProfileVersion,
    createdAt: repo.attachedAt,
    updatedAt: repo.updatedAt,
    metadata,
  };
}

function mapGithubBinding(row: {
  repoId: string;
  owner: string;
  repo: string;
  installationId: string | null;
  defaultBranch: string;
  permissions: unknown;
  connectedAt: Date;
  metadata: unknown;
}): GitHubRepoBinding {
  const permissions = toRecord(row.permissions);
  return {
    projectId: row.repoId,
    owner: row.owner,
    repo: row.repo,
    installationId: row.installationId,
    defaultBranch: row.defaultBranch,
    permissions: {
      pullRequests: Boolean(permissions.pullRequests ?? true),
      contents: Boolean(permissions.contents ?? true),
      checks: Boolean(permissions.checks ?? true),
      issues: Boolean(permissions.issues ?? false),
    },
    connectedAt: row.connectedAt.toISOString(),
    metadata: toRecord(row.metadata),
  };
}

function mapShareReport(row: {
  id: string;
  runId: string;
  repoId: string;
  summary: string;
  scorecardId: string | null;
  pullRequestUrl: string | null;
  evidenceUrls: unknown;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}): ShareableRunReport {
  return {
    id: row.id,
    runId: row.runId,
    repoId: row.repoId,
    summary: row.summary,
    scorecardId: row.scorecardId,
    pullRequestUrl: row.pullRequestUrl,
    evidenceUrls: asStringArray(row.evidenceUrls),
    metadata: toRecord(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class GitHubService {
  constructor(private readonly repoService: RepoService) {}

  async connectRepo(input: {
    actor: string;
    owner: string;
    repo: string;
    clone_url?: string;
    display_name?: string;
    default_branch?: string;
    installation_id?: string;
    github_repo_id?: string;
  }) {
    const cloneUrl = input.clone_url || `https://github.com/${input.owner}/${input.repo}.git`;
    const attached = await this.repoService.cloneRepo({
      actor: input.actor,
      url: cloneUrl,
      display_name: input.display_name || `${input.owner}/${input.repo}`,
      branch: input.default_branch,
    });

    const existingMetadata = toRecord(attached.repo.metadata);
    const updatedRepoRow = await prisma.repoRegistry.update({
      where: { id: attached.repo.id },
      data: {
        sourceKind: "github_app_bound",
        sourceUri: cloneUrl,
        metadata: {
          ...existingMetadata,
          github_owner: input.owner,
          github_repo: input.repo,
          github_installation_id: input.installation_id || null,
          github_repo_id: input.github_repo_id || null,
        },
      },
    });

    if (input.installation_id) {
      await prisma.gitHubInstallation.upsert({
        where: { installationId: input.installation_id },
        update: {
          accountLogin: input.owner,
          accountType: "Organization",
          permissions: {
            pullRequests: true,
            contents: true,
            checks: true,
            issues: true,
          },
          metadata: {
            connected_by: input.actor,
          },
        },
        create: {
          installationId: input.installation_id,
          accountLogin: input.owner,
          accountType: "Organization",
          permissions: {
            pullRequests: true,
            contents: true,
            checks: true,
            issues: true,
          },
          metadata: {
            connected_by: input.actor,
          },
        },
      });
    }

    const binding = await prisma.gitHubRepoBinding.upsert({
      where: { repoId: attached.repo.id },
      update: {
        owner: input.owner,
        repo: input.repo,
        installationId: input.installation_id || null,
        githubRepoId: input.github_repo_id || null,
        defaultBranch: input.default_branch || attached.repo.defaultBranch,
        permissions: {
          pullRequests: true,
          contents: true,
          checks: true,
          issues: true,
        },
        metadata: {
          clone_url: cloneUrl,
        },
      },
      create: {
        repoId: attached.repo.id,
        owner: input.owner,
        repo: input.repo,
        installationId: input.installation_id || null,
        githubRepoId: input.github_repo_id || null,
        defaultBranch: input.default_branch || attached.repo.defaultBranch,
        permissions: {
          pullRequests: true,
          contents: true,
          checks: true,
          issues: true,
        },
        metadata: {
          clone_url: cloneUrl,
        },
      },
    });

    publishEvent("global", "project.connected", {
      repoId: attached.repo.id,
      owner: input.owner,
      repo: input.repo,
      sourceKind: "github_app_bound",
    });

    return {
      project: mapProjectBinding(
        {
          ...attached.repo,
          sourceKind: "github_app_bound",
          sourceUri: cloneUrl,
          metadata: toRecord(updatedRepoRow.metadata),
        },
        attached.guidelines ? 1 : 0
      ),
      repo: {
        ...attached.repo,
        sourceKind: "github_app_bound",
        sourceUri: cloneUrl,
        metadata: toRecord(updatedRepoRow.metadata),
      },
      guidelines: attached.guidelines,
      snapshot: attached.snapshot,
      github: mapGithubBinding(binding),
    };
  }

  async syncRepo(actor: string, repoId: string) {
    const repo = await prisma.repoRegistry.findUnique({ where: { id: repoId } });
    if (!repo) {
      throw new Error(`Repo not found: ${repoId}`);
    }
    const metadata = toRecord(repo.metadata);
    const mirrorPath = typeof metadata.mirror_path === "string" ? metadata.mirror_path : repo.repoRoot;
    if (mirrorPath && repo.sourceKind === "github_app_bound") {
      runGit(["--git-dir", mirrorPath, "fetch", "--all", "--prune"]);
    }

    const row = await prisma.repoRegistry.update({
      where: { id: repoId },
      data: {
        metadata: {
          ...metadata,
          last_synced_at: new Date().toISOString(),
          last_synced_by: actor,
        },
      },
    });

    publishEvent("global", "project.synced", {
      repoId,
      actor,
    });

    return {
      repo: row,
      syncedAt: new Date().toISOString(),
    };
  }

  async listPullRequests(repoId: string) {
    const rows = await prisma.gitHubPullRequestProjection.findMany({
      where: { repoId },
      orderBy: { updatedAt: "desc" },
      take: 50,
    });
    return rows.map((row) => ({
      id: row.id,
      repoId: row.repoId,
      runId: row.runId,
      pullNumber: row.pullNumber,
      state: row.state,
      branch: row.branch,
      baseBranch: row.baseBranch,
      title: row.title,
      url: row.url,
      metadata: toRecord(row.metadata),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  async createLocalDraftPr(input: {
    actor: string;
    repoId: string;
    runId: string;
    title: string;
    summary: string;
    branch: string;
    baseBranch: string;
    evidenceUrls?: string[];
  }) {
    const row = await prisma.gitHubPullRequestProjection.create({
      data: {
        repoId: input.repoId,
        runId: input.runId,
        pullNumber: Math.floor(Date.now() / 1000),
        state: "draft_local_only",
        branch: input.branch,
        baseBranch: input.baseBranch,
        title: input.title,
        url: "",
        metadata: {
          created_by: input.actor,
          relay_ready: false,
        },
      },
    });

    const report = await prisma.shareableRunReport.upsert({
      where: { runId: input.runId },
      update: {
        repoId: input.repoId,
        summary: input.summary,
        evidenceUrls: input.evidenceUrls || [],
        pullRequestUrl: null,
        metadata: {
          branch: input.branch,
          baseBranch: input.baseBranch,
        },
      },
      create: {
        runId: input.runId,
        repoId: input.repoId,
        summary: input.summary,
        evidenceUrls: input.evidenceUrls || [],
        metadata: {
          branch: input.branch,
          baseBranch: input.baseBranch,
        },
      },
    });

    publishEvent("global", "github.pr.opened", {
      repoId: input.repoId,
      runId: input.runId,
      state: row.state,
    });

    return {
      pullRequest: {
        id: row.id,
        repoId: row.repoId,
        runId: row.runId,
        pullNumber: row.pullNumber,
        state: row.state,
        branch: row.branch,
        baseBranch: row.baseBranch,
        title: row.title,
        url: row.url,
        metadata: toRecord(row.metadata),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      },
      report: mapShareReport(report),
    };
  }

  async getShareReport(runId: string) {
    const row = await prisma.shareableRunReport.findUnique({ where: { runId } });
    return row ? mapShareReport(row) : null;
  }
}
