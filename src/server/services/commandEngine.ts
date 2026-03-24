import { spawnSync } from "node:child_process";
import path from "node:path";
import { publishEvent } from "../eventBus";
import { prisma } from "../db";
import type { TicketPermissionMode, ToolInvocationEvent } from "../../shared/contracts";
import { TicketService } from "./ticketService";
import {
  buildCommandPlan,
  classifyCommandFlags,
  commandPlanFromRecord,
  commandPlanToRecord,
  isCommandAllowedForToolType,
  normalizeCommandInput,
  spawnArgsForSafeSpec,
  tokenizeCommand,
  type CommandPlan,
} from "./commandSpecs";
import { redactSensitiveText, redactStringArray } from "./sensitiveRedaction";
import { detectShell } from "./shellDetect";

type ToolType = ToolInvocationEvent["toolType"];
type StageType = ToolInvocationEvent["stage"];
type PolicyDecision = ToolInvocationEvent["policyDecision"];
type ErrorClass = ToolInvocationEvent["errorClass"];

type ShellResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
};

type InvokeInput = {
  runId: string;
  ticketId: string;
  repoId: string;
  stage: StageType;
  actor: string;
  worktreePath: string;
  command?: string;
  args?: string[];
  commandPlan?: CommandPlan;
  toolType?: ToolType;
  riskLevel?: "low" | "medium" | "high";
  approvedApprovalId?: string | null;
};

type InvokeResult = {
  event: ToolInvocationEvent;
  result: ShellResult | null;
};

export { buildCommandPlan, isCommandAllowedForToolType, normalizeCommandInput, tokenizeCommand };

export class CommandEngine {
  constructor(private readonly ticketService: TicketService) {}

  private async ensureCommandApproval(input: {
    runId: string;
    ticketId: string;
    repoId: string;
    stage: StageType;
    toolType: ToolType;
    commandPlan: CommandPlan;
    worktreePath: string;
    actor: string;
    riskLevel?: "low" | "medium" | "high";
  }) {
    const existing = await prisma.approvalRequest.findFirst({
      where: {
        status: "pending",
        actionType: "command_tool_invocation",
        AND: [
          { payload: { path: ["run_id"], equals: input.runId } },
          { payload: { path: ["ticket_id"], equals: input.ticketId } },
          { payload: { path: ["stage"], equals: input.stage } },
          { payload: { path: ["tool_type"], equals: input.toolType } },
          { payload: { path: ["display_command"], equals: input.commandPlan.displayCommand } },
        ],
      },
      orderBy: { requestedAt: "desc" },
    });

    if (existing) {
      return existing;
    }

    const approval = await prisma.approvalRequest.create({
      data: {
        actionType: "command_tool_invocation",
        payload: {
          run_id: input.runId,
          ticket_id: input.ticketId,
          repo_id: input.repoId,
          project_id: input.repoId,
          stage: input.stage,
          tool_type: input.toolType,
          display_command: input.commandPlan.displayCommand,
          command_plan: commandPlanToRecord(input.commandPlan),
          worktree_path: input.worktreePath,
          risk_level: input.riskLevel || "medium",
        },
      },
    });

    publishEvent("global", "approval.requested", {
      approval_id: approval.id,
      action_type: approval.actionType,
      run_id: input.runId,
      ticket_id: input.ticketId,
      command: redactSensitiveText(input.commandPlan.displayCommand),
      stage: input.stage,
      tool_type: input.toolType,
      actor: input.actor,
      created_at: approval.requestedAt.toISOString(),
    });

    return approval;
  }

  private async ensureTicketScope(ticketId: string, repoId: string) {
    const ticket = await this.ticketService.getTicket(ticketId);
    if (!ticket) {
      throw new Error(`Ticket not found: ${ticketId}`);
    }
    if ((ticket.repoId || null) !== (repoId || null)) {
      throw new Error(`Ticket '${ticketId}' does not belong to repo '${repoId}'.`);
    }
  }

