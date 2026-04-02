import { randomUUID } from "node:crypto";
import path from "path";
import fs from "fs";
import { prisma } from "../db";
import type { SkillRecord, SkillInvocationRecord } from "../../shared/contracts";
import type { SkillDefinitionFile, SkillInvocationInput } from "./types";

const BUILTINS_DIR = path.join(__dirname, "builtins");
const CUSTOM_SKILLS_KEY = "agentic.skills.custom.v1";
const INVOCATION_KEY_PREFIX = "agentic.skill.invocation.";

export interface SkillPersistence {
  loadCustomSkills(): Promise<SkillRecord[]>;
  saveCustomSkills(skills: SkillRecord[]): Promise<void>;
  saveInvocation(invocation: SkillInvocationRecord): Promise<void>;
  getInvocation(invocationId: string): Promise<SkillInvocationRecord | null>;
  listInvocations(filter?: { runId?: string; limit?: number }): Promise<SkillInvocationRecord[]>;
}

export function createPrismaSkillPersistence(): SkillPersistence {
  return {
    async loadCustomSkills() {
      const row = await prisma.appSetting.findUnique({
        where: { key: CUSTOM_SKILLS_KEY },
      });
      return Array.isArray(row?.value)
        ? row!.value.filter((item): item is SkillRecord => Boolean(item && typeof item === "object")) as SkillRecord[]
        : [];
    },

    async saveCustomSkills(skills) {
      await prisma.appSetting.upsert({
        where: { key: CUSTOM_SKILLS_KEY },
        update: { value: skills },
        create: { key: CUSTOM_SKILLS_KEY, value: skills },
      });
    },

    async saveInvocation(invocation) {
      await prisma.appSetting.upsert({
        where: { key: `${INVOCATION_KEY_PREFIX}${invocation.id}` },
        update: { value: invocation },
        create: { key: `${INVOCATION_KEY_PREFIX}${invocation.id}`, value: invocation },
      });
    },

    async getInvocation(invocationId) {
      const row = await prisma.appSetting.findUnique({
        where: { key: `${INVOCATION_KEY_PREFIX}${invocationId}` },
      });
      return row?.value && typeof row.value === "object"
        ? (row.value as SkillInvocationRecord)
        : null;
    },

    async listInvocations(filter) {
      const rows = await prisma.appSetting.findMany({
        where: {
          key: {
            startsWith: INVOCATION_KEY_PREFIX,
          },
        },
        orderBy: { updatedAt: "desc" },
        take: filter?.limit && filter.limit > 0 ? filter.limit : 100,
      });

      return rows
        .map((row) => row.value as SkillInvocationRecord)
        .filter((row) => !filter?.runId || row.runId === filter.runId);
    },
  };
}

export class SkillService {
  private readonly skills = new Map<string, SkillRecord>();
  private readonly invocations = new Map<string, SkillInvocationRecord>();
  private initialized = false;

  constructor(private readonly persistence?: SkillPersistence) {
    this.loadBuiltinSkills();
  }

  async initialize(): Promise<void> {
    if (this.initialized || !this.persistence) {
      this.initialized = true;
      return;
    }

    const customSkills = await this.persistence.loadCustomSkills();
    for (const skill of customSkills) {
      this.skills.set(skill.id, skill);
    }
    this.initialized = true;
  }

