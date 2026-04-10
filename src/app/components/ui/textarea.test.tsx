import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Textarea } from "./textarea";

describe("Textarea", () => {
  it("renders without crashing", () => {
    const { container } = render(<Textarea />);
    expect(container.firstChild).toBeTruthy();
  });

  it("renders a textarea element", () => {
    const { container } = render(<Textarea />);
    expect(container.querySelector("textarea")).toBeTruthy();
  });

  it("forwards className", () => {
    const { container } = render(<Textarea className="custom-class" />);
    expect(container.innerHTML).toContain("custom-class");
  });
});