  private async assertWorktreeAllowed(input: { runId: string; worktreePath: string }) {
    const run = await prisma.runProjection.findUnique({
      where: { runId: input.runId },
      select: { metadata: true },
    });
    const metadata = ((run?.metadata ?? {}) as Record<string, unknown>) || {};
    const allowedRootRaw =
      typeof metadata.worktree_path === "string"
        ? metadata.worktree_path
        : typeof metadata.workspace_path === "string"
        ? metadata.workspace_path
        : "";

    if (!allowedRootRaw) {
      return;
    }

    const allowedRoot = path.resolve(allowedRootRaw);
    const requestedPath = path.resolve(input.worktreePath);
    if (requestedPath !== allowedRoot && !requestedPath.startsWith(`${allowedRoot}${path.sep}`)) {
      throw new Error(`Command worktree '${input.worktreePath}' escapes the active worktree root.`);
    }
  }

  private runCommandPlan(plan: CommandPlan, worktreePath: string): ShellResult {
    const commandTimeoutMs = Math.max(
      15000,
      Math.min(240000, Number(process.env.EXECUTION_COMMAND_TIMEOUT_MS || 90000))
    );
    try {
      const result =
        plan.kind === "safe"
          ? (() => {
              const command = spawnArgsForSafeSpec(plan.spec);
              return spawnSync(command.binary, command.args, {
                cwd: worktreePath,
                encoding: "utf8",
                stdio: ["ignore", "pipe", "pipe"],
                timeout: commandTimeoutMs,
              });
            })()
          : (() => {
              const shell = detectShell();
              const shellArgs =
                process.platform === "win32"
                  ? ["/d", "/s", "/c", plan.shellCommand]
                  : ["-lc", plan.shellCommand];
              return spawnSync(shell, shellArgs, {
                cwd: worktreePath,
                encoding: "utf8",
                stdio: ["ignore", "pipe", "pipe"],
                timeout: commandTimeoutMs,
              });
            })();
      return {
        ok: result.status === 0 && !result.error,
        stdout: result.stdout || "",
        stderr: result.stderr || result.error?.message || "",
        exitCode: result.status ?? (result.error ? 1 : 0),
      };
    } catch (error) {
      const payload = error as { stdout?: string | Buffer; stderr?: string | Buffer; status?: number; message?: string };
      return {
        ok: false,
        stdout: typeof payload.stdout === "string" ? payload.stdout : payload.stdout?.toString("utf8") || "",
        stderr: typeof payload.stderr === "string" ? payload.stderr : payload.stderr?.toString("utf8") || payload.message || "",
        exitCode: payload.status ?? 1,
      };
    }
  }

  private resolveToolType(plan: CommandPlan, explicit?: ToolType): ToolType {
    if (explicit) return explicit;
    const flags = classifyCommandFlags(plan.displayCommand);
    if (flags.install) return "repo.install";
    if (plan.binary === "git") return "git.meta";
    if (plan.kind === "safe" && plan.spec.kind === "repo_inspect") return "repo.read";
    return "repo.verify";
  }

  private evaluatePolicy(input: {
    mode: TicketPermissionMode;
    displayCommand: string;
    toolType: ToolType;
    commandPlan: CommandPlan;
    requireApprovalFor: string[];
    allowInstallCommands: boolean;
    allowNetworkCommands: boolean;
  }): PolicyDecision {
    const flags = classifyCommandFlags(input.displayCommand);
    if (flags.destructive) return "denied";
    if (input.commandPlan.kind === "shell_approved") return "approval_required";

    if (input.mode === "strict") return "approval_required";

    if (flags.install || flags.network) {
      if (input.mode !== "full_access") {
        return "approval_required";
      }
    }

    if (input.requireApprovalFor.includes("*")) return "approval_required";
    if (input.requireApprovalFor.includes(input.toolType)) return "approval_required";
    if (flags.install && input.requireApprovalFor.includes("repo.install")) return "approval_required";
    if (flags.network && input.requireApprovalFor.includes("network")) return "approval_required";
    if (flags.destructive && input.requireApprovalFor.includes("destructive")) return "approval_required";

    if (flags.install && !input.allowInstallCommands) return "approval_required";
    if (flags.network && !input.allowNetworkCommands) return "approval_required";

    return "allowed";
  }

