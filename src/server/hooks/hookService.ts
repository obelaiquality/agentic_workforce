import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { prisma } from "../db";
import { createLogger } from "../logger";
import type { HookRecord, HookExecutionLogRecord, HookEventType } from "../../shared/contracts";
import type { HookExecutionInput, HookExecutionOutput } from "./types";

const log = createLogger("Hooks");

const HOOKS_KEY = "agentic.hooks.registry.v1";
const HOOK_LOG_KEY_PREFIX = "agentic.hook.log.";

export interface HookPersistence {
  loadHooks(): Promise<HookRecord[]>;
  saveHooks(hooks: HookRecord[]): Promise<void>;
  saveExecutionLog(log: HookExecutionLogRecord): Promise<void>;
  listExecutionLogs(filter?: { hookId?: string; runId?: string; limit?: number }): Promise<HookExecutionLogRecord[]>;
}

export interface HookExecutionAggregate {
  outputs: Array<{
    hook: HookRecord;
    output: HookExecutionOutput;
  }>;
  systemMessages: string[];
  updatedInput: Record<string, unknown>;
  permissionDecision?: "allow" | "deny" | "approval_required";
  shouldContinue: boolean;
}

export function createPrismaHookPersistence(): HookPersistence {
  return {
    async loadHooks() {
      const row = await prisma.appSetting.findUnique({
        where: { key: HOOKS_KEY },
      });
      return Array.isArray(row?.value)
        ? row!.value.filter((item): item is HookRecord => Boolean(item && typeof item === "object")) as HookRecord[]
        : [];
    },

    async saveHooks(hooks) {
      await prisma.appSetting.upsert({
        where: { key: HOOKS_KEY },
        update: { value: hooks },
        create: { key: HOOKS_KEY, value: hooks },
      });
    },

    async saveExecutionLog(log) {
      await prisma.appSetting.upsert({
        where: { key: `${HOOK_LOG_KEY_PREFIX}${log.id}` },
        update: { value: log },
        create: { key: `${HOOK_LOG_KEY_PREFIX}${log.id}`, value: log },
      });
    },

    async listExecutionLogs(filter) {
      const rows = await prisma.appSetting.findMany({
        where: {
          key: {
            startsWith: HOOK_LOG_KEY_PREFIX,
          },
        },
        orderBy: { updatedAt: "desc" },
        take: filter?.limit && filter.limit > 0 ? filter.limit : 100,
      });

      return rows
        .map((row) => row.value as HookExecutionLogRecord)
        .filter((row) => (!filter?.hookId || row.hookId === filter.hookId) && (!filter?.runId || row.runId === filter.runId));
    },
  };
}

export class HookService {
  private readonly hooks = new Map<string, HookRecord>();
  private executionLog: HookExecutionLogRecord[] = [];
  private readonly maxLogEntries = 500;
  private initialized = false;

  constructor(private readonly persistence?: HookPersistence) {}

  async initialize(): Promise<void> {
    if (this.initialized || !this.persistence) {
      this.initialized = true;
      return;
    }

    const hooks = await this.persistence.loadHooks();
    for (const hook of hooks) {
      this.hooks.set(hook.id, hook);
    }
    this.initialized = true;
  }

  listHooks(filter?: {
    projectId?: string;
    eventType?: HookEventType;
    enabled?: boolean;
  }): HookRecord[] {
    let results = Array.from(this.hooks.values());

    if (filter?.projectId !== undefined) {
      results = results.filter((item) => item.projectId === filter.projectId);
    }
    if (filter?.eventType !== undefined) {
      results = results.filter((item) => item.eventType === filter.eventType);
    }
    if (filter?.enabled !== undefined) {
      results = results.filter((item) => item.enabled === filter.enabled);
    }

    return results.sort((left, right) => left.name.localeCompare(right.name));
  }

  getHook(id: string): HookRecord | null {
    return this.hooks.get(id) || null;
  }

