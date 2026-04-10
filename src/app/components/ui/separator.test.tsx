import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Separator } from "./separator";

describe("Separator", () => {
  it("renders without crashing", () => {
    const { container } = render(<Separator />);
    expect(container.firstChild).toBeTruthy();
  });

  it("forwards className", () => {
    const { container } = render(<Separator className="custom-class" />);
    expect(container.innerHTML).toContain("custom-class");
  });

  it("renders with horizontal orientation by default", () => {
    const { container } = render(<Separator />);
    expect(container.innerHTML).toContain('data-orientation="horizontal"');
  });

  it("renders with vertical orientation", () => {
    const { container } = render(<Separator orientation="vertical" />);
    expect(container.innerHTML).toContain('data-orientation="vertical"');
  });
});
