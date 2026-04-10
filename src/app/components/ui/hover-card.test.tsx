import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "./hover-card";

describe("HoverCard", () => {
  it("renders trigger", () => {
    render(
      <HoverCard>
        <HoverCardTrigger>Hover me</HoverCardTrigger>
        <HoverCardContent>Card content</HoverCardContent>
      </HoverCard>,
    );
    expect(screen.getByText("Hover me")).toBeInTheDocument();
  });

  it("renders content when open", () => {
    render(
      <HoverCard open>
        <HoverCardTrigger>Trigger</HoverCardTrigger>
        <HoverCardContent>Detailed info</HoverCardContent>
      </HoverCard>,
    );
    expect(screen.getByText("Detailed info")).toBeInTheDocument();
  });

  it("applies data-slot to trigger", () => {
    const { container } = render(
      <HoverCard>
        <HoverCardTrigger>Trigger</HoverCardTrigger>
        <HoverCardContent>Content</HoverCardContent>
      </HoverCard>,
    );
    expect(
      container.querySelector('[data-slot="hover-card-trigger"]'),
    ).toBeTruthy();
  });
});
