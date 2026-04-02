import type { ProviderOrchestrator } from "../services/providerOrchestrator";

/**
 * Auto-mode safety classifier for shell commands.
 * Uses a fast LLM to classify commands, with regex fallback.
 */
export class SafetyClassifier {
  private providerOrchestrator?: ProviderOrchestrator;
  private timeoutMs: number;

  constructor(opts?: { providerOrchestrator?: ProviderOrchestrator; timeoutMs?: number }) {
    this.providerOrchestrator = opts?.providerOrchestrator;
    this.timeoutMs = opts?.timeoutMs ?? 2000;
  }

  /**
   * Classify a shell command for safety in auto-mode.
   * Returns 'safe', 'risky', or 'dangerous'.
   */
  async classifyCommand(command: string): Promise<"safe" | "risky" | "dangerous"> {
    // First try static classification (instant)
    const staticResult = this.classifyStatic(command);
    if (staticResult === "dangerous") {
      return "dangerous"; // Static dangerous = always dangerous
    }

    // If we have a provider, try LLM classification for non-obvious cases
    if (this.providerOrchestrator && staticResult !== "safe") {
      try {
        return await this.classifyWithLLM(command);
      } catch {
        // LLM failed — fall back to static
        return staticResult;
      }
    }

    return staticResult;
  }

  /**
   * Static regex-based classification (instant, no LLM needed).
   */
  classifyStatic(command: string): "safe" | "risky" | "dangerous" {
    const cmd = command.trim().toLowerCase();

    // Dangerous patterns — always block
    const dangerous = [
      /rm\s+(-[rf]+\s+)?\/($|\s)/,
      /rm\s+(-[rf]+\s+)?\S*\*/,
      /:\(\)\{.*\|.*&\s*\}/,
      /git\s+push\s+.*--force/,
      /git\s+reset\s+--hard/,
      /dd\s+if=/,
      /mkfs\./,
      />\s*\/dev\/sd/,
      /DROP\s+(TABLE|DATABASE)/i,
      /DELETE\s+FROM\s+\w+\s*;/i,
      /TRUNCATE\s+TABLE/i,
      /sudo\s+rm\s+-rf/,
    ];
    if (dangerous.some((p) => p.test(command))) return "dangerous";

    // Safe patterns — read-only operations
    const safe = [
      /^(ls|cat|head|tail|wc|file|stat|du|df)\b/,
      /^git\s+(status|diff|log|show|branch(\s+--list)?|rev-parse|ls-files)\b/,
      /^(echo|printf|date|whoami|pwd|hostname|uname)\b/,
      /^(grep|rg|find|fd|ag)\b/,
      /^(node|python|ruby|go)\s+--version/,
      /^npx\s+(tsc|vitest|jest|eslint|prettier)\b/,
      /^npm\s+(test|run\s+test|run\s+lint|run\s+build)\b/,
    ];
    if (safe.some((p) => p.test(cmd))) return "safe";

    // Everything else is risky (needs approval in auto mode)
    return "risky";
  }

  /**
   * LLM-based classification with timeout.
   */
  private async classifyWithLLM(command: string): Promise<"safe" | "risky" | "dangerous"> {
    if (!this.providerOrchestrator) return "risky";

    const prompt = `Classify this shell command for safety. Reply with EXACTLY one word: SAFE, RISKY, or DANGEROUS.

SAFE = read-only, no side effects (ls, cat, git status, npm test, etc.)
RISKY = has side effects but reversible (git commit, npm install, file writes in project dir)
DANGEROUS = destructive, irreversible, or affects system (rm -rf, force push, DROP TABLE, system config changes)

Command: ${command.slice(0, 500)}`;

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), this.timeoutMs),
    );

    const classifyPromise = (async () => {
      const result = await this.providerOrchestrator!.streamChat(
        `classify_${Date.now()}`,
        [
          { role: "system", content: "You are a security classifier. Reply with exactly one word." },
          { role: "user", content: prompt },
        ],
        () => {},
        { modelRole: "utility_fast" },
      );
      const text = (result.text || "").trim().toUpperCase();
      if (text.includes("DANGEROUS")) return "dangerous" as const;
      if (text.includes("SAFE")) return "safe" as const;
      return "risky" as const;
    })();

    return Promise.race([classifyPromise, timeoutPromise]);
  }
}
