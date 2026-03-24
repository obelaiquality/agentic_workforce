import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { prisma } from "../db";
import { publishEvent } from "../eventBus";
import type {
  CodeFileDiffPayload,
  CodeFilePayload,
  CodebaseTreeNode,
  ProviderSession,
  ProjectBootstrapRequest,
  RepoGuidelineProfile,
  RepoIndexSnapshot,
  RepoRegistration,
  RepoStateCapsule,
} from "../../shared/contracts";
import { V2EventService } from "./v2EventService";
import { CodeGraphService } from "./codeGraphService";
import { ProjectBlueprintService } from "./projectBlueprintService";
import { normalizeStarterMetadata } from "./projectStarterCatalog";

type SourceKind = "local_path" | "git_url" | "managed_pack";

interface RepoStatePayload {
  activeBranch?: string;
  activeWorktreePath?: string;
  selectedTicketId?: string | null;
  selectedRunId?: string | null;
  recentChatSessionIds?: string[];
  lastContextManifestId?: string | null;
  retrievalCacheKeys?: string[];
  providerSessions?: Array<Partial<ProviderSession>>;
  metadata?: Record<string, unknown>;
}

interface AttachLocalRepoInput {
  actor: string;
  source_path: string;
  display_name?: string;
}

interface CloneRepoInput {
  actor: string;
  url: string;
  display_name?: string;
  branch?: string;
}

interface ImportManagedPackInput {
  actor: string;
  project_key: string;
  display_name?: string;
}

interface BootstrapEmptyProjectInput extends ProjectBootstrapRequest {
  actor: string;
}

interface ActivateRepoInput {
  actor: string;
  repo_id: string;
  state?: RepoStatePayload;
}

interface SwitchPrepareInput {
  actor: string;
  to_repo_id: string;
  state?: RepoStatePayload;
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asProviderSessions(value: unknown) {
  return Array.isArray(value) ? (value as Array<Partial<ProviderSession>>) : [];
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

function runGitWithIdentity(args: string[], cwd?: string) {
  return execFileSync(
    "git",
    ["-c", "user.name=Agentic Workforce", "-c", "user.email=agentic@local", ...args],
    {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  ).trim();
}

function exists(p: string) {
  return fs.existsSync(p);
}

function ensureManagedWorktree(sourceRoot: string, managedRoot: string, activePath: string, defaultBranch: string) {
  fs.mkdirSync(managedRoot, { recursive: true });
  try {
    runGit(["-C", sourceRoot, "worktree", "remove", "--force", activePath]);
  } catch {
    // Ignore stale or missing worktree registrations and recreate cleanly below.
  }
  fs.rmSync(activePath, { recursive: true, force: true });
  try {
    runGit(["-C", sourceRoot, "worktree", "prune"]);
  } catch {
    // Best effort; a failed prune should not block re-attachment.
  }
  runGit(["-C", sourceRoot, "worktree", "add", "--force", activePath, defaultBranch]);
}

function detectLanguageFromPath(relativePath: string): string | null {
  if (/\.(ts|tsx)$/.test(relativePath)) return "typescript";
  if (/\.(js|jsx|mjs|cjs)$/.test(relativePath)) return "javascript";
  if (/\.py$/.test(relativePath)) return "python";
  if (/\.rs$/.test(relativePath)) return "rust";
  if (/\.mdx?$/.test(relativePath)) return "markdown";
  if (/\.json$/.test(relativePath)) return "json";
  if (/\.ya?ml$/.test(relativePath)) return "yaml";
  if (/\.css$/.test(relativePath)) return "css";
  if (/\.html$/.test(relativePath)) return "html";
  return null;
}

function isBinaryBuffer(buffer: Buffer) {
  return buffer.includes(0);
}

function ensureInsideRoot(root: string, relativePath: string) {
  const resolved = path.resolve(root, relativePath);
  const normalizedRoot = path.resolve(root);
  if (resolved !== normalizedRoot && !resolved.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error(`Refusing to access path outside active worktree: ${relativePath}`);
  }
  return resolved;
}

function parseGitStatus(repoRoot: string) {
  const statuses = new Map<string, CodebaseTreeNode["status"]>();
  try {
    const output = runGit(["-C", repoRoot, "status", "--porcelain"], repoRoot);
    for (const line of output.split("\n").filter(Boolean)) {
      const code = line.slice(0, 2);
      const rawPath = line.slice(3).trim();
      const relativePath = (rawPath.includes(" -> ") ? rawPath.split(" -> ").pop()!.trim() : rawPath)
        .replace(/\\/g, "/")
        .replace(/\/+$/, "");
      let status: CodebaseTreeNode["status"] = "modified";
      if (code.includes("A") || code === "??") status = "added";
      else if (code.includes("D")) status = "deleted";
      else if (code.includes("M") || code.includes("R") || code.includes("C")) status = "modified";
      statuses.set(relativePath, status);
    }
  } catch {
    // Ignore git status failures and fall back to unchanged.
  }
  return statuses;
}

function summarizePatch(patch: string) {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split("\n")) {
    if (!line || line.startsWith("+++ ") || line.startsWith("--- ")) continue;
    if (line.startsWith("+")) additions += 1;
    if (line.startsWith("-")) deletions += 1;
  }
  return { additions, deletions };
}

function buildTree(paths: Array<{ path: string; status: CodebaseTreeNode["status"] }>) {
  const root: Array<CodebaseTreeNode & { children?: Array<CodebaseTreeNode & { children?: CodebaseTreeNode[] }> }> = [];

  for (const entry of paths) {
    const parts = entry.path.split("/").filter(Boolean);
    let currentLevel = root as Array<CodebaseTreeNode & { children?: CodebaseTreeNode[] }>;
    let currentPath = "";

    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isLeaf = index === parts.length - 1;
      let node = currentLevel.find((candidate) => path.posix.basename(candidate.path) === part);

      if (!node) {
        node = isLeaf
          ? {
              path: currentPath,
              kind: "file",
              language: detectLanguageFromPath(currentPath),
              status: entry.status,
            }
          : {
              path: currentPath,
              kind: "directory",
              children: [],
            };
        currentLevel.push(node);
      }

      if (!isLeaf) {
        if (!node.children) node.children = [];
        currentLevel = node.children as Array<CodebaseTreeNode & { children?: CodebaseTreeNode[] }>;
      }
    }
  }

  function finalize(nodes: Array<CodebaseTreeNode & { children?: CodebaseTreeNode[] }>): CodebaseTreeNode[] {
    return nodes
      .map((node) => ({
        ...node,
        children: node.children ? finalize(node.children as Array<CodebaseTreeNode & { children?: CodebaseTreeNode[] }>) : undefined,
      }))
      .sort((left, right) => {
        if (left.kind !== right.kind) {
          return left.kind === "directory" ? -1 : 1;
        }
        return left.path.localeCompare(right.path);
      });
  }

  return finalize(root);
}

function listFilesRecursive(root: string, limit = 2000) {
  const output: string[] = [];
  const queue = [root];

  while (queue.length > 0 && output.length < limit) {
    const current = queue.shift()!;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".next" || entry.name === "dist") {
        continue;
      }
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(full);
      } else {
        output.push(full);
        if (output.length >= limit) {
          break;
        }
      }
    }
  }

  return output;
}

