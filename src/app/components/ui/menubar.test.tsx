import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  Menubar,
  MenubarMenu,
  MenubarTrigger,
  MenubarContent,
  MenubarItem,
  MenubarLabel,
  MenubarSeparator,
  MenubarShortcut,
} from "./menubar";

describe("Menubar", () => {
  it("renders Menubar with a trigger", () => {
    render(
      <Menubar>
        <MenubarMenu>
          <MenubarTrigger>File</MenubarTrigger>
          <MenubarContent>
            <MenubarItem>New</MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>,
    );
    expect(screen.getByText("File")).toBeInTheDocument();
  });

  it("renders multiple menu triggers", () => {
    render(
      <Menubar>
        <MenubarMenu>
          <MenubarTrigger>File</MenubarTrigger>
          <MenubarContent>
            <MenubarItem>New</MenubarItem>
          </MenubarContent>
        </MenubarMenu>
        <MenubarMenu>
          <MenubarTrigger>Edit</MenubarTrigger>
          <MenubarContent>
            <MenubarItem>Undo</MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>,
    );
    expect(screen.getByText("File")).toBeInTheDocument();
    expect(screen.getByText("Edit")).toBeInTheDocument();
  });

  it("applies data-slot to menubar", () => {
    const { container } = render(
      <Menubar>
        <MenubarMenu>
          <MenubarTrigger>File</MenubarTrigger>
          <MenubarContent>
            <MenubarItem>New</MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>,
    );
    expect(
      container.querySelector('[data-slot="menubar"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-slot="menubar-trigger"]'),
    ).toBeTruthy();
  });

  it("renders MenubarShortcut standalone", () => {
    const { container } = render(
      <MenubarShortcut>Ctrl+N</MenubarShortcut>,
    );
    expect(
      container.querySelector('[data-slot="menubar-shortcut"]'),
    ).toBeTruthy();
  });

  it("renders MenubarLabel standalone", () => {
    const { container } = render(<MenubarLabel>Section</MenubarLabel>);
    expect(
      container.querySelector('[data-slot="menubar-label"]'),
    ).toBeTruthy();
  });
});
