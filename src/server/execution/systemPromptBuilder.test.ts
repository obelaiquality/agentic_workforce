import { describe, it, expect, beforeEach } from "vitest";
import { SystemPromptBuilder, type PromptSection } from "./systemPromptBuilder";

describe("SystemPromptBuilder", () => {
  let builder: SystemPromptBuilder;

  beforeEach(() => {
    builder = new SystemPromptBuilder();
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function section(overrides?: Partial<PromptSection>): PromptSection {
    return {
      id: "test",
      content: "Test section content.",
      priority: 10,
      cacheable: false,
      source: "base",
      ...overrides,
    };
  }

  // ---------------------------------------------------------------------------
  // addSection / removeSection / clear
  // ---------------------------------------------------------------------------

  describe("section management", () => {
    it("adds and counts sections", () => {
      builder.addSection(section({ id: "a" }));
      builder.addSection(section({ id: "b" }));
      expect(builder.sectionCount).toBe(2);
    });

    it("replaces an existing section with the same id", () => {
      builder.addSection(section({ id: "x", content: "original" }));
      builder.addSection(section({ id: "x", content: "replaced" }));
      expect(builder.sectionCount).toBe(1);

      const result = builder.build(10000);
      expect(result.prompt).toBe("replaced");
    });

    it("removes a section by id", () => {
      builder.addSection(section({ id: "keep" }));
      builder.addSection(section({ id: "drop" }));
      builder.removeSection("drop");
      expect(builder.sectionCount).toBe(1);
    });

    it("clear removes all sections", () => {
      builder.addSection(section({ id: "a" }));
      builder.addSection(section({ id: "b" }));
      builder.clear();
      expect(builder.sectionCount).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Ordering: cacheable first, then by priority
  // ---------------------------------------------------------------------------

  describe("ordering", () => {
    it("places cacheable sections before non-cacheable sections", () => {
      builder.addSection(
        section({ id: "non-cache", priority: 1, cacheable: false, content: "NONCACHE" }),
      );
      builder.addSection(
        section({ id: "cache", priority: 2, cacheable: true, content: "CACHE" }),
      );

      const result = builder.build(10000);
      const cacheIdx = result.prompt.indexOf("CACHE");
      const nonCacheIdx = result.prompt.indexOf("NONCACHE");

      // "CACHE" should appear first (cacheable has priority over non-cacheable)
      // Note: "NONCACHE" contains "CACHE", so we need to check specifically
      expect(result.prompt.startsWith("CACHE")).toBe(true);
      expect(nonCacheIdx).toBeGreaterThan(0);
    });

    it("sorts sections within the same cacheable group by priority", () => {
      builder.addSection(
        section({ id: "low", priority: 30, cacheable: true, content: "LOW" }),
      );
      builder.addSection(
        section({ id: "high", priority: 1, cacheable: true, content: "HIGH" }),
      );
      builder.addSection(
        section({ id: "mid", priority: 15, cacheable: true, content: "MID" }),
      );

      const result = builder.build(10000);
      const highIdx = result.prompt.indexOf("HIGH");
      const midIdx = result.prompt.indexOf("MID");
      const lowIdx = result.prompt.indexOf("LOW");

      expect(highIdx).toBeLessThan(midIdx);
      expect(midIdx).toBeLessThan(lowIdx);
    });
  });

  // ---------------------------------------------------------------------------
  // Token budget enforcement
  // ---------------------------------------------------------------------------

  describe("token budget", () => {
    it("includes all sections when within budget", () => {
      builder.addSection(section({ id: "a", content: "short" }));
      builder.addSection(section({ id: "b", content: "also short" }));

      const result = builder.build(10000);
      expect(result.includedSections).toEqual(["a", "b"]);
      expect(result.truncatedSections).toHaveLength(0);
    });

    it("skips lower-priority sections that exceed budget", () => {
      // Each "x" is ~0.25 tokens. 400 chars = ~100 tokens.
      builder.addSection(
        section({ id: "high", priority: 1, content: "x".repeat(400) }),
      );
      builder.addSection(
        section({ id: "low", priority: 99, content: "y".repeat(400) }),
      );

      // Budget of 120 tokens: fits the first (100 tokens), truncates or skips the second
      const result = builder.build(120);
      expect(result.includedSections).toContain("high");
      // The low-priority section should be either truncated or absent
      expect(result.prompt).toContain("x".repeat(400));
    });

    it("truncates a section to fit remaining budget", () => {
      builder.addSection(
        section({ id: "fits", priority: 1, content: "a".repeat(200) }),
      );
      builder.addSection(
        section({ id: "truncated", priority: 2, content: "b".repeat(2000) }),
      );

      // Budget: 200 chars / 4 = 50 tokens for first, then ~100 more for second
      const result = builder.build(150);
      expect(result.includedSections).toContain("fits");
      expect(result.truncatedSections).toContain("truncated");
      // The prompt should contain the first section fully
      expect(result.prompt).toContain("a".repeat(200));
      // The second section should be truncated (not the full 2000 chars)
      expect(result.prompt.length).toBeLessThan(200 + 2000);
    });
  });

  // ---------------------------------------------------------------------------
  // Per-section maxTokens
  // ---------------------------------------------------------------------------

  describe("per-section maxTokens", () => {
    it("truncates a section that exceeds its own maxTokens", () => {
      builder.addSection(
        section({
          id: "limited",
          content: "w".repeat(1000),
          maxTokens: 50, // ~200 chars
        }),
      );

      const result = builder.build(10000);
      expect(result.truncatedSections).toContain("limited");
      expect(result.includedSections).toContain("limited");
      // Content should be truncated to ~200 chars
      expect(result.prompt.length).toBeLessThanOrEqual(200);
    });

    it("does not truncate a section within its maxTokens", () => {
      const content = "word ".repeat(10); // ~50 chars = ~12 tokens
      builder.addSection(
        section({
          id: "ok",
          content,
          maxTokens: 100,
        }),
      );

      const result = builder.build(10000);
      expect(result.truncatedSections).toHaveLength(0);
      expect(result.prompt).toBe(content);
    });
  });

  // ---------------------------------------------------------------------------
  // estimateTokens
  // ---------------------------------------------------------------------------

  describe("estimateTokens", () => {
    it("estimates tokens for all sections combined", () => {
      builder.addSection(section({ id: "a", content: "x".repeat(400) }));
      builder.addSection(section({ id: "b", content: "y".repeat(400) }));

      const estimate = builder.estimateTokens();
      // 800 chars / 4 = 200 tokens
      expect(estimate).toBe(200);
    });

    it("returns 0 when no sections are present", () => {
      expect(builder.estimateTokens()).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Prompt assembly
  // ---------------------------------------------------------------------------

  describe("prompt assembly", () => {
    it("joins sections with double newlines", () => {
      builder.addSection(section({ id: "a", priority: 1, content: "AAA" }));
      builder.addSection(section({ id: "b", priority: 2, content: "BBB" }));

      const result = builder.build(10000);
      expect(result.prompt).toBe("AAA\n\nBBB");
    });

    it("builds an empty prompt when no sections exist", () => {
      const result = builder.build(10000);
      expect(result.prompt).toBe("");
      expect(result.includedSections).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Cache-first ordering integration
  // ---------------------------------------------------------------------------

  describe("cache-first ordering integration", () => {
    it("produces a stable cacheable prefix followed by dynamic sections", () => {
      builder.addSection(
        section({
          id: "base-guidelines",
          priority: 1,
          cacheable: true,
          source: "base",
          content: "You are an agent.",
        }),
      );
      builder.addSection(
        section({
          id: "tool-schemas",
          priority: 2,
          cacheable: true,
          source: "base",
          content: "Available tools: bash, read_file",
        }),
      );
      builder.addSection(
        section({
          id: "memory-context",
          priority: 3,
          cacheable: false,
          source: "memory",
          content: "Recent: user prefers TypeScript",
        }),
      );
      builder.addSection(
        section({
          id: "project-blueprint",
          priority: 4,
          cacheable: false,
          source: "project",
          content: "Project uses Vite + React",
        }),
      );

      const result = builder.build(10000);

      // Cacheable prefix comes first
      const guidelinesIdx = result.prompt.indexOf("You are an agent.");
      const toolsIdx = result.prompt.indexOf("Available tools:");
      const memoryIdx = result.prompt.indexOf("Recent:");
      const projectIdx = result.prompt.indexOf("Project uses");

      expect(guidelinesIdx).toBeLessThan(toolsIdx);
      expect(toolsIdx).toBeLessThan(memoryIdx);
      expect(memoryIdx).toBeLessThan(projectIdx);

      expect(result.includedSections).toEqual([
        "base-guidelines",
        "tool-schemas",
        "memory-context",
        "project-blueprint",
      ]);
    });
  });
});
