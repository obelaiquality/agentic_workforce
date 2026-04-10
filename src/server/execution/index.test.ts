import { describe, it, expect } from "vitest";
import * as ExecutionExports from "./index";

describe("execution barrel exports", () => {
  it("exports TaskBudgetTracker", () => {
    expect(ExecutionExports.TaskBudgetTracker).toBeDefined();
    expect(typeof ExecutionExports.TaskBudgetTracker).toBe("function");
  });

  it("exports TaskGraph", () => {
    expect(ExecutionExports.TaskGraph).toBeDefined();
    expect(typeof ExecutionExports.TaskGraph).toBe("function");
  });

  it("exports TaskScheduler", () => {
    expect(ExecutionExports.TaskScheduler).toBeDefined();
    expect(typeof ExecutionExports.TaskScheduler).toBe("function");
  });

  it("exports AgentMessageBus", () => {
    expect(ExecutionExports.AgentMessageBus).toBeDefined();
    expect(typeof ExecutionExports.AgentMessageBus).toBe("function");
  });

  it("exports BUILT_IN_SPECIALIZATIONS", () => {
    expect(ExecutionExports.BUILT_IN_SPECIALIZATIONS).toBeDefined();
    expect(typeof ExecutionExports.BUILT_IN_SPECIALIZATIONS).toBe("object");
  });
});
