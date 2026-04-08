import { randomUUID } from "node:crypto";
import type { ProviderOrchestrator } from "../services/providerOrchestrator";
import { prisma } from "../db";
import type {
  AgenticEvent,
  InterviewChallengeMode,
  InterviewDimensions,
  InterviewModeInput,
} from "../../shared/contracts";
import { createLogger } from "../logger";

const log = createLogger("InterviewMode");

// ---------------------------------------------------------------------------
// Exported utility functions (testable)
// ---------------------------------------------------------------------------

const GREENFIELD_WEIGHTS = { intent: 0.30, outcome: 0.25, scope: 0.20, constraints: 0.15, success: 0.10 };
const BROWNFIELD_WEIGHTS = { intent: 0.25, outcome: 0.20, scope: 0.20, constraints: 0.15, success: 0.10, context: 0.10 };

export function calculateAmbiguity(dimensions: InterviewDimensions, isGreenfield: boolean): number {
  const w = isGreenfield ? GREENFIELD_WEIGHTS : BROWNFIELD_WEIGHTS;
  let clarity =
    dimensions.intent * w.intent +
    dimensions.outcome * w.outcome +
    dimensions.scope * w.scope +
    dimensions.constraints * w.constraints +
    dimensions.success * w.success;

  if (!isGreenfield && dimensions.context != null) {
    clarity += dimensions.context * (w as typeof BROWNFIELD_WEIGHTS).context;
  }

  return Math.max(0, Math.min(1, 1 - clarity));
}

export function pickWeakestDimension(dimensions: InterviewDimensions, isGreenfield: boolean): keyof InterviewDimensions {
  const candidates: Array<[keyof InterviewDimensions, number]> = [
    ["intent", dimensions.intent],
    ["outcome", dimensions.outcome],
    ["scope", dimensions.scope],
    ["constraints", dimensions.constraints],
    ["success", dimensions.success],
  ];
  if (!isGreenfield && dimensions.context != null) {
    candidates.push(["context", dimensions.context]);
  }
  candidates.sort((a, b) => a[1] - b[1]);
  return candidates[0][0];
}

export function selectChallengeMode(round: number): InterviewChallengeMode | null {
  if (round >= 5) return "ontologist";
  if (round >= 4) return "simplifier";
  if (round >= 2) return "contrarian";
  return null;
}

