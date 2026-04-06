import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { SkillSynthesizer } from "./skillSynthesizer";
import { LearningsService } from "./learningsService";
import type { SuggestedSkill } from "../../shared/contracts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "skill-synth-test-"));
}

function cleanUp(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Seed a pattern learning with high confidence and enough occurrences to
 * pass the MIN_CONFIDENCE (0.6) and MIN_OCCURRENCES (3) thresholds.
 */
function seedPattern(
  ls: LearningsService,
  projectId: string,
  summary: string,
  tools: string[],
  opts?: { confidence?: number; occurrences?: number },
) {
  const entry = ls.recordLearning({
    projectId,
    category: "pattern",
    summary,
    detail: `Detail for: ${summary}`,
    source: "auto_extraction",
    relatedTools: tools,
    confidence: opts?.confidence ?? 0.8,
  });
  // Bump occurrences to the desired count (recordLearning starts at 1)
  const targetOccurrences = opts?.occurrences ?? 4;
  for (let i = 1; i < targetOccurrences; i++) {
    ls.recordLearning({
      projectId,
      category: "pattern",
      summary,
      detail: `Detail for: ${summary}`,
      source: "auto_extraction",
      relatedTools: tools,
      confidence: opts?.confidence ?? 0.8,
    });
  }
  return entry;
}

function seedAntipattern(
  ls: LearningsService,
  projectId: string,
  summary: string,
  tools: string[],
) {
  return ls.recordLearning({
    projectId,
    category: "antipattern",
    summary,
    detail: `Warning: ${summary}`,
    source: "auto_extraction",
    relatedTools: tools,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SkillSynthesizer", () => {
  let tmpDir: string;
  let ls: LearningsService;
  let synth: SkillSynthesizer;
  const PROJECT = "proj-alpha";

  beforeEach(() => {
    tmpDir = makeTmpDir();
    ls = new LearningsService(tmpDir);
    synth = new SkillSynthesizer(ls, tmpDir);
  });

  afterEach(() => {
    cleanUp(tmpDir);
  });

  // ---- 1. No suggestions with fewer than 2 qualifying patterns ----

  it("returns empty when fewer than 2 qualifying patterns exist", () => {
    // Seed only one qualifying pattern
    seedPattern(ls, PROJECT, "lint typescript files correctly", ["eslint"]);

    const results = synth.synthesizeFromPatterns(PROJECT);
    expect(results).toEqual([]);
    expect(synth.listSuggestedSkills(PROJECT)).toHaveLength(0);
  });

  it("returns empty when patterns exist but lack confidence or occurrences", () => {
    // Two patterns but low confidence (below 0.6 threshold)
    seedPattern(ls, PROJECT, "use prettier for formatting", ["prettier"], {
      confidence: 0.3,
      occurrences: 5,
    });
    seedPattern(ls, PROJECT, "apply eslint auto-fix rules", ["eslint"], {
      confidence: 0.3,
      occurrences: 5,
    });

    const results = synth.synthesizeFromPatterns(PROJECT);
    expect(results).toEqual([]);
  });

  // ---- 2. Synthesizes skill when 2+ patterns share tools ----

  it("synthesizes a skill when two patterns share at least one tool", () => {
    seedPattern(ls, PROJECT, "run tests before committing changes", [
      "shell",
      "git",
    ]);
    seedPattern(ls, PROJECT, "validate lint passes before git push", [
      "shell",
      "eslint",
    ]);

    const results = synth.synthesizeFromPatterns(PROJECT);

    expect(results.length).toBeGreaterThanOrEqual(1);
    const skill = results[0];
    expect(skill.projectId).toBe(PROJECT);
    expect(skill.status).toBe("pending");
    expect(skill.tags).toContain("synthesized");
    expect(skill.tags).toContain("auto-generated");
    expect(skill.allowedTools.length).toBeGreaterThan(0);
    // Tool sets should be the union of the two patterns' tools
    expect(skill.allowedTools).toContain("shell");
  });

  // ---- 3. Skill has correct structure ----

  it("generates skills with all required fields", () => {
    seedPattern(ls, PROJECT, "apply database migrations safely", [
      "prisma",
      "shell",
    ]);
    seedPattern(ls, PROJECT, "seed database after migration runs", [
      "prisma",
      "file_write",
    ]);

    const results = synth.synthesizeFromPatterns(PROJECT);
    expect(results.length).toBeGreaterThanOrEqual(1);

    const skill = results[0];
    expect(skill.id).toMatch(/^suggested_/);
    expect(typeof skill.name).toBe("string");
    expect(skill.name.length).toBeGreaterThan(0);
    expect(skill.name.length).toBeLessThanOrEqual(40);
    expect(typeof skill.description).toBe("string");
    expect(skill.description.length).toBeLessThanOrEqual(300);
    expect(typeof skill.systemPrompt).toBe("string");
    expect(skill.systemPrompt.length).toBeLessThanOrEqual(2000);
    expect(Array.isArray(skill.allowedTools)).toBe(true);
    expect(Array.isArray(skill.tags)).toBe(true);
    expect(Array.isArray(skill.derivedFromLearnings)).toBe(true);
    expect(skill.derivedFromLearnings.length).toBeGreaterThanOrEqual(2);
    expect(typeof skill.confidence).toBe("number");
    expect(skill.confidence).toBeGreaterThanOrEqual(0);
    expect(skill.confidence).toBeLessThanOrEqual(1);
    expect(skill.createdAt).toBeTruthy();
  });

  // ---- 4. Approve flow ----

  it("approves a pending skill and persists the change", () => {
    seedPattern(ls, PROJECT, "format code with prettier on save", [
      "prettier",
      "file_write",
    ]);
    seedPattern(ls, PROJECT, "auto-fix eslint errors on file save", [
      "eslint",
      "file_write",
    ]);

    const [skill] = synth.synthesizeFromPatterns(PROJECT);
    expect(skill.status).toBe("pending");

    const approved = synth.approveSkill(skill.id);
    expect(approved).not.toBeNull();
    expect(approved!.status).toBe("approved");

    // Re-read from disk to verify persistence
    const fresh = new SkillSynthesizer(ls, tmpDir);
    const persisted = fresh.getSuggestedSkill(skill.id);
    expect(persisted).not.toBeNull();
    expect(persisted!.status).toBe("approved");
  });

  it("returns null when approving a non-existent or already approved skill", () => {
    expect(synth.approveSkill("nonexistent-id")).toBeNull();

    seedPattern(ls, PROJECT, "write integration tests first", [
      "vitest",
      "shell",
    ]);
    seedPattern(ls, PROJECT, "run test suite via shell command", [
      "vitest",
      "shell",
    ]);
    const [skill] = synth.synthesizeFromPatterns(PROJECT);
    synth.approveSkill(skill.id);

    // Approving again should return null (already approved)
    expect(synth.approveSkill(skill.id)).toBeNull();
  });

  // ---- 5. Dismiss flow ----

  it("dismisses a skill and persists the change", () => {
    seedPattern(ls, PROJECT, "compile typescript before deploy", [
      "tsc",
      "shell",
    ]);
    seedPattern(ls, PROJECT, "build project using shell commands", [
      "tsc",
      "build",
    ]);

    const [skill] = synth.synthesizeFromPatterns(PROJECT);
    const dismissed = synth.dismissSkill(skill.id);

    expect(dismissed).not.toBeNull();
    expect(dismissed!.status).toBe("dismissed");

    const fresh = new SkillSynthesizer(ls, tmpDir);
    expect(fresh.getSuggestedSkill(skill.id)!.status).toBe("dismissed");
  });

  // ---- 6. Duplicate detection ----

  it("does not re-suggest a skill with a very similar name and description", () => {
    seedPattern(ls, PROJECT, "run unit tests before push", [
      "vitest",
      "shell",
    ]);
    seedPattern(ls, PROJECT, "execute shell lint checks before push", [
      "vitest",
      "shell",
    ]);

    const first = synth.synthesizeFromPatterns(PROJECT);
    expect(first.length).toBeGreaterThanOrEqual(1);

    // Synthesize again with same patterns -- should detect duplicates
    const second = synth.synthesizeFromPatterns(PROJECT);
    expect(second).toHaveLength(0);

    // Total count on disk should remain the same
    expect(synth.listSuggestedSkills(PROJECT).length).toBe(first.length);
  });

  // ---- 7. MAX_SUGGESTED_SKILLS cap ----

  it("caps total suggested skills at 20", () => {
    // Seed many distinct tool groups to generate many skills
    for (let i = 0; i < 25; i++) {
      const toolA = `tool_a_${i}`;
      const toolB = `tool_b_${i}`;
      seedPattern(ls, PROJECT, `pattern alpha operation ${i} on group ${i}`, [
        toolA,
        toolB,
      ]);
      seedPattern(ls, PROJECT, `pattern beta operation ${i} on group ${i}`, [
        toolA,
        toolB,
      ]);
    }

    synth.synthesizeFromPatterns(PROJECT);
    const all = synth.listSuggestedSkills(PROJECT);
    expect(all.length).toBeLessThanOrEqual(20);
  });

  // ---- 8. getPendingCount ----

  it("only counts pending skills in getPendingCount", () => {
    seedPattern(ls, PROJECT, "deploy containers with docker compose", [
      "docker",
      "shell",
    ]);
    seedPattern(ls, PROJECT, "build docker images with shell scripts", [
      "docker",
      "build",
    ]);

    const results = synth.synthesizeFromPatterns(PROJECT);
    expect(results.length).toBeGreaterThanOrEqual(1);

    const initialPending = synth.getPendingCount(PROJECT);
    expect(initialPending).toBe(results.length);

    // Approve one
    synth.approveSkill(results[0].id);
    expect(synth.getPendingCount(PROJECT)).toBe(initialPending - 1);

    // If there are more, dismiss one
    if (results.length > 1) {
      synth.dismissSkill(results[1].id);
      expect(synth.getPendingCount(PROJECT)).toBe(initialPending - 2);
    }
  });

  // ---- 9. Antipatterns included as warnings ----

  it("includes relevant antipatterns as warnings in systemPrompt", () => {
    seedPattern(ls, PROJECT, "write files via file_write tool safely", [
      "file_write",
      "shell",
    ]);
    seedPattern(ls, PROJECT, "backup files using shell before overwrite", [
      "file_write",
      "backup",
    ]);
    seedAntipattern(
      ls,
      PROJECT,
      "never overwrite without backup",
      ["file_write"],
    );

    const results = synth.synthesizeFromPatterns(PROJECT);
    expect(results.length).toBeGreaterThanOrEqual(1);

    const skill = results[0];
    expect(skill.systemPrompt).toContain("Known pitfalls");
    expect(skill.systemPrompt).toContain("never overwrite without backup");
  });

  // ---- 10. Skills persist to JSON file on disk ----

  it("persists skills to .agentic-workforce/learnings/suggested-skills.json", () => {
    seedPattern(ls, PROJECT, "generate component boilerplate code", [
      "codegen",
      "file_write",
    ]);
    seedPattern(ls, PROJECT, "write files via codegen tool", [
      "codegen",
      "template",
    ]);

    synth.synthesizeFromPatterns(PROJECT);

    const filePath = path.join(
      tmpDir,
      ".agentic-workforce/learnings/suggested-skills.json",
    );
    expect(fs.existsSync(filePath)).toBe(true);

    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as SuggestedSkill[];
    expect(raw.length).toBeGreaterThanOrEqual(1);
    expect(raw[0].id).toMatch(/^suggested_/);
    expect(raw[0].status).toBe("pending");
  });

  // ---- 11. listSuggestedSkills filters by projectId ----

  it("filters skills by projectId when listing", () => {
    const PROJECT_B = "proj-beta";

    seedPattern(ls, PROJECT, "test alpha project patterns", [
      "vitest",
      "shell",
    ]);
    seedPattern(ls, PROJECT, "lint alpha project code via shell", [
      "vitest",
      "shell",
    ]);

    seedPattern(ls, PROJECT_B, "deploy beta project containers", [
      "docker",
      "k8s",
    ]);
    seedPattern(ls, PROJECT_B, "scale beta project pods in k8s", [
      "docker",
      "k8s",
    ]);

    synth.synthesizeFromPatterns(PROJECT);
    synth.synthesizeFromPatterns(PROJECT_B);

    const alphaSkills = synth.listSuggestedSkills(PROJECT);
    const betaSkills = synth.listSuggestedSkills(PROJECT_B);
    const allSkills = synth.listSuggestedSkills();

    expect(alphaSkills.every((s) => s.projectId === PROJECT)).toBe(true);
    expect(betaSkills.every((s) => s.projectId === PROJECT_B)).toBe(true);
    expect(allSkills.length).toBe(alphaSkills.length + betaSkills.length);
  });

  // ---- 12. Patterns without tool overlap stay separate ----

  it("does not group patterns that have no tool overlap", () => {
    // Two patterns with completely disjoint tools
    seedPattern(ls, PROJECT, "analyze coverage with istanbul tool", [
      "istanbul",
    ]);
    seedPattern(ls, PROJECT, "deploy to production cloud servers", [
      "terraform",
    ]);

    const results = synth.synthesizeFromPatterns(PROJECT);
    // No group should form because tools don't overlap, each group has < 2
    expect(results).toHaveLength(0);
  });
});