  private async resolveApprovedCommandOverride(input: {
    approvalId: string | null | undefined;
    runId: string;
    ticketId: string;
    stage: StageType;
  }) {
    if (!input.approvalId) return null;
    const approval = await prisma.approvalRequest.findUnique({
      where: { id: input.approvalId },
    });
    if (!approval || approval.status !== "approved" || approval.actionType !== "command_tool_invocation") {
      return null;
    }
    const payload = (approval.payload || {}) as Record<string, unknown>;
    const payloadRunId = typeof payload.run_id === "string" ? payload.run_id : null;
    const payloadTicketId = typeof payload.ticket_id === "string" ? payload.ticket_id : null;
    const payloadStage =
      payload.stage === "scope" || payload.stage === "build" || payload.stage === "review" || payload.stage === "escalate"
        ? payload.stage
        : null;
    if (payloadRunId !== input.runId || payloadTicketId !== input.ticketId || payloadStage !== input.stage) {
      return null;
    }
    return {
      approvalId: approval.id,
      commandPlan: commandPlanFromRecord(payload.command_plan),
      worktreePath: typeof payload.worktree_path === "string" ? payload.worktree_path : null,
    };
  }

  private classifyError(input: {
    policyDecision: PolicyDecision;
    result: ShellResult | null;
  }): ErrorClass {
    if (input.policyDecision === "approval_required") return "none";
    if (input.policyDecision === "denied") return "command_failed";
    if (!input.result) return "none";
    if (input.result.ok) return "none";
    const output = `${input.result.stderr}\n${input.result.stdout}`.toLowerCase();
    if (
      input.result.exitCode === 127 ||
      /\bcommand not found\b/.test(output) ||
      /is not recognized as an internal or external command/.test(output)
    ) {
      return "infra_missing_tool";
    }
    if (
      /\bcannot find module\b/.test(output) ||
      /\bmodule not found\b/.test(output) ||
      /\bno module named\b/.test(output) ||
      /\bmissing dependency\b/.test(output) ||
      /\berr! missing\b/.test(output)
    ) {
      return "infra_missing_dependency";
    }
    if (input.result.exitCode === 124 || /\btimed out\b/.test(output)) {
      return "timeout";
    }
    return "command_failed";
  }

  async invoke(input: InvokeInput): Promise<InvokeResult> {
    await this.ensureTicketScope(input.ticketId, input.repoId);

    const requestedPlan = input.commandPlan ?? buildCommandPlan(input.command || "", input.args);
    const toolType = this.resolveToolType(requestedPlan, input.toolType);
    if (requestedPlan.kind === "safe" && !isCommandAllowedForToolType(toolType, requestedPlan.binary)) {
      throw new Error(`Binary '${requestedPlan.binary}' is not allowed for tool type '${toolType}'.`);
    }

    await this.assertWorktreeAllowed({
      runId: input.runId,
      worktreePath: input.worktreePath,
    });

    const policy = await this.ticketService.getTicketExecutionPolicy(input.ticketId);
    const approvedOverride = await this.resolveApprovedCommandOverride({
      approvalId: input.approvedApprovalId,
      runId: input.runId,
      ticketId: input.ticketId,
      stage: input.stage,
    });

    const plan = approvedOverride?.commandPlan || requestedPlan;
    if (!plan) {
      throw new Error("Approved command payload is missing a command plan.");
    }
    const worktreePath = approvedOverride?.worktreePath || input.worktreePath;
    const flags = classifyCommandFlags(plan.displayCommand);
    const policyDecision = flags.destructive
      ? "denied"
      : approvedOverride
      ? "allowed"
      : this.evaluatePolicy({
          mode: policy.mode,
          displayCommand: plan.displayCommand,
          toolType,
          commandPlan: plan,
          requireApprovalFor: policy.requireApprovalFor,
          allowInstallCommands: policy.allowInstallCommands,
          allowNetworkCommands: policy.allowNetworkCommands,
        });

    const approval =
      policyDecision === "approval_required"
        ? await this.ensureCommandApproval({
            runId: input.runId,
            ticketId: input.ticketId,
            repoId: input.repoId,
            stage: input.stage,
            toolType,
            commandPlan: plan,
            worktreePath,
            actor: input.actor,
            riskLevel: input.riskLevel,
          })
        : null;

    const startedAt = Date.now();
    const result = policyDecision === "allowed" ? this.runCommandPlan(plan, worktreePath) : null;
    const durationMs = Date.now() - startedAt;
    const summary =
      policyDecision !== "allowed"
        ? policyDecision === "approval_required"
          ? `Approval required for "${redactSensitiveText(plan.displayCommand)}".`
          : `Command denied by ticket policy (${policy.mode}).`
        : result?.ok
        ? "Command completed successfully"
        : `Command failed with exit code ${result?.exitCode ?? 1}`;

    const safeCommand = redactSensitiveText(plan.displayCommand);
    const safeArgs = redactStringArray(plan.args);

    const payload = {
      runId: input.runId,
      ticketId: input.ticketId,
      stage: input.stage,
      toolType,
      command: safeCommand,
      args: safeArgs,
      cwd: worktreePath,
      policyDecision,
      exitCode: result?.exitCode ?? null,
      durationMs,
      summary,
      errorClass: this.classifyError({ policyDecision, result }),
      approval_id: approvedOverride?.approvalId ?? approval?.id ?? null,
      riskLevel: input.riskLevel || "medium",
      actor: input.actor,
      command_plan: commandPlanToRecord(plan),
    };

    const row = await prisma.benchmarkOutcomeEvidence.create({
      data: {
        runId: input.runId,
        kind: "tool_invocation",
        payload,
      },
    });

    const event: ToolInvocationEvent = {
      id: row.id,
      runId: input.runId,
      ticketId: input.ticketId,
      stage: input.stage,
      toolType,
      command: safeCommand,
      args: safeArgs,
      cwd: worktreePath,
      policyDecision,
      exitCode: result?.exitCode ?? null,
      durationMs,
      summary,
      errorClass: this.classifyError({ policyDecision, result }),
      approvalId: approvedOverride?.approvalId ?? approval?.id ?? null,
      createdAt: row.createdAt.toISOString(),
    };

    publishEvent("global", "command.tool.invocation", {
      runId: input.runId,
      ticketId: input.ticketId,
      stage: input.stage,
      toolType,
      command: safeCommand,
      args: safeArgs,
      policyDecision,
      exitCode: result?.exitCode ?? null,
      durationMs,
      approvalId: approvedOverride?.approvalId ?? approval?.id ?? null,
      createdAt: event.createdAt,
    });

    return { event, result };
  }

