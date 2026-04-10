/**
 * Execution subsystem exports
 *
 * Provides agentic orchestration, tool execution, budget tracking,
 * context management, task scheduling, and inter-agent communication.
 */

export type {
  BudgetLimits,
  BudgetConsumed,
  BudgetResource,
  BudgetStatus,
} from "./budgetTracker";

export { TaskBudgetTracker } from "./budgetTracker";

// ---------------------------------------------------------------------------
// Orchestration — Task Graph, Scheduler, Messaging, Specializations
// ---------------------------------------------------------------------------

export type { TaskNode } from "./taskGraph";
export { TaskGraph } from "./taskGraph";

export type { SchedulerConfig } from "./taskScheduler";
export { TaskScheduler } from "./taskScheduler";

export type { MessageType, AgentMessage } from "./agentMessageBus";
export { AgentMessageBus } from "./agentMessageBus";

export type { AgentSpecialization } from "./agentSpecializations";
export { BUILT_IN_SPECIALIZATIONS } from "./agentSpecializations";
