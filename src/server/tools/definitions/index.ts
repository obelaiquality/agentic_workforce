import type { ToolDefinition } from "../types";

// Import all tool definitions
import { readFile, editFile, writeFile, listFiles, grepSearch, globSearch, fuzzyFileSearch } from "./fileOps";
import { bash } from "./bash";
import { gitStatus, gitDiff, gitCommit } from "./git";
import { runTests, runLint } from "./verification";
import { rollbackFile, askUser, completeTask } from "./meta";
import { lspTools } from "./lsp";
import { teamTools } from "./team";
import { skillTool } from "./skill";
import { planModeTools } from "./planMode";
import { taskDecompositionTools } from "./taskDecomposition";
import { taskClaimTools } from "./taskClaims";
import { webFetch, webSearch } from "./web";

// Re-export createToolSearchTool (needs registry, created on-demand)
export { createToolSearchTool } from "./toolSearch";

/**
 * Get all core tool definitions (19 base tools + 4 LSP tools + 3 team tools + 2 plan mode tools + 3 task decomposition tools + 2 task claim tools = 33 tools total).
 *
 * Tools are organized by category:
 * - File Operations (7): read_file, edit_file, write_file, list_files, grep_search, glob_search, fuzzy_file_search
 * - Shell (1): bash
 * - Git (3): git_status, git_diff, git_commit
 * - Verification (2): run_tests, run_lint
 * - Web (2): web_fetch, web_search
 * - Meta (4): rollback_file, ask_user, complete_task, skill
 * - LSP (4): lsp_diagnostics, lsp_definition, lsp_references, lsp_symbols
 * - Team (3): send_message, list_peers, spawn_agent
 * - Plan Mode (2): submit_plan, ask_plan_question
 * - Task Decomposition (3): create_subtask, update_subtask, list_subtasks
 * - Task Claims (2): claim_subtask, release_subtask
 */
export function getAllCoreTools(): ToolDefinition[] {
  return [
    // File operations (7)
    readFile,
    editFile,
    writeFile,
    listFiles,
    grepSearch,
    globSearch,
    fuzzyFileSearch,

    // Shell execution (1)
    bash,

    // Git operations (3)
    gitStatus,
    gitDiff,
    gitCommit,

    // Verification (2)
    runTests,
    runLint,

    // Web tools (2) - deferred
    webFetch,
    webSearch,

    // Meta tools (4)
    rollbackFile,
    askUser,
    completeTask,
    skillTool,

    // LSP tools (4) - deferred
    ...lspTools,

    // Team tools (3) - deferred
    ...teamTools,

    // Plan mode tools (2) - deferred
    ...planModeTools,

    // Task decomposition tools (3) - always loaded
    ...taskDecompositionTools,

    // Task claim tools (2) - always loaded
    ...taskClaimTools,
  ];
}

/**
 * Get names of all core tools.
 */
export function getCoreToolNames(): string[] {
  return getAllCoreTools().map((tool) => tool.name);
}

/**
 * Get tools that should be loaded initially (not deferred).
 */
export function getInitialCoreTools(): ToolDefinition[] {
  return getAllCoreTools().filter((tool) => tool.alwaysLoad !== false);
}

/**
 * Get tools that are deferred (loaded on demand).
 */
export function getDeferredCoreTools(): ToolDefinition[] {
  return getAllCoreTools().filter((tool) => tool.alwaysLoad === false);
}

/**
 * Get tools by category.
 */
export function getCoreToolsByCategory() {
  return {
    fileOps: [readFile, editFile, writeFile, listFiles, grepSearch, globSearch, fuzzyFileSearch],
    shell: [bash],
    git: [gitStatus, gitDiff, gitCommit],
    verification: [runTests, runLint],
    web: [webFetch, webSearch],
    meta: [rollbackFile, askUser, completeTask, skillTool],
    lsp: lspTools,
    team: teamTools,
    planMode: planModeTools,
    taskDecomposition: taskDecompositionTools,
    taskClaims: taskClaimTools,
  };
}

// Re-export individual tools for convenience
export {
  // File ops
  readFile,
  editFile,
  writeFile,
  listFiles,
  grepSearch,
  globSearch,
  fuzzyFileSearch,

  // Shell
  bash,

  // Git
  gitStatus,
  gitDiff,
  gitCommit,

  // Verification
  runTests,
  runLint,

  // Meta
  rollbackFile,
  askUser,
  completeTask,
  skillTool,

  // LSP
  lspTools,

  // Web
  webFetch,
  webSearch,

  // Team
  teamTools,

  // Plan Mode
  planModeTools,

  // Task Decomposition
  taskDecompositionTools,

  // Task Claims
  taskClaimTools,
};