  async listRunToolEvents(runId: string): Promise<ToolInvocationEvent[]> {
    const rows = await prisma.benchmarkOutcomeEvidence.findMany({
      where: {
        runId,
        kind: "tool_invocation",
      },
      orderBy: { createdAt: "asc" },
    });

    return rows
      .map((row) => {
        const payload = (row.payload || {}) as Record<string, unknown>;
        const stage =
          payload.stage === "scope" || payload.stage === "build" || payload.stage === "review" || payload.stage === "escalate"
            ? payload.stage
            : null;
        const toolType =
          payload.toolType === "repo.read" ||
          payload.toolType === "repo.edit" ||
          payload.toolType === "repo.verify" ||
          payload.toolType === "repo.install" ||
          payload.toolType === "git.meta"
            ? payload.toolType
            : null;
        if (!stage || !toolType) return null;
        const errorClass =
          payload.errorClass === "infra_missing_tool" ||
          payload.errorClass === "infra_missing_dependency" ||
          payload.errorClass === "timeout" ||
          payload.errorClass === "command_failed" ||
          payload.errorClass === "none"
            ? payload.errorClass
            : "none";
        const policyDecision =
          payload.policyDecision === "allowed" ||
          payload.policyDecision === "approval_required" ||
          payload.policyDecision === "denied"
            ? payload.policyDecision
            : "denied";
        return {
          id: row.id,
          runId,
          ticketId: typeof payload.ticketId === "string" ? payload.ticketId : "",
          stage,
          toolType,
          command: typeof payload.command === "string" ? payload.command : "",
          args: Array.isArray(payload.args) ? payload.args.filter((item): item is string => typeof item === "string") : [],
          cwd: typeof payload.cwd === "string" ? payload.cwd : "",
          policyDecision,
          exitCode: typeof payload.exitCode === "number" ? payload.exitCode : null,
          durationMs: typeof payload.durationMs === "number" ? payload.durationMs : 0,
          summary: typeof payload.summary === "string" ? payload.summary : "",
          errorClass,
          approvalId:
            (typeof payload.approval_id === "string" && payload.approval_id) ||
            (typeof payload.approvalId === "string" && payload.approvalId) ||
            null,
          createdAt: row.createdAt.toISOString(),
        } satisfies ToolInvocationEvent;
      })
      .filter((item): item is ToolInvocationEvent => Boolean(item));
  }
}
