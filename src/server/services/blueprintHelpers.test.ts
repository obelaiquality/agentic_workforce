import { describe, expect, it } from "vitest";
import {
  firstParagraph,
  inferProductIntent,
  inferSuccessCriteria,
  inferConstraints,
  classifyConfidence,
  CANDIDATE_SOURCES,
} from "./blueprintHelpers";
import type { RepoGuidelineProfile } from "../../shared/contracts";

describe("firstParagraph", () => {
  it("extracts the first paragraph with > 40 chars", () => {
    const text = "# Title\n\nThis is a paragraph with enough characters to be considered valid content for extraction.\n\nSecond paragraph.";
    const result = firstParagraph(text);
    expect(result).toContain("enough characters");
  });

  it("skips headings", () => {
    const text = "# My Project\n\nShort.\n\nA longer paragraph that should be the first real content paragraph returned by this function.";
    const result = firstParagraph(text);
    expect(result).not.toContain("# My");
  });

  it("returns empty for text with only short paragraphs", () => {
    const text = "# Title\n\nShort.\n\nAlso short.";
    const result = firstParagraph(text);
    expect(result).toBe("");
  });

  it("returns empty for empty input", () => {
    expect(firstParagraph("")).toBe("");
  });
});

describe("inferProductIntent", () => {
  it("uses first paragraph when available", () => {
    const text = "# My App\n\nThis application provides a comprehensive coding agent system for local-first development workflows.";
    const result = inferProductIntent(text, "MyApp");
    expect(result).toContain("comprehensive coding agent");
  });

  it("falls back to name-based intent", () => {
    const result = inferProductIntent("# Title\n\nShort.", "MyProject");
    expect(result).toContain("MyProject");
    expect(result).toContain("reliable code changes");
  });

  it("truncates long paragraphs to 280 chars", () => {
    const longText = "# Title\n\n" + "A".repeat(400) + ".";
    const result = inferProductIntent(longText, "Proj");
    expect(result.length).toBeLessThanOrEqual(280);
  });
});

describe("inferSuccessCriteria", () => {
  it("always includes base criteria", () => {
    const result = inferSuccessCriteria(null);
    expect(result).toContain("Implement the requested change with minimal diffs.");
    expect(result).toContain("Verify impacted behavior before promotion.");
  });

  it("adds test criteria when guidelines require tests", () => {
    const guidelines = {
      requiredArtifacts: ["tests"],
    } as unknown as RepoGuidelineProfile;
    const result = inferSuccessCriteria(guidelines);
    expect(result.some((c) => c.includes("tests"))).toBe(true);
  });

  it("adds doc criteria when guidelines require docs", () => {
    const guidelines = {
      requiredArtifacts: ["documentation"],
    } as unknown as RepoGuidelineProfile;
    const result = inferSuccessCriteria(guidelines);
    expect(result.some((c) => c.includes("documentation"))).toBe(true);
  });
});

describe("inferConstraints", () => {
  it("infers minimal diffs constraint", () => {
    const result = inferConstraints("Always use minimal diffs for changes.");
    expect(result).toContain("Prefer minimal diffs.");
  });

  it("infers worktree constraint", () => {
    const result = inferConstraints("Work inside the managed worktree only.");
    expect(result).toContain("Operate inside the managed worktree only.");
  });

  it("infers review findings style", () => {
    const result = inferConstraints("Use review findings first before summary.");
    expect(result).toContain("Use findings-first review style.");
  });

  it("infers performance constraint", () => {
    const result = inferConstraints("Preserve performance-critical paths.");
    expect(result).toContain("Preserve performance-sensitive paths.");
  });

  it("returns empty for text with no matches", () => {
    const result = inferConstraints("Just a normal text with nothing special.");
    expect(result).toEqual([]);
  });

  it("deduplicates constraints", () => {
    const result = inferConstraints("Use minimal diffs. Always minimal diffs.");
    const diffCount = result.filter((c) => c.includes("minimal")).length;
    expect(diffCount).toBe(1);
  });
});

describe("classifyConfidence", () => {
  it("returns high for confidence >= 0.75", () => {
    expect(classifyConfidence({ guidelineConfidence: 0.8, sourceRefs: [] })).toBe("high");
  });

  it("returns high for 4+ source refs", () => {
    expect(classifyConfidence({ guidelineConfidence: 0.1, sourceRefs: ["a", "b", "c", "d"] })).toBe("high");
  });

  it("returns medium for confidence >= 0.45", () => {
    expect(classifyConfidence({ guidelineConfidence: 0.5, sourceRefs: [] })).toBe("medium");
  });

  it("returns medium for 2+ source refs", () => {
    expect(classifyConfidence({ guidelineConfidence: 0.1, sourceRefs: ["a", "b"] })).toBe("medium");
  });

  it("returns low for low confidence and few refs", () => {
    expect(classifyConfidence({ guidelineConfidence: 0.2, sourceRefs: ["a"] })).toBe("low");
  });

  it("returns low for null confidence", () => {
    expect(classifyConfidence({ guidelineConfidence: null, sourceRefs: [] })).toBe("low");
  });
});

describe("CANDIDATE_SOURCES", () => {
  it("includes AGENTS.md", () => {
    expect(CANDIDATE_SOURCES).toContain("AGENTS.md");
  });

  it("includes README.md", () => {
    expect(CANDIDATE_SOURCES).toContain("README.md");
  });

  it("includes docs paths", () => {
    expect(CANDIDATE_SOURCES.some((s) => s.startsWith("docs/"))).toBe(true);
  });

  it("includes guidelines path", () => {
    expect(CANDIDATE_SOURCES.some((s) => s.startsWith("guidelines/"))).toBe(true);
  });
});
