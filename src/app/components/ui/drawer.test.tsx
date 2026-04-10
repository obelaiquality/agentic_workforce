import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  Drawer,
  DrawerTrigger,
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
});
