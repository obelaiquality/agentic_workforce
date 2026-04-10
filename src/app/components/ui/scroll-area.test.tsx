import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScrollArea, ScrollBar } from "./scroll-area";

describe("ScrollArea", () => {
  it("renders ScrollArea with children", () => {
    render(<ScrollArea>Scrollable content</ScrollArea>);
    expect(screen.getByText("Scrollable content")).toBeInTheDocument();
  });

  it("applies data-slot attribute", () => {
    const { container } = render(
      <ScrollArea>Content</ScrollArea>,
    );
    expect(
      container.querySelector('[data-slot="scroll-area"]'),
    ).toBeTruthy();
  });

  it("renders with custom className", () => {
    const { container } = render(
      <ScrollArea className="h-64">Long content</ScrollArea>,
    );
    expect(container.querySelector(".h-64")).toBeTruthy();
  });

  it("renders ScrollArea viewport", () => {
    const { container } = render(
      <ScrollArea>
        <div>Viewport content</div>
      </ScrollArea>,
    );
    expect(
      container.querySelector('[data-slot="scroll-area-viewport"]'),
    ).toBeTruthy();
  });
});
