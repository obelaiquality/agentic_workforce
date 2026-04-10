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
});
