import { describe, expect, it } from "vitest";
import { scanAndRedactSensitiveText } from "./privacyScanner";

describe("privacy scanner", () => {
  it("redacts obvious secret tokens", () => {
    const result = scanAndRedactSensitiveText("token=sk-1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    expect(result.safe).toBe(false);
    expect(result.redacted).toContain("[REDACTED_SECRET]");
  });

  it("passes safe text", () => {
    const result = scanAndRedactSensitiveText("refactor service layer and run tests");
    expect(result.safe).toBe(true);
    expect(result.findings).toHaveLength(0);
  });
});

