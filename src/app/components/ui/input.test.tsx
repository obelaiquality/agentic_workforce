import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Input } from "./input";

describe("Input", () => {
  it("renders without crashing", () => {
    const { container } = render(<Input />);
    expect(container.firstChild).toBeTruthy();
  });

  it("forwards className", () => {
    const { container } = render(<Input className="custom-class" />);
    expect(container.innerHTML).toContain("custom-class");
  });

  it("renders with placeholder", () => {
    const { container } = render(<Input placeholder="Enter text" />);
    const input = container.querySelector("input");
    expect(input?.getAttribute("placeholder")).toBe("Enter text");
  });
});
