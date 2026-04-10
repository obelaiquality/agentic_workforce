import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Toggle } from "./toggle";

describe("Toggle", () => {
  it("renders without crashing", () => {
    const { container } = render(<Toggle>Toggle</Toggle>);
    expect(container.firstChild).toBeTruthy();
  });

  it("renders a button", () => {
    const { container } = render(<Toggle>Toggle</Toggle>);
    expect(container.querySelector("button")).toBeTruthy();
  });

  it("forwards className", () => {
    const { container } = render(
      <Toggle className="custom-class">Toggle</Toggle>,
    );
    expect(container.innerHTML).toContain("custom-class");
  });
});