  private loadBuiltinSkills(): void {
    if (!fs.existsSync(BUILTINS_DIR)) return;

    const files = fs.readdirSync(BUILTINS_DIR).filter((file) => file.endsWith(".json"));
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(BUILTINS_DIR, file), "utf-8");
        const def = JSON.parse(content) as SkillDefinitionFile;
        const id = `builtin_${def.name}`;
        this.skills.set(id, {
          id,
          name: def.name,
          description: def.description,
          version: def.version,
          contextMode: def.contextMode,
          allowedTools: Array.isArray(def.allowedTools) ? def.allowedTools : [],
          maxIterations: def.maxIterations ?? null,
          systemPrompt: def.systemPrompt,
          referenceFiles: def.referenceFiles || [],
          author: def.author || "system",
          tags: def.tags || [],
          builtIn: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      } catch {
        // Ignore invalid built-in definitions.
      }
    }
  }

  listSkills(filter?: { tags?: string[]; builtIn?: boolean }): SkillRecord[] {
    let items = Array.from(this.skills.values());
    if (filter?.builtIn !== undefined) {
      items = items.filter((item) => item.builtIn === filter.builtIn);
    }
    if (filter?.tags?.length) {
      items = items.filter((item) => filter.tags!.some((tag) => item.tags.includes(tag)));
    }
    return items.sort((left, right) => left.name.localeCompare(right.name));
  }

  getSkill(idOrName: string): SkillRecord | null {
    return this.skills.get(idOrName) || Array.from(this.skills.values()).find((item) => item.name === idOrName) || null;
  }

  async createSkill(input: Omit<SkillRecord, "id" | "builtIn" | "createdAt" | "updatedAt">): Promise<SkillRecord> {
    const id = `custom_${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const skill: SkillRecord = {
      ...input,
      id,
      builtIn: false,
      createdAt: now,
      updatedAt: now,
    };
    this.skills.set(id, skill);
    await this.persistCustomSkills();
    return skill;
  }

  async updateSkill(
    id: string,
    updates: Partial<Omit<SkillRecord, "id" | "builtIn" | "createdAt">>,
  ): Promise<SkillRecord | null> {
    const skill = this.skills.get(id);
    if (!skill || skill.builtIn) {
      return null;
    }
    const updated: SkillRecord = {
      ...skill,
      ...updates,
      id: skill.id,
      builtIn: false,
      createdAt: skill.createdAt,
      updatedAt: new Date().toISOString(),
    };
    this.skills.set(id, updated);
    await this.persistCustomSkills();
    return updated;
  }

  async deleteSkill(id: string): Promise<boolean> {
    const skill = this.skills.get(id);
    if (!skill || skill.builtIn) {
      return false;
    }
    this.skills.delete(id);
    await this.persistCustomSkills();
    return true;
  }

  async startInvocation(input: SkillInvocationInput): Promise<SkillInvocationRecord> {
    const skill = this.getSkill(input.skillId);
    if (!skill) {
      throw new Error(`Skill not found: ${input.skillId}`);
    }

    const record: SkillInvocationRecord = {
      id: `inv_${randomUUID().slice(0, 12)}`,
      skillId: skill.id,
      skillName: skill.name,
      runId: input.runId || "",
      projectId: input.projectId,
      ticketId: input.ticketId || null,
      args: input.args || null,
      status: "running",
      output: null,
      childRunId: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
    };

    this.invocations.set(record.id, record);
    await this.persistence?.saveInvocation(record);
    return record;
  }

  async completeInvocation(invocationId: string, output: string, childRunId?: string): Promise<SkillInvocationRecord | null> {
    const invocation = await this.getInvocation(invocationId);
    if (!invocation) {
      return null;
    }

    const updated: SkillInvocationRecord = {
      ...invocation,
      status: "completed",
      output,
      childRunId: childRunId || null,
      completedAt: new Date().toISOString(),
    };
    this.invocations.set(invocationId, updated);
    await this.persistence?.saveInvocation(updated);
    return updated;
  }

  async failInvocation(invocationId: string, error: string): Promise<SkillInvocationRecord | null> {
    const invocation = await this.getInvocation(invocationId);
    if (!invocation) {
      return null;
    }

    const updated: SkillInvocationRecord = {
      ...invocation,
      status: "failed",
      output: error,
      completedAt: new Date().toISOString(),
    };
    this.invocations.set(invocationId, updated);
    await this.persistence?.saveInvocation(updated);
    return updated;
  }

  async getInvocation(invocationId: string): Promise<SkillInvocationRecord | null> {
    const cached = this.invocations.get(invocationId);
    if (cached) {
      return cached;
    }
    const persisted = await this.persistence?.getInvocation(invocationId);
    if (persisted) {
      this.invocations.set(invocationId, persisted);
      return persisted;
    }
    return null;
  }

  async listInvocations(filter?: { runId?: string; limit?: number }): Promise<SkillInvocationRecord[]> {
    if (!this.persistence) {
      let items = Array.from(this.invocations.values());
      if (filter?.runId) {
        items = items.filter((item) => item.runId === filter.runId);
      }
      items.sort((left, right) => right.startedAt.localeCompare(left.startedAt));
      return filter?.limit ? items.slice(0, filter.limit) : items;
    }
    const items = await this.persistence.listInvocations(filter);
    for (const item of items) {
      this.invocations.set(item.id, item);
    }
    return items;
  }

  buildSkillPrompt(skill: SkillRecord, args?: string): string {
    let prompt = skill.systemPrompt;
    if (args) {
      prompt += `\n\n## User Arguments\n${args}`;
    }
    return prompt;
  }

  private async persistCustomSkills(): Promise<void> {
    if (!this.persistence) {
      return;
    }
    const customSkills = Array.from(this.skills.values()).filter((item) => !item.builtIn);
    await this.persistence.saveCustomSkills(customSkills);
  }
}
