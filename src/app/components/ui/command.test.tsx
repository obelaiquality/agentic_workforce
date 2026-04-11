import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

beforeEach(() => {
  global.ResizeObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  }));

  // cmdk calls scrollIntoView on selected items
  Element.prototype.scrollIntoView = vi.fn();
});
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandItem,
  CommandEmpty,
  CommandGroup,
  CommandSeparator,
  CommandShortcut,
} from "./command";

describe("Command", () => {
  it("renders Command with input and list", () => {
    const { container } = render(
      <Command>
        <CommandInput placeholder="Search..." />
        <CommandList>
          <CommandItem>Item 1</CommandItem>
        </CommandList>
      </Command>,
    );
    expect(container.querySelector('[data-slot="command"]')).toBeTruthy();
  });

  it("renders CommandInput with placeholder", () => {
    render(
      <Command>
        <CommandInput placeholder="Type a command..." />
        <CommandList />
      </Command>,
    );
    expect(
      screen.getByPlaceholderText("Type a command..."),
    ).toBeInTheDocument();
  });

  it("renders CommandGroup with items", () => {
    render(
      <Command>
        <CommandInput placeholder="Search..." />
        <CommandList>
          <CommandGroup heading="Actions">
            <CommandItem>Action 1</CommandItem>
            <CommandItem>Action 2</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>,
    );
    expect(screen.getByText("Action 1")).toBeInTheDocument();
    expect(screen.getByText("Action 2")).toBeInTheDocument();
  });

  it("renders CommandEmpty", () => {
    render(
      <Command>
        <CommandInput placeholder="Search..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
        </CommandList>
      </Command>,
    );
    expect(screen.getByText("No results found.")).toBeInTheDocument();
  });

  it("renders CommandShortcut", () => {
    render(
      <Command>
        <CommandList>
          <CommandItem>
            Save
            <CommandShortcut>Ctrl+S</CommandShortcut>
          </CommandItem>
        </CommandList>
      </Command>,
    );
    expect(screen.getByText("Ctrl+S")).toBeInTheDocument();
  });

  it("renders CommandSeparator", () => {
    const { container } = render(
      <Command>
        <CommandList>
          <CommandItem>Item A</CommandItem>
          <CommandSeparator />
          <CommandItem>Item B</CommandItem>
        </CommandList>
      </Command>,
    );
    expect(container.querySelector('[data-slot="command-separator"]')).toBeTruthy();
  });

  it("renders Command with custom className", () => {
    const { container } = render(
      <Command className="custom-class">
        <CommandList />
      </Command>,
    );
    const cmd = container.querySelector('[data-slot="command"]');
    expect(cmd?.className).toContain("custom-class");
  });

  it("renders CommandInput with custom className", () => {
    const { container } = render(
      <Command>
        <CommandInput className="input-custom" placeholder="Search..." />
        <CommandList />
      </Command>,
    );
    const input = container.querySelector('[data-slot="command-input"]');
    expect(input?.className).toContain("input-custom");
  });

  it("renders CommandList with custom className", () => {
    const { container } = render(
      <Command>
        <CommandList className="list-custom" />
      </Command>,
    );
    const list = container.querySelector('[data-slot="command-list"]');
    expect(list?.className).toContain("list-custom");
  });

  it("renders CommandGroup with custom className", () => {
    const { container } = render(
      <Command>
        <CommandList>
          <CommandGroup className="group-custom" heading="Test Group">
            <CommandItem>Item</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>,
    );
    const group = container.querySelector('[data-slot="command-group"]');
    expect(group?.className).toContain("group-custom");
  });

  it("renders CommandItem with custom className", () => {
    const { container } = render(
      <Command>
        <CommandList>
          <CommandItem className="item-custom">Custom Item</CommandItem>
        </CommandList>
      </Command>,
    );
    const item = container.querySelector('[data-slot="command-item"]');
    expect(item?.className).toContain("item-custom");
  });

  it("renders CommandShortcut with custom className", () => {
    const { container } = render(
      <Command>
        <CommandList>
          <CommandItem>
            Action
            <CommandShortcut className="shortcut-custom">K</CommandShortcut>
          </CommandItem>
        </CommandList>
      </Command>,
    );
    const shortcut = container.querySelector('[data-slot="command-shortcut"]');
    expect(shortcut?.className).toContain("shortcut-custom");
  });

  it("renders CommandSeparator with custom className", () => {
    const { container } = render(
      <Command>
        <CommandList>
          <CommandSeparator className="sep-custom" />
        </CommandList>
      </Command>,
    );
    const sep = container.querySelector('[data-slot="command-separator"]');
    expect(sep?.className).toContain("sep-custom");
  });

  it("renders CommandEmpty with data-slot attribute", () => {
    const { container } = render(
      <Command>
        <CommandList>
          <CommandEmpty>Nothing here</CommandEmpty>
        </CommandList>
      </Command>,
    );
    const empty = container.querySelector('[data-slot="command-empty"]');
    expect(empty).toBeTruthy();
    expect(empty?.textContent).toBe("Nothing here");
  });

  it("renders CommandInput wrapper with search icon", () => {
    const { container } = render(
      <Command>
        <CommandInput placeholder="Type..." />
        <CommandList />
      </Command>,
    );
    const wrapper = container.querySelector('[data-slot="command-input-wrapper"]');
    expect(wrapper).toBeTruthy();
    // Should contain an SVG icon (SearchIcon)
    const svg = wrapper?.querySelector("svg");
    expect(svg).toBeTruthy();
  });

  it("renders CommandDialog when open", () => {
    render(
      <CommandDialog open={true}>
        <CommandInput placeholder="Search commands..." />
        <CommandList>
          <CommandItem>Test Command</CommandItem>
        </CommandList>
      </CommandDialog>,
    );
    expect(screen.getByPlaceholderText("Search commands...")).toBeInTheDocument();
    expect(screen.getByText("Test Command")).toBeInTheDocument();
  });

  it("renders CommandDialog with custom title and description", () => {
    render(
      <CommandDialog open={true} title="Custom Title" description="Custom Description">
        <CommandList>
          <CommandItem>Dialog Item</CommandItem>
        </CommandList>
      </CommandDialog>,
    );
    expect(screen.getByText("Custom Title")).toBeInTheDocument();
    expect(screen.getByText("Custom Description")).toBeInTheDocument();
  });

  it("renders CommandDialog with default title and description", () => {
    render(
      <CommandDialog open={true}>
        <CommandList>
          <CommandItem>Default Item</CommandItem>
        </CommandList>
      </CommandDialog>,
    );
    expect(screen.getByText("Command Palette")).toBeInTheDocument();
    expect(screen.getByText("Search for a command to run...")).toBeInTheDocument();
  });

  it("does not render CommandDialog content when closed", () => {
    render(
      <CommandDialog open={false}>
        <CommandList>
          <CommandItem>Hidden Item</CommandItem>
        </CommandList>
      </CommandDialog>,
    );
    expect(screen.queryByText("Hidden Item")).not.toBeInTheDocument();
  });
});
