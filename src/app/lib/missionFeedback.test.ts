// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  buildApprovalFollowup,
  buildExecutionActionMessage,
  buildExecutionFailureActionMessage,
  normalizeApiErrorMessage,
  summarizeVerificationRootCause,
} from "./missionFeedback";

describe("missionFeedback", () => {
  // --- normalizeApiErrorMessage ---
  it("normalizes JSON API errors", () => {
    expect(normalizeApiErrorMessage('{ "error": "Patch generator offline" }')).toBe("Patch generator offline");
  });

  it("returns fallback when message is empty or whitespace", () => {
    expect(normalizeApiErrorMessage("")).toBe("Execution failed.");
    expect(normalizeApiErrorMessage("   ")).toBe("Execution failed.");
  });

  it("falls back to message field when error is absent", () => {
    expect(normalizeApiErrorMessage('{ "message": "Something broke" }')).toBe("Something broke");
  });

  it("returns trimmed original when JSON parse fails", () => {
    expect(normalizeApiErrorMessage("  plain text error  ")).toBe("plain text error");
  });

  it("returns trimmed original when JSON has no error or message fields", () => {
    expect(normalizeApiErrorMessage('{ "code": 500 }')).toBe('{ "code": 500 }');
  });

  it("skips empty error string and tries message", () => {
    expect(normalizeApiErrorMessage('{ "error": "  ", "message": "Real msg" }')).toBe("Real msg");
  });

  it("skips empty error and empty message, returns trimmed original", () => {
    expect(normalizeApiErrorMessage('{ "error": "  ", "message": "  " }')).toBe('{ "error": "  ", "message": "  " }');
  });

  // --- summarizeVerificationRootCause ---
  it("summarizes verification root causes", () => {
    expect(summarizeVerificationRootCause(["infra_missing_dependency:npm install"])).toBe(
      'Missing dependency for "npm install".'
    );
  });

  it("returns null for undefined failures", () => {
    expect(summarizeVerificationRootCause(undefined)).toBeNull();
  });

  it("returns null for empty failures", () => {
    expect(summarizeVerificationRootCause([])).toBeNull();
  });

  it("handles infra_missing_tool prefix", () => {
    expect(summarizeVerificationRootCause(["infra_missing_tool:jest"])).toBe(
      'Missing tool/dependency for "jest".'
    );
  });

  it("handles infra_command_timeout prefix", () => {
    expect(summarizeVerificationRootCause(["infra_command_timeout:npm test"])).toBe(
      'Verification timed out on "npm test".'
    );
  });

  it("handles setup_failed prefix", () => {
    expect(summarizeVerificationRootCause(["setup_failed:pip install"])).toBe(
      'Dependency bootstrap failed for "pip install".'
    );
  });

  it("handles policy_denied prefix", () => {
    expect(summarizeVerificationRootCause(["policy_denied:rm -rf"])).toBe(
      'Policy denied "rm -rf".'
    );
  });

  it("handles command_failed prefix", () => {
    expect(summarizeVerificationRootCause(["command_failed:vitest run"])).toBe(
      'Verification failed on "vitest run".'
    );
  });

  it("returns null for unrecognized failure prefix", () => {
    expect(summarizeVerificationRootCause(["some_other:thing"])).toBeNull();
  });

  // --- buildExecutionActionMessage ---
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

  it("builds verified message when verification passes", () => {
    expect(
      buildExecutionActionMessage({
        lifecycle: {
          autoReviewEnabled: true,
          maxRounds: 3,
          roundsRun: 0,
          completed: false,
          transitions: [],
        },
        verification: { pass: true },
      })
    ).toBe("Execution verified. Ticket moved through review.");
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

  it("builds approval-required message without root cause", () => {
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
        verification: null,
      })
    ).toBe("Execution waiting for approval.");
  });

  it("builds follow-up message after auto-review rounds with root cause", () => {
    expect(
      buildExecutionActionMessage({
        lifecycle: {
          autoReviewEnabled: true,
          maxRounds: 3,
          roundsRun: 2,
          completed: false,
          transitions: [],
        },
        verification: { pass: false, failures: ["command_failed:npm test"] },
      })
    ).toBe('Execution needs follow-up after 2 auto-review rounds. Verification failed on "npm test".');
  });

  it("builds follow-up message after auto-review rounds without root cause", () => {
    expect(
      buildExecutionActionMessage({
        lifecycle: {
          autoReviewEnabled: true,
          maxRounds: 3,
          roundsRun: 2,
          completed: false,
          transitions: [],
        },
        verification: null,
      })
    ).toBe("Execution needs follow-up after 2 auto-review rounds. Ticket moved back to In Progress.");
  });

  it("returns root cause when no lifecycle info present", () => {
    expect(
      buildExecutionActionMessage({
        verification: { pass: false, failures: ["infra_missing_tool:eslint"] },
      })
    ).toBe('Missing tool/dependency for "eslint".');
  });

  it("returns generic in-progress message when nothing matches", () => {
    expect(
      buildExecutionActionMessage({
        lifecycle: undefined,
        verification: null,
      })
    ).toBe("Execution finished. Ticket remains in progress for follow-up.");
  });

  // --- buildExecutionFailureActionMessage ---
  it("builds a timeout-specific execution failure message", () => {
    expect(buildExecutionFailureActionMessage("Generic patch generation timed out after 90s")).toBe(
      "Execution timed out while generating patch. Try Retry with smaller scope."
    );
  });

  it("detects timed out in lowercase", () => {
    expect(buildExecutionFailureActionMessage("Request timed out")).toBe(
      "Execution timed out while generating patch. Try Retry with smaller scope."
    );
  });

  it("returns generic failure for non-timeout errors", () => {
    expect(buildExecutionFailureActionMessage("Model crashed")).toBe("Execution failed: Model crashed");
  });

  it("normalizes JSON inside failure message", () => {
    expect(buildExecutionFailureActionMessage('{"error":"Server down"}')).toBe("Execution failed: Server down");
  });

  // --- buildApprovalFollowup ---
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

  it("returns rejection follow-up", () => {
    expect(
      buildApprovalFollowup({
        decision: "rejected",
        fallbackTicketId: "t-5",
      })
    ).toEqual({
      actionMessage: "Approval rejected.",
      notice: null,
      ticketId: "t-5",
    });
  });

  it("returns null ticketId for rejection without fallback", () => {
    expect(
      buildApprovalFollowup({ decision: "rejected" })
    ).toEqual({
      actionMessage: "Approval rejected.",
      notice: null,
      ticketId: null,
    });
  });

  it("builds requeue-only approval (no command execution)", () => {
    const result = buildApprovalFollowup({
      decision: "approved",
      requeue: {
        ticketId: "ticket-2",
        from: "blocked",
        to: "needs_review",
        reason: "approval granted",
      },
      now: new Date("2026-04-01T12:00:00.000Z"),
    });
    expect(result).toEqual({
      actionMessage: "Ticket moved to needs review after approval.",
      notice: {
        message: "Ticket moved to needs review after approval.",
        tone: "info",
        at: "2026-04-01T12:00:00.000Z",
      },
      ticketId: "ticket-2",
    });
  });

  it("builds command-execution-only approval with exit 0", () => {
    const result = buildApprovalFollowup({
      decision: "approved",
      commandExecution: {
        toolEventId: "tool-2",
        policyDecision: "allowed",
        exitCode: 0,
        summary: "done",
      },
      fallbackTicketId: "t-99",
      now: new Date("2026-04-01T12:00:00.000Z"),
    });
    expect(result).toEqual({
      actionMessage: "Approved command executed successfully.",
      notice: {
        message: "Approved command executed successfully.",
        tone: "success",
        at: "2026-04-01T12:00:00.000Z",
      },
      ticketId: "t-99",
    });
  });

  it("builds command-execution-only approval with non-zero exit code", () => {
    const result = buildApprovalFollowup({
      decision: "approved",
      commandExecution: {
        toolEventId: "tool-3",
        policyDecision: "allowed",
        exitCode: 1,
        summary: "failed",
      },
      now: new Date("2026-04-01T12:00:00.000Z"),
    });
    expect(result).toEqual({
      actionMessage: "Approved command executed with follow-up required.",
      notice: {
        message: "Approved command executed with follow-up required.",
        tone: "warn",
        at: "2026-04-01T12:00:00.000Z",
      },
      ticketId: null,
    });
  });

  it("builds requeue + command execution with non-zero exit code", () => {
    const result = buildApprovalFollowup({
      decision: "approved",
      requeue: {
        ticketId: "ticket-7",
        from: "blocked",
        to: "in_progress",
        reason: "retry",
      },
      commandExecution: {
        toolEventId: "tool-4",
        policyDecision: "allowed",
        exitCode: 1,
        summary: "partial",
      },
      now: new Date("2026-04-02T08:00:00.000Z"),
    });
    expect(result).toEqual({
      actionMessage: "Approved command executed with follow-up. Ticket moved to in progress.",
      notice: {
        message: "Approved command executed with follow-up. Ticket moved to in progress.",
        tone: "warn",
        at: "2026-04-02T08:00:00.000Z",
      },
      ticketId: "ticket-7",
    });
  });

  it("returns generic message when approved with no requeue or command", () => {
    const result = buildApprovalFollowup({
      decision: "approved",
      now: new Date("2026-04-01T12:00:00.000Z"),
    });
    expect(result).toEqual({
      actionMessage: "Approval updated.",
      notice: null,
      ticketId: null,
    });
  });

  it("uses fallbackTicketId when requeue has no ticketId", () => {
    const result = buildApprovalFollowup({
      decision: "approved",
      fallbackTicketId: "fallback-1",
      now: new Date("2026-04-01T12:00:00.000Z"),
    });
    expect(result.ticketId).toBe("fallback-1");
  });
});
