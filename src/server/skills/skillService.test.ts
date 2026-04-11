import { beforeEach, describe, expect, it, vi } from "vitest";
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

  it("initialize is a no-op when already initialized", async () => {
    const persistence = createMemoryPersistence();
    const svc = new SkillService(persistence);
    await svc.initialize();
    // calling initialize again should be idempotent and not reload
    const loadSpy = vi.spyOn(persistence, "loadCustomSkills");
    await svc.initialize();
    expect(loadSpy).not.toHaveBeenCalled();
  });

  it("initialize without persistence just marks initialized", async () => {
    const svc = new SkillService();
    await svc.initialize();
    // calling again should be no-op, no throw
    await svc.initialize();
    expect(svc.listSkills().length).toBeGreaterThan(0);
  });

  it("returns null when updating a non-existent skill", async () => {
    expect(await service.updateSkill("nonexistent", { description: "nope" })).toBeNull();
  });

  it("returns false when deleting a non-existent skill", async () => {
    expect(await service.deleteSkill("nonexistent")).toBe(false);
  });

  it("getSkill returns null for unknown id/name", () => {
    expect(service.getSkill("nonexistent_skill")).toBeNull();
  });

  it("completeInvocation returns null for unknown invocation id", async () => {
    const result = await service.completeInvocation("inv_nonexistent", "output");
    expect(result).toBeNull();
  });

  it("failInvocation returns null for unknown invocation id", async () => {
    const result = await service.failInvocation("inv_nonexistent", "error");
    expect(result).toBeNull();
  });

  it("getInvocation returns null when not in cache or persistence", async () => {
    const result = await service.getInvocation("inv_nonexistent");
    expect(result).toBeNull();
  });

  it("getInvocation falls back to persistence when not in cache", async () => {
    const persistence = createMemoryPersistence();
    const svc = new SkillService(persistence);
    await svc.initialize();

    // Manually store an invocation in persistence (simulating a previous session)
    const storedInvocation = {
      id: "inv_from_persistence",
      skillId: "builtin_commit",
      skillName: "commit",
      runId: "run-old",
      projectId: "proj-1",
      ticketId: null,
      args: null,
      status: "completed" as const,
      output: "done",
      childRunId: null,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
    persistence.invocations.set("inv_from_persistence", storedInvocation);

    const result = await svc.getInvocation("inv_from_persistence");
    expect(result).toMatchObject({ id: "inv_from_persistence", status: "completed" });
  });

  it("listInvocations without persistence filters by runId and respects limit", async () => {
    // No persistence service, uses in-memory invocations map
    const svc = new SkillService();

    const inv1 = await svc.startInvocation({ skillId: "commit", projectId: "p1", runId: "run-a" });
    const inv2 = await svc.startInvocation({ skillId: "verify", projectId: "p1", runId: "run-a" });
    const inv3 = await svc.startInvocation({ skillId: "debug", projectId: "p1", runId: "run-b" });

    // Filter by runId
    const runAInvocations = await svc.listInvocations({ runId: "run-a" });
    expect(runAInvocations).toHaveLength(2);
    expect(runAInvocations.every((i) => i.runId === "run-a")).toBe(true);

    // Limit
    const limited = await svc.listInvocations({ limit: 1 });
    expect(limited).toHaveLength(1);

    // All invocations (no filter)
    const all = await svc.listInvocations();
    expect(all).toHaveLength(3);
  });

  it("listInvocations with persistence delegates and caches results", async () => {
    const persistence = createMemoryPersistence();
    const svc = new SkillService(persistence);
    await svc.initialize();

    const inv = await svc.startInvocation({ skillId: "commit", projectId: "p1", runId: "run-x" });
    const listed = await svc.listInvocations({ runId: "run-x" });
    expect(listed.length).toBeGreaterThanOrEqual(1);
    expect(listed[0].runId).toBe("run-x");
  });

  it("buildSkillPrompt without args returns system prompt only", () => {
    const skill = service.getSkill("commit")!;
    const prompt = service.buildSkillPrompt(skill);
    expect(prompt).toBe(skill.systemPrompt);
    expect(prompt).not.toContain("User Arguments");
  });

  it("startInvocation with no optional fields uses defaults", async () => {
    const inv = await service.startInvocation({
      skillId: "commit",
      projectId: "p1",
    });
    expect(inv.runId).toBe("");
    expect(inv.ticketId).toBeNull();
    expect(inv.args).toBeNull();
    expect(inv.childRunId).toBeNull();
    expect(inv.output).toBeNull();
    expect(inv.completedAt).toBeNull();
  });

  it("completeInvocation sets childRunId when provided", async () => {
    const inv = await service.startInvocation({
      skillId: "commit",
      projectId: "p1",
      runId: "run-1",
    });
    const completed = await service.completeInvocation(inv.id, "output", "child-run-42");
    expect(completed?.childRunId).toBe("child-run-42");
  });

  it("completeInvocation sets childRunId to null when not provided", async () => {
    const inv = await service.startInvocation({
      skillId: "commit",
      projectId: "p1",
      runId: "run-1",
    });
    const completed = await service.completeInvocation(inv.id, "output");
    expect(completed?.childRunId).toBeNull();
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
