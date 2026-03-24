import fs from "node:fs";
import path from "node:path";
import { prisma } from "./db";
import { listOnPremQwenModelPlugins } from "./providers/modelPlugins";
import { mapLegacyToLifecycle } from "./routes/shared/ticketProjection";

export async function seedIfEmpty() {
  const ticketCount = await prisma.ticket.count();
  if (ticketCount === 0) {
    await prisma.ticket.createMany({
      data: [
        {
          title: "Design overseer chat command protocol",
          description: "Define structured action envelope for chat-to-ticket operations.",
          status: "ready",
          priority: "p1",
          risk: "medium",
          acceptanceCriteria: ["Envelope schema documented", "Backward-compatible parser in place"],
          dependencies: [],
        },
        {
          title: "Implement Kanban optimistic updates",
          description: "Drag ticket between lanes with optimistic UI and rollback.",
          status: "in_progress",
          priority: "p1",
          risk: "low",
          acceptanceCriteria: ["No flicker on move", "Rollback on API conflict"],
          dependencies: [],
        },
        {
          title: "Ship quota ETA monitor",
          description: "Track account cooldowns and reset confidence.",
          status: "backlog",
          priority: "p0",
          risk: "high",
          acceptanceCriteria: ["Per-account next usable ETA", "Confidence scoring"],
          dependencies: [],
        },
      ],
    });
  }

  const sessionCount = await prisma.chatSession.count();
  if (sessionCount === 0) {
    await prisma.chatSession.create({
      data: {
        title: "Overseer Session",
        providerId: "onprem-qwen",
      },
    });
  }
}

export async function seedV2ReadModels() {
  const projectionCount = await prisma.taskProjection.count();
  if (projectionCount === 0) {
    const legacyTickets = await prisma.ticket.findMany({
      orderBy: { createdAt: "asc" },
    });

    for (const ticket of legacyTickets) {
      await prisma.taskProjection.upsert({
        where: { ticketId: ticket.id },
        update: {
          title: ticket.title,
          description: ticket.description,
          status: mapLegacyToLifecycle(ticket.status),
          priority: ticket.priority,
          risk: ticket.risk,
          acceptanceCriteria: ticket.acceptanceCriteria,
          dependencies: ticket.dependencies,
        },
        create: {
          ticketId: ticket.id,
          title: ticket.title,
          description: ticket.description,
          status: mapLegacyToLifecycle(ticket.status),
          priority: ticket.priority,
          risk: ticket.risk,
          acceptanceCriteria: ticket.acceptanceCriteria,
          dependencies: ticket.dependencies,
        },
      });
    }
  }

  const pendingApprovalRows = await prisma.approvalRequest.findMany({
    where: { status: "pending" },
    orderBy: { requestedAt: "desc" },
    take: 100,
  });

  for (const row of pendingApprovalRows) {
    await prisma.approvalProjection.upsert({
      where: { approvalId: row.id },
      update: {
        actionType: row.actionType,
        status: row.status,
        reason: row.reason,
        payload: row.payload,
        requestedAt: row.requestedAt,
        decidedAt: row.decidedAt,
      },
      create: {
        approvalId: row.id,
        actionType: row.actionType,
        status: row.status,
        reason: row.reason,
        payload: row.payload,
        requestedAt: row.requestedAt,
        decidedAt: row.decidedAt,
      },
    });
  }

  const knowledgeCount = await prisma.knowledgeIndexMetadata.count();
  if (knowledgeCount === 0) {
    const candidates = ["README.md", "guidelines/Guidelines.md", "src/shared/contracts.ts"];
    for (const candidate of candidates) {
      const full = path.resolve(process.cwd(), candidate);
      if (!fs.existsSync(full)) {
        continue;
      }
      const content = fs.readFileSync(full, "utf-8");
      await prisma.knowledgeIndexMetadata.create({
        data: {
          source: "bootstrap",
          path: candidate,
          snippet: content.slice(0, 4000),
          score: 0.8,
        },
      });
    }
  }
}

export async function seedModelPluginRegistry() {
  const onPrem = await prisma.appSetting.findUnique({ where: { key: "onprem_qwen_config" } });
  const onPremValue = (onPrem?.value as Record<string, unknown>) || {};
  const activePluginId =
    typeof onPremValue.pluginId === "string" && onPremValue.pluginId.trim().length > 0
      ? onPremValue.pluginId
      : "qwen3.5-4b";

  const plugins = listOnPremQwenModelPlugins();
  for (const plugin of plugins) {
    await prisma.modelPluginRegistry.upsert({
      where: { pluginId: plugin.id },
      update: {
        providerId: "onprem-qwen",
        modelId: plugin.runtimeModel,
        paramsB: plugin.paramsB,
        active: plugin.id === activePluginId,
        capabilities: {
          maxContext: plugin.maxContext,
          recommendedBackend: plugin.recommendedBackend,
          notes: plugin.notes,
        },
      },
      create: {
        pluginId: plugin.id,
        providerId: "onprem-qwen",
        modelId: plugin.runtimeModel,
        paramsB: plugin.paramsB,
        active: plugin.id === activePluginId,
        capabilities: {
          maxContext: plugin.maxContext,
          recommendedBackend: plugin.recommendedBackend,
          notes: plugin.notes,
        },
      },
    });
  }
}
