import path from "node:path";
import { prisma } from "../db";

export interface QwenCliConfig {
  command: string;
  args: string[];
  timeoutMs: number;
}

export const DEFAULT_QWEN_CLI_ARGS = ["--auth-type", "qwen-oauth", "--output-format", "text"];

export function normalizeQwenCliArgs(args: string[]) {
  const filtered = args.filter(Boolean);
  if (!filtered.length) {
    return [...DEFAULT_QWEN_CLI_ARGS];
  }

  const joined = filtered.join(" ").trim();
  if (joined === "chat --prompt" || filtered[0] === "chat") {
    return [...DEFAULT_QWEN_CLI_ARGS];
  }

  return filtered;
}

export function resolveQwenProfileHome(profilePath: string) {
  const resolved = path.resolve(profilePath);
  return path.basename(resolved) === ".qwen" ? path.dirname(resolved) : resolved;
}

export async function getQwenCliConfig(): Promise<QwenCliConfig> {
  const setting = await prisma.appSetting.findUnique({ where: { key: "qwen_cli_config" } });
  const envCommand = process.env.QWEN_COMMAND || "qwen";
  const envArgs = normalizeQwenCliArgs((process.env.QWEN_ARGS || DEFAULT_QWEN_CLI_ARGS.join(" ")).split(" ").filter(Boolean));

  if (!setting || typeof setting.value !== "object" || !setting.value) {
    return {
      command: envCommand,
      args: envArgs,
      timeoutMs: 120000,
    };
  }

  const value = setting.value as Record<string, unknown>;
  const command = typeof value.command === "string" && value.command.trim() ? value.command : envCommand;
  const args = normalizeQwenCliArgs(Array.isArray(value.args) ? value.args.filter((x): x is string => typeof x === "string") : envArgs);
  const timeoutMs = typeof value.timeoutMs === "number" ? Math.max(5000, value.timeoutMs) : 120000;

  return { command, args, timeoutMs };
}