function readIfExists(filePath: string, maxChars = 24000) {
  if (!exists(filePath)) {
    return null;
  }
  return fs.readFileSync(filePath, "utf8").slice(0, maxChars);
}

function inferLanguages(repoRoot: string) {
  const languages = new Set<string>();
  const files = listFilesRecursive(repoRoot, 1200);
  for (const file of files) {
    if (file.endsWith(".ts") || file.endsWith(".tsx")) languages.add("typescript");
    if (file.endsWith(".js") || file.endsWith(".jsx")) languages.add("javascript");
    if (file.endsWith(".py")) languages.add("python");
    if (file.endsWith(".rs")) languages.add("rust");
    if (file.endsWith(".md")) languages.add("markdown");
    if (file.endsWith(".json")) languages.add("json");
  }
  return Array.from(languages);
}

function inferCommands(repoRoot: string, languages: string[]) {
  const testCommands = new Set<string>();
  const buildCommands = new Set<string>();
  const lintCommands = new Set<string>();
  const packageJsonPath = path.join(repoRoot, "package.json");

  if (exists(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { scripts?: Record<string, string> };
      const scripts = pkg.scripts || {};
      if (scripts.test) testCommands.add("npm test");
      if (scripts["test:e2e"]) testCommands.add("npm run test:e2e");
      if (scripts.build) buildCommands.add("npm run build");
      if (scripts.lint) lintCommands.add("npm run lint");
      if (scripts.typecheck) lintCommands.add("npm run typecheck");
    } catch {
      // Ignore malformed package.json and fall back.
    }
  }

  if (languages.includes("python")) {
    if (exists(path.join(repoRoot, "pytest.ini")) || exists(path.join(repoRoot, "pyproject.toml"))) {
      testCommands.add("pytest");
    }
  }

  if (languages.includes("rust") && exists(path.join(repoRoot, "Cargo.toml"))) {
    testCommands.add("cargo test");
    buildCommands.add("cargo build");
    lintCommands.add("cargo fmt --check");
  }

  return {
    testCommands: Array.from(testCommands),
    buildCommands: Array.from(buildCommands),
    lintCommands: Array.from(lintCommands),
  };
}

function inferReviewStyle(text: string) {
  return /findings first|review findings/i.test(text) ? "findings_first" : "summary_first";
}

