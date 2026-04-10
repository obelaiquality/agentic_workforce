// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { cn } from "./utils";

describe("cn utility", () => {
  it("merges class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("handles conditional classes", () => {
    expect(cn("foo", false && "bar", "baz")).toBe("foo baz");
  });

  it("merges tailwind conflicts", () => {
    expect(cn("p-4", "p-2")).toBe("p-2");
  });

  it("handles undefined/null", () => {
    expect(cn("foo", undefined, null, "bar")).toBe("foo bar");
  });
});
