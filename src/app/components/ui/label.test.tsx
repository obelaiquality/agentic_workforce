import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Label } from "./label";

describe("Label", () => {
  it("renders without crashing", () => {
    const { container } = render(<Label>Test Label</Label>);
    expect(container.firstChild).toBeTruthy();
  });

  it("renders children", () => {
    const { container } = render(<Label>Test Label</Label>);
    expect(container.textContent).toBe("Test Label");
  });

  it("forwards className", () => {
    const { container } = render(<Label className="custom-class">Label</Label>);
    expect(container.innerHTML).toContain("custom-class");
  });
});