function buildGuidelineProfile(repoId: string, repoRoot: string) {
  const sourceRefs: string[] = [];
  const collectedText: string[] = [];

  const candidateFiles = [
    "AGENTS.md",
    "README.md",
    "README",
    "guidelines/Guidelines.md",
    "docs/onboarding.md",
    "docs/architecture.md",
    ".github/workflows/ci.yml",
    ".github/workflows/test.yml",
  ];

  for (const relativePath of candidateFiles) {
    const absolutePath = path.join(repoRoot, relativePath);
    const text = readIfExists(absolutePath, 18000);
    if (!text) {
      continue;
    }
    sourceRefs.push(absolutePath);
    collectedText.push(text);
  }

  const joinedText = collectedText.join("\n\n");
  const languages = inferLanguages(repoRoot);
  const commands = inferCommands(repoRoot, languages);

  const docRules = [
    "Update user-facing docs when behavior changes.",
    "Keep runbooks concise and task-oriented.",
  ];
  const patchRules = [
    "Prefer minimal diffs.",
    "Keep changes inside the active repo worktree.",
    "Run targeted verification before broad suites when possible.",
  ];
  const filePlacementRules = [
    "Place files in domain-appropriate folders.",
    "Avoid random root-level file drops.",
  ];
  const requiredArtifacts = ["verification summary", "retrieval citations"];

  if (/tests required|mandatory tests|add tests/i.test(joinedText)) {
    requiredArtifacts.push("tests");
  }
  if (/runbook|readme|documentation/i.test(joinedText)) {
    requiredArtifacts.push("docs update");
  }

  return {
    languages,
    testCommands: commands.testCommands,
    buildCommands: commands.buildCommands,
    lintCommands: commands.lintCommands,
    docRules,
    patchRules,
    filePlacementRules,
    reviewStyle: inferReviewStyle(joinedText) as RepoGuidelineProfile["reviewStyle"],
    requiredArtifacts,
    sourceRefs,
    confidence: sourceRefs.length > 0 ? 0.8 : 0.4,
    metadata: {
      extracted_from: sourceRefs,
      fallback: sourceRefs.length === 0,
    },
  };
}

