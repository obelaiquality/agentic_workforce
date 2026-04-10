import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Popover, PopoverTrigger, PopoverContent, PopoverAnchor } from "./popover";

describe("Popover", () => {
  it("renders trigger", () => {
    render(
      <Popover>
        <PopoverTrigger>Open popover</PopoverTrigger>
        <PopoverContent>Popover body</PopoverContent>
      </Popover>,
    );
    expect(screen.getByText("Open popover")).toBeInTheDocument();
  });

  it("renders content when open", () => {
    render(
      <Popover open>
        <PopoverTrigger>Trigger</PopoverTrigger>
        <PopoverContent>Popover content here</PopoverContent>
      </Popover>,
    );
    expect(screen.getByText("Popover content here")).toBeInTheDocument();
  });

  it("applies data-slot to trigger", () => {
    const { container } = render(
      <Popover>
        <PopoverTrigger>Trigger</PopoverTrigger>
        <PopoverContent>Content</PopoverContent>
      </Popover>,
    );
    expect(
      container.querySelector('[data-slot="popover-trigger"]'),
    ).toBeTruthy();
  });

  it("renders PopoverAnchor", () => {
    const { container } = render(
      <Popover>
        <PopoverAnchor>Anchor element</PopoverAnchor>
        <PopoverTrigger>Trigger</PopoverTrigger>
        <PopoverContent>Content</PopoverContent>
      </Popover>,
    );
    expect(
      container.querySelector('[data-slot="popover-anchor"]'),
    ).toBeTruthy();
  });
});
