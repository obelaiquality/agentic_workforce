import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ToggleGroup, ToggleGroupItem } from "./toggle-group";

describe("ToggleGroup", () => {
  it("renders ToggleGroup with items", () => {
    render(
      <ToggleGroup type="single">
        <ToggleGroupItem value="a">A</ToggleGroupItem>
        <ToggleGroupItem value="b">B</ToggleGroupItem>
      </ToggleGroup>,
    );
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
  });

  it("renders with type multiple", () => {
    render(
      <ToggleGroup type="multiple">
        <ToggleGroupItem value="x">X</ToggleGroupItem>
        <ToggleGroupItem value="y">Y</ToggleGroupItem>
      </ToggleGroup>,
    );
    expect(screen.getByText("X")).toBeInTheDocument();
    expect(screen.getByText("Y")).toBeInTheDocument();
  });

  it("applies data-slot attributes", () => {
    const { container } = render(
      <ToggleGroup type="single">
        <ToggleGroupItem value="a">A</ToggleGroupItem>
      </ToggleGroup>,
    );
    expect(
      container.querySelector('[data-slot="toggle-group"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-slot="toggle-group-item"]'),
    ).toBeTruthy();
  });

  it("passes variant and size to context", () => {
    const { container } = render(
      <ToggleGroup type="single" variant="outline" size="sm">
        <ToggleGroupItem value="a">A</ToggleGroupItem>
      </ToggleGroup>,
    );
    const group = container.querySelector('[data-slot="toggle-group"]');
    expect(group?.getAttribute("data-variant")).toBe("outline");
    expect(group?.getAttribute("data-size")).toBe("sm");
  });
});
