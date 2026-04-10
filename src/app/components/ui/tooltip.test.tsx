import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "./tooltip";

beforeEach(() => {
  global.ResizeObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  }));
});

describe("Tooltip", () => {
  it("renders trigger", () => {
    render(
      <Tooltip>
        <TooltipTrigger>Hover me</TooltipTrigger>
        <TooltipContent>Tooltip text</TooltipContent>
      </Tooltip>,
    );
    expect(screen.getByText("Hover me")).toBeInTheDocument();
  });

  it("renders with explicit TooltipProvider", () => {
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>Button</TooltipTrigger>
          <TooltipContent>Info</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    expect(screen.getByText("Button")).toBeInTheDocument();
  });

  it("applies data-slot to trigger", () => {
    const { container } = render(
      <Tooltip>
        <TooltipTrigger>Trigger</TooltipTrigger>
        <TooltipContent>Content</TooltipContent>
      </Tooltip>,
    );
    expect(
      container.querySelector('[data-slot="tooltip-trigger"]'),
    ).toBeTruthy();
  });

  it("renders content when open (defaultOpen)", () => {
    render(
      <Tooltip defaultOpen>
        <TooltipTrigger>Trigger</TooltipTrigger>
        <TooltipContent>Visible tooltip</TooltipContent>
      </Tooltip>,
    );
    const matches = screen.getAllByText("Visible tooltip");
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });
});
