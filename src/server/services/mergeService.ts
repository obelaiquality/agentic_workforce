import { prisma } from "../db";
import { publishEvent } from "../eventBus";
import type { MergeReport } from "../../shared/contracts";
import { V2EventService } from "./v2EventService";

interface PrepareMergeInput {
  actor: string;
  repo_id?: string;
  run_id: string;
  changed_files: string[];
  semantic_conflicts?: string[];
  required_checks?: string[];
  overlap_score?: number;
  metadata?: Record<string, unknown>;
}

function toStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function computeOverlapScore(changedFiles: string[]) {
  if (changedFiles.length <= 1) {
    return 0.05;
  }

  const normalized = changedFiles.map((file) => file.trim()).filter(Boolean);
  const directories = normalized.map((file) => file.split("/").slice(0, -1).join("/"));
  const uniqueDirs = new Set(directories);
  const repeatedDirs = normalized.length - uniqueDirs.size;
  const score = repeatedDirs <= 0 ? 0.12 : Math.min(0.9, 0.12 + repeatedDirs / Math.max(1, normalized.length));
  return Number(score.toFixed(2));
}

function mapReport(row: {
  id: string;
  repoId: string | null;
  runId: string;
  changedFiles: unknown;
  overlapScore: number;
  semanticConflicts: unknown;
  requiredChecks: unknown;
  outcome: string;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}): MergeReport {
  return {
    id: row.id,
    repoId: row.repoId,
    runId: row.runId,
    changedFiles: toStringArray(row.changedFiles),
    overlapScore: row.overlapScore,
    semanticConflicts: toStringArray(row.semanticConflicts),
    requiredChecks: toStringArray(row.requiredChecks),
    outcome: row.outcome as MergeReport["outcome"],
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class MergeService {
  constructor(private readonly events: V2EventService) {}

  async prepareMerge(input: PrepareMergeInput) {
    const overlapScore = typeof input.overlap_score === "number" ? input.overlap_score : computeOverlapScore(input.changed_files);
    const semanticConflicts = input.semantic_conflicts || [];
    const requiredChecks = input.required_checks || ["lint_changed", "tests_impacted"];
    const outcome = semanticConflicts.length > 0 ? "integrator_required" : overlapScore > 0.2 ? "integrator_required" : "fast_path";

    const row = await prisma.mergeReport.upsert({
      where: { runId: input.run_id },
      update: {
        repoId: input.repo_id || null,
        changedFiles: input.changed_files,
        overlapScore,
        semanticConflicts,
        requiredChecks,
        outcome,
        metadata: input.metadata || {},
      },
      create: {
        repoId: input.repo_id || null,
        runId: input.run_id,
        changedFiles: input.changed_files,
        overlapScore,
        semanticConflicts,
        requiredChecks,
        outcome,
        metadata: input.metadata || {},
      },
    });

    await this.events.appendEvent({
      type: semanticConflicts.length > 0 ? "merge.conflict.detected" : "merge.prepared",
      aggregateId: input.run_id,
      actor: input.actor,
      payload: {
        merge_report_id: row.id,
        repo_id: input.repo_id || null,
        overlap_score: overlapScore,
        outcome,
        semantic_conflicts: semanticConflicts,
      },
    });

    publishEvent("global", semanticConflicts.length > 0 ? "merge.conflict.detected" : "merge.prepared", {
      runId: input.run_id,
      repoId: input.repo_id || null,
      mergeReportId: row.id,
      overlapScore,
      outcome,
    });

    return mapReport(row);
  }

  async getMergeReport(runId: string) {
    const row = await prisma.mergeReport.findUnique({ where: { runId } });
    return row ? mapReport(row) : null;
  }
}
