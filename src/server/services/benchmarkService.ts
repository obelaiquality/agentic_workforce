import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import YAML from "yaml";
import { prisma } from "../db";
import { publishEvent } from "../eventBus";
import type {
  BenchmarkProject,
  BenchmarkProjectManifest,
  BenchmarkRun,
  BenchmarkScorecard,
  BenchmarkTask,
  ModelRole,
  OutcomeEvidence,
} from "../../shared/contracts";
import { RepoService } from "./repoService";
import { V2EventService } from "./v2EventService";
import { ExecutionService } from "./executionService";
import { buildVerificationCommandPlans } from "./verificationPolicy";
import { applyEscalationPolicy } from "./providerOrchestrator";
import { detectShell } from "./shellDetect";

interface StartBenchmarkRunInput {
  actor: string;
  project_id: string;
  task_id: string;
  mode?: BenchmarkRun["mode"];
  provider_role?: ModelRole;
  repo_id?: string;
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function toRecord(value: unknown) {
  return (value ?? {}) as Record<string, unknown>;
}

function runShell(command: string, cwd: string) {
  try {
    const stdout = execSync(command, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: detectShell(),
      timeout: 120000,
    });
    return {
      ok: true,
      stdout,
      stderr: "",
      exitCode: 0,
    };
  } catch (error) {
    const payload = error as { stdout?: string | Buffer; stderr?: string | Buffer; status?: number; message?: string };
    return {
      ok: false,
      stdout: typeof payload.stdout === "string" ? payload.stdout : payload.stdout?.toString("utf8") || "",
      stderr: typeof payload.stderr === "string" ? payload.stderr : payload.stderr?.toString("utf8") || payload.message || "",
      exitCode: payload.status ?? 1,
    };
  }
}

function normalizeRole(value: unknown): ModelRole | null {
  if (
    value === "utility_fast" ||
    value === "coder_default" ||
    value === "review_deep" ||
    value === "overseer_escalation"
  ) {
    return value;
  }
  return null;
}

function inferBenchmarkRisk(task: BenchmarkTask): "low" | "medium" | "high" {
  const metadata = toRecord(task.metadata);
  const metadataRisk = metadata.riskLevel ?? metadata.risk ?? metadata.risk_level;
  if (metadataRisk === "low" || metadataRisk === "medium" || metadataRisk === "high") {
    return metadataRisk;
  }

  const text = [
    task.title,
    task.prompt,
    ...task.requiredChecks,
    ...task.requiredDocs,
    ...task.hardFailIfMissing,
  ]
    .join(" ")
    .toLowerCase();

  if (
    task.category === "decompose" ||
    /architecture|multi-agent|parallel|merge|migration|security|policy|destructive|approval/.test(text)
  ) {
    return "high";
  }

  if (task.category === "review" || /integration|e2e|contract|full-stack|cross-repo/.test(text)) {
    return "medium";
  }

  return "low";
}

function inferBenchmarkProviderRole(
  project: BenchmarkProject,
  task: BenchmarkTask,
  escalationPolicy?: "manual" | "high_risk_only" | "auto",
): ModelRole {
  const metadata = toRecord(task.metadata);
  const preferredRole = normalizeRole(metadata.preferredRole ?? metadata.preferred_role);
  if (preferredRole) {
    return applyEscalationPolicy(preferredRole, escalationPolicy, inferBenchmarkRisk(task));
  }

  const risk = inferBenchmarkRisk(task);
  if (risk === "high") {
    return applyEscalationPolicy("overseer_escalation", escalationPolicy, risk);
  }
  if (task.category === "review" || task.category === "decompose") {
    return "review_deep";
  }
  return project.defaultProviderRole;
}

