import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuTrigger,
  NavigationMenuContent,
  NavigationMenuLink,
  NavigationMenuIndicator,
  NavigationMenuViewport,
  navigationMenuTriggerStyle,
} from "./navigation-menu";

describe("NavigationMenu", () => {
  it("renders NavigationMenu with a list", () => {
    const { container } = render(
      <NavigationMenu>
        <NavigationMenuList>
          <NavigationMenuItem>
            <NavigationMenuLink>Home</NavigationMenuLink>
          </NavigationMenuItem>
        </NavigationMenuList>
      </NavigationMenu>,
    );
    expect(
      container.querySelector('[data-slot="navigation-menu"]'),
    ).toBeTruthy();
    expect(screen.getByText("Home")).toBeInTheDocument();
  });

  it("renders NavigationMenuTrigger", () => {
    render(
      <NavigationMenu>
        <NavigationMenuList>
          <NavigationMenuItem>
            <NavigationMenuTrigger>Products</NavigationMenuTrigger>
            <NavigationMenuContent>
              <NavigationMenuLink>Product A</NavigationMenuLink>
            </NavigationMenuContent>
          </NavigationMenuItem>
        </NavigationMenuList>
      </NavigationMenu>,
    );
    expect(screen.getByText("Products")).toBeInTheDocument();
  });

  it("renders NavigationMenuLink with data-slot", () => {
    const { container } = render(
      <NavigationMenu>
        <NavigationMenuList>
          <NavigationMenuItem>
            <NavigationMenuLink>About</NavigationMenuLink>
          </NavigationMenuItem>
        </NavigationMenuList>
      </NavigationMenu>,
    );
    expect(
      container.querySelector('[data-slot="navigation-menu-link"]'),
    ).toBeTruthy();
  });

  it("renders with viewport disabled", () => {
    const { container } = render(
      <NavigationMenu viewport={false}>
        <NavigationMenuList>
          <NavigationMenuItem>
            <NavigationMenuLink>Link</NavigationMenuLink>
          </NavigationMenuItem>
        </NavigationMenuList>
      </NavigationMenu>,
    );
    expect(
      container.querySelector('[data-slot="navigation-menu-viewport"]'),
    ).toBeNull();
  });

  it("renders with viewport enabled by default (data-viewport=true)", () => {
    const { container } = render(
      <NavigationMenu>
        <NavigationMenuList>
          <NavigationMenuItem>
            <NavigationMenuLink>Link</NavigationMenuLink>
          </NavigationMenuItem>
        </NavigationMenuList>
      </NavigationMenu>,
    );
    const menu = container.querySelector('[data-slot="navigation-menu"]');
    expect(menu?.getAttribute("data-viewport")).toBe("true");
  });

  it("renders NavigationMenuIndicator without crashing", () => {
    // NavigationMenuIndicator is only visible when Radix state is active,
    // but we verify the component renders without error
    expect(() =>
      render(
        <NavigationMenu>
          <NavigationMenuList>
            <NavigationMenuItem>
              <NavigationMenuLink>Home</NavigationMenuLink>
            </NavigationMenuItem>
            <NavigationMenuIndicator />
          </NavigationMenuList>
        </NavigationMenu>,
      ),
    ).not.toThrow();
  });

  it("renders NavigationMenuViewport component without crashing", () => {
    // NavigationMenuViewport is rendered by Radix internally; explicit usage
    // should not crash even if the viewport element is not yet mounted
    expect(() =>
      render(
        <NavigationMenu viewport={false}>
          <NavigationMenuList>
            <NavigationMenuItem>
              <NavigationMenuLink>Link</NavigationMenuLink>
            </NavigationMenuItem>
          </NavigationMenuList>
          <NavigationMenuViewport />
        </NavigationMenu>,
      ),
    ).not.toThrow();
  });

  it("NavigationMenuTrigger renders chevron icon", () => {
    const { container } = render(
      <NavigationMenu>
        <NavigationMenuList>
          <NavigationMenuItem>
            <NavigationMenuTrigger>Menu</NavigationMenuTrigger>
            <NavigationMenuContent>
              <NavigationMenuLink>Item</NavigationMenuLink>
            </NavigationMenuContent>
          </NavigationMenuItem>
        </NavigationMenuList>
      </NavigationMenu>,
    );
    // The trigger should render an SVG chevron icon
    const trigger = container.querySelector('[data-slot="navigation-menu-trigger"]');
    expect(trigger).toBeTruthy();
    expect(trigger?.querySelector("svg")).toBeTruthy();
  });

  it("NavigationMenuContent renders without crashing", () => {
    // Content is only mounted when trigger is active in Radix;
    // verify the component can render alongside a trigger without error
    expect(() =>
      render(
        <NavigationMenu>
          <NavigationMenuList>
            <NavigationMenuItem>
              <NavigationMenuTrigger>Products</NavigationMenuTrigger>
              <NavigationMenuContent>
                <NavigationMenuLink>Product A</NavigationMenuLink>
              </NavigationMenuContent>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>,
      ),
    ).not.toThrow();
  });

  it("renders NavigationMenuItem with data-slot and custom className", () => {
    const { container } = render(
      <NavigationMenu>
        <NavigationMenuList>
          <NavigationMenuItem className="custom-item">
            <NavigationMenuLink>Link</NavigationMenuLink>
          </NavigationMenuItem>
        </NavigationMenuList>
      </NavigationMenu>,
    );
    const item = container.querySelector('[data-slot="navigation-menu-item"]');
    expect(item).toBeTruthy();
    expect(item?.classList.contains("custom-item")).toBe(true);
  });

  it("NavigationMenuList renders with data-slot", () => {
    const { container } = render(
      <NavigationMenu>
        <NavigationMenuList className="custom-list">
          <NavigationMenuItem>
            <NavigationMenuLink>Link</NavigationMenuLink>
          </NavigationMenuItem>
        </NavigationMenuList>
      </NavigationMenu>,
    );
    const list = container.querySelector('[data-slot="navigation-menu-list"]');
    expect(list).toBeTruthy();
    expect(list?.classList.contains("custom-list")).toBe(true);
  });

  it("navigationMenuTriggerStyle returns a string class", () => {
    const cls = navigationMenuTriggerStyle();
    expect(typeof cls).toBe("string");
    expect(cls.length).toBeGreaterThan(0);
  });
});
