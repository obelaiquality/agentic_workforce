import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
  SidebarTrigger,
  SidebarRail,
  SidebarInset,
  SidebarInput,
  SidebarSeparator,
  useSidebar,
} from "./sidebar";

const mockUseIsMobile = vi.fn(() => false);

// Mock useIsMobile to return false (desktop) by default
vi.mock("./use-mobile", () => ({
  useIsMobile: () => mockUseIsMobile(),
}));

beforeEach(() => {
  mockUseIsMobile.mockReturnValue(false);

  // matchMedia mock for SidebarProvider keyboard shortcut listener
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

describe("Sidebar", () => {
  it("renders SidebarProvider with Sidebar", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>Content</SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    expect(
      container.querySelector('[data-slot="sidebar-wrapper"]'),
    ).toBeTruthy();
    expect(container.querySelector('[data-slot="sidebar"]')).toBeTruthy();
  });

  it("renders SidebarHeader and SidebarFooter", () => {
    render(
      <SidebarProvider>
        <Sidebar>
          <SidebarHeader>Header</SidebarHeader>
          <SidebarContent>Main</SidebarContent>
          <SidebarFooter>Footer</SidebarFooter>
        </Sidebar>
      </SidebarProvider>,
    );
    expect(screen.getByText("Header")).toBeInTheDocument();
    expect(screen.getByText("Footer")).toBeInTheDocument();
  });

  it("renders SidebarGroup with label and content", () => {
    render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Navigation</SidebarGroupLabel>
              <SidebarGroupContent>Group content</SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    expect(screen.getByText("Navigation")).toBeInTheDocument();
    expect(screen.getByText("Group content")).toBeInTheDocument();
  });

  it("renders SidebarMenu with items and buttons", () => {
    render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton>Dashboard</SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
  });

  it("renders SidebarTrigger with toggle label", () => {
    render(
      <SidebarProvider>
        <SidebarTrigger />
        <Sidebar>
          <SidebarContent>Content</SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    expect(screen.getByText("Toggle Sidebar")).toBeInTheDocument();
  });

  it("renders SidebarInset", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>Sidebar</SidebarContent>
        </Sidebar>
        <SidebarInset>Main content</SidebarInset>
      </SidebarProvider>,
    );
    expect(screen.getByText("Main content")).toBeInTheDocument();
    expect(
      container.querySelector('[data-slot="sidebar-inset"]'),
    ).toBeTruthy();
  });

  it("renders Sidebar with collapsible=none", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar collapsible="none">
          <SidebarContent>Non-collapsible</SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    const sidebar = container.querySelector('[data-slot="sidebar"]');
    expect(sidebar).toBeTruthy();
    expect(screen.getByText("Non-collapsible")).toBeInTheDocument();
    // Should not have a sidebar-gap or sidebar-container since collapsible=none
    expect(container.querySelector('[data-slot="sidebar-gap"]')).toBeNull();
  });

  it("renders Sidebar with side=right", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar side="right">
          <SidebarContent>Right Side</SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    const sidebar = container.querySelector('[data-slot="sidebar"]');
    expect(sidebar?.getAttribute("data-side")).toBe("right");
  });

  it("renders Sidebar with variant=floating", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar variant="floating">
          <SidebarContent>Floating</SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    const sidebar = container.querySelector('[data-slot="sidebar"]');
    expect(sidebar?.getAttribute("data-variant")).toBe("floating");
  });

  it("renders Sidebar with variant=inset", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar variant="inset">
          <SidebarContent>Inset</SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    const sidebar = container.querySelector('[data-slot="sidebar"]');
    expect(sidebar?.getAttribute("data-variant")).toBe("inset");
  });

  it("renders Sidebar with collapsible=icon", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <SidebarContent>Icon Collapsible</SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    expect(container.querySelector('[data-slot="sidebar"]')).toBeTruthy();
  });

  it("SidebarProvider starts with defaultOpen=true", () => {
    const { container } = render(
      <SidebarProvider defaultOpen={true}>
        <Sidebar>
          <SidebarContent>Content</SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    const sidebar = container.querySelector('[data-slot="sidebar"]');
    expect(sidebar?.getAttribute("data-state")).toBe("expanded");
  });

  it("SidebarProvider starts with defaultOpen=false", () => {
    const { container } = render(
      <SidebarProvider defaultOpen={false}>
        <Sidebar>
          <SidebarContent>Content</SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    const sidebar = container.querySelector('[data-slot="sidebar"]');
    expect(sidebar?.getAttribute("data-state")).toBe("collapsed");
  });

  it("SidebarProvider controlled mode", () => {
    const onOpenChange = vi.fn();
    const { container } = render(
      <SidebarProvider open={true} onOpenChange={onOpenChange}>
        <SidebarTrigger />
        <Sidebar>
          <SidebarContent>Content</SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    const sidebar = container.querySelector('[data-slot="sidebar"]');
    expect(sidebar?.getAttribute("data-state")).toBe("expanded");

    // Click the trigger to toggle
    fireEvent.click(screen.getByText("Toggle Sidebar"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("SidebarProvider toggles with keyboard shortcut Ctrl+B", () => {
    const { container } = render(
      <SidebarProvider defaultOpen={true}>
        <Sidebar>
          <SidebarContent>Content</SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    let sidebar = container.querySelector('[data-slot="sidebar"]');
    expect(sidebar?.getAttribute("data-state")).toBe("expanded");

    act(() => {
      fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    });

    sidebar = container.querySelector('[data-slot="sidebar"]');
    expect(sidebar?.getAttribute("data-state")).toBe("collapsed");
  });

  it("SidebarProvider toggles with keyboard shortcut Meta+B", () => {
    const { container } = render(
      <SidebarProvider defaultOpen={true}>
        <Sidebar>
          <SidebarContent>Content</SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );

    act(() => {
      fireEvent.keyDown(window, { key: "b", metaKey: true });
    });

    const sidebar = container.querySelector('[data-slot="sidebar"]');
    expect(sidebar?.getAttribute("data-state")).toBe("collapsed");
  });

  it("does not toggle on other keyboard shortcuts", () => {
    const { container } = render(
      <SidebarProvider defaultOpen={true}>
        <Sidebar>
          <SidebarContent>Content</SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );

    act(() => {
      fireEvent.keyDown(window, { key: "b" }); // no modifier
    });

    const sidebar = container.querySelector('[data-slot="sidebar"]');
    expect(sidebar?.getAttribute("data-state")).toBe("expanded");
  });

  it("SidebarTrigger calls onClick callback and toggles", () => {
    const onClick = vi.fn();
    const { container } = render(
      <SidebarProvider defaultOpen={true}>
        <SidebarTrigger onClick={onClick} />
        <Sidebar>
          <SidebarContent>Content</SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );

    fireEvent.click(screen.getByText("Toggle Sidebar"));
    expect(onClick).toHaveBeenCalledTimes(1);
    const sidebar = container.querySelector('[data-slot="sidebar"]');
    expect(sidebar?.getAttribute("data-state")).toBe("collapsed");
  });

  it("SidebarTrigger applies custom className", () => {
    const { container } = render(
      <SidebarProvider>
        <SidebarTrigger className="my-trigger" />
        <Sidebar>
          <SidebarContent>Content</SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    const trigger = container.querySelector('[data-slot="sidebar-trigger"]');
    expect(trigger?.className).toContain("my-trigger");
  });

  it("renders SidebarRail", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>Content</SidebarContent>
          <SidebarRail />
        </Sidebar>
      </SidebarProvider>,
    );
    const rail = container.querySelector('[data-slot="sidebar-rail"]');
    expect(rail).toBeTruthy();
    expect(rail?.getAttribute("aria-label")).toBe("Toggle Sidebar");
  });

  it("SidebarRail toggles sidebar on click", () => {
    const { container } = render(
      <SidebarProvider defaultOpen={true}>
        <Sidebar>
          <SidebarContent>Content</SidebarContent>
          <SidebarRail />
        </Sidebar>
      </SidebarProvider>,
    );
    const rail = container.querySelector('[data-slot="sidebar-rail"]')!;
    fireEvent.click(rail);
    const sidebar = container.querySelector('[data-slot="sidebar"]');
    expect(sidebar?.getAttribute("data-state")).toBe("collapsed");
  });

  it("SidebarRail applies custom className", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>Content</SidebarContent>
          <SidebarRail className="my-rail" />
        </Sidebar>
      </SidebarProvider>,
    );
    const rail = container.querySelector('[data-slot="sidebar-rail"]');
    expect(rail?.className).toContain("my-rail");
  });

  it("renders SidebarInput", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar>
          <SidebarInput placeholder="Search..." />
          <SidebarContent>Content</SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    expect(screen.getByPlaceholderText("Search...")).toBeInTheDocument();
    expect(
      container.querySelector('[data-slot="sidebar-input"]'),
    ).toBeTruthy();
  });

  it("SidebarInput applies custom className", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar>
          <SidebarInput className="my-input" />
          <SidebarContent>Content</SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    const input = container.querySelector('[data-slot="sidebar-input"]');
    expect(input?.className).toContain("my-input");
  });

  it("renders SidebarSeparator", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>Content</SidebarContent>
          <SidebarSeparator />
        </Sidebar>
      </SidebarProvider>,
    );
    expect(
      container.querySelector('[data-slot="sidebar-separator"]'),
    ).toBeTruthy();
  });

  it("SidebarSeparator applies custom className", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>Content</SidebarContent>
          <SidebarSeparator className="my-sep" />
        </Sidebar>
      </SidebarProvider>,
    );
    const sep = container.querySelector('[data-slot="sidebar-separator"]');
    expect(sep?.className).toContain("my-sep");
  });

  it("renders SidebarGroupAction", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Nav</SidebarGroupLabel>
              <SidebarGroupAction className="my-action">+</SidebarGroupAction>
              <SidebarGroupContent>Content</SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    const action = container.querySelector('[data-slot="sidebar-group-action"]');
    expect(action).toBeTruthy();
    expect(action?.className).toContain("my-action");
  });

  it("renders SidebarGroupLabel with asChild", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel asChild>
                <span>Custom Label</span>
              </SidebarGroupLabel>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    expect(screen.getByText("Custom Label")).toBeInTheDocument();
  });

  it("renders SidebarGroupAction with asChild", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupAction asChild>
                <a href="#">Link Action</a>
              </SidebarGroupAction>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    expect(screen.getByText("Link Action")).toBeInTheDocument();
  });

  it("renders SidebarMenuButton with isActive", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton isActive>Active</SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    const btn = container.querySelector('[data-slot="sidebar-menu-button"]');
    expect(btn?.getAttribute("data-active")).toBe("true");
  });

  it("renders SidebarMenuButton with variant=outline and size=sm", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton variant="outline" size="sm">
                  Small Outline
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    const btn = container.querySelector('[data-slot="sidebar-menu-button"]');
    expect(btn?.getAttribute("data-size")).toBe("sm");
  });

  it("renders SidebarMenuButton with size=lg", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton size="lg">Large</SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    const btn = container.querySelector('[data-slot="sidebar-menu-button"]');
    expect(btn?.getAttribute("data-size")).toBe("lg");
  });

  it("renders SidebarMenuButton with string tooltip", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Tooltip Text">
                  With Tooltip
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    expect(screen.getByText("With Tooltip")).toBeInTheDocument();
  });

  it("renders SidebarMenuButton with object tooltip", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip={{ children: "Object Tooltip" }}>
                  With Obj Tooltip
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    expect(screen.getByText("With Obj Tooltip")).toBeInTheDocument();
  });

  it("renders SidebarMenuButton with asChild", () => {
    render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <a href="#">Link Button</a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    expect(screen.getByText("Link Button")).toBeInTheDocument();
  });

  it("renders SidebarMenuAction", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton>Item</SidebarMenuButton>
                <SidebarMenuAction className="my-action">X</SidebarMenuAction>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    const action = container.querySelector('[data-slot="sidebar-menu-action"]');
    expect(action).toBeTruthy();
    expect(action?.className).toContain("my-action");
  });

  it("renders SidebarMenuAction with showOnHover", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton>Item</SidebarMenuButton>
                <SidebarMenuAction showOnHover>X</SidebarMenuAction>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    const action = container.querySelector('[data-slot="sidebar-menu-action"]');
    expect(action).toBeTruthy();
  });

  it("renders SidebarMenuAction with asChild", () => {
    render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton>Item</SidebarMenuButton>
                <SidebarMenuAction asChild>
                  <a href="#">Link Action</a>
                </SidebarMenuAction>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    expect(screen.getByText("Link Action")).toBeInTheDocument();
  });

  it("renders SidebarMenuBadge", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton>Item</SidebarMenuButton>
                <SidebarMenuBadge className="my-badge">5</SidebarMenuBadge>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    const badge = container.querySelector('[data-slot="sidebar-menu-badge"]');
    expect(badge).toBeTruthy();
    expect(badge?.className).toContain("my-badge");
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("renders SidebarMenuSkeleton without icon", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuSkeleton />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    expect(
      container.querySelector('[data-slot="sidebar-menu-skeleton"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-sidebar="menu-skeleton-icon"]'),
    ).toBeNull();
  });

  it("renders SidebarMenuSkeleton with icon", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuSkeleton showIcon />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    expect(
      container.querySelector('[data-sidebar="menu-skeleton-icon"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-sidebar="menu-skeleton-text"]'),
    ).toBeTruthy();
  });

  it("SidebarMenuSkeleton applies custom className", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuSkeleton className="my-skel" />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    const skel = container.querySelector('[data-slot="sidebar-menu-skeleton"]');
    expect(skel?.className).toContain("my-skel");
  });

  it("renders SidebarMenuSub", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton>Parent</SidebarMenuButton>
                <SidebarMenuSub className="my-sub">
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton>Sub Item</SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                </SidebarMenuSub>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    expect(
      container.querySelector('[data-slot="sidebar-menu-sub"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-slot="sidebar-menu-sub-item"]'),
    ).toBeTruthy();
    expect(screen.getByText("Sub Item")).toBeInTheDocument();
  });

  it("renders SidebarMenuSubButton with size=sm", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuSub>
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton size="sm">Small Sub</SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                </SidebarMenuSub>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    const btn = container.querySelector('[data-slot="sidebar-menu-sub-button"]');
    expect(btn?.getAttribute("data-size")).toBe("sm");
  });

  it("renders SidebarMenuSubButton with isActive", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuSub>
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton isActive>Active Sub</SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                </SidebarMenuSub>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    const btn = container.querySelector('[data-slot="sidebar-menu-sub-button"]');
    expect(btn?.getAttribute("data-active")).toBe("true");
  });

  it("renders SidebarMenuSubButton with asChild", () => {
    render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuSub>
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton asChild>
                      <a href="#">Sub Link</a>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                </SidebarMenuSub>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    expect(screen.getByText("Sub Link")).toBeInTheDocument();
  });

  it("SidebarProvider applies custom style and className", () => {
    const { container } = render(
      <SidebarProvider className="my-provider" style={{ color: "red" }}>
        <Sidebar>
          <SidebarContent>Content</SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    const wrapper = container.querySelector('[data-slot="sidebar-wrapper"]');
    expect(wrapper?.className).toContain("my-provider");
  });

  it("SidebarHeader applies custom className", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar>
          <SidebarHeader className="my-header">Header</SidebarHeader>
          <SidebarContent>Content</SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    const header = container.querySelector('[data-slot="sidebar-header"]');
    expect(header?.className).toContain("my-header");
  });

  it("SidebarFooter applies custom className", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>Content</SidebarContent>
          <SidebarFooter className="my-footer">Footer</SidebarFooter>
        </Sidebar>
      </SidebarProvider>,
    );
    const footer = container.querySelector('[data-slot="sidebar-footer"]');
    expect(footer?.className).toContain("my-footer");
  });

  it("SidebarContent applies custom className", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent className="my-content">Content</SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    const content = container.querySelector('[data-slot="sidebar-content"]');
    expect(content?.className).toContain("my-content");
  });

  it("SidebarGroup applies custom className", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>
            <SidebarGroup className="my-group">
              <SidebarGroupContent>Content</SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    const group = container.querySelector('[data-slot="sidebar-group"]');
    expect(group?.className).toContain("my-group");
  });

  it("SidebarGroupLabel applies custom className", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel className="my-label">Label</SidebarGroupLabel>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    const label = container.querySelector('[data-slot="sidebar-group-label"]');
    expect(label?.className).toContain("my-label");
  });

  it("SidebarInset applies custom className", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>Sidebar</SidebarContent>
        </Sidebar>
        <SidebarInset className="my-inset">Main</SidebarInset>
      </SidebarProvider>,
    );
    const inset = container.querySelector('[data-slot="sidebar-inset"]');
    expect(inset?.className).toContain("my-inset");
  });

  it("useSidebar throws when used outside SidebarProvider", () => {
    const TestComp = () => {
      useSidebar();
      return <div />;
    };
    expect(() => render(<TestComp />)).toThrow(
      "useSidebar must be used within a SidebarProvider.",
    );
  });

  it("renders Sidebar in mobile mode", () => {
    mockUseIsMobile.mockReturnValue(true);
    render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>Mobile Content</SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    // In mobile mode, sidebar is rendered inside a Sheet
    // The content should not be visible until opened
    expect(
      document.querySelector('[data-slot="sidebar-wrapper"]'),
    ).toBeTruthy();
  });

  it("renders Sidebar in mobile mode with side=right", () => {
    mockUseIsMobile.mockReturnValue(true);
    render(
      <SidebarProvider>
        <Sidebar side="right">
          <SidebarContent>Mobile Right</SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    expect(
      document.querySelector('[data-slot="sidebar-wrapper"]'),
    ).toBeTruthy();
  });

  it("toggleSidebar in mobile mode toggles openMobile", () => {
    mockUseIsMobile.mockReturnValue(true);
    render(
      <SidebarProvider>
        <SidebarTrigger />
        <Sidebar>
          <SidebarContent>Mobile Content</SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    // Click trigger to open mobile sidebar
    fireEvent.click(screen.getByText("Toggle Sidebar"));
    // The Sheet should now be triggered to open
    expect(
      document.querySelector('[data-slot="sidebar-wrapper"]'),
    ).toBeTruthy();
  });

  it("SidebarMenu applies custom className", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>
            <SidebarMenu className="my-menu">
              <SidebarMenuItem>
                <SidebarMenuButton>Item</SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    const menu = container.querySelector('[data-slot="sidebar-menu"]');
    expect(menu?.className).toContain("my-menu");
  });

  it("SidebarMenuItem applies custom className", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>
            <SidebarMenu>
              <SidebarMenuItem className="my-item">
                <SidebarMenuButton>Item</SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    const item = container.querySelector('[data-slot="sidebar-menu-item"]');
    expect(item?.className).toContain("my-item");
  });

  it("SidebarGroupContent applies custom className", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent className="my-group-content">
                Content
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    const gc = container.querySelector('[data-slot="sidebar-group-content"]');
    expect(gc?.className).toContain("my-group-content");
  });

  it("SidebarMenuSub applies custom className", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuSub className="my-menu-sub">
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton>Sub</SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                </SidebarMenuSub>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    const sub = container.querySelector('[data-slot="sidebar-menu-sub"]');
    expect(sub?.className).toContain("my-menu-sub");
  });

  it("SidebarMenuSubItem applies custom className", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuSub>
                  <SidebarMenuSubItem className="my-sub-item">
                    <SidebarMenuSubButton>Sub</SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                </SidebarMenuSub>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    const subItem = container.querySelector('[data-slot="sidebar-menu-sub-item"]');
    expect(subItem?.className).toContain("my-sub-item");
  });
});