function mapProject(row: {
  id: string;
  repoId: string | null;
  projectKey: string;
  displayName: string;
  sourceKind: string;
  sourceUri: string;
  manifestPath: string | null;
  languages: unknown;
  setupCommand: string;
  verifyCommand: string;
  resetCommand: string | null;
  installCommand: string | null;
  guidelineSources: unknown;
  timeBudgetSec: number;
  networkPolicy: string;
  defaultProviderRole: string;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}): BenchmarkProject {
  return {
    id: row.id,
    repoId: row.repoId,
    projectKey: row.projectKey,
    displayName: row.displayName,
    sourceKind: row.sourceKind as BenchmarkProject["sourceKind"],
    sourceUri: row.sourceUri,
    manifestPath: row.manifestPath,
    languages: asStringArray(row.languages),
    setupCommand: row.setupCommand,
    verifyCommand: row.verifyCommand,
    resetCommand: row.resetCommand,
    installCommand: row.installCommand,
    guidelineSources: asStringArray(row.guidelineSources),
    timeBudgetSec: row.timeBudgetSec,
    networkPolicy: row.networkPolicy as BenchmarkProject["networkPolicy"],
    defaultProviderRole: row.defaultProviderRole as BenchmarkProject["defaultProviderRole"],
    metadata: toRecord(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapTask(row: {
  id: string;
  projectId: string;
  taskKey: string;
  title: string;
  category: string;
  prompt: string;
  expectedArtifacts: unknown;
  requiredChecks: unknown;
  requiredDocs: unknown;
  hardFailIfMissing: unknown;
  scoringWeights: unknown;
  acceptanceCommands: unknown;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}): BenchmarkTask {
  return {
    id: row.id,
    projectId: row.projectId,
    taskKey: row.taskKey,
    title: row.title,
    category: row.category as BenchmarkTask["category"],
    prompt: row.prompt,
    expectedArtifacts: asStringArray(row.expectedArtifacts),
    requiredChecks: asStringArray(row.requiredChecks),
    requiredDocs: asStringArray(row.requiredDocs),
    hardFailIfMissing: asStringArray(row.hardFailIfMissing),
    scoringWeights: toRecord(row.scoringWeights),
    acceptanceCommands: asStringArray(row.acceptanceCommands),
    metadata: toRecord(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapRun(row: {
  id: string;
  projectId: string;
  repoId: string;
  taskId: string;
  mode: string;
  providerRole: string;
  status: string;
  actor: string;
  worktreePath: string;
  chatSessionId: string | null;
  routingDecisionId: string | null;
  metadata: unknown;
  startedAt: Date;
  completedAt: Date | null;
  updatedAt: Date;
}): BenchmarkRun {
  return {
    id: row.id,
    projectId: row.projectId,
    repoId: row.repoId,
    taskId: row.taskId,
    mode: row.mode as BenchmarkRun["mode"],
    providerRole: row.providerRole as BenchmarkRun["providerRole"],
    status: row.status as BenchmarkRun["status"],
    actor: row.actor,
    worktreePath: row.worktreePath,
    chatSessionId: row.chatSessionId,
    routingDecisionId: row.routingDecisionId,
    metadata: toRecord(row.metadata),
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapScorecard(row: {
  runId: string;
  pass: boolean;
  totalScore: number;
  functionalCorrectness: number;
  guidelineAdherence: number;
  verificationDiscipline: number;
  patchQuality: number;
  retrievalDiscipline: number;
  policyCompliance: number;
  latencyRecovery: number;
  hardFailures: unknown;
  evidenceRefs: unknown;
  summary: string;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}): BenchmarkScorecard {
  return {
    runId: row.runId,
    pass: row.pass,
    totalScore: row.totalScore,
    functionalCorrectness: row.functionalCorrectness,
    guidelineAdherence: row.guidelineAdherence,
    verificationDiscipline: row.verificationDiscipline,
    patchQuality: row.patchQuality,
    retrievalDiscipline: row.retrievalDiscipline,
    policyCompliance: row.policyCompliance,
    latencyRecovery: row.latencyRecovery,
    hardFailures: asStringArray(row.hardFailures),
    evidenceRefs: asStringArray(row.evidenceRefs),
    summary: row.summary,
    metadata: toRecord(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapEvidence(row: {
  id: string;
  runId: string;
  kind: string;
  path: string | null;
  payload: unknown;
  createdAt: Date;
}): OutcomeEvidence {
  return {
    id: row.id,
    runId: row.runId,
    kind: row.kind as OutcomeEvidence["kind"],
    path: row.path,
    payload: toRecord(row.payload),
    createdAt: row.createdAt.toISOString(),
  };
}

export class BenchmarkService {
  constructor(
    private readonly events: V2EventService,
    private readonly repoService: RepoService,
    private readonly executionService: ExecutionService
  ) {}

  private manifestsRoot() {
    return path.join(process.cwd(), "benchmarks", "projects");
  }

  private runRoot() {
    const root = path.join(process.cwd(), ".local", "benchmark-runs");
    fs.mkdirSync(root, { recursive: true });
    return root;
  }

  private loadManifest(manifestPath: string): BenchmarkProjectManifest {
    const raw = fs.readFileSync(manifestPath, "utf8");
    return YAML.parse(raw) as BenchmarkProjectManifest;
  }

  async syncProjectManifests() {
    const manifests = fs
      .readdirSync(this.manifestsRoot(), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(this.manifestsRoot(), entry.name, "agentic-benchmark.yaml"))
      .filter((manifestPath) => fs.existsSync(manifestPath));

    const projects: BenchmarkProject[] = [];
    for (const manifestPath of manifests) {
      const manifest = this.loadManifest(manifestPath);
      const projectRow = await prisma.benchmarkProject.upsert({
        where: { projectKey: manifest.projectId },
        update: {
          displayName: manifest.displayName,
          sourceKind: manifest.source.kind,
          sourceUri: manifest.source.uri,
          manifestPath,
          languages: manifest.languages,
          setupCommand: manifest.setupCommand,
          verifyCommand: manifest.verifyCommand,
          resetCommand: manifest.resetCommand || null,
          installCommand: manifest.installCommand || null,
          guidelineSources: manifest.guidelineSources,
          timeBudgetSec: manifest.timeBudgetSec,
          networkPolicy: manifest.networkPolicy,
          defaultProviderRole: manifest.defaultProviderRole,
          metadata: {
            ref: manifest.source.ref || null,
          },
        },
        create: {
          projectKey: manifest.projectId,
          displayName: manifest.displayName,
          sourceKind: manifest.source.kind,
          sourceUri: manifest.source.uri,
          manifestPath,
          languages: manifest.languages,
          setupCommand: manifest.setupCommand,
          verifyCommand: manifest.verifyCommand,
          resetCommand: manifest.resetCommand || null,
          installCommand: manifest.installCommand || null,
          guidelineSources: manifest.guidelineSources,
          timeBudgetSec: manifest.timeBudgetSec,
          networkPolicy: manifest.networkPolicy,
          defaultProviderRole: manifest.defaultProviderRole,
          metadata: {
            ref: manifest.source.ref || null,
          },
        },
      });

      for (const taskSpec of manifest.taskSpecs) {
        await prisma.benchmarkTask.upsert({
          where: {
            projectId_taskKey: {
              projectId: projectRow.id,
              taskKey: taskSpec.taskId,
            },
          },
          update: {
            title: taskSpec.title,
            category: taskSpec.category,
            prompt: taskSpec.prompt,
            expectedArtifacts: taskSpec.expectedArtifacts,
            requiredChecks: taskSpec.requiredChecks,
            requiredDocs: taskSpec.requiredDocs,
            hardFailIfMissing: taskSpec.hardFailIfMissing,
            scoringWeights: taskSpec.benchmarkRubricOverrides || {},
            acceptanceCommands: taskSpec.acceptanceCommands || [],
          },
          create: {
            projectId: projectRow.id,
            taskKey: taskSpec.taskId,
            title: taskSpec.title,
            category: taskSpec.category,
            prompt: taskSpec.prompt,
            expectedArtifacts: taskSpec.expectedArtifacts,
            requiredChecks: taskSpec.requiredChecks,
            requiredDocs: taskSpec.requiredDocs,
            hardFailIfMissing: taskSpec.hardFailIfMissing,
            scoringWeights: taskSpec.benchmarkRubricOverrides || {},
            acceptanceCommands: taskSpec.acceptanceCommands || [],
          },
        });
      }

      projects.push(mapProject(projectRow));
    }

    return projects;
  }

  async listProjects() {
    await this.syncProjectManifests();
    const rows = await prisma.benchmarkProject.findMany({
      orderBy: [{ displayName: "asc" }],
    });
    return rows.map(mapProject);
  }

  async getProject(projectId: string) {
    const row = await prisma.benchmarkProject.findUnique({ where: { id: projectId } });
    if (!row) {
      return null;
    }
    const tasks = await prisma.benchmarkTask.findMany({
      where: { projectId },
      orderBy: [{ taskKey: "asc" }],
    });
    return {
      project: mapProject(row),
      tasks: tasks.map(mapTask),
    };
  }

  async ensureRepoForProject(project: BenchmarkProject) {
    if (project.repoId) {
      const repo = await this.repoService.getRepo(project.repoId);
      if (repo) {
        return repo;
      }
    }

    if (project.sourceKind === "managed_pack") {
      const candidates = await prisma.repoRegistry.findMany({
        where: {
          sourceKind: "managed_pack",
        },
      });
      const existing =
        candidates.find((item) => item.sourceUri === project.sourceUri) ||
        candidates.find((item) => (item.metadata as Record<string, unknown> | undefined)?.project_key === project.sourceUri) ||
        null;
      if (existing) {
        await prisma.benchmarkProject.update({
          where: { id: project.id },
          data: { repoId: existing.id },
        });
        return this.repoService.getRepo(existing.id);
      }
      const imported = await this.repoService.importManagedPack({
        actor: "system",
        project_key: path.basename(project.sourceUri),
        display_name: project.displayName,
      });
      await prisma.benchmarkProject.update({
        where: { id: project.id },
        data: { repoId: imported.repo.id },
      });
      return imported.repo;
    }

    if (project.sourceKind === "local_path") {
      const existing = await prisma.repoRegistry.findFirst({
        where: {
          sourceKind: "local_path",
          sourceUri: project.sourceUri,
        },
      });
      if (existing) {
        await prisma.benchmarkProject.update({
          where: { id: project.id },
          data: { repoId: existing.id },
        });
        return this.repoService.getRepo(existing.id);
      }
      const attached = await this.repoService.attachLocalRepo({
        actor: "system",
        source_path: project.sourceUri,
        display_name: project.displayName,
      });
      await prisma.benchmarkProject.update({
        where: { id: project.id },
        data: { repoId: attached.repo.id },
      });
      return attached.repo;
    }

    return null;
  }

  async startRun(input: StartBenchmarkRunInput) {
    await this.syncProjectManifests();
    const projectRow = await prisma.benchmarkProject.findUnique({ where: { id: input.project_id } });
    if (!projectRow) {
      throw new Error(`Benchmark project not found: ${input.project_id}`);
    }
    const taskRow = await prisma.benchmarkTask.findUnique({ where: { id: input.task_id } });
    if (!taskRow) {
      throw new Error(`Benchmark task not found: ${input.task_id}`);
    }

    const project = mapProject(projectRow);
    const repo = input.repo_id ? await this.repoService.getRepo(input.repo_id) : await this.ensureRepoForProject(project);
    if (!repo) {
      throw new Error(`Unable to resolve repo for benchmark project: ${project.displayName}`);
    }

    const runId = project.projectKey.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const runRoot = path.join(this.runRoot(), `${Date.now()}-${runId}`);
    const sourceWorktree = path.join(repo.managedWorktreeRoot, "active");
    fs.mkdirSync(runRoot, { recursive: true });
    fs.cpSync(sourceWorktree, runRoot, { recursive: true });

    const mode = input.mode || "api_regression";
    const providerRole = input.provider_role || inferBenchmarkProviderRole(project, mapTask(taskRow));
    const runRow = await prisma.benchmarkRun.create({
      data: {
        projectId: project.id,
        repoId: repo.id,
        taskId: taskRow.id,
        mode,
        providerRole,
        status: "running",
        actor: input.actor,
        worktreePath: runRoot,
        metadata: {
          project_key: project.projectKey,
          task_key: taskRow.taskKey,
          time_budget_sec: project.timeBudgetSec,
        },
      },
    });

    if (project.setupCommand) {
      const setupResult = runShell(project.setupCommand, runRoot);
      await prisma.benchmarkOutcomeEvidence.create({
        data: {
          runId: runRow.id,
          kind: "build_result",
          payload: {
            phase: "setup",
            command: project.setupCommand,
            ...setupResult,
          },
        },
      });
    }

    await this.events.appendEvent({
      type: "benchmark.run.started",
      aggregateId: runRow.id,
      actor: input.actor,
      payload: {
        benchmark_run_id: runRow.id,
        repo_id: repo.id,
        project_id: project.id,
        task_id: taskRow.id,
        mode,
        provider_role: providerRole,
      },
    });

    publishEvent("global", "benchmark.run.started", {
      runId: runRow.id,
      repoId: repo.id,
      projectId: project.id,
      taskId: taskRow.id,
    });

    return {
      run: mapRun(runRow),
      repo,
      project,
      task: mapTask(taskRow),
    };
  }

  async executeTask(runId: string, actor: string) {
    const runRow = await prisma.benchmarkRun.findUnique({ where: { id: runId } });
    if (!runRow) {
      throw new Error(`Benchmark run not found: ${runId}`);
    }
    const taskRow = await prisma.benchmarkTask.findUnique({ where: { id: runRow.taskId } });
    const projectRow = await prisma.benchmarkProject.findUnique({ where: { id: runRow.projectId } });
    if (!taskRow || !projectRow) {
      throw new Error("Benchmark run is missing project/task state");
    }

    const task = mapTask(taskRow);
    const project = mapProject(projectRow);
    const benchmarkRisk = inferBenchmarkRisk(task);
    const planned = await this.executionService.planExecution({
      actor,
      runId: runRow.id,
      repoId: runRow.repoId,
      projectId: project.id,
      objective: task.prompt,
      worktreePath: runRow.worktreePath,
      modelRole: inferBenchmarkProviderRole(project, task),
      queryMode: task.category === "decompose" ? "architecture" : task.category === "review" ? "review" : "impact",
      verificationPlan: task.requiredChecks,
      docsRequired: task.requiredDocs,
      metadata: {
        benchmark_task_id: task.id,
        benchmark_project_id: project.id,
        inferred_risk: benchmarkRisk,
        project_key: project.projectKey,
        task_key: task.taskKey,
      },
    });

    const attempt = await this.executionService.startExecution({
      actor,
      runId: runRow.id,
      repoId: runRow.repoId,
      projectId: project.id,
      projectKey: project.projectKey,
      worktreePath: runRow.worktreePath,
      objective: task.prompt,
      modelRole: planned.routingDecision.modelRole,
      providerId: planned.routingDecision.providerId,
      routingDecisionId: planned.routingDecision.id,
      contextPackId: planned.contextPack.id,
      metadata: {
        benchmark_task_id: task.id,
        benchmark_project_id: project.id,
      },
    });

    const verification = await this.executionService.verifyExecution({
      actor,
      runId: runRow.id,
      repoId: runRow.repoId,
      worktreePath: runRow.worktreePath,
      executionAttemptId: attempt.id,
      commands: buildVerificationCommandPlans(task.requiredChecks.length ? task.requiredChecks : [project.verifyCommand]),
      docsRequired: task.requiredDocs,
      fullSuiteRun: task.category === "decompose" || task.category === "review",
    });

    const updated = await prisma.benchmarkRun.update({
      where: { id: runId },
      data: {
        providerRole: planned.routingDecision.modelRole,
        chatSessionId: null,
        routingDecisionId: planned.routingDecision.id,
        metadata: {
          ...(runRow.metadata as Record<string, unknown> | undefined),
          context_manifest_id: planned.contextManifest.id,
          context_pack_id: planned.contextPack.id,
          execution_attempt_id: attempt.id,
          verification_bundle_id: verification.id,
          inferred_provider_role: inferBenchmarkProviderRole(project, task),
          inferred_risk: benchmarkRisk,
        },
      },
    });

    await this.events.appendEvent({
      type: "benchmark.task.started",
      aggregateId: runId,
      actor,
      payload: {
        benchmark_run_id: runId,
        chat_session_id: null,
        routing_decision_id: planned.routingDecision.id,
        context_manifest_id: planned.contextManifest.id,
        context_pack_id: planned.contextPack.id,
        provider_role: planned.routingDecision.modelRole,
        inferred_risk: benchmarkRisk,
        execution_attempt_id: attempt.id,
        verification_bundle_id: verification.id,
      },
    });

    publishEvent("global", "benchmark.task.started", {
      runId,
      chatSessionId: null,
      routingDecisionId: planned.routingDecision.id,
    });

    return {
      run: mapRun(updated),
      chatSession: null,
      routingDecision: planned.routingDecision,
      context: planned.contextManifest,
      contextPack: planned.contextPack,
      executionAttempt: attempt,
      verification,
    };
  }

  async scoreRun(runId: string, actor: string) {
    const runRow = await prisma.benchmarkRun.findUnique({ where: { id: runId } });
    if (!runRow) {
      throw new Error(`Benchmark run not found: ${runId}`);
    }
    const taskRow = await prisma.benchmarkTask.findUnique({ where: { id: runRow.taskId } });
    const projectRow = await prisma.benchmarkProject.findUnique({ where: { id: runRow.projectId } });
    const guidelines = await this.repoService.getGuidelines(runRow.repoId);
    const blueprint = await prisma.projectBlueprint.findFirst({
      where: { projectId: runRow.repoId },
      orderBy: { version: "desc" },
    });
    const retrievalTrace = await prisma.retrievalTrace.findMany({
      where: { aggregateId: runId },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    const verificationBundle = await prisma.verificationBundle.findFirst({
      where: { runId },
      orderBy: { createdAt: "desc" },
    });
    if (!taskRow || !projectRow) {
      throw new Error("Benchmark task or project not found");
    }

    const task = mapTask(taskRow);
    const project = mapProject(projectRow);
    const evidenceRefs: string[] = [];
    const hardFailures: string[] = [];

    const verifyResult = runShell(project.verifyCommand, runRow.worktreePath);
    const verifyEvidence = await prisma.benchmarkOutcomeEvidence.create({
      data: {
        runId,
        kind: "test_result",
        payload: {
          command: project.verifyCommand,
          ...verifyResult,
        },
      },
    });
    evidenceRefs.push(verifyEvidence.id);

    const diffNames = runShell("git status --short || true", runRow.worktreePath);
    const diffEvidence = await prisma.benchmarkOutcomeEvidence.create({
      data: {
        runId,
        kind: "diff_meta",
        payload: {
          changed_files: diffNames.stdout
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean),
        },
      },
    });
    evidenceRefs.push(diffEvidence.id);

    for (const docPath of task.requiredDocs) {
      if (!fs.existsSync(path.join(runRow.worktreePath, docPath))) {
        hardFailures.push(`required_doc_missing:${docPath}`);
      }
    }

    if (!verifyResult.ok) {
      hardFailures.push("verify_command_failed");
    }
    if (!verificationBundle) {
      hardFailures.push("verification_bundle_missing");
    } else if (!verificationBundle.pass) {
      hardFailures.push(...asStringArray(verificationBundle.failures));
    }
    if (!retrievalTrace.length) {
      hardFailures.push("retrieval_trace_missing");
    }
    if (!task.requiredChecks.length) {
      hardFailures.push("required_checks_missing");
    }

    const functionalCorrectness = verifyResult.ok ? 40 : 0;
    const verificationDiscipline = verifyResult.ok && verificationBundle?.pass ? 15 : verifyResult.ok ? 10 : 5;
    const guidelineAdherence = guidelines ? Math.min(20, 8 + guidelines.sourceRefs.length * 2) : 6;
    const changedFileCount = asStringArray((diffEvidence.payload as Record<string, unknown>).changed_files).length;
    const patchQuality = changedFileCount === 0 ? 0 : changedFileCount <= 6 ? 10 : changedFileCount <= 12 ? 7 : 4;
    const retrievalDiscipline = retrievalTrace.length > 0 ? 5 : 0;

    // Blueprint-driven policy compliance scoring
    let policyCompliance = 0;
    if (blueprint) {
      const bp = blueprint as { testingPolicy?: Record<string, unknown>; documentationPolicy?: Record<string, unknown>; executionPolicy?: Record<string, unknown> };
      // +2 for having a blueprint at all
      policyCompliance += 2;
      // +1 if testing policy was satisfied (tests passed when required)
      const testsRequired = bp.testingPolicy?.requiredForBehaviorChange === true;
      if (!testsRequired || verifyResult.ok) policyCompliance += 1;
      // +1 if docs policy was satisfied
      const docsRequired = bp.documentationPolicy?.updateUserFacingDocs === true;
      const requiredDocPaths = Array.isArray(bp.documentationPolicy?.requiredDocPaths) ? bp.documentationPolicy.requiredDocPaths as string[] : [];
      const docsMissing = requiredDocPaths.filter((d) => !fs.existsSync(path.join(runRow.worktreePath, d)));
      if (!docsRequired || docsMissing.length === 0) policyCompliance += 1;
      else hardFailures.push(...docsMissing.map((d) => `blueprint_required_doc_missing:${d}`));
      // +1 if changed file count is within blueprint's review threshold
      const maxFiles = typeof bp.executionPolicy?.maxChangedFilesBeforeReview === "number" ? bp.executionPolicy.maxChangedFilesBeforeReview as number : 10;
      if (changedFileCount <= maxFiles) policyCompliance += 1;
    } else {
      // No blueprint — flat baseline score
      policyCompliance = 3;
    }
    const elapsedMs = Date.now() - runRow.startedAt.getTime();
    const latencyRecovery = elapsedMs <= project.timeBudgetSec * 1000 ? 5 : 2;
    const totalScore =
      functionalCorrectness +
      guidelineAdherence +
      verificationDiscipline +
      patchQuality +
      retrievalDiscipline +
      policyCompliance +
      latencyRecovery;
    const pass = hardFailures.length === 0 && totalScore >= 75;

    const scoreRow = await prisma.benchmarkScorecard.upsert({
      where: { runId },
      update: {
        pass,
        totalScore,
        functionalCorrectness,
        guidelineAdherence,
        verificationDiscipline,
        patchQuality,
        retrievalDiscipline,
        policyCompliance,
        latencyRecovery,
        hardFailures,
        evidenceRefs,
        summary: pass ? "Benchmark passed with machine-verifiable evidence." : `Benchmark failed: ${hardFailures.join(", ") || "score below threshold"}`,
        metadata: {
          verify_exit_code: verifyResult.exitCode,
          elapsed_ms: elapsedMs,
          retrieval_trace_count: retrievalTrace.length,
        },
      },
      create: {
        runId,
        pass,
        totalScore,
        functionalCorrectness,
        guidelineAdherence,
        verificationDiscipline,
        patchQuality,
        retrievalDiscipline,
        policyCompliance,
        latencyRecovery,
        hardFailures,
        evidenceRefs,
        summary: pass ? "Benchmark passed with machine-verifiable evidence." : `Benchmark failed: ${hardFailures.join(", ") || "score below threshold"}`,
        metadata: {
          verify_exit_code: verifyResult.exitCode,
          elapsed_ms: elapsedMs,
          retrieval_trace_count: retrievalTrace.length,
        },
      },
    });

    await prisma.benchmarkRun.update({
      where: { id: runId },
      data: {
        status: pass ? "completed" : "failed",
        completedAt: new Date(),
      },
    });

    const report = await prisma.shareableRunReport.upsert({
      where: { runId },
      update: {
        repoId: runRow.repoId,
        scorecardId: scoreRow.id,
        summary: pass
          ? `Completed ${task.title}. Verification passed and the benchmark scorecard is green.`
          : `Completed ${task.title} with failures: ${hardFailures.join(", ") || "score below threshold"}.`,
        evidenceUrls: evidenceRefs,
        metadata: {
          project_key: project.projectKey,
          task_key: task.taskKey,
        },
      },
      create: {
        runId,
        repoId: runRow.repoId,
        scorecardId: scoreRow.id,
        summary: pass
          ? `Completed ${task.title}. Verification passed and the benchmark scorecard is green.`
          : `Completed ${task.title} with failures: ${hardFailures.join(", ") || "score below threshold"}.`,
        evidenceUrls: evidenceRefs,
        metadata: {
          project_key: project.projectKey,
          task_key: task.taskKey,
        },
      },
    });

    if (pass) {
      await prisma.benchmarkExampleCandidate.upsert({
        where: { runId },
        update: {
          scorecardId: scoreRow.id,
          status: "candidate",
          metadata: {
            project_key: project.projectKey,
            task_key: task.taskKey,
          },
        },
        create: {
          runId,
          scorecardId: scoreRow.id,
          status: "candidate",
          metadata: {
            project_key: project.projectKey,
            task_key: task.taskKey,
          },
        },
      });
    }

    await this.events.appendEvent({
      type: pass ? "benchmark.task.completed" : "benchmark.run.failed",
      aggregateId: runId,
      actor,
      payload: {
        benchmark_run_id: runId,
        pass,
        total_score: totalScore,
        hard_failures: hardFailures,
      },
    });

    publishEvent("global", pass ? "benchmark.score.updated" : "benchmark.run.failed", {
      runId,
      pass,
      totalScore,
      hardFailures,
      reportId: report.id,
    });

    return {
      run: mapRun(
        (await prisma.benchmarkRun.findUniqueOrThrow({
          where: { id: runId },
        })) as any
      ),
      scorecard: mapScorecard(scoreRow),
      evidence: (await prisma.benchmarkOutcomeEvidence.findMany({
        where: { runId },
        orderBy: { createdAt: "asc" },
      })).map(mapEvidence),
    };
  }

  async listRuns(repoId?: string) {
    const rows = await prisma.benchmarkRun.findMany({
      where: repoId ? { repoId } : undefined,
      orderBy: { startedAt: "desc" },
      take: 100,
    });
    return rows.map(mapRun);
  }

  async getRun(runId: string) {
    const run = await prisma.benchmarkRun.findUnique({ where: { id: runId } });
    if (!run) {
      return null;
    }
    const score = await prisma.benchmarkScorecard.findUnique({ where: { runId } });
    const evidence = await prisma.benchmarkOutcomeEvidence.findMany({
      where: { runId },
      orderBy: { createdAt: "asc" },
    });
    return {
      run: mapRun(run),
      scorecard: score ? mapScorecard(score) : null,
      evidence: evidence.map(mapEvidence),
    };
  }

  async listFailures() {
    const rows = await prisma.benchmarkScorecard.findMany({
      where: { pass: false },
      orderBy: { updatedAt: "desc" },
      take: 50,
    });
    return rows.map(mapScorecard);
  }

  async getLeaderboard() {
    const rows = await prisma.benchmarkScorecard.findMany({
      orderBy: [{ totalScore: "desc" }, { updatedAt: "desc" }],
      take: 100,
    });
    return rows.map(mapScorecard);
  }
}
