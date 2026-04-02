/**
 * Context collapse service - read-time projection of conversation summaries.
 *
 * Implements non-destructive compaction by storing summaries separately
 * and projecting them onto the conversation at query time. This preserves
 * the original message history while allowing aggressive space reduction
 * under memory pressure.
 */

import type { ConversationMessage } from "../tools/types";

export interface ConversationSummary {
  id: string;
  runId: string;
  turnStart: number;
  turnEnd: number;
  summary: string;
  tokensOriginal: number;
  tokensSummary: number;
  createdAt: string;
}

export class ContextCollapseService {
  private summaries = new Map<string, ConversationSummary[]>();

  /**
   * Store a summary for a range of turns.
   * Called by compaction when dropping messages.
   */
  storeSummary(summary: ConversationSummary): void {
    if (!this.summaries.has(summary.runId)) {
      this.summaries.set(summary.runId, []);
    }
    const runSummaries = this.summaries.get(summary.runId)!;

    // Insert in sorted order by turnStart
    const insertIndex = runSummaries.findIndex(s => s.turnStart > summary.turnStart);
    if (insertIndex === -1) {
      runSummaries.push(summary);
    } else {
      runSummaries.splice(insertIndex, 0, summary);
    }
  }

  /**
   * Project summaries onto a conversation.
   * Returns a new message array with old turns replaced by summaries.
   * Does NOT mutate the input.
   */
  projectConversation(input: {
    runId: string;
    messages: ConversationMessage[];
    maxTokens: number;
    pressureThreshold?: number;
  }): { messages: ConversationMessage[]; collapsed: boolean; turnsCollapsed: number } {
    const { runId, messages, maxTokens, pressureThreshold = 0.6 } = input;

    // Calculate current pressure
    const currentTokens = this.estimateConversationTokens(messages);
    const pressure = currentTokens / maxTokens;

    // If below threshold, return as-is
    if (pressure < pressureThreshold) {
      return { messages, collapsed: false, turnsCollapsed: 0 };
    }

    // Get summaries for this run
    const runSummaries = this.summaries.get(runId);
    if (!runSummaries || runSummaries.length === 0) {
      return { messages, collapsed: false, turnsCollapsed: 0 };
    }

    // Build the projected conversation
    const result: ConversationMessage[] = [];
    let turnsCollapsed = 0;
    let currentIndex = 0;

    for (const summary of runSummaries) {
      // Add messages before this summary range
      while (currentIndex < summary.turnStart && currentIndex < messages.length) {
        result.push(messages[currentIndex]);
        currentIndex++;
      }

      // Replace the summary range with a summary message
      if (currentIndex === summary.turnStart && summary.turnEnd < messages.length) {
        result.push({
          role: "system",
          content: summary.summary,
          timestamp: summary.createdAt,
          pinned: false,
        });
        turnsCollapsed += (summary.turnEnd - summary.turnStart + 1);
        currentIndex = summary.turnEnd + 1;
      }
    }

    // Add remaining messages after the last summary
    while (currentIndex < messages.length) {
      result.push(messages[currentIndex]);
      currentIndex++;
    }

    return {
      messages: result,
      collapsed: turnsCollapsed > 0,
      turnsCollapsed,
    };
  }

