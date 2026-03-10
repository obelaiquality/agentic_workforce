import { prisma } from "../db";
import { publishEvent } from "../eventBus";
import type { ChallengeCandidate } from "../../shared/contracts";
import { V2EventService } from "./v2EventService";

function mapCandidate(row: {
  id: string;
  modelPluginId: string;
  parentModelPluginId: string | null;
  datasetId: string;
  evalRunId: string;
  status: string;
  metrics: unknown;
  createdAt: Date;
  updatedAt: Date;
}): ChallengeCandidate {
  return {
    id: row.id,
    modelPluginId: row.modelPluginId,
    parentModelPluginId: row.parentModelPluginId,
    datasetId: row.datasetId,
    evalRunId: row.evalRunId,
    status: row.status as ChallengeCandidate["status"],
    metrics: (row.metrics ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class ChallengeService {
  constructor(private readonly events: V2EventService) {}

  async registerCandidate(input: {
    actor: string;
    model_plugin_id: string;
    parent_model_plugin_id?: string | null;
    dataset_id: string;
    eval_run_id: string;
  }) {
    const evalRun = await prisma.distillEvalRun.findUnique({ where: { id: input.eval_run_id } });
    const status = evalRun?.pass ? "pending_review" : "draft";

    const row = await prisma.challengeCandidate.create({
      data: {
        modelPluginId: input.model_plugin_id,
        parentModelPluginId: input.parent_model_plugin_id || null,
        datasetId: input.dataset_id,
        evalRunId: input.eval_run_id,
        status,
        metrics: (evalRun?.metrics ?? {}) as Record<string, unknown>,
      },
    });

    await this.events.appendEvent({
      type: "model.challenge.registered",
      aggregateId: row.id,
      actor: input.actor,
      payload: {
        challenge_candidate_id: row.id,
        status,
        eval_run_id: input.eval_run_id,
      },
    });

    publishEvent("global", "model.challenge.registered", {
      challengeCandidateId: row.id,
      status,
      modelPluginId: row.modelPluginId,
    });

    return mapCandidate(row);
  }

  async reviewCandidate(input: { actor: string; candidate_id: string; status: "approved" | "rejected" | "promoted" }) {
    const row = await prisma.challengeCandidate.update({
      where: { id: input.candidate_id },
      data: {
        status: input.status,
      },
    });

    await this.events.appendEvent({
      type: input.status === "promoted" ? "model.promoted" : "model.promotion.pending_review",
      aggregateId: row.id,
      actor: input.actor,
      payload: {
        challenge_candidate_id: row.id,
        status: input.status,
      },
    });

    return mapCandidate(row);
  }

  async getChampionVsChallenger() {
    const champions = await prisma.modelPluginRegistry.findMany({
      where: { promoted: true },
      orderBy: { updatedAt: "desc" },
    });
    const challengers = await prisma.challengeCandidate.findMany({
      orderBy: { updatedAt: "desc" },
      take: 50,
    });

    return {
      champions: champions.map((item) => ({
        pluginId: item.pluginId,
        modelId: item.modelId,
        active: item.active,
        promoted: item.promoted,
        paramsB: item.paramsB,
        updatedAt: item.updatedAt.toISOString(),
      })),
      challengers: challengers.map(mapCandidate),
    };
  }
}