function mapRepo(row: {
  id: string;
  displayName: string;
  sourceKind: string;
  sourceUri: string;
  canonicalRoot: string;
  managedWorktreeRoot: string;
  defaultBranch: string;
  benchmarkEligible: boolean;
  active: boolean;
  toolchainProfile: unknown;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}): RepoRegistration {
  const metadata = normalizeStarterMetadata(toRecord(row.metadata));
  const developerOnly = row.sourceKind === "managed_pack" || metadata.developerOnly === true || metadata.developer_only === true;
  return {
    id: row.id,
    displayName: row.displayName,
    sourceKind: row.sourceKind as RepoRegistration["sourceKind"],
    sourceUri: row.sourceUri,
    repoRoot: row.canonicalRoot,
    managedWorktreeRoot: row.managedWorktreeRoot,
    defaultBranch: row.defaultBranch,
    active: row.active,
    benchmarkEligible: row.benchmarkEligible,
    developerOnly,
    hiddenFromPrimaryList: developerOnly,
    branch: row.defaultBranch,
    lastUsedAt: row.updatedAt.toISOString(),
    toolchainProfile: toRecord(row.toolchainProfile),
    metadata,
    attachedAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapGuidelines(row: {
  id: string;
  repoId: string;
  languages: unknown;
  testCommands: unknown;
  buildCommands: unknown;
  lintCommands: unknown;
  docRules: unknown;
  patchRules: unknown;
  filePlacementRules: unknown;
  reviewStyle: string;
  requiredArtifacts: unknown;
  sourceRefs: unknown;
  confidence: number;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}): RepoGuidelineProfile {
  return {
    id: row.id,
    repoId: row.repoId,
    languages: asStringArray(row.languages),
    testCommands: asStringArray(row.testCommands),
    buildCommands: asStringArray(row.buildCommands),
    lintCommands: asStringArray(row.lintCommands),
    docRules: asStringArray(row.docRules),
    patchRules: asStringArray(row.patchRules),
    filePlacementRules: asStringArray(row.filePlacementRules),
    reviewStyle: row.reviewStyle as RepoGuidelineProfile["reviewStyle"],
    requiredArtifacts: asStringArray(row.requiredArtifacts),
    sourceRefs: asStringArray(row.sourceRefs),
    confidence: row.confidence,
    metadata: toRecord(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapIndexSnapshot(row: {
  id: string;
  repoId: string;
  commitSha: string;
  fileCount: number;
  indexedDocRefs: unknown;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}): RepoIndexSnapshot {
  return {
    id: row.id,
    repoId: row.repoId,
    commitSha: row.commitSha,
    fileCount: row.fileCount,
    indexedDocRefs: asStringArray(row.indexedDocRefs),
    metadata: toRecord(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapStateCapsule(row: {
  id: string;
  repoId: string;
  activeBranch: string;
  activeWorktreePath: string;
  selectedTicketId: string | null;
  selectedRunId: string | null;
  recentChatSessionIds: unknown;
  lastContextManifestId: string | null;
  retrievalCacheKeys: unknown;
  providerSessions: unknown;
  warmAt: Date;
  suspendedAt: Date | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}): RepoStateCapsule {
  return {
    id: row.id,
    repoId: row.repoId,
    activeBranch: row.activeBranch,
    activeWorktreePath: row.activeWorktreePath,
    selectedTicketId: row.selectedTicketId,
    selectedRunId: row.selectedRunId,
    recentChatSessionIds: asStringArray(row.recentChatSessionIds),
    lastContextManifestId: row.lastContextManifestId,
    retrievalCacheKeys: asStringArray(row.retrievalCacheKeys),
    providerSessions: asProviderSessions(row.providerSessions),
    warmAt: row.warmAt.toISOString(),
    suspendedAt: row.suspendedAt?.toISOString() ?? null,
    metadata: toRecord(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class RepoService {
  constructor(
    private readonly events: V2EventService,
    private readonly codeGraphService?: CodeGraphService,
    private readonly projectBlueprintService?: ProjectBlueprintService
  ) {}

  private repoStorageRoot() {
    const root = path.join(process.cwd(), ".local", "repos");
    fs.mkdirSync(root, { recursive: true });
    return root;
  }

  private mirrorStorageRoot() {
    const root = path.join(process.cwd(), ".local", "repo-mirrors");
    fs.mkdirSync(root, { recursive: true });
    return root;
  }

  private benchmarkPackRoot() {
    return path.join(process.cwd(), "benchmarks", "projects");
  }

  private async createOrUpdateGuidelines(repoId: string, repoRoot: string) {
    const profile = buildGuidelineProfile(repoId, repoRoot);
    const row = await prisma.repoGuidelineProfile.upsert({
      where: { repoId },
      update: {
        languages: profile.languages,
        testCommands: profile.testCommands,
        buildCommands: profile.buildCommands,
        lintCommands: profile.lintCommands,
        docRules: profile.docRules,
        patchRules: profile.patchRules,
        filePlacementRules: profile.filePlacementRules,
        reviewStyle: profile.reviewStyle,
        requiredArtifacts: profile.requiredArtifacts,
        sourceRefs: profile.sourceRefs,
        confidence: profile.confidence,
        metadata: profile.metadata,
      },
      create: {
        repoId,
        languages: profile.languages,
        testCommands: profile.testCommands,
        buildCommands: profile.buildCommands,
        lintCommands: profile.lintCommands,
        docRules: profile.docRules,
        patchRules: profile.patchRules,
        filePlacementRules: profile.filePlacementRules,
        reviewStyle: profile.reviewStyle,
        requiredArtifacts: profile.requiredArtifacts,
        sourceRefs: profile.sourceRefs,
        confidence: profile.confidence,
        metadata: profile.metadata,
      },
    });
    return mapGuidelines(row);
  }

  private async createIndexSnapshot(repoId: string, repoRoot: string) {
    const commitSha = exists(path.join(repoRoot, ".git")) || exists(path.join(repoRoot, ".git"))
      ? runGit(["-C", repoRoot, "rev-parse", "HEAD"])
      : "untracked";
    const docs = listFilesRecursive(repoRoot, 1500)
      .filter((file) => file.endsWith(".md") || file.endsWith(".mdx"))
      .slice(0, 64)
      .map((file) => path.relative(repoRoot, file));
    const row = await prisma.repoIndexSnapshot.create({
      data: {
        repoId,
        commitSha,
        fileCount: listFilesRecursive(repoRoot, 5000).length,
        indexedDocRefs: docs,
        metadata: {
          repo_root: repoRoot,
        },
      },
    });
    return mapIndexSnapshot(row);
  }

  private async saveStateCapsule(repoId: string, state?: RepoStatePayload, suspendedAt?: Date | null) {
    const repo = await prisma.repoRegistry.findUnique({ where: { id: repoId } });
    if (!repo) {
      throw new Error(`Repo not found: ${repoId}`);
    }
    const row = await prisma.repoStateCapsule.create({
      data: {
        repoId,
        activeBranch: state?.activeBranch || repo.defaultBranch,
        activeWorktreePath: state?.activeWorktreePath || path.join(repo.managedWorktreeRoot, "active"),
        selectedTicketId: state?.selectedTicketId || null,
        selectedRunId: state?.selectedRunId || null,
        recentChatSessionIds: state?.recentChatSessionIds || [],
        lastContextManifestId: state?.lastContextManifestId || null,
        retrievalCacheKeys: state?.retrievalCacheKeys || [],
        providerSessions: state?.providerSessions || [],
        warmAt: new Date(),
        suspendedAt: suspendedAt || null,
        metadata: state?.metadata || {},
      },
    });
    return mapStateCapsule(row);
  }

  async listRepos() {
    const rows = await prisma.repoRegistry.findMany({
      orderBy: [{ active: "desc" }, { updatedAt: "desc" }],
    });
    return rows.map(mapRepo);
  }

  async getRepo(repoId: string) {
    const row = await prisma.repoRegistry.findUnique({ where: { id: repoId } });
    return row ? mapRepo(row) : null;
  }

  async getActiveRepo() {
    const row = await prisma.repoRegistry.findFirst({
      where: { active: true },
      orderBy: { updatedAt: "desc" },
    });
    return row ? mapRepo(row) : null;
  }

  async getActiveWorktreePath(repoId: string) {
    const repo = await prisma.repoRegistry.findUnique({ where: { id: repoId } });
    if (!repo) {
      throw new Error(`Repo not found: ${repoId}`);
    }
    const metadata = toRecord(repo.metadata);
    return typeof metadata.active_worktree_path === "string"
      ? metadata.active_worktree_path
      : path.join(repo.managedWorktreeRoot, "active");
  }

  async inspectLocalPath(sourcePath: string) {
    const absolutePath = path.resolve(sourcePath);
    fs.mkdirSync(absolutePath, { recursive: true });
    const entries = fs
      .readdirSync(absolutePath, { withFileTypes: true })
      .filter((entry) => entry.name !== ".DS_Store" && entry.name !== ".gitkeep");

    const isGitRepo = exists(path.join(absolutePath, ".git"));
    return {
      absolutePath,
      isGitRepo,
      isEmpty: entries.length === 0 || (entries.length === 1 && entries[0]?.name === ".git"),
      hasFiles: entries.some((entry) => entry.name !== ".git"),
    };
  }

  async attachLocalRepo(input: AttachLocalRepoInput) {
    const sourceRoot = runGit(["-C", path.resolve(input.source_path), "rev-parse", "--show-toplevel"]);
    const defaultBranch = runGit(["-C", sourceRoot, "rev-parse", "--abbrev-ref", "HEAD"]) || "main";

    const existing = await prisma.repoRegistry.findFirst({
      where: {
        sourceKind: "local_path",
        sourceUri: sourceRoot,
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    if (existing) {
      const managedRoot = existing.managedWorktreeRoot || path.join(this.repoStorageRoot(), existing.id);
      const activePath = path.join(managedRoot, "active");
      ensureManagedWorktree(sourceRoot, managedRoot, activePath, defaultBranch);

      const updated = await prisma.repoRegistry.update({
        where: { id: existing.id },
        data: {
          displayName: input.display_name || existing.displayName,
          canonicalRoot: sourceRoot,
          managedWorktreeRoot: managedRoot,
          defaultBranch,
          toolchainProfile: {
            languages: inferLanguages(sourceRoot),
          },
          metadata: {
            ...(toRecord(existing.metadata) || {}),
            attach_mode: "managed_worktree",
            source_path: sourceRoot,
            active_worktree_path: activePath,
            reattached_at: new Date().toISOString(),
          },
        },
      });

      const guidelines = await this.createOrUpdateGuidelines(updated.id, activePath);
      const snapshot = await this.createIndexSnapshot(updated.id, activePath);
      const codeGraph = this.codeGraphService ? await this.codeGraphService.indexRepo(updated.id, activePath, input.actor) : null;
      const blueprint = this.projectBlueprintService ? await this.projectBlueprintService.generate(updated.id) : null;

      await prisma.repoActivationLog.create({
        data: {
          repoId: updated.id,
          actor: input.actor,
          eventType: "repo.resumed",
          payload: {
            source_kind: "local_path",
            source_uri: sourceRoot,
            active_worktree_path: activePath,
            guideline_profile_id: guidelines.id,
            index_snapshot_id: snapshot.id,
            code_graph_status: codeGraph?.status || "not_indexed",
            blueprint_id: blueprint?.id || null,
          },
        },
      });

      publishEvent("global", "repo.resumed", {
        repoId: updated.id,
        displayName: updated.displayName,
      });

      return {
        repo: mapRepo(updated),
        guidelines,
        snapshot,
        codeGraph,
        blueprint,
      };
    }

    const repo = await prisma.repoRegistry.create({
      data: {
        displayName: input.display_name || path.basename(sourceRoot),
        sourceKind: "local_path",
        sourceUri: sourceRoot,
        canonicalRoot: sourceRoot,
        managedWorktreeRoot: path.join(this.repoStorageRoot(), ""),
        defaultBranch,
        toolchainProfile: {
          languages: inferLanguages(sourceRoot),
        },
        benchmarkEligible: true,
      },
    });

    const managedRoot = path.join(this.repoStorageRoot(), repo.id);
    const activePath = path.join(managedRoot, "active");
    ensureManagedWorktree(sourceRoot, managedRoot, activePath, defaultBranch);

    const updated = await prisma.repoRegistry.update({
      where: { id: repo.id },
      data: {
        managedWorktreeRoot: managedRoot,
        metadata: {
          attach_mode: "managed_worktree",
          source_path: sourceRoot,
          active_worktree_path: activePath,
        },
      },
    });

    const guidelines = await this.createOrUpdateGuidelines(updated.id, activePath);
    const snapshot = await this.createIndexSnapshot(updated.id, activePath);
    const codeGraph = this.codeGraphService ? await this.codeGraphService.indexRepo(updated.id, activePath, input.actor) : null;
    const blueprint = this.projectBlueprintService ? await this.projectBlueprintService.generate(updated.id) : null;

    await prisma.repoActivationLog.create({
      data: {
        repoId: updated.id,
        actor: input.actor,
        eventType: "repo.registered",
        payload: {
          source_kind: "local_path",
          source_uri: sourceRoot,
          active_worktree_path: activePath,
          guideline_profile_id: guidelines.id,
          index_snapshot_id: snapshot.id,
          code_graph_status: codeGraph?.status || "not_indexed",
          blueprint_id: blueprint?.id || null,
        },
      },
    });

    publishEvent("global", "repo.registered", {
      repoId: updated.id,
      displayName: updated.displayName,
    });

    return {
      repo: mapRepo(updated),
      guidelines,
      snapshot,
      codeGraph,
      blueprint,
    };
  }

  async bootstrapEmptyProject(input: BootstrapEmptyProjectInput) {
    const absolutePath = path.resolve(input.folderPath);
    fs.mkdirSync(absolutePath, { recursive: true });

    const entries = fs
      .readdirSync(absolutePath, { withFileTypes: true })
      .filter((entry) => entry.name !== ".DS_Store" && entry.name !== ".gitkeep");
    const nonGitEntries = entries.filter((entry) => entry.name !== ".git");
    const hasGit = exists(path.join(absolutePath, ".git"));

    if (!hasGit && nonGitEntries.length > 0) {
      throw new Error("Selected folder is not empty. Choose an empty folder or an existing Git repo.");
    }

    if (!hasGit) {
      if (!input.initializeGit) {
        throw new Error("Git initialization is required for empty project bootstrap.");
      }
      try {
        runGit(["init", "-b", "main"], absolutePath);
      } catch {
        runGit(["init"], absolutePath);
        runGit(["branch", "-M", "main"], absolutePath);
      }
      runGitWithIdentity(["commit", "--allow-empty", "-m", "Initialize project"], absolutePath);
    }

    const attached = await this.attachLocalRepo({
      actor: input.actor,
      source_path: absolutePath,
      display_name: input.displayName,
    });

    const repo = await prisma.repoRegistry.update({
      where: { id: attached.repo.id },
      data: {
        metadata: {
          ...(toRecord(attached.repo.metadata) || {}),
          bootstrap_template: input.starterId ?? null,
          creation_mode: input.starterId ? "starter" : "blank",
          requested_starter_id: input.starterId ?? null,
          bootstrap_initialized_at: new Date().toISOString(),
        },
      },
    });

    return {
      ...attached,
      repo: mapRepo(repo),
    };
  }

  async cloneRepo(input: CloneRepoInput) {
    const repo = await prisma.repoRegistry.create({
      data: {
        displayName: input.display_name || path.basename(input.url).replace(/\.git$/, ""),
        sourceKind: "git_url",
        sourceUri: input.url,
        canonicalRoot: "",
        managedWorktreeRoot: "",
        defaultBranch: input.branch || "main",
        toolchainProfile: {},
        benchmarkEligible: true,
      },
    });

    const mirrorRoot = path.join(this.mirrorStorageRoot(), `${repo.id}.git`);
    const managedRoot = path.join(this.repoStorageRoot(), repo.id);
    const activePath = path.join(managedRoot, "active");
    fs.rmSync(mirrorRoot, { recursive: true, force: true });
    fs.rmSync(managedRoot, { recursive: true, force: true });
    runGit(["clone", "--mirror", input.url, mirrorRoot]);
    const defaultBranch =
      input.branch ||
      runGit(["--git-dir", mirrorRoot, "symbolic-ref", "--short", "HEAD"]).replace(/^origin\//, "") ||
      "main";
    fs.mkdirSync(managedRoot, { recursive: true });
    runGit(["--git-dir", mirrorRoot, "worktree", "add", "--force", activePath, defaultBranch]);

    const updated = await prisma.repoRegistry.update({
      where: { id: repo.id },
      data: {
        canonicalRoot: mirrorRoot,
        managedWorktreeRoot: managedRoot,
        defaultBranch,
        toolchainProfile: {
          languages: inferLanguages(activePath),
        },
        metadata: {
          attach_mode: "managed_worktree",
          mirror_path: mirrorRoot,
          active_worktree_path: activePath,
        },
      },
    });

    const guidelines = await this.createOrUpdateGuidelines(updated.id, activePath);
    const snapshot = await this.createIndexSnapshot(updated.id, activePath);
    const codeGraph = this.codeGraphService ? await this.codeGraphService.indexRepo(updated.id, activePath, input.actor) : null;
    const blueprint = this.projectBlueprintService ? await this.projectBlueprintService.generate(updated.id) : null;
    return {
      repo: mapRepo(updated),
      guidelines,
      snapshot,
      codeGraph,
      blueprint,
    };
  }

  async importManagedPack(input: ImportManagedPackInput) {
    const packRoot = path.join(this.benchmarkPackRoot(), input.project_key);
    if (!exists(packRoot)) {
      throw new Error(`Benchmark pack not found: ${input.project_key}`);
    }
    const repo = await prisma.repoRegistry.create({
      data: {
        displayName: input.display_name || input.project_key,
        sourceKind: "managed_pack",
        sourceUri: input.project_key,
        canonicalRoot: packRoot,
        managedWorktreeRoot: path.join(this.repoStorageRoot(), ""),
        defaultBranch: "main",
        toolchainProfile: {
          languages: inferLanguages(packRoot),
        },
        benchmarkEligible: true,
      },
    });

    const managedRoot = path.join(this.repoStorageRoot(), repo.id);
    const activePath = path.join(managedRoot, "active");
    fs.mkdirSync(managedRoot, { recursive: true });
    fs.rmSync(activePath, { recursive: true, force: true });
    fs.cpSync(packRoot, activePath, { recursive: true });

    const updated = await prisma.repoRegistry.update({
      where: { id: repo.id },
      data: {
        managedWorktreeRoot: managedRoot,
        metadata: {
          attach_mode: "managed_copy",
          active_worktree_path: activePath,
          project_key: input.project_key,
        },
      },
    });

    const guidelines = await this.createOrUpdateGuidelines(updated.id, activePath);
    const snapshot = await this.createIndexSnapshot(updated.id, activePath);
    const codeGraph = this.codeGraphService ? await this.codeGraphService.indexRepo(updated.id, activePath, input.actor) : null;
    const blueprint = this.projectBlueprintService ? await this.projectBlueprintService.generate(updated.id) : null;
    return {
      repo: mapRepo(updated),
      guidelines,
      snapshot,
      codeGraph,
      blueprint,
    };
  }

  async activateRepo(input: ActivateRepoInput) {
    const current = await prisma.repoRegistry.findFirst({ where: { active: true } });
    if (current && current.id !== input.repo_id) {
      await this.saveStateCapsule(current.id, input.state, new Date());
      await prisma.repoRegistry.update({
        where: { id: current.id },
        data: { active: false },
      });
      await prisma.repoActivationLog.create({
        data: {
          repoId: current.id,
          actor: input.actor,
          eventType: "repo.suspended",
          payload: {
            reason: "switch",
          },
        },
      });
      publishEvent("global", "repo.suspended", { repoId: current.id });
    }

    const row = await prisma.repoRegistry.update({
      where: { id: input.repo_id },
      data: { active: true },
    });

    await prisma.appSetting.upsert({
      where: { key: "active_repo" },
      update: { value: row.id },
      create: { key: "active_repo", value: row.id },
    });

    const state = await this.saveStateCapsule(row.id, input.state, null);
    await prisma.repoActivationLog.create({
      data: {
        repoId: row.id,
        actor: input.actor,
        eventType: "repo.activated",
        payload: {
          state_capsule_id: state.id,
        },
      },
    });

    publishEvent("global", "repo.activated", { repoId: row.id, stateCapsuleId: state.id });
    return {
      repo: mapRepo(row),
      state,
    };
  }

  async suspendRepo(actor: string, repoId: string, state?: RepoStatePayload) {
    const row = await prisma.repoRegistry.update({
      where: { id: repoId },
      data: { active: false },
    });
    const capsule = await this.saveStateCapsule(repoId, state, new Date());
    await prisma.repoActivationLog.create({
      data: {
        repoId,
        actor,
        eventType: "repo.suspended",
        payload: {
          state_capsule_id: capsule.id,
        },
      },
    });
    publishEvent("global", "repo.suspended", { repoId });
    return {
      repo: mapRepo(row),
      state: capsule,
    };
  }

  async prepareSwitch(input: SwitchPrepareInput) {
    const current = await this.getActiveRepo();
    const capsule = current ? await this.saveStateCapsule(current.id, input.state, new Date()) : null;
    const checkpoint = await prisma.repoSwitchCheckpoint.create({
      data: {
        fromRepoId: current?.id || null,
        toRepoId: input.to_repo_id,
        actor: input.actor,
        stateCapsuleId: capsule?.id || null,
        status: "prepared",
        metadata: {
          from_repo_id: current?.id || null,
          to_repo_id: input.to_repo_id,
        },
      },
    });
    publishEvent("global", "repo.switch.prepared", {
      checkpointId: checkpoint.id,
      fromRepoId: current?.id || null,
      toRepoId: input.to_repo_id,
    });
    return checkpoint;
  }

  async commitSwitch(actor: string, checkpointId: string) {
    const checkpoint = await prisma.repoSwitchCheckpoint.findUnique({ where: { id: checkpointId } });
    if (!checkpoint) {
      throw new Error(`Repo switch checkpoint not found: ${checkpointId}`);
    }
    const activation = await this.activateRepo({
      actor,
      repo_id: checkpoint.toRepoId,
    });
    const updated = await prisma.repoSwitchCheckpoint.update({
      where: { id: checkpointId },
      data: {
        status: "completed",
        metadata: {
          ...(checkpoint.metadata as Record<string, unknown> | undefined),
          completed_at: new Date().toISOString(),
        },
      },
    });
    publishEvent("global", "repo.switch.completed", {
      checkpointId: updated.id,
      toRepoId: checkpoint.toRepoId,
    });
    return {
      checkpoint: updated,
      activation,
    };
  }

  async refreshGuidelines(repoId: string) {
    const repo = await prisma.repoRegistry.findUnique({ where: { id: repoId } });
    if (!repo) {
      throw new Error(`Repo not found: ${repoId}`);
    }
    const root = path.join(repo.managedWorktreeRoot, "active");
    const guidelines = await this.createOrUpdateGuidelines(repoId, root);
    if (this.projectBlueprintService) {
      await this.projectBlueprintService.generate(repoId);
    }
    publishEvent("global", "repo.guidelines.refreshed", { repoId, guidelineProfileId: guidelines.id });
    return guidelines;
  }

  async refreshIndex(repoId: string) {
    const repo = await prisma.repoRegistry.findUnique({ where: { id: repoId } });
    if (!repo) {
      throw new Error(`Repo not found: ${repoId}`);
    }
    const root = path.join(repo.managedWorktreeRoot, "active");
    const snapshot = await this.createIndexSnapshot(repoId, root);
    const codeGraph = this.codeGraphService ? await this.codeGraphService.indexRepo(repoId, root, "system") : null;
    publishEvent("global", "repo.index.refreshed", { repoId, snapshotId: snapshot.id });
    return {
      ...snapshot,
      codeGraph,
    };
  }

  async listCodebaseTree(repoId: string) {
    const worktreePath = await this.getActiveWorktreePath(repoId);
    const files = listFilesRecursive(worktreePath, 5000);
    const statusMap = parseGitStatus(worktreePath);
    const relativeFiles = files.map((filePath) => path.relative(worktreePath, filePath).replace(/\\/g, "/"));

    const resolveStatus = (relativePath: string): CodebaseTreeNode["status"] => {
      let current = relativePath;
      while (current && current !== ".") {
        const direct = statusMap.get(current);
        if (direct) return direct;
        const parent = path.posix.dirname(current);
        if (!parent || parent === current) break;
        current = parent;
      }
      return "unchanged";
    };

    return buildTree(
      relativeFiles.map((relativePath) => ({
        path: relativePath,
        status: resolveStatus(relativePath),
      }))
    );
  }

  async readCodebaseFile(repoId: string, relativePath: string): Promise<CodeFilePayload> {
    const worktreePath = await this.getActiveWorktreePath(repoId);
    const absolutePath = ensureInsideRoot(worktreePath, relativePath);
    const buffer = fs.readFileSync(absolutePath);

    if (isBinaryBuffer(buffer)) {
      throw new Error("Binary files are not displayed in the codebase viewer.");
    }

    const text = buffer.toString("utf8");
    const lineLimit = 800;
    const byteLimit = 64000;
    const lines = text.split("\n");
    const truncated = buffer.byteLength > byteLimit || lines.length > lineLimit;
    const content = truncated ? lines.slice(0, lineLimit).join("\n").slice(0, byteLimit) : text;

    return {
      path: relativePath.replace(/\\/g, "/"),
      language: detectLanguageFromPath(relativePath),
      content,
      truncated,
      source: "managed_worktree",
    };
  }

  async readCodebaseDiff(repoId: string, relativePath: string): Promise<CodeFileDiffPayload> {
    const worktreePath = await this.getActiveWorktreePath(repoId);
    const normalizedPath = relativePath.replace(/\\/g, "/");
    const absolutePath = ensureInsideRoot(worktreePath, normalizedPath);
    const statusMap = parseGitStatus(worktreePath);
    const status = statusMap.get(normalizedPath) || "unchanged";

    if (status === "unchanged") {
      return {
        path: normalizedPath,
        status,
        patch: null,
        additions: 0,
        deletions: 0,
        truncated: false,
        available: false,
      };
    }

    if (status === "added") {
      const buffer = fs.readFileSync(absolutePath);
      if (isBinaryBuffer(buffer)) {
        return {
          path: normalizedPath,
          status,
          patch: null,
          additions: 0,
          deletions: 0,
          truncated: false,
          available: false,
        };
      }
      const text = buffer.toString("utf8");
      const lines = text.split("\n");
      const limit = 220;
      const additions = lines.length;
      const patch = lines
        .slice(0, limit)
        .map((line) => `+${line}`)
        .join("\n");
      return {
        path: normalizedPath,
        status,
        patch,
        additions,
        deletions: 0,
        truncated: lines.length > limit,
        available: true,
      };
    }

    try {
      const rawPatch = execFileSync("git", ["-C", worktreePath, "diff", "--no-ext-diff", "--unified=2", "HEAD", "--", normalizedPath], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
      if (!rawPatch) {
        return {
          path: normalizedPath,
          status,
          patch: null,
          additions: 0,
          deletions: 0,
          truncated: false,
          available: false,
        };
      }
      const lines = rawPatch.split("\n");
      const limit = 260;
      const patch = lines.slice(0, limit).join("\n");
      const summary = summarizePatch(rawPatch);
      return {
        path: normalizedPath,
        status,
        patch,
        additions: summary.additions,
        deletions: summary.deletions,
        truncated: lines.length > limit,
        available: true,
      };
    } catch {
      return {
        path: normalizedPath,
        status,
        patch: null,
        additions: 0,
        deletions: 0,
        truncated: false,
        available: false,
      };
    }
  }

  async getGuidelines(repoId: string) {
    const row = await prisma.repoGuidelineProfile.findUnique({ where: { repoId } });
    return row ? mapGuidelines(row) : null;
  }

  async getLatestIndexSnapshot(repoId: string) {
    const row = await prisma.repoIndexSnapshot.findFirst({
      where: { repoId },
      orderBy: { createdAt: "desc" },
    });
    return row ? mapIndexSnapshot(row) : null;
  }

  async getState(repoId: string) {
    const row = await prisma.repoStateCapsule.findFirst({
      where: { repoId },
      orderBy: { createdAt: "desc" },
    });
    return row ? mapStateCapsule(row) : null;
  }
}
