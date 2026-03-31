import { describe, expect, it } from "vitest";
import { truncateFileContent } from "./codebaseHelpers";

describe("truncateFileContent", () => {
  it("does not truncate short content", () => {
    const result = truncateFileContent("line1\nline2\nline3");
    expect(result.truncated).toBe(false);
    expect(result.content).toBe("line1\nline2\nline3");
  });

  it("truncates content exceeding line limit", () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `line ${i}`).join("\n");
    const result = truncateFileContent(lines, 800);
    expect(result.truncated).toBe(true);
    const outputLines = result.content.split("\n");
    expect(outputLines.length).toBeLessThanOrEqual(800);
  });

  it("truncates content exceeding byte limit", () => {
    const bigContent = "A".repeat(70000);
    const result = truncateFileContent(bigContent, 800, 64000);
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.content, "utf8")).toBeLessThanOrEqual(64000);
  });

  it("handles empty content", () => {
    const result = truncateFileContent("");
    expect(result.truncated).toBe(false);
    expect(result.content).toBe("");
  });
});
