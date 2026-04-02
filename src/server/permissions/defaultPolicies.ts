import type { PermissionPolicy, PermissionCheckResult } from "./types";
import type { ToolPermission } from "../tools/types";

/**
 * Extract command string from various input formats
 */
function extractCommand(input: unknown): string | null {
  if (typeof input === "string") return input;
  if (typeof input === "object" && input !== null) {
    const obj = input as Record<string, unknown>;
    if (typeof obj.command === "string") return obj.command;
    if (typeof obj.cmd === "string") return obj.cmd;
  }
  return null;
}

/**
 * Auto-approve all tools with readOnly=true
 */
export const autoApproveReadOnly: PermissionPolicy = {
  name: "autoApproveReadOnly",
  priority: 10,
  matches(tool): boolean {
    return tool.permission.readOnly === true;
  },
  evaluate(): PermissionCheckResult {
    return {
      decision: "allow",
      requiresApproval: false,
      reasons: ["Tool is read-only"],
      source: "policy",
    };
  },
};

/**
 * Require approval for destructive tools
 */
export const requireApprovalForDestructive: PermissionPolicy = {
  name: "requireApprovalForDestructive",
  priority: 20,
  matches(tool): boolean {
    return tool.permission.destructive === true;
  },
  evaluate(tool): PermissionCheckResult {
    return {
      decision: "approval_required",
      requiresApproval: true,
      reasons: [`Tool '${tool.name}' is marked as destructive`],
      source: "policy",
    };
  },
};

/**
 * Dangerous commands that should always be denied
 */
const DANGEROUS_PATTERNS = [
  /rm\s+(-rf?|--recursive)\s+(\/|~|\.\.)/i, // rm -rf /, rm -rf ~, etc.
  /git\s+push\s+--force\s+(origin\s+)?main/i, // git push --force origin main
  /git\s+push\s+-f\s+(origin\s+)?main/i, // git push -f origin main
  /DROP\s+TABLE/i, // DROP TABLE
  /DROP\s+DATABASE/i, // DROP DATABASE
  /DELETE\s+FROM\s+\w+\s+(;|$)/i, // DELETE FROM table without WHERE clause
  /TRUNCATE\s+TABLE/i, // TRUNCATE TABLE
  /sudo\s+rm\s+-rf/i, // sudo rm -rf
  />?\s*\/dev\/(null|zero|random)/i, // Overwriting device files
  /mkfs\./i, // Formatting filesystems
  /dd\s+if=/i, // dd commands (can be dangerous)
];

/**
 * Deny dangerous commands that could destroy data
 */
export const denyDangerousCommands: PermissionPolicy = {
  name: "denyDangerousCommands",
  priority: 1, // Highest priority - evaluate first
  matches(tool, input): boolean {
    // Check if this is a bash/shell command
    if (tool.name !== "bash" && tool.name !== "shell" && tool.permission.scope !== "repo.edit") {
      return false;
    }

    // Extract command from input
    const command = extractCommand(input);
    if (!command) return false;

    // Check against dangerous patterns
    return DANGEROUS_PATTERNS.some((pattern) => pattern.test(command));
  },
  evaluate(tool, input): PermissionCheckResult {
    const command = extractCommand(input);
    return {
      decision: "deny",
      requiresApproval: false,
      reasons: [
        `Command contains dangerous pattern: ${command?.substring(0, 100)}`,
        "This command could destroy data and is blocked by policy",
      ],
      source: "policy",
    };
  },
};

/**
 * Package installation patterns
 */
const INSTALL_PATTERNS = [
  /npm\s+(install|i|add)/i,
  /yarn\s+(add|install)/i,
  /pnpm\s+(add|install)/i,
  /pip\s+install/i,
  /cargo\s+install/i,
  /gem\s+install/i,
  /composer\s+install/i,
  /go\s+get/i,
];

/**
 * Require approval for package installation commands
 */
