import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from "./context-menu";

describe("ContextMenu", () => {
  it("renders trigger content", () => {
    render(
      <ContextMenu>
        <ContextMenuTrigger>Right click me</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem>Action</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>,
    );
    expect(screen.getByText("Right click me")).toBeInTheDocument();
  });

  it("applies data-slot to trigger", () => {
    const { container } = render(
      <ContextMenu>
        <ContextMenuTrigger>Target</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem>Item</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>,
    );
    expect(
      container.querySelector('[data-slot="context-menu-trigger"]'),
    ).toBeTruthy();
  });

  it("renders ContextMenuShortcut", () => {
    const { container } = render(
      <ContextMenuShortcut>Ctrl+Z</ContextMenuShortcut>,
    );
    expect(
      container.querySelector('[data-slot="context-menu-shortcut"]'),
    ).toBeTruthy();
  });

  it("renders ContextMenuLabel standalone", () => {
    const { container } = render(
      <ContextMenuLabel>Section</ContextMenuLabel>,
    );
    expect(
      container.querySelector('[data-slot="context-menu-label"]'),
    ).toBeTruthy();
  });

  it("renders ContextMenuSeparator standalone", () => {
    const { container } = render(<ContextMenuSeparator />);
    expect(
      container.querySelector('[data-slot="context-menu-separator"]'),
    ).toBeTruthy();
  });
});
