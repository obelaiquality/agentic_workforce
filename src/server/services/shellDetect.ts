import { execSync } from "node:child_process";

let cachedShell: string | null = null;

export function detectShell(): string {
  if (cachedShell) return cachedShell;

  if (process.platform === "win32") {
    cachedShell = "cmd.exe";
    return cachedShell;
  }

  if (process.env.SHELL) {
    cachedShell = process.env.SHELL;
    return cachedShell;
  }

  try {
    execSync("which bash", { stdio: "ignore" });
    cachedShell = "/bin/bash";
    return cachedShell;
  } catch {
    // bash not found
  }

  cachedShell = "/bin/sh";
  return cachedShell;
}
