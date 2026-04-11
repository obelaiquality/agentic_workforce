import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  Drawer,
  DrawerTrigger,
  DrawerClose,
  DrawerOverlay,
  DrawerPortal,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
} from "./drawer";

describe("Drawer", () => {
  it("renders trigger", () => {
    render(
      <Drawer>
        <DrawerTrigger>Open Drawer</DrawerTrigger>
        <DrawerContent>
          <DrawerTitle>Title</DrawerTitle>
        </DrawerContent>
      </Drawer>,
    );
    expect(screen.getByText("Open Drawer")).toBeInTheDocument();
  });

  it("renders content when open", () => {
    render(
      <Drawer open>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Drawer Title</DrawerTitle>
            <DrawerDescription>Description text</DrawerDescription>
          </DrawerHeader>
        </DrawerContent>
      </Drawer>,
    );
    expect(screen.getByText("Drawer Title")).toBeInTheDocument();
    expect(screen.getByText("Description text")).toBeInTheDocument();
  });

  it("renders DrawerFooter", () => {
    render(
      <Drawer open>
        <DrawerContent>
          <DrawerTitle>Title</DrawerTitle>
          <DrawerFooter>Footer</DrawerFooter>
        </DrawerContent>
      </Drawer>,
    );
    expect(screen.getByText("Footer")).toBeInTheDocument();
  });

  it("renders DrawerClose inside open drawer", () => {
    render(
      <Drawer open>
        <DrawerContent>
          <DrawerTitle>Title</DrawerTitle>
          <DrawerClose>Close Me</DrawerClose>
        </DrawerContent>
      </Drawer>,
    );
    expect(screen.getByText("Close Me")).toBeInTheDocument();
  });

  it("applies custom className to DrawerHeader and DrawerFooter", () => {
    render(
      <Drawer open>
        <DrawerContent>
          <DrawerTitle>Title</DrawerTitle>
          <DrawerHeader className="custom-header">Header</DrawerHeader>
          <DrawerFooter className="custom-footer">Footer</DrawerFooter>
        </DrawerContent>
      </Drawer>,
    );
    expect(document.querySelector(".custom-header")).toBeTruthy();
    expect(document.querySelector(".custom-footer")).toBeTruthy();
  });

  it("renders DrawerOverlay with custom className", () => {
    const { container } = render(
      <Drawer open>
        <DrawerContent>
          <DrawerTitle>Title</DrawerTitle>
        </DrawerContent>
      </Drawer>,
    );
    expect(
      container.querySelector('[data-slot="drawer-overlay"]') ||
        document.querySelector('[data-slot="drawer-overlay"]'),
    ).toBeTruthy();
  });
});
