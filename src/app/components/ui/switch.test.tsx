import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Switch } from "./switch";

describe("Switch", () => {
  it("renders without crashing", () => {
    const { container } = render(<Switch />);
    expect(container.firstChild).toBeTruthy();
  });

  it("renders a button role", () => {
    const { container } = render(<Switch />);
    expect(container.querySelector('[role="switch"]')).toBeTruthy();
  });

  it("forwards className", () => {
    const { container } = render(<Switch className="custom-class" />);
    expect(container.innerHTML).toContain("custom-class");
  });
});
