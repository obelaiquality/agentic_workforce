import { describe, expect, it } from "vitest";
import {
  buildApprovalFollowup,
  buildExecutionActionMessage,
  buildExecutionFailureActionMessage,
  normalizeApiErrorMessage,
  summarizeVerificationRootCause,
} from "./missionFeedback";

describe("missionFeedback", () => {
  it("normalizes JSON API errors", () => {
    expect(normalizeApiErrorMessage('{ "error": "Patch generator offline" }')).toBe("Patch generator offline");
  });

  it("summarizes verification root causes", () => {
    expect(summarizeVerificationRootCause(["infra_missing_dependency:npm install"])).toBe(
      'Missing dependency for "npm install".'
    );
  });

  it("builds a completion message when lifecycle completes", () => {
    expect(
      buildExecutionActionMessage({
        lifecycle: {
          autoReviewEnabled: true,
          maxRounds: 3,
          roundsRun: 2,
          completed: true,
          transitions: [],
        },
        verification: { pass: true },
      })
    ).toBe("Execution and auto-review completed (2/3 review rounds). Ticket moved to Completed.");
  });

  it("builds an approval-required follow-up message with root cause", () => {
    expect(
      buildExecutionActionMessage({
        lifecycle: {
          autoReviewEnabled: true,
          maxRounds: 3,
          roundsRun: 1,
          completed: false,
          approvalRequired: true,
          transitions: [],
        },
        verification: {
          pass: false,
          failures: ["approval_required:npm install"],
        },
      })
    ).toBe('Execution waiting for approval: Approval required to run "npm install".');
  });

  it("builds a timeout-specific execution failure message", () => {
    expect(buildExecutionFailureActionMessage("Generic patch generation timed out after 90s")).toBe(
      "Execution timed out while generating patch. Try Retry with smaller scope."
    );
  });

  it("builds approval follow-up notices for successful command execution and requeue", () => {
    expect(
      buildApprovalFollowup({
        decision: "approved",
        requeue: {
          ticketId: "ticket-1",
          from: "blocked",
          to: "in_progress",
          reason: "approval granted",
        },
        commandExecution: {
          toolEventId: "tool-1",
          policyDecision: "allowed",
          exitCode: 0,
          summary: "completed",
        },
        now: new Date("2026-03-23T10:00:00.000Z"),
      })
    ).toEqual({
      actionMessage: "Approved command executed. Ticket moved to in progress.",
      notice: {
        message: "Approved command executed. Ticket moved to in progress.",
        tone: "success",
        at: "2026-03-23T10:00:00.000Z",
      },
      ticketId: "ticket-1",
    });
  });
});