export const requireApprovalForInstall: PermissionPolicy = {
  name: "requireApprovalForInstall",
  priority: 15,
  matches(tool, input): boolean {
    // Check if this is an install scope or a shell command
    if (tool.permission.scope === "repo.install") {
      return true;
    }

    if (tool.name !== "bash" && tool.name !== "shell") {
      return false;
    }

    const command = extractCommand(input);
    if (!command) return false;

    return INSTALL_PATTERNS.some((pattern) => pattern.test(command));
  },
  evaluate(tool, input): PermissionCheckResult {
    const command = extractCommand(input);
    return {
      decision: "approval_required",
      requiresApproval: true,
      reasons: [
        `Package installation requires approval`,
        command ? `Command: ${command.substring(0, 100)}` : "Install command detected",
      ],
      source: "policy",
    };
  },
};

/**
 * Network command patterns
 */
const NETWORK_PATTERNS = [
  /curl\s+/i,
  /wget\s+/i,
  /ssh\s+/i,
  /scp\s+/i,
  /rsync\s+.*::/i,
  /nc\s+/i, // netcat
  /telnet\s+/i,
  /ftp\s+/i,
];

/**
 * Require approval for network commands
 */
export const requireApprovalForNetwork: PermissionPolicy = {
  name: "requireApprovalForNetwork",
  priority: 15,
  matches(tool, input): boolean {
    // Check if this is a network scope
    if (tool.permission.scope === "network") {
      return true;
    }

    if (tool.name !== "bash" && tool.name !== "shell") {
      return false;
    }

    const command = extractCommand(input);
    if (!command) return false;

    return NETWORK_PATTERNS.some((pattern) => pattern.test(command));
  },
  evaluate(tool, input): PermissionCheckResult {
    const command = extractCommand(input);
    return {
      decision: "approval_required",
      requiresApproval: true,
      reasons: [
        `Network command requires approval`,
        command ? `Command: ${command.substring(0, 100)}` : "Network command detected",
      ],
      source: "policy",
    };
  },
};

/**
 * Auto-approve everything when running in test mode
 */
export const autoApproveInTestMode: PermissionPolicy = {
  name: "autoApproveInTestMode",
  priority: 0, // Highest priority - check first
  matches(): boolean {
    return process.env.NODE_ENV === "test" || process.env.VITEST === "true";
  },
  evaluate(): PermissionCheckResult {
    return {
      decision: "allow",
      requiresApproval: false,
      reasons: ["Auto-approved in test mode"],
      source: "policy",
    };
  },
};

/**
 * Git read-only commands that are safe to auto-approve
 */
const GIT_READONLY_COMMANDS = [
  /^git\s+status/i,
  /^git\s+diff/i,
  /^git\s+log/i,
  /^git\s+branch(\s+--list|-l)?$/i,
  /^git\s+show/i,
  /^git\s+rev-parse/i,
  /^git\s+ls-files/i,
  /^git\s+ls-tree/i,
  /^git\s+remote\s+-v/i,
  /^git\s+config\s+--get/i,
];

/**
 * Auto-approve git read-only commands
 */
export const autoApproveGitReadOnly: PermissionPolicy = {
  name: "autoApproveGitReadOnly",
  priority: 5,
  matches(tool, input): boolean {
    // Check if this is a git.meta scope
    if (tool.permission.scope === "git.meta") {
      return true;
    }

    if (tool.name !== "bash" && tool.name !== "shell") {
      return false;
    }

    const command = extractCommand(input);
    if (!command) return false;

    return GIT_READONLY_COMMANDS.some((pattern) => pattern.test(command.trim()));
  },
  evaluate(): PermissionCheckResult {
    return {
      decision: "allow",
      requiresApproval: false,
      reasons: ["Git read-only command is safe to execute"],
      source: "policy",
    };
  },
};

/**
 * All default policies in priority order
 */
export const DEFAULT_POLICIES: PermissionPolicy[] = [
  autoApproveInTestMode, // priority 0
  denyDangerousCommands, // priority 1
  autoApproveGitReadOnly, // priority 5
  autoApproveReadOnly, // priority 10
  requireApprovalForInstall, // priority 15
  requireApprovalForNetwork, // priority 15
  requireApprovalForDestructive, // priority 20
];
