import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "./sheet";

describe("Sheet", () => {
  it("renders trigger", () => {
    render(
      <Sheet>
        <SheetTrigger>Open Sheet</SheetTrigger>
        <SheetContent>
          <SheetTitle>Title</SheetTitle>
        </SheetContent>
      </Sheet>,
    );
    expect(screen.getByText("Open Sheet")).toBeInTheDocument();
  });

  it("renders content when open", () => {
    render(
      <Sheet open>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Sheet Title</SheetTitle>
            <SheetDescription>Sheet description</SheetDescription>
          </SheetHeader>
        </SheetContent>
      </Sheet>,
    );
    expect(screen.getByText("Sheet Title")).toBeInTheDocument();
    expect(screen.getByText("Sheet description")).toBeInTheDocument();
  });

  it("renders SheetFooter", () => {
    render(
      <Sheet open>
        <SheetContent>
          <SheetTitle>Title</SheetTitle>
          <SheetFooter>Footer content</SheetFooter>
        </SheetContent>
      </Sheet>,
    );
    expect(screen.getByText("Footer content")).toBeInTheDocument();
  });

  it("has close button with sr-only label", () => {
    render(
      <Sheet open>
        <SheetContent>
          <SheetTitle>Title</SheetTitle>
        </SheetContent>
      </Sheet>,
    );
    expect(screen.getByText("Close")).toBeInTheDocument();
  });
});
