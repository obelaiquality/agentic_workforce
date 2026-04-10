import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Checkbox } from "./checkbox";

describe("Checkbox", () => {
  it("renders without crashing", () => {
    const { container } = render(<Checkbox />);
    expect(container.firstChild).toBeTruthy();
  });

  it("renders a button role", () => {
    const { container } = render(<Checkbox />);
    expect(container.querySelector('[role="checkbox"]')).toBeTruthy();
  });

  it("forwards className", () => {
    const { container } = render(<Checkbox className="custom-class" />);
    expect(container.innerHTML).toContain("custom-class");
  });
});
