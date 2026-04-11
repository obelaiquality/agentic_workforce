import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogOverlay,
  DialogPortal,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./dialog";

describe("Dialog", () => {
  it("renders trigger", () => {
    render(
      <Dialog>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent>
          <DialogTitle>Title</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByText("Open")).toBeInTheDocument();
  });

  it("renders content when open", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Dialog Title</DialogTitle>
          <DialogDescription>Dialog description</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByText("Dialog Title")).toBeInTheDocument();
    expect(screen.getByText("Dialog description")).toBeInTheDocument();
  });

  it("renders DialogHeader and DialogFooter", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Header Title</DialogTitle>
          </DialogHeader>
          <DialogFooter>Footer content</DialogFooter>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByText("Header Title")).toBeInTheDocument();
    expect(screen.getByText("Footer content")).toBeInTheDocument();
  });

  it("has close button with sr-only label", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Title</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByText("Close")).toBeInTheDocument();
  });

  it("applies custom className to DialogHeader and DialogFooter", () => {
    const { container } = render(
      <Dialog open>
        <DialogContent>
          <DialogHeader className="custom-header">
            <DialogTitle>Title</DialogTitle>
          </DialogHeader>
          <DialogFooter className="custom-footer">Footer</DialogFooter>
        </DialogContent>
      </Dialog>,
    );
    expect(container.querySelector(".custom-header") || document.querySelector(".custom-header")).toBeTruthy();
    expect(container.querySelector(".custom-footer") || document.querySelector(".custom-footer")).toBeTruthy();
  });

  it("renders DialogClose inside open dialog", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Title</DialogTitle>
          <DialogClose>Dismiss</DialogClose>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByText("Dismiss")).toBeInTheDocument();
  });

  it("renders DialogOverlay with data-slot", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Title</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toBeTruthy();
  });

  it("applies custom className to DialogContent", () => {
    render(
      <Dialog open>
        <DialogContent className="custom-content">
          <DialogTitle>Title</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(document.querySelector(".custom-content")).toBeTruthy();
  });
});
