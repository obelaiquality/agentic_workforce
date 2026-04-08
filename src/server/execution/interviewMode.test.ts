import { describe, it, expect, vi } from "vitest";
import {
  calculateAmbiguity,
  pickWeakestDimension,
  selectChallengeMode,
  shouldPressurePass,
  InterviewModeOrchestrator,
} from "./interviewMode";
import type { InterviewDimensions, AgenticEvent } from "../../shared/contracts";

// ---------------------------------------------------------------------------
// calculateAmbiguity
// ---------------------------------------------------------------------------

describe("calculateAmbiguity", () => {
  it("greenfield — all perfect scores yields 0 ambiguity", () => {
    const dims: InterviewDimensions = {
      intent: 1.0,
      outcome: 1.0,
      scope: 1.0,
      constraints: 1.0,
      success: 1.0,
    };
    const result = calculateAmbiguity(dims, true);
    expect(result).toBeCloseTo(0.0, 5);
  });

  it("greenfield — all zero scores yields 1.0 ambiguity", () => {
    const dims: InterviewDimensions = {
      intent: 0,
      outcome: 0,
      scope: 0,
      constraints: 0,
      success: 0,
    };
    const result = calculateAmbiguity(dims, true);
    expect(result).toBeCloseTo(1.0, 5);
  });

  it("greenfield — applies correct weights", () => {
    // intent*0.30 + outcome*0.25 + scope*0.20 + constraints*0.15 + success*0.10
    const dims: InterviewDimensions = {
      intent: 0.8,
      outcome: 0.6,
      scope: 0.4,
      constraints: 0.2,
      success: 0.1,
    };
    const clarity =
      0.8 * 0.30 + 0.6 * 0.25 + 0.4 * 0.20 + 0.2 * 0.15 + 0.1 * 0.10;
    const expected = 1 - clarity;
    const result = calculateAmbiguity(dims, true);
    expect(result).toBeCloseTo(expected, 5);
  });

  it("greenfield — ignores context dimension", () => {
    const dims: InterviewDimensions = {
      intent: 0.5,
      outcome: 0.5,
      scope: 0.5,
      constraints: 0.5,
      success: 0.5,
      context: 1.0, // should be ignored
    };
    const clarity = 0.5 * (0.30 + 0.25 + 0.20 + 0.15 + 0.10);
    const expected = 1 - clarity;
    const result = calculateAmbiguity(dims, true);
    expect(result).toBeCloseTo(expected, 5);
  });

  it("brownfield — includes context dimension with correct weights", () => {
    // intent*0.25 + outcome*0.20 + scope*0.20 + constraints*0.15 + success*0.10 + context*0.10
    const dims: InterviewDimensions = {
      intent: 0.8,
      outcome: 0.6,
      scope: 0.4,
      constraints: 0.2,
      success: 0.1,
      context: 0.7,
    };
    const clarity =
      0.8 * 0.25 + 0.6 * 0.20 + 0.4 * 0.20 + 0.2 * 0.15 + 0.1 * 0.10 + 0.7 * 0.10;
    const expected = 1 - clarity;
    const result = calculateAmbiguity(dims, false);
    expect(result).toBeCloseTo(expected, 5);
  });

  it("brownfield — all perfect scores yields 0 ambiguity", () => {
    const dims: InterviewDimensions = {
      intent: 1.0,
      outcome: 1.0,
      scope: 1.0,
      constraints: 1.0,
      success: 1.0,
      context: 1.0,
    };
    const result = calculateAmbiguity(dims, false);
    expect(result).toBeCloseTo(0.0, 5);
  });

  it("clamps result to [0, 1]", () => {
    // Scores beyond 1.0 should still clamp
    const dims: InterviewDimensions = {
      intent: 2.0,
      outcome: 2.0,
      scope: 2.0,
      constraints: 2.0,
      success: 2.0,
    };
    const result = calculateAmbiguity(dims, true);
    expect(result).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// pickWeakestDimension
// ---------------------------------------------------------------------------

describe("pickWeakestDimension", () => {
  it("returns the lowest-scored dimension", () => {
    const dims: InterviewDimensions = {
      intent: 0.8,
      outcome: 0.6,
      scope: 0.1, // weakest
      constraints: 0.5,
      success: 0.9,
    };
    expect(pickWeakestDimension(dims, true)).toBe("scope");
  });

  it("returns the lowest among all dimensions including context for brownfield", () => {
    const dims: InterviewDimensions = {
      intent: 0.8,
      outcome: 0.6,
      scope: 0.5,
      constraints: 0.5,
      success: 0.9,
      context: 0.05, // weakest
    };
    expect(pickWeakestDimension(dims, false)).toBe("context");
  });

  it("ignores context for greenfield even if it is lowest", () => {
    const dims: InterviewDimensions = {
      intent: 0.8,
      outcome: 0.6,
      scope: 0.5,
      constraints: 0.3, // weakest among non-context
      success: 0.9,
      context: 0.05,
    };
    expect(pickWeakestDimension(dims, true)).toBe("constraints");
  });
});

// ---------------------------------------------------------------------------
// selectChallengeMode
// ---------------------------------------------------------------------------

describe("selectChallengeMode", () => {
  it("returns null for round 1", () => {
    expect(selectChallengeMode(1)).toBeNull();
  });

  it("returns contrarian for round 2", () => {
    expect(selectChallengeMode(2)).toBe("contrarian");
  });

  it("returns contrarian for round 3", () => {
    expect(selectChallengeMode(3)).toBe("contrarian");
  });

  it("returns simplifier for round 4", () => {
    expect(selectChallengeMode(4)).toBe("simplifier");
  });

  it("returns ontologist for round 5", () => {
    expect(selectChallengeMode(5)).toBe("ontologist");
  });

  it("returns ontologist for round 10", () => {
    expect(selectChallengeMode(10)).toBe("ontologist");
  });
});

// ---------------------------------------------------------------------------
// shouldPressurePass
// ---------------------------------------------------------------------------

describe("shouldPressurePass", () => {
  it("returns false for round 0", () => {
    expect(shouldPressurePass(0)).toBe(false);
  });

  it("returns false for round 1", () => {
    expect(shouldPressurePass(1)).toBe(false);
  });

  it("returns false for round 2", () => {
    expect(shouldPressurePass(2)).toBe(false);
  });

  it("returns true for round 3", () => {
    expect(shouldPressurePass(3)).toBe(true);
  });

  it("returns false for round 4", () => {
    expect(shouldPressurePass(4)).toBe(false);
  });

  it("returns false for round 5", () => {
    expect(shouldPressurePass(5)).toBe(false);
  });

  it("returns true for round 6", () => {
    expect(shouldPressurePass(6)).toBe(true);
  });

  it("returns true for round 9", () => {
    expect(shouldPressurePass(9)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Spec crystallization format (smoke test)
// ---------------------------------------------------------------------------

describe("spec crystallization", () => {
  it("ambiguity formula: greenfield with mid-range scores gives expected value", () => {
    const dims: InterviewDimensions = {
      intent: 0.9,
      outcome: 0.85,
      scope: 0.7,
      constraints: 0.6,
      success: 0.5,
    };
    const ambiguity = calculateAmbiguity(dims, true);
    // 1 - (0.9*0.30 + 0.85*0.25 + 0.7*0.20 + 0.6*0.15 + 0.5*0.10)
    // 1 - (0.27 + 0.2125 + 0.14 + 0.09 + 0.05) = 1 - 0.7625 = 0.2375
    expect(ambiguity).toBeCloseTo(0.2375, 4);
  });

  it("early termination: ambiguity at or below threshold should crystallize", () => {
    // This tests the logic condition: overall <= threshold
    const dims: InterviewDimensions = {
      intent: 0.95,
      outcome: 0.95,
      scope: 0.95,
      constraints: 0.95,
      success: 0.95,
    };
    const ambiguity = calculateAmbiguity(dims, true);
    // 1 - 0.95*(0.30+0.25+0.20+0.15+0.10) = 1 - 0.95 = 0.05
    expect(ambiguity).toBeCloseTo(0.05, 4);
    expect(ambiguity).toBeLessThanOrEqual(0.15); // default threshold
  });
});

// ---------------------------------------------------------------------------
// InterviewModeOrchestrator — integration tests
// ---------------------------------------------------------------------------

vi.mock("../db", () => ({
  prisma: {
    interviewSession: {
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    interviewQuestion: {
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    interviewAmbiguityScore: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}));

// Re-import prisma so we can reference the mocked version
import { prisma } from "../db";

async function collectEvents(gen: AsyncGenerator<AgenticEvent>): Promise<AgenticEvent[]> {
  const events: AgenticEvent[] = [];
  for await (const e of gen) {
    events.push(e);
  }
  return events;
}

describe("InterviewModeOrchestrator", () => {
  const HIGH_AMBIGUITY_SCORES = JSON.stringify({
    intent: 0.3,
    outcome: 0.2,
    scope: 0.1,
    constraints: 0.2,
    success: 0.1,
  });

  const LOW_AMBIGUITY_SCORES = JSON.stringify({
    intent: 0.98,
    outcome: 0.97,
    scope: 0.96,
    constraints: 0.95,
    success: 0.95,
  });

  const baseInput = {
    runId: "run-1",
    repoId: "repo-1",
    objective: "Build a CLI tool",
    actor: "user-1",
    worktreePath: "/tmp/worktree",
    isGreenfield: true,
    maxRounds: 10,
    ambiguityThreshold: 0.15,
  };

  function createOrchestrator(mockProviderOrchestrator: { streamChatWithRetry: ReturnType<typeof vi.fn> }) {
    return new InterviewModeOrchestrator({
      providerOrchestrator: mockProviderOrchestrator as any,
    });
  }

  it("execute() emits correct event sequence for high ambiguity", async () => {
    const mockProviderOrchestrator = {
      streamChatWithRetry: vi.fn()
        .mockResolvedValueOnce({ text: HIGH_AMBIGUITY_SCORES }) // scoring
        .mockResolvedValueOnce({ text: "What is the primary goal of this CLI tool?" }), // question
    };

    const orch = createOrchestrator(mockProviderOrchestrator);
    const events = await collectEvents(orch.execute(baseInput));

    const types = events.map((e) => e.type);
    expect(types).toEqual([
      "interview_started",
      "interview_scored",
      "interview_question",
    ]);

    const scored = events.find((e) => e.type === "interview_scored") as any;
    expect(scored.round).toBe(0);
    expect(scored.overall).toBeGreaterThan(0.15);

    const question = events.find((e) => e.type === "interview_question") as any;
    expect(question.round).toBe(1);
    expect(question.question).toBe("What is the primary goal of this CLI tool?");
  });

  it("submitAnswer() scores and emits next question", async () => {
    const mockProviderOrchestrator = {
      streamChatWithRetry: vi.fn()
        .mockResolvedValueOnce({ text: HIGH_AMBIGUITY_SCORES }) // scoring
        .mockResolvedValueOnce({ text: "How will users invoke the tool?" }), // question
    };

    (prisma.interviewSession.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "session-1",
      objective: "Build a CLI tool",
      isGreenfield: true,
      currentRound: 1,
      maxRounds: 10,
      ambiguityThreshold: 0.15,
      handoffMode: null,
      questions: [
        { question: "What is the goal?", answer: "A fast CLI", round: 1 },
      ],
    });

    const orch = createOrchestrator(mockProviderOrchestrator);
    const events = await collectEvents(
      orch.submitAnswer("session-1", "q-1", "A fast CLI"),
    );

    const types = events.map((e) => e.type);
    expect(types).toEqual([
      "interview_answered",
      "interview_scored",
      "interview_question",
    ]);

    const answered = events.find((e) => e.type === "interview_answered") as any;
    expect(answered.answer).toBe("A fast CLI");
  });

  it("submitAnswer() crystallizes when threshold met", async () => {
    const mockProviderOrchestrator = {
      streamChatWithRetry: vi.fn()
        .mockResolvedValueOnce({ text: LOW_AMBIGUITY_SCORES }) // scoring — low ambiguity
        .mockResolvedValueOnce({ text: "## Goal\nBuild a CLI tool\n\n## Deliverables\n- CLI binary" }), // crystallization
    };

    (prisma.interviewSession.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "session-2",
      objective: "Build a CLI tool",
      isGreenfield: true,
      currentRound: 2,
      maxRounds: 10,
      ambiguityThreshold: 0.15,
      handoffMode: null,
      questions: [
        { question: "What is the goal?", answer: "A fast CLI", round: 1 },
        { question: "Who uses it?", answer: "Developers", round: 2 },
      ],
    });

    const orch = createOrchestrator(mockProviderOrchestrator);
    const events = await collectEvents(
      orch.submitAnswer("session-2", "q-2", "Developers"),
    );

    const types = events.map((e) => e.type);
    expect(types).toContain("interview_answered");
    expect(types).toContain("interview_scored");
    expect(types).toContain("interview_spec_crystallized");
    expect(types).not.toContain("interview_question");

    const crystallized = events.find((e) => e.type === "interview_spec_crystallized") as any;
    expect(crystallized.specContent).toContain("## Goal");
  });

  it("submitAnswer() crystallizes at max rounds", async () => {
    const mockProviderOrchestrator = {
      streamChatWithRetry: vi.fn()
        .mockResolvedValueOnce({ text: HIGH_AMBIGUITY_SCORES }) // scoring — still high ambiguity
        .mockResolvedValueOnce({ text: "## Goal\nBuild a CLI tool" }), // crystallization forced
    };

    (prisma.interviewSession.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "session-3",
      objective: "Build a CLI tool",
      isGreenfield: true,
      currentRound: 9, // maxRounds - 1
      maxRounds: 10,
      ambiguityThreshold: 0.15,
      handoffMode: null,
      questions: [
        { question: "Q1?", answer: "A1", round: 1 },
      ],
    });

    const orch = createOrchestrator(mockProviderOrchestrator);
    const events = await collectEvents(
      orch.submitAnswer("session-3", "q-9", "Final answer"),
    );

    const types = events.map((e) => e.type);
    expect(types).toContain("interview_spec_crystallized");
    expect(types).not.toContain("interview_question");
  });

  it("DB persistence uses correct field names for ambiguity scores", async () => {
    const mockProviderOrchestrator = {
      streamChatWithRetry: vi.fn()
        .mockResolvedValueOnce({ text: HIGH_AMBIGUITY_SCORES }) // scoring
        .mockResolvedValueOnce({ text: "What is the scope?" }), // question
    };

    (prisma.interviewAmbiguityScore.create as ReturnType<typeof vi.fn>).mockClear();

    const orch = createOrchestrator(mockProviderOrchestrator);
    await collectEvents(orch.execute(baseInput));

    expect(prisma.interviewAmbiguityScore.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        overallAmbiguity: expect.any(Number),
        intentScore: expect.any(Number),
        outcomeScore: expect.any(Number),
        scopeScore: expect.any(Number),
        constraintsScore: expect.any(Number),
        successScore: expect.any(Number),
      }),
    });

    // Verify the actual values match what we sent
    const callData = (prisma.interviewAmbiguityScore.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    expect(callData.intentScore).toBeCloseTo(0.3);
    expect(callData.outcomeScore).toBeCloseTo(0.2);
    expect(callData.scopeScore).toBeCloseTo(0.1);
    expect(callData.constraintsScore).toBeCloseTo(0.2);
    expect(callData.successScore).toBeCloseTo(0.1);
  });
});
