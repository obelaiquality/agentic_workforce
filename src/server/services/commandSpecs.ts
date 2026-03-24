import type { ToolInvocationEvent } from "../../shared/contracts";

export type ToolType = ToolInvocationEvent["toolType"];

export type SafeCommandSpec =
  | {
      kind: "package_manager";
      manager: "npm" | "pnpm" | "yarn" | "bun";
      args: string[];
    }
  | {
      kind: "cargo";
      args: string[];
    }
  | {
      kind: "pytest";
      binary: "pytest" | "python" | "python3";
      args: string[];
    }
  | {
      kind: "git_readonly";
      args: string[];
    }
  | {
      kind: "repo_inspect";
      binary: "cat" | "find" | "grep" | "ls" | "rg";
      args: string[];
    };

export type CommandPlan =
  | {
      kind: "safe";
      spec: SafeCommandSpec;
      displayCommand: string;
      binary: string;
      args: string[];
    }
  | {
      kind: "shell_approved";
      shellCommand: string;
      displayCommand: string;
      binary: string;
      args: string[];
    };

type StructuredCommand = {
  binary: string;
  args: string[];
  displayCommand: string;
};

const SHELL_METACHARACTER_PATTERN = /[;&|><`$]/;
const SAFE_BINARY_PATTERN = /^[A-Za-z0-9._:@/+~-]+$/;
const SAFE_ARGUMENT_PATTERN = /^[^\n\r]+$/;
const READONLY_GIT_SUBCOMMANDS = new Set(["branch", "diff", "log", "ls-files", "rev-parse", "show", "status"]);

const TOOL_TYPE_BINARY_ALLOWLIST: Record<ToolType, string[]> = {
  "repo.read": ["cat", "find", "git", "grep", "ls", "rg"],
  "repo.edit": ["git"],
  "repo.verify": ["bun", "cargo", "git", "npm", "pnpm", "pytest", "python", "python3", "yarn"],
  "repo.install": ["bun", "npm", "pnpm", "yarn"],
  "git.meta": ["git"],
};

export const DESTRUCTIVE_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-fdx\b/i,
  /\bmv\b.*\.\./i,
];

export const NETWORK_PATTERNS = [
  /\bcurl\b/i,
  /\bwget\b/i,
  /\bnpm\s+view\b/i,
  /\bnpm\s+publish\b/i,
  /\bpnpm\s+publish\b/i,
  /\byarn\s+npm\s+publish\b/i,
  /\bgit\s+clone\b/i,
];

export const INSTALL_PATTERNS = [
  /\bnpm\s+install\b/i,
  /\bpnpm\s+install\b/i,
  /\byarn\s+install\b/i,
  /\bbun\s+install\b/i,
];

export function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;

  for (const char of command) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (escaping || quote) {
    throw new Error("Command contains an unterminated escape or quote.");
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}

export function normalizeCommandInput(command: string, args?: string[]): StructuredCommand {
  const providedArgs = Array.isArray(args) ? args : [];
  const trimmedCommand = command.trim();
  if (!trimmedCommand) {
    throw new Error("Command is empty.");
  }
  const baseTokens = providedArgs.length === 0 ? tokenizeCommand(trimmedCommand) : [trimmedCommand, ...providedArgs];
  if (baseTokens.length === 0) {
    throw new Error("Command is empty.");
  }

  const [binary, ...normalizedArgs] = baseTokens;
  if (!SAFE_BINARY_PATTERN.test(binary)) {
    throw new Error(`Command binary is not allowed: ${binary}`);
  }

  for (const value of normalizedArgs) {
    if (!SAFE_ARGUMENT_PATTERN.test(value)) {
      throw new Error(`Command argument is not allowed: ${value}`);
    }
  }

  return {
    binary,
    args: normalizedArgs,
    displayCommand: [binary, ...normalizedArgs].join(" ").trim(),
  };
}

function tryBuildSafeSpec(command: StructuredCommand): SafeCommandSpec | null {
  const { binary, args } = command;

  if (binary === "npm" || binary === "pnpm" || binary === "yarn" || binary === "bun") {
    return {
      kind: "package_manager",
      manager: binary,
      args,
    };
  }

  if (binary === "cargo") {
    return {
      kind: "cargo",
      args,
    };
  }

  if (binary === "pytest") {
    return {
      kind: "pytest",
      binary: "pytest",
      args,
    };
  }

  if ((binary === "python" || binary === "python3") && args[0] === "-m" && args[1] === "pytest") {
    return {
      kind: "pytest",
      binary,
      args,
    };
  }

  if (binary === "git" && args[0] && READONLY_GIT_SUBCOMMANDS.has(args[0])) {
    return {
      kind: "git_readonly",
      args,
    };
  }

  if (binary === "cat" || binary === "find" || binary === "grep" || binary === "ls" || binary === "rg") {
    return {
      kind: "repo_inspect",
      binary,
      args,
    };
  }

  return null;
}

export function buildCommandPlan(command: string, args?: string[]): CommandPlan {
  const normalized = normalizeCommandInput(command, args);
  const hasShellMetacharacters =
    SHELL_METACHARACTER_PATTERN.test(command) || normalized.args.some((value) => SHELL_METACHARACTER_PATTERN.test(value));
  const safeSpec = hasShellMetacharacters ? null : tryBuildSafeSpec(normalized);

  if (safeSpec) {
    return {
      kind: "safe",
      spec: safeSpec,
      displayCommand: normalized.displayCommand,
      binary: normalized.binary,
      args: normalized.args,
    };
  }

  return {
    kind: "shell_approved",
    shellCommand: normalized.displayCommand,
    displayCommand: normalized.displayCommand,
    binary: normalized.binary,
    args: normalized.args,
  };
}

export function commandPlanToRecord(plan: CommandPlan) {
  if (plan.kind === "safe") {
    return {
      kind: "safe",
      displayCommand: plan.displayCommand,
      binary: plan.binary,
      args: plan.args,
      spec: plan.spec,
    };
  }
  return {
    kind: "shell_approved",
    displayCommand: plan.displayCommand,
    binary: plan.binary,
    args: plan.args,
    shellCommand: plan.shellCommand,
  };
}

export function commandPlanFromRecord(value: unknown): CommandPlan | null {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  if (!record || typeof record.displayCommand !== "string" || typeof record.binary !== "string" || !Array.isArray(record.args)) {
    return null;
  }
  const args = record.args.filter((item): item is string => typeof item === "string");
  if (record.kind === "safe" && record.spec && typeof record.spec === "object" && !Array.isArray(record.spec)) {
    return {
      kind: "safe",
      displayCommand: record.displayCommand,
      binary: record.binary,
      args,
      spec: record.spec as SafeCommandSpec,
    };
  }
  if (record.kind === "shell_approved" && typeof record.shellCommand === "string") {
    return {
      kind: "shell_approved",
      displayCommand: record.displayCommand,
      binary: record.binary,
      args,
      shellCommand: record.shellCommand,
    };
  }
  return null;
}

export function isCommandAllowedForToolType(toolType: ToolType, binary: string) {
  return TOOL_TYPE_BINARY_ALLOWLIST[toolType].includes(binary);
}

export function classifyCommandFlags(displayCommand: string) {
  return {
    install: INSTALL_PATTERNS.some((pattern) => pattern.test(displayCommand)),
    network: NETWORK_PATTERNS.some((pattern) => pattern.test(displayCommand)),
    destructive: DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(displayCommand)),
  };
}

export function spawnArgsForSafeSpec(spec: SafeCommandSpec) {
  switch (spec.kind) {
    case "package_manager":
      return {
        binary: spec.manager,
        args: spec.args,
      };
    case "cargo":
      return {
        binary: "cargo",
        args: spec.args,
      };
    case "pytest":
      return {
        binary: spec.binary,
        args: spec.args,
      };
    case "git_readonly":
      return {
        binary: "git",
        args: spec.args,
      };
    case "repo_inspect":
      return {
        binary: spec.binary,
        args: spec.args,
      };
  }
}