  /**
   * Generate a summary for a range of messages.
   * Uses a simple extractive approach (no LLM call needed).
   */
  generateExtractSummary(messages: ConversationMessage[]): string {
    if (messages.length === 0) return "No activity.";

    const tools = new Set<string>();
    const files = new Set<string>();
    const errors: string[] = [];
    const decisions: string[] = [];

    for (const msg of messages) {
      // Extract tool names from tool_result messages
      if (msg.role === "tool_result" && msg.toolName) {
        tools.add(msg.toolName);
      }

      // Extract file paths (simple heuristic: look for common path patterns)
      const fileMatches = msg.content.match(/(?:\/[\w.-]+)+\.\w+/g);
      if (fileMatches) {
        for (const file of fileMatches.slice(0, 3)) {
          files.add(file);
        }
      }

      // Extract errors
      if (msg.content.toLowerCase().includes("error:") || msg.content.toLowerCase().includes("failed")) {
        const errorLine = msg.content.split("\n").find(line =>
          line.toLowerCase().includes("error") || line.toLowerCase().includes("failed")
        );
        if (errorLine && errors.length < 2) {
          errors.push(errorLine.trim().slice(0, 80));
        }
      }

      // Extract decisions from assistant messages
      if (msg.role === "assistant") {
        const decisionLine = msg.content.split("\n").find(line =>
          line.toLowerCase().includes("decision:") ||
          line.toLowerCase().includes("will ") ||
          line.toLowerCase().includes("going to")
        );
        if (decisionLine && decisions.length < 2) {
          decisions.push(decisionLine.trim().slice(0, 80));
        }
      }
    }

    // Build summary
    const parts: string[] = [];

    if (tools.size > 0) {
      parts.push(`Tools: ${Array.from(tools).slice(0, 5).join(", ")}`);
    }

    if (files.size > 0) {
      parts.push(`Files: ${Array.from(files).slice(0, 3).join(", ")}`);
    }

    if (errors.length > 0) {
      parts.push(`Errors: ${errors.join("; ")}`);
    }

    if (decisions.length > 0) {
      parts.push(`Actions: ${decisions.join("; ")}`);
    }

    const summary = parts.join(" | ");

    // Truncate to 500 chars
    if (summary.length > 500) {
      return summary.slice(0, 497) + "...";
    }

    return summary || "General conversation activity.";
  }

  /**
   * Clear summaries for a run.
   */
  clearSummaries(runId: string): void {
    this.summaries.delete(runId);
  }

  /**
   * Get all summaries for a run.
   */
  getSummaries(runId: string): ConversationSummary[] {
    return this.summaries.get(runId) ?? [];
  }

  /**
   * Estimate token count for a conversation.
   * Uses ~4 chars per token heuristic.
   */
  private estimateConversationTokens(messages: ConversationMessage[]): number {
    let total = 0;
    for (const msg of messages) {
      total += Math.ceil(msg.content.length / 4);
    }
    return total;
  }

  /**
   * Create a summary for a message range and store it.
   * Returns the created summary.
   */
  createAndStoreSummary(
    runId: string,
    messages: ConversationMessage[],
    turnStart: number,
    turnEnd: number,
  ): ConversationSummary {
    const rangeMessages = messages.slice(turnStart, turnEnd + 1);
    const summary = this.generateExtractSummary(rangeMessages);

    const tokensOriginal = this.estimateConversationTokens(rangeMessages);
    const tokensSummary = Math.ceil(summary.length / 4);

    const summaryRecord: ConversationSummary = {
      id: `${runId}-${turnStart}-${turnEnd}`,
      runId,
      turnStart,
      turnEnd,
      summary: `Turns ${turnStart}-${turnEnd}: ${summary}`,
      tokensOriginal,
      tokensSummary,
      createdAt: new Date().toISOString(),
    };

    this.storeSummary(summaryRecord);
    return summaryRecord;
  }

  /**
   * Get compression stats for a run.
   */
  getCompressionStats(runId: string): {
    summaryCount: number;
    tokensOriginal: number;
    tokensSummary: number;
    compressionRatio: number;
  } {
    const runSummaries = this.summaries.get(runId) ?? [];
    const tokensOriginal = runSummaries.reduce((sum, s) => sum + s.tokensOriginal, 0);
    const tokensSummary = runSummaries.reduce((sum, s) => sum + s.tokensSummary, 0);

    return {
      summaryCount: runSummaries.length,
      tokensOriginal,
      tokensSummary,
      compressionRatio: tokensOriginal > 0 ? tokensOriginal / tokensSummary : 0,
    };
  }
}