export function shouldPressurePass(round: number): boolean {
  return round > 0 && round % 3 === 0;
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildScoringPrompt(
  objective: string,
  isGreenfield: boolean,
  questionsAndAnswers: Array<{ question: string; answer: string | null }>,
): string {
  const qaBlock = questionsAndAnswers.length > 0
    ? questionsAndAnswers
        .map((qa, i) => `Q${i + 1}: ${qa.question}\nA${i + 1}: ${qa.answer ?? "(unanswered)"}`)
        .join("\n\n")
    : "(No questions asked yet)";

  const dimensionList = isGreenfield
    ? "intent, outcome, scope, constraints, success"
    : "intent, outcome, scope, constraints, success, context";

  return `You are an ambiguity scorer for a software project specification.

Objective: ${objective}
Project type: ${isGreenfield ? "greenfield" : "brownfield"}

Questions and answers so far:
${qaBlock}

Score each dimension from 0.0 (completely ambiguous) to 1.0 (crystal clear):
Dimensions: ${dimensionList}

- intent: How clear is the user's goal/intent?
- outcome: How well-defined are the expected outcomes/deliverables?
- scope: How well-bounded is the scope of work?
- constraints: How clear are the technical/business constraints?
- success: How measurable are the success criteria?
${!isGreenfield ? "- context: How well-understood is the existing codebase context?" : ""}

Respond with ONLY a JSON object like:
${isGreenfield
    ? '{"intent": 0.5, "outcome": 0.3, "scope": 0.4, "constraints": 0.6, "success": 0.2}'
    : '{"intent": 0.5, "outcome": 0.3, "scope": 0.4, "constraints": 0.6, "success": 0.2, "context": 0.4}'}`;
}

function buildQuestionPrompt(
  objective: string,
  targetDimension: string,
  challengeMode: InterviewChallengeMode | null,
  questionsAndAnswers: Array<{ question: string; answer: string | null }>,
  pressurePassQuestion?: string,
): string {
  const qaBlock = questionsAndAnswers
    .map((qa, i) => `Q${i + 1}: ${qa.question}\nA${i + 1}: ${qa.answer ?? "(unanswered)"}`)
    .join("\n\n");

  let modeInstruction = "";
  if (challengeMode === "contrarian") {
    modeInstruction = "\nAdopt a CONTRARIAN stance: challenge the user's assumptions and probe for hidden risks or overlooked alternatives.";
  } else if (challengeMode === "simplifier") {
    modeInstruction = "\nAdopt a SIMPLIFIER stance: probe whether the scope can be reduced to a minimal viable version. Question complexity.";
  } else if (challengeMode === "ontologist") {
    modeInstruction = "\nAdopt an ONTOLOGIST stance: reframe the problem at an essence level. Ask what the fundamental nature of the problem really is.";
  }

  let pressureInstruction = "";
  if (pressurePassQuestion) {
    pressureInstruction = `\n\nPRESSURE PASS: An earlier answer may need revisiting. The previous question was: "${pressurePassQuestion}". Incorporate a follow-up or challenge to the earlier answer in your new question.`;
  }

  return `You are a Socratic interviewer helping clarify a software project specification.

Objective: ${objective}

Previous Q&A:
${qaBlock || "(None yet)"}

The weakest dimension is: ${targetDimension}
Generate ONE focused question to reduce ambiguity in the "${targetDimension}" dimension.${modeInstruction}${pressureInstruction}

Respond with ONLY the question text, no numbering or prefixes.`;
}

function buildCrystallizationPrompt(
  objective: string,
  questionsAndAnswers: Array<{ question: string; answer: string | null }>,
): string {
  const qaBlock = questionsAndAnswers
    .map((qa, i) => `Q${i + 1}: ${qa.question}\nA${i + 1}: ${qa.answer ?? "(unanswered)"}`)
    .join("\n\n");

  return `You are a specification writer. Based on the following objective and Q&A interview, produce a structured, execution-ready specification.

Objective: ${objective}

Interview Q&A:
${qaBlock}

Produce a specification in the following format:

## Goal
(one paragraph)

## Deliverables
(bulleted list)

## Scope
- In scope: (bulleted)
- Out of scope: (bulleted)

## Constraints
(bulleted list)

## Success Criteria
(bulleted, measurable)

## Implementation Notes
(any relevant details from the interview)

Respond with ONLY the specification, no preamble.`;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

interface InterviewOrchDeps {
  providerOrchestrator: ProviderOrchestrator;
}

export class InterviewModeOrchestrator {
  private deps: InterviewOrchDeps;

  constructor(deps: InterviewOrchDeps) {
    this.deps = deps;
  }

  /**
   * Start a new interview session. Scores the initial objective and emits the
   * first question. Yields events and then pauses — caller should await
   * submitAnswer() for subsequent rounds.
   */
  async *execute(input: InterviewModeInput): AsyncGenerator<AgenticEvent> {
    const sessionId = randomUUID();
    const maxRounds = input.maxRounds ?? 10;
    const ambiguityThreshold = input.ambiguityThreshold ?? 0.15;
    const isGreenfield = input.isGreenfield ?? true;

    // 1. Create session in DB
    await prisma.interviewSession.create({
      data: {
        id: sessionId,
        runId: input.runId,
        repoId: input.repoId,
        ticketId: input.ticketId ?? null,
        objective: input.objective,
        maxRounds,
        ambiguityThreshold,
        isGreenfield,
        actor: input.actor,
        worktreePath: input.worktreePath,
        handoffMode: input.handoffMode ?? null,
        status: "active",
        currentRound: 0,
      },
    });

    // 2. Emit started
    yield { type: "interview_started", sessionId, maxRounds };

    // 3. Initial scoring (round 0, no Q&A yet)
    const dimensions = await this.scoreDimensions(sessionId, input.objective, isGreenfield, []);
    const overall = calculateAmbiguity(dimensions, isGreenfield);

    await this.persistScore(sessionId, 0, overall, dimensions);
    yield { type: "interview_scored", round: 0, overall, dimensions: { ...dimensions } };

    // Check if already clear enough
    if (overall <= ambiguityThreshold) {
      yield* this.crystallize(sessionId, input.objective, [], overall, input.handoffMode);
      return;
    }

    // 4. Generate first question
    await prisma.interviewSession.update({
      where: { id: sessionId },
      data: { currentRound: 1 },
    });

    const weakest = pickWeakestDimension(dimensions, isGreenfield);
    const challengeMode = selectChallengeMode(1); // null for round 1
    const questionText = await this.generateQuestion(
      sessionId, input.objective, weakest, challengeMode, [], undefined,
    );

    const questionId = randomUUID();
    await prisma.interviewQuestion.create({
      data: {
        id: questionId,
        sessionId,
        round: 1,
        question: questionText,
        targetDimension: weakest,
        challengeMode: challengeMode ?? undefined,
      },
    });

    yield {
      type: "interview_question",
      questionId,
      question: questionText,
      round: 1,
      challengeMode: challengeMode ?? undefined,
      targetDimension: weakest,
    };

    // Pause — answer comes via submitAnswer
  }

  /**
   * Submit an answer to the current question, then score, and either emit the
   * next question or crystallize the spec.
   */
  async *submitAnswer(
    sessionId: string,
    questionId: string,
    answer: string,
  ): AsyncGenerator<AgenticEvent> {
    // Persist answer
    await prisma.interviewQuestion.update({
      where: { id: questionId },
      data: { answer, answeredAt: new Date() },
    });

    yield { type: "interview_answered", questionId, answer };

    // Load session
    const session = await prisma.interviewSession.findUniqueOrThrow({
      where: { id: sessionId },
      include: { questions: { orderBy: { round: "asc" } } },
    });

    const questionsAndAnswers = session.questions.map((q) => ({
      question: q.question,
      answer: q.answer,
    }));

    const isGreenfield = session.isGreenfield;
    const nextRound = session.currentRound + 1;

    // Score
    const dimensions = await this.scoreDimensions(
      sessionId, session.objective, isGreenfield, questionsAndAnswers,
    );
    const overall = calculateAmbiguity(dimensions, isGreenfield);

    await this.persistScore(sessionId, nextRound, overall, dimensions);
    yield { type: "interview_scored", round: nextRound, overall, dimensions: { ...dimensions } };

    // Threshold met or max rounds reached?
    if (overall <= session.ambiguityThreshold || nextRound >= session.maxRounds) {
      await prisma.interviewSession.update({
        where: { id: sessionId },
        data: { currentRound: nextRound, status: "completed" },
      });
      yield* this.crystallize(
        sessionId,
        session.objective,
        questionsAndAnswers,
        overall,
        session.handoffMode as "ralph" | "team" | "autopilot" | undefined,
      );
      return;
    }

    // Update round
    await prisma.interviewSession.update({
      where: { id: sessionId },
      data: { currentRound: nextRound },
    });

    // Pick weakest dimension and generate next question
    const weakest = pickWeakestDimension(dimensions, isGreenfield);
    const challengeMode = selectChallengeMode(nextRound);

    // Pressure pass: revisit an earlier answer every 3rd round
    let pressurePassQuestion: string | undefined;
    if (shouldPressurePass(nextRound) && session.questions.length > 0) {
      const earlierQ = session.questions[Math.floor(Math.random() * session.questions.length)];
      pressurePassQuestion = earlierQ.question;
    }

    const questionText = await this.generateQuestion(
      sessionId, session.objective, weakest, challengeMode, questionsAndAnswers, pressurePassQuestion,
    );

    const newQuestionId = randomUUID();
    await prisma.interviewQuestion.create({
      data: {
        id: newQuestionId,
        sessionId,
        round: nextRound,
        question: questionText,
        targetDimension: weakest,
        challengeMode: challengeMode ?? undefined,
      },
    });

    yield {
      type: "interview_question",
      questionId: newQuestionId,
      question: questionText,
      round: nextRound,
      challengeMode: challengeMode ?? undefined,
      targetDimension: weakest,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async scoreDimensions(
    sessionId: string,
    objective: string,
    isGreenfield: boolean,
    questionsAndAnswers: Array<{ question: string; answer: string | null }>,
  ): Promise<InterviewDimensions> {
    const prompt = buildScoringPrompt(objective, isGreenfield, questionsAndAnswers);

    try {
      const result = await this.deps.providerOrchestrator.streamChatWithRetry(
        `interview-score-${sessionId}`,
        [{ role: "user", content: prompt }],
        () => {},
        { modelRole: "utility_fast", querySource: "context_building" },
      );

      const parsed = JSON.parse(result.text.trim());
      return {
        intent: clamp01(parsed.intent ?? 0),
        outcome: clamp01(parsed.outcome ?? 0),
        scope: clamp01(parsed.scope ?? 0),
        constraints: clamp01(parsed.constraints ?? 0),
        success: clamp01(parsed.success ?? 0),
        ...((!isGreenfield && parsed.context != null) ? { context: clamp01(parsed.context) } : {}),
      };
    } catch (error) {
      log.error("Failed to score dimensions, using defaults", { error, sessionId });
      return {
        intent: 0.5,
        outcome: 0.5,
        scope: 0.5,
        constraints: 0.5,
        success: 0.5,
        ...(!isGreenfield ? { context: 0.5 } : {}),
      };
    }
  }

  private async generateQuestion(
    sessionId: string,
    objective: string,
    targetDimension: string,
    challengeMode: InterviewChallengeMode | null,
    questionsAndAnswers: Array<{ question: string; answer: string | null }>,
    pressurePassQuestion?: string,
  ): Promise<string> {
    const prompt = buildQuestionPrompt(
      objective, targetDimension, challengeMode, questionsAndAnswers, pressurePassQuestion,
    );

    try {
      const result = await this.deps.providerOrchestrator.streamChatWithRetry(
        `interview-question-${sessionId}`,
        [{ role: "user", content: prompt }],
        () => {},
        { modelRole: "utility_fast", querySource: "context_building" },
      );
      return result.text.trim();
    } catch (error) {
      log.error("Failed to generate question, using fallback", { error, sessionId });
      return `Can you clarify the ${targetDimension} aspect of your objective?`;
    }
  }

  private async persistScore(
    sessionId: string,
    round: number,
    overall: number,
    dimensions: InterviewDimensions,
  ): Promise<void> {
    await prisma.interviewAmbiguityScore.create({
      data: {
        id: randomUUID(),
        sessionId,
        round,
        overallAmbiguity: overall,
        intentScore: dimensions.intent,
        outcomeScore: dimensions.outcome,
        scopeScore: dimensions.scope,
        constraintsScore: dimensions.constraints,
        successScore: dimensions.success,
        contextScore: dimensions.context ?? null,
      },
    });
  }

  private async *crystallize(
    sessionId: string,
    objective: string,
    questionsAndAnswers: Array<{ question: string; answer: string | null }>,
    finalAmbiguity: number,
    handoffMode?: "ralph" | "team" | "autopilot" | null,
  ): AsyncGenerator<AgenticEvent> {
    const prompt = buildCrystallizationPrompt(objective, questionsAndAnswers);

    let specContent: string;
    try {
      const result = await this.deps.providerOrchestrator.streamChatWithRetry(
        `interview-crystallize-${sessionId}`,
        [{ role: "user", content: prompt }],
        () => {},
        { modelRole: "utility_fast", querySource: "context_building" },
      );
      specContent = result.text.trim();
    } catch (error) {
      log.error("Failed to crystallize spec", { error, sessionId });
      specContent = `## Goal\n${objective}\n\n(Crystallization failed — raw Q&A available in session)`;
    }

    await prisma.interviewSession.update({
      where: { id: sessionId },
      data: { finalSpec: specContent, status: "completed" },
    });

    yield { type: "interview_spec_crystallized", specContent, finalAmbiguity };

    if (handoffMode) {
      yield { type: "interview_handoff", targetMode: handoffMode };
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
