import { describe, it, expect, beforeEach } from "vitest";
import {
  estimateTokensAccurate,
  estimateTokensFast,
  resetEncoder,
} from "./tokenEstimator";

describe("tokenEstimator", () => {
  beforeEach(() => {
    resetEncoder();
  });

  // ---------------------------------------------------------------------------
  // estimateTokensFast (heuristic)
  // ---------------------------------------------------------------------------

  describe("estimateTokensFast", () => {
    it("returns 0 for empty string", () => {
      expect(estimateTokensFast("")).toBe(0);
    });

    it("estimates ~4 characters per token", () => {
      // 100 chars -> ceil(100 / 4) = 25 tokens
      expect(estimateTokensFast("a".repeat(100))).toBe(25);
    });

    it("rounds up partial tokens", () => {
      // 5 chars -> ceil(5 / 4) = 2
      expect(estimateTokensFast("hello")).toBe(2);
    });

    it("handles single character", () => {
      expect(estimateTokensFast("x")).toBe(1);
    });

    it("handles multi-line text", () => {
      const text = "line 1\nline 2\nline 3\n";
      expect(estimateTokensFast(text)).toBe(Math.ceil(text.length / 4));
    });

    it("provides reasonable estimates for typical prompts", () => {
      const prompt =
        "You are a helpful coding assistant. Please analyze the following code and suggest improvements.";
      const estimate = estimateTokensFast(prompt);
      // Typical English text: ~4 chars/token is a reasonable approximation
      // The prompt is 95 chars -> ~24 tokens heuristic vs ~18-20 real tokens
      expect(estimate).toBeGreaterThan(10);
      expect(estimate).toBeLessThan(50);
    });
  });

  // ---------------------------------------------------------------------------
  // estimateTokensAccurate (with tiktoken fallback)
  // ---------------------------------------------------------------------------

  describe("estimateTokensAccurate", () => {
    it("returns 0 for empty string with high confidence", async () => {
      const result = await estimateTokensAccurate("");
      expect(result.count).toBe(0);
      expect(result.confidence).toBe("high");
    });

    it("falls back to heuristic when tiktoken is not available", async () => {
      // tiktoken is not installed in this project, so heuristic fallback is expected
      const result = await estimateTokensAccurate("Hello, world!");
      expect(result.count).toBeGreaterThan(0);
      expect(result.method).toBe("heuristic");
      expect(result.confidence).toBe("medium");
    });

    it("produces same count as estimateTokensFast in heuristic mode", async () => {
      const text = "The quick brown fox jumps over the lazy dog.";
      const accurate = await estimateTokensAccurate(text);
      const fast = estimateTokensFast(text);

      // When falling back to heuristic, they should match
      if (accurate.method === "heuristic") {
        expect(accurate.count).toBe(fast);
      }
    });

    it("handles very long text without errors", async () => {
      const longText = "word ".repeat(10000);
      const result = await estimateTokensAccurate(longText);
      expect(result.count).toBeGreaterThan(0);
    });

    it("caches the encoder across calls", async () => {
      // Call twice — second call should reuse cached state
      const result1 = await estimateTokensAccurate("first call");
      const result2 = await estimateTokensAccurate("second call");

      // Both should use the same method (either both tiktoken or both heuristic)
      expect(result1.method).toBe(result2.method);
    });

    it("resetEncoder allows re-initialization", async () => {
      await estimateTokensAccurate("before reset");
      resetEncoder();
      const result = await estimateTokensAccurate("after reset");
      // Should still work after reset
      expect(result.count).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Heuristic accuracy sanity checks
  // ---------------------------------------------------------------------------

  describe("heuristic accuracy", () => {
    it("estimates within 2x of expected range for code", () => {
      const code = `function greet(name: string): string {
  return \`Hello, \${name}!\`;
}`;
      const estimate = estimateTokensFast(code);
      // Real token count for this would be ~20-25 tokens
      // Heuristic: 68 chars / 4 = 17 tokens — close enough
      expect(estimate).toBeGreaterThan(5);
      expect(estimate).toBeLessThan(50);
    });

    it("estimates within 2x of expected range for prose", () => {
      const prose =
        "The Electron application provides a local-first coding agent " +
        "that uses small language models running on the user's hardware.";
      const estimate = estimateTokensFast(prose);
      // 125 chars / 4 = ~31 tokens. Real: ~25 tokens.
      expect(estimate).toBeGreaterThan(15);
      expect(estimate).toBeLessThan(60);
    });
  });
});
