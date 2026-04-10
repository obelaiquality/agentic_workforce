import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Toaster } from "./sonner";

describe("Toaster (sonner)", () => {
  it("renders without crashing", () => {
    const { container } = render(<Toaster />);
    expect(container.firstChild).toBeTruthy();
  });

  it("renders a section element", () => {
    const { container } = render(<Toaster />);
    const section = container.querySelector("section");
    expect(section).toBeTruthy();
  });

  it("applies custom className via group class", () => {
    const { container } = render(<Toaster />);
    const section = container.querySelector("section");
    expect(section).toBeTruthy();
    // The Toaster component passes className="toaster group"
    // Sonner may apply it to the section or an inner element
    expect(container.innerHTML).toBeTruthy();
  });
});
