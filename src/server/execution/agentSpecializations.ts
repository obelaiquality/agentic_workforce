import type { ModelRole } from "../../shared/contracts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentSpecialization {
  name: string;
  description: string;
  systemPromptPrefix: string;
  preferredTools: string[];
  modelRole: ModelRole;
  maxIterations: number;
}

// ---------------------------------------------------------------------------
// Built-in Specializations
// ---------------------------------------------------------------------------

/**
 * Pre-defined agent specializations for common software development roles.
 *
 * Each specialization defines a system prompt prefix, preferred tool set,
 * model role, and iteration budget appropriate for the role.
 */
export const BUILT_IN_SPECIALIZATIONS: Record<string, AgentSpecialization> = {
  planner: {
    name: "planner",
    description: "Plans task decomposition and creates implementation strategies by analyzing the codebase and requirements.",
    systemPromptPrefix:
      "You are a planning agent. Your role is to analyze the codebase, understand requirements, and create detailed implementation plans. " +
      "You do NOT write code — you read, explore, and produce structured plans for other agents to execute. " +
      "Focus on identifying file dependencies, potential risks, and the optimal order of changes.",
    preferredTools: ["read_file", "search_files", "list_directory", "grep_search", "codebase_search"],
    modelRole: "utility_fast",
    maxIterations: 10,
  },

  implementer: {
    name: "implementer",
    description: "Writes production code, creates new features, and modifies existing functionality.",
    systemPromptPrefix:
      "You are an implementation agent. Your role is to write high-quality production code that follows the project's conventions and passes all tests. " +
      "You have full access to file creation, editing, and shell commands. " +
      "Write clean, well-documented code and ensure your changes integrate properly with the existing codebase.",
    preferredTools: [
      "read_file", "write_file", "edit_file", "search_files", "list_directory",
      "grep_search", "bash", "codebase_search",
    ],
    modelRole: "coder_default",
    maxIterations: 30,
  },

  tester: {
    name: "tester",
    description: "Writes and runs tests to verify code correctness and quality.",
    systemPromptPrefix:
      "You are a testing agent. Your role is to write comprehensive tests and run verification commands to ensure code quality. " +
      "Write unit tests, integration tests, and run existing test suites. " +
      "Focus on edge cases, error paths, and ensuring acceptance criteria are met.",
    preferredTools: [
      "read_file", "write_file", "edit_file", "search_files", "list_directory",
      "grep_search", "bash", "codebase_search",
    ],
    modelRole: "coder_default",
    maxIterations: 20,
  },

  reviewer: {
    name: "reviewer",
    description: "Reviews code changes for quality, correctness, and adherence to project standards.",
    systemPromptPrefix:
      "You are a code review agent. Your role is to review code changes, identify issues, and suggest improvements. " +
      "Check for bugs, security issues, performance problems, and style violations. " +
      "You can read files and inspect git history but should not make direct edits.",
    preferredTools: ["read_file", "search_files", "list_directory", "grep_search", "bash", "git_diff", "git_log"],
    modelRole: "review_deep",
    maxIterations: 15,
  },

  debugger: {
    name: "debugger",
    description: "Diagnoses failures, traces bugs, and identifies root causes.",
    systemPromptPrefix:
      "You are a debugging agent. Your role is to diagnose failures, trace bugs, and identify root causes. " +
      "Use shell commands to run tests, inspect logs, and reproduce issues. " +
      "Read relevant source files to understand control flow and pinpoint the exact cause of failures.",
    preferredTools: [
      "read_file", "search_files", "list_directory", "grep_search", "bash",
      "codebase_search",
    ],
    modelRole: "review_deep",
    maxIterations: 25,
  },

  refactorer: {
    name: "refactorer",
    description: "Cleans up code, improves structure, and reduces technical debt.",
    systemPromptPrefix:
      "You are a refactoring agent. Your role is to improve code quality by restructuring, simplifying, and cleaning up existing code. " +
      "Extract common patterns, reduce duplication, improve naming, and ensure changes preserve existing behavior. " +
      "Run tests after every refactoring step to verify nothing is broken.",
    preferredTools: [
      "read_file", "write_file", "edit_file", "search_files", "list_directory",
      "grep_search", "bash", "codebase_search",
    ],
    modelRole: "coder_default",
    maxIterations: 20,
  },

  documenter: {
    name: "documenter",
    description: "Generates and updates documentation, comments, and developer guides.",
    systemPromptPrefix:
      "You are a documentation agent. Your role is to generate and update documentation, code comments, and developer guides. " +
      "Write clear, accurate documentation that helps other developers understand the codebase. " +
      "Focus on API docs, README files, inline comments, and architecture documentation.",
    preferredTools: ["read_file", "write_file", "edit_file", "search_files", "list_directory", "grep_search"],
    modelRole: "utility_fast",
    maxIterations: 15,
  },
};
