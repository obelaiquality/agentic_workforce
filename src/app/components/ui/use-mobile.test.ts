// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useIsMobile } from "./use-mobile";

describe("useIsMobile", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      value: 1024,
    });
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  });

  it("returns false for desktop width", () => {
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it("returns true for mobile width", () => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      value: 500,
    });
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });
});
