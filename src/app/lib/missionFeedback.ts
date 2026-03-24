export type TicketLifecycleNotice = {
  message: string;
  tone: "info" | "success" | "warn";
  at: string;
};

type ExecutionVerification = {
  pass?: boolean;
  failures?: string[];
} | null;

type ExecutionLifecycle = {
  autoReviewEnabled: boolean;
  maxRounds: number;
  roundsRun: number;
  completed: boolean;
  approvalRequired?: boolean;
  approvalId?: string | null;
  rejected?: boolean;
  transitions: Array<{
    from: string;
    to: string;
    reason: string;
    at: string;
  }>;
} | null | undefined;

type ApprovalRequeue = {
  ticketId: string;
  from: string;
  to: string;
  reason: string;
} | null | undefined;

type ApprovalCommandExecution = {
  toolEventId: string;
  policyDecision: "allowed" | "approval_required" | "denied";
  exitCode: number | null;
  summary: string;
} | null | undefined;

export function normalizeApiErrorMessage(message: string) {
  const trimmed = message.trim();
  if (!trimmed) return "Execution failed.";
  try {
    const parsed = JSON.parse(trimmed) as { error?: unknown; message?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error.trim();
    if (typeof parsed.message === "string" && parsed.message.trim()) return parsed.message.trim();
  } catch {
    // Fall back to the original message.
  }
  return trimmed;
}

export function summarizeVerificationRootCause(failures: string[] | undefined) {
  const list = failures || [];
  const first = list[0];
  if (!first) return null;
  if (first.startsWith("infra_missing_tool:")) {
    return `Missing tool/dependency for "${first.replace("infra_missing_tool:", "")}".`;
  }
  if (first.startsWith("infra_missing_dependency:")) {
    return `Missing dependency for "${first.replace("infra_missing_dependency:", "")}".`;
  }
  if (first.startsWith("infra_command_timeout:")) {
    return `Verification timed out on "${first.replace("infra_command_timeout:", "")}".`;
  }
  if (first.startsWith("setup_failed:")) {
    return `Dependency bootstrap failed for "${first.replace("setup_failed:", "")}".`;
  }
  if (first.startsWith("approval_required:")) {
    return `Approval required to run "${first.replace("approval_required:", "")}".`;
  }
  if (first.startsWith("policy_denied:")) {
    return `Policy denied "${first.replace("policy_denied:", "")}".`;
  }
  if (first.startsWith("command_failed:")) {
    return `Verification failed on "${first.replace("command_failed:", "")}".`;
  }
  return null;
}

export function buildExecutionActionMessage(input: {
  lifecycle?: ExecutionLifecycle;
  verification?: ExecutionVerification;
}) {
  if (input.lifecycle?.completed) {
    return `Execution and auto-review completed (${input.lifecycle.roundsRun}/${input.lifecycle.maxRounds} review rounds). Ticket moved to Completed.`;
  }

  if (input.verification?.pass) {
    return "Execution verified. Ticket moved through review.";
  }

  const rootCause = summarizeVerificationRootCause(input.verification?.failures);
  if (input.lifecycle?.approvalRequired) {
    return `Execution waiting for approval${rootCause ? `: ${rootCause}` : "."}`;
  }

  if (input.lifecycle?.roundsRun) {
    return rootCause
      ? `Execution needs follow-up after ${input.lifecycle.roundsRun} auto-review rounds. ${rootCause}`
      : `Execution needs follow-up after ${input.lifecycle.roundsRun} auto-review rounds. Ticket moved back to In Progress.`;
  }

  if (rootCause) {
    return rootCause;
  }

  return "Execution finished. Ticket remains in progress for follow-up.";
}

export function buildExecutionFailureActionMessage(error: string) {
  const normalized = normalizeApiErrorMessage(error);
  const lower = normalized.toLowerCase();
  if (lower.includes("generic patch generation timed out") || lower.includes("timed out")) {
    return "Execution timed out while generating patch. Try Retry with smaller scope.";
  }
  return `Execution failed: ${normalized}`;
}

export function buildApprovalFollowup(input: {
  decision: "approved" | "rejected";
  requeue?: ApprovalRequeue;
  commandExecution?: ApprovalCommandExecution;
  fallbackTicketId?: string | null;
  now?: Date;
}) {
  if (input.decision === "rejected") {
    return {
      actionMessage: "Approval rejected.",
      notice: null,
      ticketId: input.fallbackTicketId ?? null,
    };
  }

  const at = (input.now ?? new Date()).toISOString();
  const ticketId = input.requeue?.ticketId || input.fallbackTicketId || null;
  let notice: TicketLifecycleNotice | null = null;

  if (input.requeue && input.commandExecution) {
    notice = {
      message:
        input.commandExecution.exitCode === 0
          ? `Approved command executed. Ticket moved to ${input.requeue.to.replace(/_/g, " ")}.`
          : `Approved command executed with follow-up. Ticket moved to ${input.requeue.to.replace(/_/g, " ")}.`,
      tone: input.commandExecution.exitCode === 0 ? "success" : "warn",
      at,
    };
  } else if (input.requeue) {
    notice = {
      message: `Ticket moved to ${input.requeue.to.replace(/_/g, " ")} after approval.`,
      tone: "info",
      at,
    };
  } else if (input.commandExecution) {
    notice = {
      message:
        input.commandExecution.exitCode === 0
          ? "Approved command executed successfully."
          : "Approved command executed with follow-up required.",
      tone: input.commandExecution.exitCode === 0 ? "success" : "warn",
      at,
    };
  }

  return {
    actionMessage: notice?.message || "Approval updated.",
    notice,
    ticketId,
  };
}
