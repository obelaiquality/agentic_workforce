import { describe, expect, it } from "vitest";
import { QwenCliAdapter } from "./qwenCliAdapter";

describe("QwenCliAdapter.classifyError", () => {
  const adapter = new QwenCliAdapter();

  it("classifies quota exhaustion", () => {
    expect(adapter.classifyError(new Error("429 quota exceeded"))).toBe("quota_exhausted");
  });

  it("classifies auth issues", () => {
    expect(adapter.classifyError(new Error("authentication failed"))).toBe("auth_required");
  });

  it("classifies provider missing", () => {
    expect(adapter.classifyError(new Error("spawn ENOENT"))).toBe("provider_unavailable");
  });
});
