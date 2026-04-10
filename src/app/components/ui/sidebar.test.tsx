import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
  SidebarInset,
} from "./sidebar";

// Mock useIsMobile to return false (desktop) by default
vi.mock("./use-mobile", () => ({
  useIsMobile: () => false,
}));

beforeEach(() => {
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
});
