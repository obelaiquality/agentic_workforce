import { describe, expect, it } from "vitest";
import { buildVerificationPlan } from "./verificationPolicy";
import type { ProjectBlueprint, RepoGuidelineProfile } from "../../shared/contracts";

function makeBlueprint(overrides?: Partial<ProjectBlueprint>): ProjectBlueprint {
  return {
    id: "bp-1",
    projectId: "proj-1",
    version: 1,
    sourceMode: "repo_extracted",
    confidence: "high",
    charter: {
      productIntent: "Test app",
      successCriteria: ["tests pass"],
      constraints: [],
      riskPosture: "medium",
    },
    codingStandards: {
      principles: [],
      filePlacementRules: [],
      architectureRules: [],
      dependencyRules: [],
      reviewStyle: "summary_first",
    },
    testingPolicy: {
      requiredForBehaviorChange: true,
      defaultCommands: ["npm test"],
      impactedTestStrategy: "required",
      fullSuitePolicy: "on_major_change",
    },
    documentationPolicy: {
      updateUserFacingDocs: true,
      updateRunbooksWhenOpsChange: true,
      requiredDocPaths: ["README.md"],
      changelogPolicy: "recommended",
    },
    executionPolicy: {
      approvalRequiredFor: ["file_apply"],
      protectedPaths: [".git"],
      maxChangedFilesBeforeReview: 8,
      allowParallelExecution: false,
    },
    providerPolicy: {
      preferredCoderRole: "coder_default",
      reviewRole: "review_deep",
      escalationPolicy: "high_risk_only",
    },
    extractedFrom: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeGuidelines(overrides?: Partial<RepoGuidelineProfile>): RepoGuidelineProfile {
  return {
    id: "gl-1",
    repoId: "repo-1",
    languages: ["typescript"],
    testCommands: ["npm test"],
    buildCommands: ["npm run build"],
    lintCommands: ["npm run lint"],
    docRules: [],
    patchRules: [],
    filePlacementRules: [],
    reviewStyle: "summary_first",
    requiredArtifacts: [],
    sourceRefs: [],
    confidence: 0.8,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function displayCommands(plan: ReturnType<typeof buildVerificationPlan>) {
  return plan.commands.map((command) => command.displayCommand);
}

describe("buildVerificationPlan", () => {
  it("includes lint, test, and build commands from guidelines", () => {
    const plan = buildVerificationPlan({
      blueprint: makeBlueprint(),
      guidelines: makeGuidelines(),
    });

    const commands = displayCommands(plan);
    expect(commands).toContain("npm run lint");
    expect(commands).toContain("npm test");
    expect(commands).toContain("npm run build");
  });

  it("includes npm install when includeInstall is true", () => {
    const plan = buildVerificationPlan({
      blueprint: makeBlueprint(),
      guidelines: makeGuidelines(),
      includeInstall: true,
    });

    expect(plan.commands[0]?.displayCommand).toBe("npm install");
  });

  it("does not include npm install by default", () => {
    const plan = buildVerificationPlan({
      blueprint: makeBlueprint(),
      guidelines: makeGuidelines(),
    });

    expect(displayCommands(plan)).not.toContain("npm install");
  });

  it("returns docs from blueprint documentation policy", () => {
    const plan = buildVerificationPlan({
      blueprint: makeBlueprint({
        documentationPolicy: {
          updateUserFacingDocs: true,
          updateRunbooksWhenOpsChange: false,
          requiredDocPaths: ["README.md", "docs/api.md"],
          changelogPolicy: "none",
        },
      }),
      guidelines: null,
    });

    expect(plan.docsRequired).toContain("README.md");
    expect(plan.docsRequired).toContain("docs/api.md");
  });

  it("sets fullSuiteRun when blueprint requires always", () => {
    const plan = buildVerificationPlan({
      blueprint: makeBlueprint({
        testingPolicy: {
          requiredForBehaviorChange: true,
          defaultCommands: ["npm test"],
          impactedTestStrategy: "required",
          fullSuitePolicy: "always",
        },
      }),
      guidelines: null,
    });

    expect(plan.fullSuiteRun).toBe(true);
  });

  it("does not set fullSuiteRun for on_major_change", () => {
    const plan = buildVerificationPlan({
      blueprint: makeBlueprint(),
      guidelines: null,
    });

    expect(plan.fullSuiteRun).toBe(false);
  });

  it("works with no blueprint and no guidelines", () => {
    const plan = buildVerificationPlan({
      blueprint: null,
      guidelines: null,
    });

    expect(displayCommands(plan)).toEqual([]);
    expect(plan.docsRequired).toEqual([]);
    expect(plan.fullSuiteRun).toBe(false);
  });

  it("includes enforced rules reflecting blueprint policies", () => {
    const plan = buildVerificationPlan({
      blueprint: makeBlueprint(),
      guidelines: makeGuidelines(),
    });

    expect(plan.enforcedRules).toContain("Tests required for behavior changes");
    expect(plan.enforcedRules).toContain("User-facing docs updates expected");
    expect(plan.enforcedRules).toContain("Single-agent execution preferred");
  });

  it("deduplicates commands", () => {
    const plan = buildVerificationPlan({
      blueprint: makeBlueprint({
        testingPolicy: {
          requiredForBehaviorChange: true,
          defaultCommands: ["npm test", "npm run lint"],
          impactedTestStrategy: "required",
          fullSuitePolicy: "on_major_change",
        },
      }),
      guidelines: makeGuidelines({
        testCommands: ["npm test"],
        lintCommands: ["npm run lint"],
      }),
    });

    const testCount = displayCommands(plan).filter((cmd) => cmd === "npm test").length;
    expect(testCount).toBe(1);
  });

  it("includes reasons explaining verification choices", () => {
    const plan = buildVerificationPlan({
      blueprint: makeBlueprint(),
      guidelines: makeGuidelines(),
    });

    expect(plan.reasons.length).toBeGreaterThan(0);
    expect(plan.reasons.some((r) => r.includes("blueprint"))).toBe(true);
  });

  it("blueprint update changes verification expectations", () => {
    const guidelines = makeGuidelines();

    const planBefore = buildVerificationPlan({
      blueprint: makeBlueprint({
        testingPolicy: {
          requiredForBehaviorChange: false,
          defaultCommands: [],
          impactedTestStrategy: "preferred",
          fullSuitePolicy: "manual",
        },
        documentationPolicy: {
          updateUserFacingDocs: false,
          updateRunbooksWhenOpsChange: false,
          requiredDocPaths: [],
          changelogPolicy: "none",
        },
      }),
      guidelines,
    });

    const planAfter = buildVerificationPlan({
      blueprint: makeBlueprint({
        testingPolicy: {
          requiredForBehaviorChange: true,
          defaultCommands: ["npm test"],
          impactedTestStrategy: "required",
          fullSuitePolicy: "always",
        },
        documentationPolicy: {
          updateUserFacingDocs: true,
          updateRunbooksWhenOpsChange: true,
          requiredDocPaths: ["README.md", "CHANGELOG.md"],
          changelogPolicy: "required",
        },
      }),
      guidelines,
    });

    expect(displayCommands(planAfter)).toContain("npm test");
    expect(planAfter.fullSuiteRun).toBe(true);
    expect(planBefore.fullSuiteRun).toBe(false);
    expect(planAfter.docsRequired).toContain("README.md");
    expect(planAfter.docsRequired).toContain("CHANGELOG.md");
    expect(planBefore.docsRequired).toEqual([]);
    expect(planAfter.enforcedRules).toContain("Tests required for behavior changes");
    expect(planAfter.enforcedRules).toContain("User-facing docs updates expected");
    expect(planBefore.enforcedRules).not.toContain("Tests required for behavior changes");
    expect(planBefore.enforcedRules).not.toContain("User-facing docs updates expected");
  });
});