  async createHook(input: Omit<HookRecord, "id" | "createdAt" | "updatedAt">): Promise<HookRecord> {
    const now = new Date().toISOString();
    const hook: HookRecord = {
      id: `hook_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
      createdAt: now,
      updatedAt: now,
      ...input,
    };

    this.hooks.set(hook.id, hook);
    await this.persistHooks();
    return hook;
  }

  async updateHook(
    id: string,
    updates: Partial<Omit<HookRecord, "id" | "createdAt">>,
  ): Promise<HookRecord | null> {
    const existing = this.hooks.get(id);
    if (!existing) {
      return null;
    }

    const updated: HookRecord = {
      ...existing,
      ...updates,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    this.hooks.set(id, updated);
    await this.persistHooks();
    return updated;
  }

  async deleteHook(id: string): Promise<boolean> {
    const deleted = this.hooks.delete(id);
    if (deleted) {
      await this.persistHooks();
    }
    return deleted;
  }

  async executeHook(input: HookExecutionInput): Promise<HookExecutionOutput> {
    return this.executeHookInternal(input, true);
  }

  private async executeHookInternal(input: HookExecutionInput, shouldLog: boolean): Promise<HookExecutionOutput> {
    const hook = this.hooks.get(input.hookId);
    if (!hook) {
      return {
        success: false,
        continue: true,
        error: `Hook not found: ${input.hookId}`,
        durationMs: 0,
      };
    }

    if (!hook.enabled) {
      return {
        success: false,
        continue: true,
        error: `Hook is disabled: ${hook.name}`,
        durationMs: 0,
      };
    }

    const startedAt = Date.now();
    let output: HookExecutionOutput;

    try {
      switch (hook.hookType) {
        case "Command":
          output = this.executeCommandHook(hook, input);
          break;
        case "Prompt":
          output = await this.executePromptHook(hook, input);
          break;
        case "Agent":
          output = await this.executeAgentHook(hook, input);
          break;
        default:
          output = {
            success: false,
            continue: true,
            error: `Unknown hook type: ${hook.hookType}`,
            durationMs: 0,
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output = {
        success: false,
        continue: hook.continueOnError,
        error: `Hook execution failed: ${message}`,
        durationMs: Date.now() - startedAt,
      };
    }

    output.durationMs = Date.now() - startedAt;
    if (shouldLog) {
      await this.logExecution(hook, input, output);
    }
    return output;
  }

  async executeHooksForEvent(input: {
    eventType: HookEventType;
    eventPayload: Record<string, unknown>;
    context: HookExecutionInput["context"];
  }): Promise<HookExecutionAggregate> {
    const hooks = this.getHooksForEvent(input.eventType, input.context.projectId);
    let updatedInput = { ...input.eventPayload };
    const outputs: HookExecutionAggregate["outputs"] = [];
    const systemMessages: string[] = [];
    let permissionDecision: HookExecutionAggregate["permissionDecision"];
    let shouldContinue = true;

    for (const hook of hooks) {
      const output = await this.executeHook({
        hookId: hook.id,
        eventType: input.eventType,
        eventPayload: updatedInput,
        context: input.context,
      });
      outputs.push({ hook, output });

      if (output.systemMessage) {
        systemMessages.push(output.systemMessage);
      }
      if (output.updatedInput) {
        updatedInput = { ...updatedInput, ...output.updatedInput };
      }
      if (output.permissionDecision === "deny") {
        permissionDecision = "deny";
      } else if (output.permissionDecision === "approval_required" && permissionDecision !== "deny") {
        permissionDecision = "approval_required";
      } else if (!permissionDecision && output.permissionDecision === "allow") {
        permissionDecision = "allow";
      }
      if (!output.continue) {
        shouldContinue = false;
        break;
      }
    }

    return {
      outputs,
      systemMessages,
      updatedInput,
      permissionDecision,
      shouldContinue,
    };
  }

  async testHook(
    hookId: string,
    testPayload: Record<string, unknown>,
  ): Promise<HookExecutionOutput> {
    const hook = this.hooks.get(hookId);
    if (!hook) {
      return {
        success: false,
        continue: true,
        error: `Hook not found: ${hookId}`,
        durationMs: 0,
      };
    }

    const startedAt = Date.now();
    const result = await this.executeHookInternal({
      hookId,
      eventType: hook.eventType,
      eventPayload: testPayload,
      context: {
        runId: "test-run",
        projectId: hook.projectId || "test-project",
        ticketId: "test-ticket",
        stage: "test",
      },
    }, false);

    return {
      ...result,
      durationMs: Date.now() - startedAt,
    };
  }

  getHooksForEvent(eventType: HookEventType, projectId?: string): HookRecord[] {
    return this.listHooks({
      eventType,
      enabled: true,
    }).filter((hook) => hook.projectId === null || hook.projectId === projectId);
  }

  async getExecutionLog(filter?: {
    hookId?: string;
    runId?: string;
    limit?: number;
  }): Promise<HookExecutionLogRecord[]> {
    if (!this.persistence) {
      let items = [...this.executionLog];
      if (filter?.hookId) {
        items = items.filter((item) => item.hookId === filter.hookId);
      }
      if (filter?.runId) {
        items = items.filter((item) => item.runId === filter.runId);
      }
      items.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
      return filter?.limit ? items.slice(0, filter.limit) : items;
    }

    const items = await this.persistence.listExecutionLogs(filter);
    this.executionLog = items.slice(0, this.maxLogEntries);
    return items;
  }

  private executeCommandHook(hook: HookRecord, input: HookExecutionInput): HookExecutionOutput {
    if (!hook.command) {
      return {
        success: false,
        continue: false,
        error: "Command hook has no command defined",
        durationMs: 0,
      };
    }

    const stdinPayload = JSON.stringify({
      hook_id: hook.id,
      event_type: input.eventType,
      ...input.eventPayload,
      context: input.context,
    });

    try {
      const stdout = execSync(hook.command, {
        input: stdinPayload,
        encoding: "utf-8",
        timeout: hook.timeoutMs,
        maxBuffer: 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
      });

      try {
        const result = JSON.parse(stdout.trim()) as Partial<HookExecutionOutput> & { updatedInput?: Record<string, unknown> };
        return {
          success: true,
          continue: result.continue !== false,
          systemMessage: typeof result.systemMessage === "string" ? result.systemMessage : undefined,
          permissionDecision: result.permissionDecision,
          updatedInput: result.updatedInput,
          durationMs: 0,
        };
      } catch {
        return {
          success: true,
          continue: true,
          systemMessage: stdout.trim() || undefined,
          durationMs: 0,
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        continue: hook.continueOnError,
        error: `Command hook failed: ${message}`,
        durationMs: 0,
      };
    }
  }

  private async executePromptHook(hook: HookRecord, input: HookExecutionInput): Promise<HookExecutionOutput> {
    if (!hook.promptTemplate) {
      return {
        success: false,
        continue: false,
        error: "Prompt hook has no prompt template defined",
        durationMs: 0,
      };
    }

    const rendered = hook.promptTemplate
      .replace(/\{\{tool_name\}\}/g, String(input.eventPayload.tool_name || ""))
      .replace(/\{\{params\}\}/g, JSON.stringify(input.eventPayload.params || {}));

    // If hook has a command, execute it with the prompt as stdin
    if (hook.command) {
      try {
        const stdout = execSync(hook.command, {
          input: rendered,
          encoding: "utf-8",
          timeout: hook.timeoutMs,
          maxBuffer: 1024 * 1024,
          stdio: ["pipe", "pipe", "pipe"],
        });

        return {
          success: true,
          continue: true,
          systemMessage: `[Hook Prompt: ${hook.name}] ${stdout.trim()}`,
          durationMs: 0,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (hook.continueOnError) {
          log.warn(`Prompt hook command failed, falling back to template: ${message}`);
          return {
            success: true,
            continue: true,
            systemMessage: `[Hook Prompt: ${hook.name}] ${rendered}`,
            durationMs: 0,
          };
        }
        return {
          success: false,
          continue: hook.continueOnError,
          error: `Prompt hook command failed: ${message}`,
          durationMs: 0,
        };
      }
    }

    // Fall back to template rendering if no command
    return {
      success: true,
      continue: true,
      systemMessage: `[Hook Prompt: ${hook.name}] ${rendered}`,
      durationMs: 0,
    };
  }

  private async executeAgentHook(hook: HookRecord, input: HookExecutionInput): Promise<HookExecutionOutput> {
    if (!hook.agentObjective && !hook.command) {
      return {
        success: false,
        continue: false,
        error: "Agent hook has no agent objective or command defined",
        durationMs: 0,
      };
    }

    // Handle tool lifecycle events
    if (input.eventType === "tool_before" || input.eventType === "tool_after") {
      if (!hook.command) {
        return {
          success: false,
          continue: false,
          error: `Agent hook for ${input.eventType} requires a command`,
          durationMs: 0,
        };
      }

      const stdinPayload = JSON.stringify({
        hook_id: hook.id,
        event_type: input.eventType,
        tool_name: input.eventPayload.tool_name || input.eventPayload.toolName,
        input: input.eventPayload.input,
        result: input.eventPayload.result,
        context: input.context,
      });

      try {
        const stdout = execSync(hook.command, {
          input: stdinPayload,
          encoding: "utf-8",
          timeout: hook.timeoutMs,
          maxBuffer: 1024 * 1024,
          stdio: ["pipe", "pipe", "pipe"],
        });

        try {
          const result = JSON.parse(stdout.trim()) as {
            allow?: boolean;
            reason?: string;
            input?: Record<string, unknown>;
            systemMessage?: string;
            continue?: boolean;
          };

          // tool_before can block or modify input
          if (input.eventType === "tool_before") {
            if (result.allow === false) {
              return {
                success: true,
                continue: false,
                blocked: true,
                blockReason: result.reason || "Hook blocked execution",
                systemMessage: result.systemMessage,
                durationMs: 0,
              };
            }
            if (result.input) {
              return {
                success: true,
                continue: result.continue !== false,
                updatedInput: result.input,
                systemMessage: result.systemMessage,
                durationMs: 0,
              };
            }
          }

          // tool_after is informational
          return {
            success: true,
            continue: result.continue !== false,
            systemMessage: result.systemMessage || stdout.trim(),
            durationMs: 0,
          };
        } catch {
          // Non-JSON output, treat as system message
          return {
            success: true,
            continue: true,
            systemMessage: stdout.trim() || undefined,
            durationMs: 0,
          };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          continue: hook.continueOnError,
          error: `Agent hook command failed: ${message}`,
          durationMs: 0,
        };
      }
    }

    // Handle run lifecycle events
    if (input.eventType === "run_start" || input.eventType === "run_end") {
      if (hook.command) {
        const stdinPayload = JSON.stringify({
          hook_id: hook.id,
          event_type: input.eventType,
          ...input.eventPayload,
          context: input.context,
        });

        try {
          const stdout = execSync(hook.command, {
            input: stdinPayload,
            encoding: "utf-8",
            timeout: hook.timeoutMs,
            maxBuffer: 1024 * 1024,
            stdio: ["pipe", "pipe", "pipe"],
          });

          return {
            success: true,
            continue: true,
            systemMessage: `[Hook Agent: ${hook.name}] ${stdout.trim()}`,
            durationMs: 0,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            success: false,
            continue: hook.continueOnError,
            error: `Agent hook command failed: ${message}`,
            durationMs: 0,
          };
        }
      }
    }

    // Handle command lifecycle events
    if (input.eventType === "command_before" || input.eventType === "command_after") {
      if (hook.command) {
        const stdinPayload = JSON.stringify({
          hook_id: hook.id,
          event_type: input.eventType,
          ...input.eventPayload,
          context: input.context,
        });

        try {
          const stdout = execSync(hook.command, {
            input: stdinPayload,
            encoding: "utf-8",
            timeout: hook.timeoutMs,
            maxBuffer: 1024 * 1024,
            stdio: ["pipe", "pipe", "pipe"],
          });

          return {
            success: true,
            continue: true,
            systemMessage: `[Hook Agent: ${hook.name}] ${stdout.trim()}`,
            durationMs: 0,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            success: false,
            continue: hook.continueOnError,
            error: `Agent hook command failed: ${message}`,
            durationMs: 0,
          };
        }
      }
    }

    // Default behavior for other event types
    return {
      success: true,
      continue: true,
      systemMessage: `[Hook Agent: ${hook.name}] Agent objective: ${hook.agentObjective}`,
      durationMs: 0,
    };
  }

  private async logExecution(
    hook: HookRecord,
    input: HookExecutionInput,
    output: HookExecutionOutput,
  ): Promise<void> {
    const record: HookExecutionLogRecord = {
      id: `hlog_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
      hookId: hook.id,
      hookName: hook.name,
      runId: input.context.runId,
      eventType: input.eventType,
      success: output.success,
      output: output.systemMessage || null,
      error: output.error || null,
      durationMs: output.durationMs,
      createdAt: new Date().toISOString(),
    };

    this.executionLog.push(record);
    if (this.executionLog.length > this.maxLogEntries) {
      this.executionLog = this.executionLog.slice(-this.maxLogEntries);
    }
    await this.persistence?.saveExecutionLog(record);
  }

  private async persistHooks(): Promise<void> {
    if (!this.persistence) {
      return;
    }
    await this.persistence.saveHooks(Array.from(this.hooks.values()));
  }
}
