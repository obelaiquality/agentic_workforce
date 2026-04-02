import { beforeEach, describe, expect, it } from "vitest";
import { SkillService, type SkillPersistence } from "./skillService";

function createMemoryPersistence(): SkillPersistence & {
  customSkills: any[];
  invocations: Map<string, any>;
} {
  return {
    customSkills: [],
    invocations: new Map(),
    async loadCustomSkills() {
      return this.customSkills;
    },
    async saveCustomSkills(skills) {
      this.customSkills = skills.map((item) => ({ ...item }));
    },
    async saveInvocation(invocation) {
      this.invocations.set(invocation.id, { ...invocation });
    },
    async getInvocation(invocationId) {
      return this.invocations.get(invocationId) ?? null;
    },
    async listInvocations(filter) {
      let items = Array.from(this.invocations.values());
      if (filter?.runId) {
        items = items.filter((item) => item.runId === filter.runId);
      }
      items.sort((left, right) => right.startedAt.localeCompare(left.startedAt));
      return filter?.limit ? items.slice(0, filter.limit) : items;
    },
  };
}

describe("SkillService", () => {
  let service: SkillService;

  beforeEach(() => {
    service = new SkillService();
  });

  it("loads built-in skills", () => {
    const skills = service.listSkills();
    expect(skills.map((skill) => skill.name)).toEqual(
      expect.arrayContaining(["commit", "verify", "simplify", "debug", "plan"]),
    );
  });

  it("retrieves skills by id or name", () => {
    expect(service.getSkill("commit")?.builtIn).toBe(true);
    expect(service.getSkill("builtin_commit")?.name).toBe("commit");
  });

  it("creates, updates, and deletes custom skills", async () => {
    const created = await service.createSkill({
      name: "test-skill",
      description: "A test skill",
      version: "1.0.0",
      contextMode: "inline",
      allowedTools: ["read_file"],
      maxIterations: 3,
      systemPrompt: "Do the work",
      referenceFiles: [],
      author: "test",
      tags: ["test"],
    });

    expect(created.id).toMatch(/^custom_/);
    expect(service.getSkill(created.id)?.name).toBe("test-skill");

    const updated = await service.updateSkill(created.id, {
      description: "Updated description",
      systemPrompt: "Updated prompt",
    });

    expect(updated?.description).toBe("Updated description");
    expect(updated?.systemPrompt).toBe("Updated prompt");
    expect(await service.deleteSkill(created.id)).toBe(true);
    expect(service.getSkill(created.id)).toBeNull();
  });

  it("does not mutate built-in skills", async () => {
    await expect(service.updateSkill("builtin_commit", { description: "nope" })).resolves.toBeNull();
    await expect(service.deleteSkill("builtin_commit")).resolves.toBe(false);
  });

  it("filters skills", async () => {
    await service.createSkill({
      name: "git-helper",
      description: "Git helper",
      version: "1.0.0",
      contextMode: "inline",
      allowedTools: [],
      maxIterations: null,
      systemPrompt: "git",
      referenceFiles: [],
      author: "test",
      tags: ["git", "ops"],
    });

    expect(service.listSkills({ builtIn: false })).toHaveLength(1);
    expect(service.listSkills({ tags: ["git"] }).every((skill) => skill.tags.includes("git"))).toBe(true);
  });

  it("tracks invocation lifecycle", async () => {
    const invocation = await service.startInvocation({
      skillId: "commit",
      projectId: "project-1",
      runId: "run-1",
      ticketId: "ticket-1",
      args: "commit staged changes",
    });

    expect(invocation.id).toMatch(/^inv_/);
    expect(invocation.status).toBe("running");

    const completed = await service.completeInvocation(invocation.id, "done");
    expect(completed?.status).toBe("completed");
    expect(completed?.output).toBe("done");

    const listed = await service.listInvocations({ runId: "run-1" });
    expect(listed[0]?.id).toBe(invocation.id);
  });

  it("marks invocation failure", async () => {
    const invocation = await service.startInvocation({
      skillId: "debug",
      projectId: "project-1",
      runId: "run-1",
    });

    const failed = await service.failInvocation(invocation.id, "boom");
    expect(failed?.status).toBe("failed");
    expect(failed?.output).toBe("boom");
  });

  it("builds prompts with optional arguments", () => {
    const skill = service.getSkill("verify");
    expect(skill).toBeTruthy();
    expect(service.buildSkillPrompt(skill!, "run targeted tests")).toContain("run targeted tests");
  });

  it("throws when starting an invocation for an unknown skill", async () => {
    await expect(
      service.startInvocation({
        skillId: "missing-skill",
        projectId: "project-1",
      }),
    ).rejects.toThrow("Skill not found: missing-skill");
  });

  it("persists custom skills and invocations across service instances", async () => {
    const persistence = createMemoryPersistence();
    const persisted = new SkillService(persistence);
    await persisted.initialize();

    const created = await persisted.createSkill({
      name: "release-check",
      description: "Verify a release candidate",
      version: "1.0.0",
      contextMode: "fork",
      allowedTools: ["bash"],
      maxIterations: 2,
      systemPrompt: "Check the release candidate thoroughly.",
      referenceFiles: [],
      author: "test",
      tags: ["release"],
    });
    const invocation = await persisted.startInvocation({
      skillId: created.id,
      projectId: "project-1",
      runId: "run-9",
    });
    await persisted.completeInvocation(invocation.id, "verified", "child-run-1");

    const reloaded = new SkillService(persistence);
    await reloaded.initialize();

    expect(reloaded.getSkill(created.id)?.name).toBe("release-check");
    const restoredInvocation = await reloaded.getInvocation(invocation.id);
    expect(restoredInvocation).toMatchObject({
      status: "completed",
      output: "verified",
      childRunId: "child-run-1",
    });
  });
});
