import { randomUUID } from "node:crypto";
import { prisma } from "../db";
import type { WorkflowSubtask, TicketPriority, TicketRisk } from "../../shared/contracts";

const SUBTASK_EVENT_TYPE = "ticket.subtask_upserted";

interface PersistedSubtaskEvent {
  kind: "created" | "updated";
  subtask: WorkflowSubtask;
}

export interface CreateSubtaskInput {
  parentTicketId: string;
  title: string;
  description: string;
  priority?: TicketPriority;
  estimatedComplexity?: "low" | "medium" | "high";
  dependencies?: string[];
}

export interface UpdateSubtaskInput {
  parentTicketId: string;
  subtaskId: string;
  status?: WorkflowSubtask["status"];
  notes?: string;
}

export interface SubtaskPersistence {
  list(parentTicketId: string): Promise<WorkflowSubtask[]>;
  save(parentTicketId: string, event: PersistedSubtaskEvent): Promise<void>;
}

export function createPrismaSubtaskPersistence(): SubtaskPersistence {
  return {
    async list(parentTicketId) {
      const rows = await prisma.ticketEvent.findMany({
        where: {
          ticketId: parentTicketId,
          type: SUBTASK_EVENT_TYPE,
        },
        orderBy: { createdAt: "asc" },
      });

      const byId = new Map<string, WorkflowSubtask>();
      for (const row of rows) {
        const payload = row.payload as PersistedSubtaskEvent;
        if (!payload?.subtask?.id) {
          continue;
        }
        byId.set(payload.subtask.id, payload.subtask);
      }

      const items = Array.from(byId.values());
      return withDerivedState(items);
    },

    async save(parentTicketId, event) {
      await prisma.ticketEvent.create({
        data: {
          ticketId: parentTicketId,
          type: SUBTASK_EVENT_TYPE,
          payload: event,
        },
      });
    },
  };
}

export class SubtaskService {
  private readonly cache = new Map<string, Map<string, WorkflowSubtask>>();

  constructor(private readonly persistence?: SubtaskPersistence) {}

  async createSubtask(input: CreateSubtaskInput): Promise<WorkflowSubtask> {
    const now = new Date().toISOString();
    const subtask: WorkflowSubtask = {
      id: `subtask_${randomUUID().slice(0, 8)}`,
      parentTicketId: input.parentTicketId,
      title: input.title,
      description: input.description,
      status: "backlog",
      priority: input.priority || "p2",
      risk: toRisk(input.estimatedComplexity),
      dependencies: input.dependencies || [],
      notes: [],
      blockedBy: [],
      blocked: false,
      createdAt: now,
      updatedAt: now,
    };

    this.upsertCached(subtask);
    await this.persistence?.save(input.parentTicketId, {
      kind: "created",
      subtask,
    });
    return this.materializeWithSiblings(input.parentTicketId, subtask.id);
  }

  async updateSubtask(input: UpdateSubtaskInput): Promise<WorkflowSubtask | null> {
    const items = await this.listSubtasks(input.parentTicketId, { includeCompleted: true });
    const current = items.find((item) => item.id === input.subtaskId);
    if (!current) {
      return null;
    }

    const next: WorkflowSubtask = {
      ...current,
      status: input.status ?? current.status,
      notes: input.notes ? [...current.notes, input.notes] : current.notes,
      updatedAt: new Date().toISOString(),
    };

    this.upsertCached(next);
    await this.persistence?.save(input.parentTicketId, {
      kind: "updated",
      subtask: next,
    });
    return this.materializeWithSiblings(input.parentTicketId, input.subtaskId);
  }

  async listSubtasks(parentTicketId: string, options?: { includeCompleted?: boolean }): Promise<WorkflowSubtask[]> {
    if (this.persistence) {
      const persisted = await this.persistence.list(parentTicketId);
      this.replaceCached(parentTicketId, persisted);
    }

    const items = Array.from(this.cache.get(parentTicketId)?.values() || []);
    const derived = withDerivedState(items);
    return options?.includeCompleted ? derived : derived.filter((item) => item.status !== "done");
  }

  async getSubtask(parentTicketId: string, subtaskId: string): Promise<WorkflowSubtask | null> {
    const items = await this.listSubtasks(parentTicketId, { includeCompleted: true });
    return items.find((item) => item.id === subtaskId) || null;
  }

  clear(): void {
    this.cache.clear();
  }

  private materializeWithSiblings(parentTicketId: string, subtaskId: string): WorkflowSubtask {
    const items = withDerivedState(Array.from(this.cache.get(parentTicketId)?.values() || []));
    this.replaceCached(parentTicketId, items);
    return items.find((item) => item.id === subtaskId)!;
  }

  private upsertCached(subtask: WorkflowSubtask): void {
    const bucket = this.cache.get(subtask.parentTicketId) || new Map<string, WorkflowSubtask>();
    bucket.set(subtask.id, subtask);
    this.cache.set(subtask.parentTicketId, bucket);
  }

  private replaceCached(parentTicketId: string, items: WorkflowSubtask[]): void {
    const bucket = new Map<string, WorkflowSubtask>();
    for (const item of items) {
      bucket.set(item.id, item);
    }
    this.cache.set(parentTicketId, bucket);
  }
}

function toRisk(complexity?: "low" | "medium" | "high"): TicketRisk {
  if (complexity === "high") return "high";
  if (complexity === "low") return "low";
  return "medium";
}

function withDerivedState(items: WorkflowSubtask[]): WorkflowSubtask[] {
  return items
    .map((item) => {
      const blockedBy = item.dependencies.filter((dependency) => {
        const dep = items.find((candidate) => candidate.id === dependency);
        return dep && dep.status !== "done";
      });
      return {
        ...item,
        blockedBy,
        blocked: blockedBy.length > 0 || item.status === "blocked",
      };
    })
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}
