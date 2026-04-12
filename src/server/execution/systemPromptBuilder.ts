/**
 * Dynamic system prompt builder.
 *
 * Assembles a system prompt from prioritized, budget-aware sections.
 * Cacheable sections are placed first (stable prefix for provider caching).
 * Sections are included in priority order until the token budget is exhausted.
 *
 * Pure module — no side effects except through the sections provided.
 */

import { estimateTokens } from "../services/contextCompactionService";

export interface PromptSection {
  /** Unique identifier for the section */
  id: string;
  /** The section text content */
  content: string;
  /** Priority ordering (lower number = higher priority, included first) */
  priority: number;
  /** Optional maximum token budget for this section; content is truncated if exceeded */
  maxTokens?: number;
  /** If true, this section is placed in the stable prefix for caching */
  cacheable: boolean;
  /** Origin of the section */
  source:
    | "base"
    | "project"
    | "memory"
    | "skills"
    | "hooks"
    | "plugins"
    | "policy";
}

export interface BuildResult {
  /** The assembled system prompt string */
  prompt: string;
  /** IDs of sections that were fully included */
  includedSections: string[];
  /** IDs of sections that were truncated to fit budget */
  truncatedSections: string[];
}

/**
 * Builds a system prompt from composable, prioritized sections.
 */
export class SystemPromptBuilder {
  private sections: PromptSection[] = [];

  /**
   * Add a section to the builder. If a section with the same ID exists, it is replaced.
   */
  addSection(section: PromptSection): void {
    const existingIndex = this.sections.findIndex((s) => s.id === section.id);
    if (existingIndex >= 0) {
      this.sections[existingIndex] = section;
    } else {
      this.sections.push(section);
    }
  }

  /**
   * Remove a section by ID.
   */
  removeSection(id: string): void {
    this.sections = this.sections.filter((s) => s.id !== id);
  }

  /**
   * Build the final system prompt within a token budget.
   *
   * Ordering:
   *  1. Cacheable sections sorted by priority (ascending = higher priority)
   *  2. Non-cacheable sections sorted by priority
   *
   * When a section has a maxTokens constraint that is exceeded, the content
   * is truncated to fit. When the total would exceed `maxTokens`, lower-priority
   * sections are skipped.
   */
  build(maxTokens: number): BuildResult {
    const sorted = this.sortedSections();

    const includedSections: string[] = [];
    const truncatedSections: string[] = [];
    const parts: string[] = [];
    let usedTokens = 0;

    for (const section of sorted) {
      let content = section.content;

      // Per-section truncation
      if (section.maxTokens !== undefined) {
        const sectionTokens = estimateTokens(content);
        if (sectionTokens > section.maxTokens) {
          content = this.truncateToTokens(content, section.maxTokens);
          truncatedSections.push(section.id);
        }
      }

      const contentTokens = estimateTokens(content);

      // Check global budget
      if (usedTokens + contentTokens > maxTokens) {
        // Try to fit a truncated version
        const remaining = maxTokens - usedTokens;
        if (remaining > 0) {
          content = this.truncateToTokens(content, remaining);
          const truncatedTokens = estimateTokens(content);
          if (truncatedTokens > 0) {
            parts.push(content);
            usedTokens += truncatedTokens;
            if (!truncatedSections.includes(section.id)) {
              truncatedSections.push(section.id);
            }
            includedSections.push(section.id);
          }
        }
        // Skip remaining sections (they are lower priority)
        break;
      }

      parts.push(content);
      usedTokens += contentTokens;
      if (!truncatedSections.includes(section.id)) {
        includedSections.push(section.id);
      } else {
        // Was truncated by per-section limit but still included
        includedSections.push(section.id);
      }
    }

    return {
      prompt: parts.join("\n\n"),
      includedSections,
      truncatedSections,
    };
  }

  /**
   * Estimate the total tokens across all current sections (without truncation).
   */
  estimateTokens(): number {
    return this.sections.reduce(
      (sum, s) => sum + estimateTokens(s.content),
      0,
    );
  }

  /**
   * Clear all sections.
   */
  clear(): void {
    this.sections = [];
  }

  /**
   * Get the current number of sections.
   */
  get sectionCount(): number {
    return this.sections.length;
  }

  /**
   * Inject the prompt-driven safety layer.
   *
   * Adds a high-priority, cacheable section with self-moderation instructions.
   * This creates defense-in-depth alongside the API-level permission policy engine.
   */
  injectSafetyLayer(): void {
    this.addSection(SAFETY_SECTION);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Sort sections: cacheable first (by priority), then non-cacheable (by priority).
   */
  private sortedSections(): PromptSection[] {
    return [...this.sections].sort((a, b) => {
      // Cacheable sections come first
      if (a.cacheable !== b.cacheable) {
        return a.cacheable ? -1 : 1;
      }
      // Within the same cacheable group, sort by priority ascending
      return a.priority - b.priority;
    });
  }

  /**
   * Truncate text to approximately `maxTokens` tokens.
   * Uses the ~4 chars/token heuristic.
   */
  private truncateToTokens(text: string, maxTokens: number): string {
    const maxChars = maxTokens * 4;
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars);
  }
}

// ---------------------------------------------------------------------------
// Built-in safety section — prompt-driven self-moderation
// ---------------------------------------------------------------------------

const SAFETY_CONTENT = `## Safety & Responsibility

You are operating within a managed execution environment with safety controls. Follow these principles:

### Destructive Operations
- Before executing any destructive operation (file deletion, git reset, database drop, process kill), explain what you will do and confirm it aligns with the task objective.
- Prefer reversible approaches: use git branches, file backups, or soft deletes instead of hard deletes.
- Never run \`rm -rf\` on directories outside the project worktree.

### Scope Boundaries
- Only modify files within the designated project directory.
- Do not access, read, or modify files in home directories, system directories, or other projects.
- Do not access environment variables containing secrets unless the task explicitly requires it.

### Network & External Systems
- Do not make network requests unless the task requires it (e.g., fetching documentation, running API tests).
- Do not send data to external services that the user has not explicitly authorized.
- Do not install packages or dependencies without clear justification from the task objective.

### Code Safety
- Do not introduce known security vulnerabilities (command injection, SQL injection, XSS, path traversal).
- Do not hardcode secrets, API keys, or credentials in source files.
- Do not disable security features, linters, or tests to make code pass.

### Verification Before Completion
- Run the project's test suite after making changes.
- Check for TypeScript/linting errors before claiming work is complete.
- If verification fails, diagnose and fix — do not skip verification.`;

export const SAFETY_SECTION: PromptSection = {
  id: "builtin_safety",
  content: SAFETY_CONTENT,
  priority: 5, // High priority — included early in the prompt
  cacheable: true, // Stable content, good for prefix caching
  source: "policy",
};
