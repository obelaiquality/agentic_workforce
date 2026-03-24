import { describe, expect, it } from "vitest";
import { requireConfiguredApiToken } from "./index";

describe("standalone API token startup", () => {
  it("rejects empty tokens", () => {
    expect(() => requireConfiguredApiToken("")).toThrow("API_TOKEN is required for standalone API startup");
  });

  it("accepts non-empty trimmed tokens", () => {
    expect(requireConfiguredApiToken("  local-dev-token  ")).toBe("local-dev-token");
  });
});
