import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuTrigger,
  NavigationMenuContent,
  NavigationMenuLink,
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
});
