import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Button } from "./button";

describe("Button", () => {
  it("renders without crashing", () => {
    const { container } = render(<Button>Click me</Button>);
    expect(container.firstChild).toBeTruthy();
  });

  it("renders a button element", () => {
    const { container } = render(<Button>Click me</Button>);
    expect(container.querySelector("button")).toBeTruthy();
  });

  it("forwards className", () => {
    const { container } = render(
      <Button className="custom-class">Click me</Button>,
    );
    expect(container.innerHTML).toContain("custom-class");
  });

  it("renders with default variant", () => {
    const { container } = render(<Button>Default</Button>);
    expect(container.innerHTML).toContain("bg-primary");
  });

  it("renders with destructive variant", () => {
    const { container } = render(
      <Button variant="destructive">Delete</Button>,
    );
    expect(container.innerHTML).toContain("bg-destructive");
  });

  it("renders with outline variant", () => {
    const { container } = render(<Button variant="outline">Outline</Button>);
    expect(container.innerHTML).toContain("bg-background");
  });

  it("renders children", () => {
    const { container } = render(<Button>Button Text</Button>);
    expect(container.textContent).toBe("Button Text");
  });
});
