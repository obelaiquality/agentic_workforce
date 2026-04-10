import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./tabs";

describe("Tabs", () => {
  it("renders compound component without crashing", () => {
    const { container } = render(
      <Tabs defaultValue="tab1">
        <TabsList>
          <TabsTrigger value="tab1">Tab 1</TabsTrigger>
          <TabsTrigger value="tab2">Tab 2</TabsTrigger>
        </TabsList>
        <TabsContent value="tab1">Content 1</TabsContent>
        <TabsContent value="tab2">Content 2</TabsContent>
      </Tabs>,
    );
    expect(container.firstChild).toBeTruthy();
  });

  it("renders tab triggers", () => {
    const { container } = render(
      <Tabs defaultValue="tab1">
        <TabsList>
          <TabsTrigger value="tab1">Tab 1</TabsTrigger>
          <TabsTrigger value="tab2">Tab 2</TabsTrigger>
        </TabsList>
        <TabsContent value="tab1">Content 1</TabsContent>
        <TabsContent value="tab2">Content 2</TabsContent>
      </Tabs>,
    );
    expect(container.textContent).toContain("Tab 1");
    expect(container.textContent).toContain("Tab 2");
  });

  it("renders active tab content", () => {
    const { container } = render(
      <Tabs defaultValue="tab1">
        <TabsList>
          <TabsTrigger value="tab1">Tab 1</TabsTrigger>
        </TabsList>
        <TabsContent value="tab1">Active Content</TabsContent>
      </Tabs>,
    );
    expect(container.textContent).toContain("Active Content");
  });

  it("forwards className to Tabs root", () => {
    const { container } = render(
      <Tabs defaultValue="tab1" className="custom-class">
        <TabsList>
          <TabsTrigger value="tab1">Tab 1</TabsTrigger>
        </TabsList>
        <TabsContent value="tab1">Content</TabsContent>
      </Tabs>,
    );
    expect(container.innerHTML).toContain("custom-class");
  });
});
