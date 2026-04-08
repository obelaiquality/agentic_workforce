import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  DESLOP_PATTERNS,
  determineVerificationTier,
  scanForDeslopIssues,
  RalphModeOrchestrator,
  MAX_DESLOP_RETRIES,
} from "./ralphMode";
import type { AgenticEvent, RalphModeInput } from "../../shared/contracts";
import { prisma } from "../db";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../db", () => ({
  prisma: {
    ralphSession: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation((args: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: "session-1",
          ...args.data,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ),
      update: vi.fn().mockResolvedValue({}),
    },
    ralphPhaseExecution: {
      create: vi.fn().mockResolvedValue({}),
    },
    ralphVerification: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock("../logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

function createMockProviderOrchestrator() {
  return {
    streamChatWithRetry: vi.fn().mockResolvedValue({
      text: '["src/foo.ts", "src/bar.ts"]',
      accountId: "test",
      providerId: "onprem-qwen",
    }),
  };
}

function createMockExecutionService() {
  return {};
}

function createInput(overrides?: Partial<RalphModeInput>): RalphModeInput {
  return {
    runId: "run-test-1",
    repoId: "repo-1",
    specContent: "Build a widget that does X",
    actor: "test-user",
    worktreePath: "/tmp/test-worktree",
    maxIterations: 1,
    ...overrides,
  };
}

async function collectEvents(
  gen: AsyncGenerator<AgenticEvent>,
): Promise<AgenticEvent[]> {
  const events: AgenticEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

// ---------------------------------------------------------------------------
// determineVerificationTier
// ---------------------------------------------------------------------------

describe("determineVerificationTier", () => {
  it("returns STANDARD for small changes", () => {
    expect(determineVerificationTier(3, 50)).toBe("STANDARD");
  });

  it("returns STANDARD when both below thresholds", () => {
    expect(determineVerificationTier(4, 99)).toBe("STANDARD");
  });

  it("returns THOROUGH when files >= 5", () => {
    expect(determineVerificationTier(5, 50)).toBe("THOROUGH");
  });

  it("returns THOROUGH when lines >= 100", () => {
    expect(determineVerificationTier(2, 100)).toBe("THOROUGH");
  });

  it("returns THOROUGH when both above thresholds", () => {
    expect(determineVerificationTier(10, 500)).toBe("THOROUGH");
  });
});

// ---------------------------------------------------------------------------
// DESLOP_PATTERNS
// ---------------------------------------------------------------------------

describe("DESLOP_PATTERNS", () => {
  it("detects empty TODO comments", () => {
    const pattern = DESLOP_PATTERNS.find((p) => p.name === "empty-todo")!;
    expect(pattern.pattern.test("// TODO")).toBe(true);
    expect(pattern.pattern.test("// TODO: implement this")).toBe(false);
  });

  it("detects empty catch blocks", () => {
    const pattern = DESLOP_PATTERNS.find((p) => p.name === "empty-catch")!;
    expect(pattern.pattern.test("catch (e) {}")).toBe(true);
    expect(pattern.pattern.test("catch (e) { log(e); }")).toBe(false);
  });

  it("detects consecutive block comments", () => {
    const pattern = DESLOP_PATTERNS.find(
      (p) => p.name === "consecutive-block-comments",
    )!;
    expect(pattern.pattern.test("/* comment 1 */\n/* comment 2 */")).toBe(true);
    expect(pattern.pattern.test("/* single comment */")).toBe(false);
  });

  it("detects debug logging", () => {
    const pattern = DESLOP_PATTERNS.find((p) => p.name === "debug-logging")!;
    expect(pattern.pattern.test("console.log('test')")).toBe(true);
    expect(pattern.pattern.test("console.debug('x')")).toBe(true);
    expect(pattern.pattern.test("console.info('x')")).toBe(true);
    expect(pattern.pattern.test("console.error('x')")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// scanForDeslopIssues
// ---------------------------------------------------------------------------

describe("scanForDeslopIssues", () => {
  it("finds issues in sample code", () => {
    const files = [
      {
        path: "src/bad.ts",
        content: [
          "const x = 1;",
          "// TODO",
          "try { doStuff(); } catch (e) {}",
          'console.log("debug");',
        ].join("\n"),
      },
    ];

    const issues = scanForDeslopIssues(files);
    expect(issues.length).toBeGreaterThanOrEqual(3);

    const patternNames = issues.map((i) => i.pattern);
    expect(patternNames).toContain("empty-todo");
    expect(patternNames).toContain("empty-catch");
    expect(patternNames).toContain("debug-logging");
  });

  it("returns empty array for clean code", () => {
    const files = [
      {
        path: "src/clean.ts",
        content: [
          "const x = 1;",
          "// TODO: implement validation logic",
          "try { doStuff(); } catch (e) { logger.error(e); }",
        ].join("\n"),
      },
    ];

    const issues = scanForDeslopIssues(files);
    expect(issues).toEqual([]);
  });

  it("reports the correct file path", () => {
    const files = [
      { path: "src/a.ts", content: "// TODO" },
      { path: "src/b.ts", content: "const clean = true;" },
    ];
    const issues = scanForDeslopIssues(files);
    expect(issues.every((i) => i.file === "src/a.ts")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// RalphModeOrchestrator — phase progression
// ---------------------------------------------------------------------------

describe("RalphModeOrchestrator", () => {
  let providerOrchestrator: ReturnType<typeof createMockProviderOrchestrator>;
  let executionService: ReturnType<typeof createMockExecutionService>;

  beforeEach(() => {
    vi.clearAllMocks();
    providerOrchestrator = createMockProviderOrchestrator();
    executionService = createMockExecutionService();
  });

  it("progresses through all phases: intake -> execute -> verify -> architect_review -> deslop -> regression -> complete", async () => {
    // LLM returns positive verification results
    providerOrchestrator.streamChatWithRetry
      .mockResolvedValueOnce({ text: "1. Build widget\n2. Add tests", accountId: "t", providerId: "onprem-qwen" }) // intake
      .mockResolvedValueOnce({ text: '["src/widget.ts"]', accountId: "t", providerId: "onprem-qwen" }) // execute
      .mockResolvedValueOnce({ text: '{ "testsPassed": true, "lintsPassed": true }', accountId: "t", providerId: "onprem-qwen" }) // verify
      .mockResolvedValueOnce({ text: '{ "structurallySound": true, "followsPatterns": true, "summary": "Looks good" }', accountId: "t", providerId: "onprem-qwen" }); // architect_review

    const orchestrator = new RalphModeOrchestrator({
      providerOrchestrator: providerOrchestrator as never,
      executionService: executionService as never,
    });

    const events = await collectEvents(orchestrator.execute(createInput()));
    const phases = events
      .filter((e) => e.type === "ralph_phase_entered")
      .map((e) => (e as { phase: string }).phase);

    expect(phases).toEqual([
      "intake",
      "execute",
      "verify",
      "architect_review",
      "deslop",
      "regression",
      "complete",
    ]);
  });

  it("emits ralph_started as first meaningful event", async () => {
    const orchestrator = new RalphModeOrchestrator({
      providerOrchestrator: providerOrchestrator as never,
      executionService: executionService as never,
    });

    const events = await collectEvents(orchestrator.execute(createInput()));
    expect(events[0].type).toBe("ralph_started");
  });

  it("emits ralph_checkpoint after regression passes", async () => {
    const orchestrator = new RalphModeOrchestrator({
      providerOrchestrator: providerOrchestrator as never,
      executionService: executionService as never,
    });

    const events = await collectEvents(orchestrator.execute(createInput()));
    const checkpoints = events.filter((e) => e.type === "ralph_checkpoint");
    expect(checkpoints.length).toBe(1);
  });

  it("caps iterations at maxIterations", async () => {
    // Make verify always fail so it keeps looping
    providerOrchestrator.streamChatWithRetry.mockResolvedValue({
      text: '{ "testsPassed": false, "lintsPassed": false }',
      accountId: "t",
      providerId: "onprem-qwen",
    });

    const orchestrator = new RalphModeOrchestrator({
      providerOrchestrator: providerOrchestrator as never,
      executionService: executionService as never,
    });

    const events = await collectEvents(
      orchestrator.execute(createInput({ maxIterations: 3 })),
    );

    const intakeEntries = events.filter(
      (e) => e.type === "ralph_phase_entered" && (e as { phase: string }).phase === "intake",
    );
    // Should not exceed maxIterations
    expect(intakeEntries.length).toBeLessThanOrEqual(3);
  });

  it("emits ralph_verification events during verify phase", async () => {
    const orchestrator = new RalphModeOrchestrator({
      providerOrchestrator: providerOrchestrator as never,
      executionService: executionService as never,
    });

    const events = await collectEvents(orchestrator.execute(createInput()));
    const verifications = events.filter((e) => e.type === "ralph_verification");
    expect(verifications.length).toBeGreaterThanOrEqual(1);
  });

  it("tracks filesModified in the ledger across phases", async () => {
    providerOrchestrator.streamChatWithRetry
      .mockResolvedValueOnce({ text: "1. Implement feature", accountId: "t", providerId: "onprem-qwen" })
      .mockResolvedValueOnce({ text: '["src/a.ts", "src/b.ts"]', accountId: "t", providerId: "onprem-qwen" })
      .mockResolvedValueOnce({ text: '{ "testsPassed": true, "lintsPassed": true }', accountId: "t", providerId: "onprem-qwen" })
      .mockResolvedValueOnce({ text: '{ "structurallySound": true, "followsPatterns": true, "summary": "ok" }', accountId: "t", providerId: "onprem-qwen" });

    const orchestrator = new RalphModeOrchestrator({
      providerOrchestrator: providerOrchestrator as never,
      executionService: executionService as never,
    });

    const events = await collectEvents(orchestrator.execute(createInput()));
    const execExited = events.find(
      (e) => e.type === "ralph_phase_exited" && (e as { phase: string }).phase === "execute",
    );
    expect(execExited).toBeDefined();
    expect((execExited as { result: string }).result).toContain("2 files changed");
  });

  it("pause() stops execution after current phase", async () => {
    const orchestrator = new RalphModeOrchestrator({
      providerOrchestrator: providerOrchestrator as never,
      executionService: executionService as never,
    });

    // Pause immediately
    orchestrator.pause();

    const events = await collectEvents(
      orchestrator.execute(createInput({ maxIterations: 5 })),
    );

    // Should have ralph_started but stop before entering phases
    expect(events[0].type).toBe("ralph_started");
    const phaseEntries = events.filter((e) => e.type === "ralph_phase_entered");
    // Either 0 phases or stops early
    expect(phaseEntries.length).toBeLessThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // currentIteration field used in DB calls
  // -------------------------------------------------------------------------

  it("creates session with currentIteration: 0 (not iteration)", async () => {
    const orchestrator = new RalphModeOrchestrator({
      providerOrchestrator: providerOrchestrator as never,
      executionService: executionService as never,
    });

    await collectEvents(orchestrator.execute(createInput()));

    expect(prisma.ralphSession.create).toHaveBeenCalled();
    const createCall = vi.mocked(prisma.ralphSession.create).mock.calls[0][0];
    expect(createCall.data).toHaveProperty("currentIteration", 0);
    expect(createCall.data).not.toHaveProperty("iteration");
  });

  // -------------------------------------------------------------------------
  // Failed verify does NOT add to completedPhases
  // -------------------------------------------------------------------------

  it("does not add verify to completedPhases when verification fails", async () => {
    // intake succeeds, execute succeeds, verify always fails
    providerOrchestrator.streamChatWithRetry
      .mockResolvedValueOnce({ text: "1. Do stuff", accountId: "t", providerId: "onprem-qwen" }) // intake iter 1
      .mockResolvedValueOnce({ text: '["src/x.ts"]', accountId: "t", providerId: "onprem-qwen" }) // execute iter 1
      .mockResolvedValueOnce({ text: '{ "testsPassed": false, "lintsPassed": false }', accountId: "t", providerId: "onprem-qwen" }) // verify iter 1 — fails
      .mockResolvedValue({ text: '{ "testsPassed": false, "lintsPassed": false }', accountId: "t", providerId: "onprem-qwen" }); // any subsequent

    const orchestrator = new RalphModeOrchestrator({
      providerOrchestrator: providerOrchestrator as never,
      executionService: executionService as never,
    });

    await collectEvents(orchestrator.execute(createInput({ maxIterations: 1 })));

    // saveCheckpoint is called via prisma.ralphSession.update — inspect the
    // ledger passed to it. If no checkpoint was saved (verify failed before
    // reaching checkpoint), inspect updateSessionStatus instead.
    const updateCalls = vi.mocked(prisma.ralphSession.update).mock.calls;
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);

    // The last update call contains the final ledger
    const lastUpdate = updateCalls[updateCalls.length - 1][0];
    const ledger = lastUpdate.data.progressLedger as { completedPhases: string[] };
    expect(ledger.completedPhases).not.toContain("verify");
  });

  // -------------------------------------------------------------------------
  // Deslop → regression retry limit
  // -------------------------------------------------------------------------

  it("caps deslop→regression retries at MAX_DESLOP_RETRIES then moves on", async () => {
    // All phases pass except regression always fails
    providerOrchestrator.streamChatWithRetry
      .mockImplementation((_id: string, messages: Array<{ role: string; content: string }>) => {
        const content = messages[0]?.content ?? "";
        if (content.includes("Parse the following spec")) {
          return Promise.resolve({ text: "1. Implement feature", accountId: "t", providerId: "onprem-qwen" });
        }
        if (content.includes("Determine what files")) {
          return Promise.resolve({ text: '["src/a.ts"]', accountId: "t", providerId: "onprem-qwen" });
        }
        if (content.includes("Review these changed files")) {
          return Promise.resolve({ text: '{ "testsPassed": true, "lintsPassed": true }', accountId: "t", providerId: "onprem-qwen" });
        }
        if (content.includes("structural quality review")) {
          return Promise.resolve({ text: '{ "structurallySound": true, "followsPatterns": true, "summary": "ok" }', accountId: "t", providerId: "onprem-qwen" });
        }
        return Promise.resolve({ text: "{}", accountId: "t", providerId: "onprem-qwen" });
      });

    // Make regression always fail by mocking ralphVerification.create to still
    // work but we need to override runRegression. Since it reads from LLM
    // defaults (regressionsPassed: true), we override the verification create
    // to set regressionsPassed to false. Actually, runRegression hard-codes
    // regressionsPassed: true in the details. We need to spy on the private
    // method. Instead, let's override via prototype.
    const originalRunRegression = (RalphModeOrchestrator.prototype as never)["runRegression"];
    const regressionSpy = vi.fn().mockResolvedValue({
      passed: false,
      details: { regressionsPassed: false },
    });
    (RalphModeOrchestrator.prototype as never)["runRegression"] = regressionSpy;

    try {
      const orchestrator = new RalphModeOrchestrator({
        providerOrchestrator: providerOrchestrator as never,
        executionService: executionService as never,
      });

      // Allow enough iterations: 1 initial + deslop retries that loop back, then fallback to intake
      const events = await collectEvents(
        orchestrator.execute(createInput({ maxIterations: MAX_DESLOP_RETRIES + 3 })),
      );

      // Regression should have been called at least MAX_DESLOP_RETRIES + 1 times
      // (initial + retries) before giving up and falling back to intake
      expect(regressionSpy.mock.calls.length).toBeGreaterThanOrEqual(MAX_DESLOP_RETRIES + 1);

      // After exceeding MAX_DESLOP_RETRIES, execution should fall back to intake
      // on the next iteration. Find the phase entries to verify.
      const phaseEntries = events
        .filter((e) => e.type === "ralph_phase_entered")
        .map((e) => (e as { phase: string; iteration: number }).phase);

      // After the deslop→regression retry loop exhausts, intake should appear again
      // Find the index of the last regression entry, and check that intake follows
      const lastRegressionIdx = phaseEntries.lastIndexOf("regression");
      const subsequentPhases = phaseEntries.slice(lastRegressionIdx + 1);
      // If there are more iterations, intake should be among them
      if (subsequentPhases.length > 0) {
        expect(subsequentPhases).toContain("intake");
      }
    } finally {
      (RalphModeOrchestrator.prototype as never)["runRegression"] = originalRunRegression;
    }
  });

  // -------------------------------------------------------------------------
  // Resume from checkpoint
  // -------------------------------------------------------------------------

  it("resume() returns correct input for resuming from a checkpoint", async () => {
    vi.mocked(prisma.ralphSession.findUnique).mockResolvedValueOnce({
      id: "session-resume",
      runId: "run-resume-1",
      repoId: "repo-42",
      ticketId: null,
      specContent: "Build feature Y",
      currentPhase: "verify",
      currentIteration: 3,
      maxIterations: 10,
      verificationTier: "THOROUGH",
      status: "paused",
      progressLedger: { completedPhases: ["intake", "execute"], filesModified: ["src/y.ts"] },
      sessionOwner: "alice",
      actor: "alice",
      worktreePath: "/tmp/resume-worktree",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    const orchestrator = new RalphModeOrchestrator({
      providerOrchestrator: providerOrchestrator as never,
      executionService: executionService as never,
    });

    const result = await orchestrator.resume("session-resume");

    expect(result).not.toBeNull();
    expect(result!.runId).toBe("run-resume-1");
    expect(result!.repoId).toBe("repo-42");
    expect(result!.specContent).toBe("Build feature Y");
    expect(result!.actor).toBe("alice");
    expect(result!.worktreePath).toBe("/tmp/resume-worktree");
    expect(result!.maxIterations).toBe(10);
    expect(result!.verificationTier).toBe("THOROUGH");
    expect(result!.resumeFromCheckpoint).toBe(true);

    expect(prisma.ralphSession.findUnique).toHaveBeenCalledWith({
      where: { id: "session-resume" },
    });
  });
});
