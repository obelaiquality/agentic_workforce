import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "./dropdown-menu";

describe("DropdownMenu", () => {
  it("renders trigger", () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Options</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Item</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(screen.getByText("Options")).toBeInTheDocument();
  });

  it("renders content when open", () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Actions</DropdownMenuLabel>
          <DropdownMenuItem>Edit</DropdownMenuItem>
          <DropdownMenuItem>Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(screen.getByText("Actions")).toBeInTheDocument();
    expect(screen.getByText("Edit")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
  });

  it("renders DropdownMenuShortcut", () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>
            Copy
            <DropdownMenuShortcut>Ctrl+C</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(screen.getByText("Ctrl+C")).toBeInTheDocument();
  });

  it("renders DropdownMenuGroup", () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuGroup>
            <DropdownMenuItem>Profile</DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(screen.getByText("Profile")).toBeInTheDocument();
  });

  it("applies data-slot to trigger", () => {
    const { container } = render(
      <DropdownMenu>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Item</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(
      container.querySelector('[data-slot="dropdown-menu-trigger"]'),
    ).toBeTruthy();
  });

  it("renders DropdownMenuContent with custom className", () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent className="my-content">
          <DropdownMenuItem>Item</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const el = document.querySelector('[data-slot="dropdown-menu-content"]');
    expect(el?.className).toContain("my-content");
  });

  it("renders DropdownMenuItem with inset and destructive variant", () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem inset variant="destructive" className="my-item">
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const el = document.querySelector('[data-slot="dropdown-menu-item"]');
    expect(el?.getAttribute("data-inset")).toBe("true");
    expect(el?.getAttribute("data-variant")).toBe("destructive");
    expect(el?.className).toContain("my-item");
  });

  it("renders DropdownMenuItem with default variant", () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Default</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const el = document.querySelector('[data-slot="dropdown-menu-item"]');
    expect(el?.getAttribute("data-variant")).toBe("default");
  });

  it("renders DropdownMenuCheckboxItem checked", () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuCheckboxItem checked className="my-cb">
            Show Grid
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const el = document.querySelector('[data-slot="dropdown-menu-checkbox-item"]');
    expect(el).toBeTruthy();
    expect(el?.className).toContain("my-cb");
    expect(screen.getByText("Show Grid")).toBeInTheDocument();
  });

  it("renders DropdownMenuCheckboxItem unchecked", () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuCheckboxItem checked={false}>
            Unchecked
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(
      document.querySelector('[data-slot="dropdown-menu-checkbox-item"]'),
    ).toBeTruthy();
  });

  it("renders DropdownMenuRadioGroup and DropdownMenuRadioItem", () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuRadioGroup value="small">
            <DropdownMenuRadioItem value="small" className="radio-sm">
              Small
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="large">Large</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(
      document.querySelector('[data-slot="dropdown-menu-radio-group"]'),
    ).toBeTruthy();
    const radio = document.querySelector('[data-slot="dropdown-menu-radio-item"]');
    expect(radio).toBeTruthy();
    expect(radio?.className).toContain("radio-sm");
    expect(screen.getByText("Small")).toBeInTheDocument();
    expect(screen.getByText("Large")).toBeInTheDocument();
  });

  it("renders DropdownMenuLabel with inset and custom className", () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel inset className="my-label">
            Actions
          </DropdownMenuLabel>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const el = document.querySelector('[data-slot="dropdown-menu-label"]');
    expect(el?.getAttribute("data-inset")).toBe("true");
    expect(el?.className).toContain("my-label");
  });

  it("renders DropdownMenuSeparator with custom className", () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuSeparator className="my-sep" />
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const el = document.querySelector('[data-slot="dropdown-menu-separator"]');
    expect(el?.className).toContain("my-sep");
  });

  it("renders DropdownMenuShortcut with custom className", () => {
    const { container } = render(
      <DropdownMenuShortcut className="my-short">Ctrl+V</DropdownMenuShortcut>,
    );
    const el = container.querySelector('[data-slot="dropdown-menu-shortcut"]');
    expect(el?.className).toContain("my-short");
  });

  it("renders DropdownMenuGroup with data-slot", () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuGroup>
            <DropdownMenuItem>Grouped</DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(
      document.querySelector('[data-slot="dropdown-menu-group"]'),
    ).toBeTruthy();
  });

  it("renders DropdownMenuSub with SubTrigger", () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>More</DropdownMenuSubTrigger>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(screen.getByText("More")).toBeInTheDocument();
    expect(
      document.querySelector('[data-slot="dropdown-menu-sub-trigger"]'),
    ).toBeTruthy();
  });

  it("renders DropdownMenuSubTrigger with inset and custom className", () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger inset className="my-sub-trig">
              SubItem
            </DropdownMenuSubTrigger>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const el = document.querySelector('[data-slot="dropdown-menu-sub-trigger"]');
    expect(el?.getAttribute("data-inset")).toBe("true");
    expect(el?.className).toContain("my-sub-trig");
  });

  it("renders DropdownMenuPortal", () => {
    const { baseElement } = render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuPortal>
          <div data-testid="portal-child">Portaled</div>
        </DropdownMenuPortal>
      </DropdownMenu>,
    );
    expect(baseElement.querySelector('[data-testid="portal-child"]')).toBeTruthy();
  });

  /* v8 ignore next 2 */
  // DropdownMenuSubContent requires pointer-driven sub-menu opening
  // that cannot be reliably simulated in jsdom.
});
