import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { KeyboardShortcutsDialog } from "./KeyboardShortcutsDialog";

describe("KeyboardShortcutsDialog", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<KeyboardShortcutsDialog />);
    expect(container.innerHTML).toBe("");
  });

  it("opens when ? is pressed", () => {
    render(<KeyboardShortcutsDialog />);
    fireEvent.keyDown(window, { key: "?" });
    expect(screen.getByText("Keyboard Shortcuts")).toBeTruthy();
  });

  it("closes on Escape", () => {
    render(<KeyboardShortcutsDialog />);
    fireEvent.keyDown(window, { key: "?" });
    expect(screen.getByText("Keyboard Shortcuts")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("Keyboard Shortcuts")).toBeNull();
  });

  it("shows navigation shortcuts", () => {
    render(<KeyboardShortcutsDialog />);
    fireEvent.keyDown(window, { key: "?" });
    expect(screen.getByText("Go to Work")).toBeTruthy();
    expect(screen.getByText("Go to Codebase")).toBeTruthy();
    expect(screen.getByText("Go to Console")).toBeTruthy();
    expect(screen.getByText("Go to Projects")).toBeTruthy();
    expect(screen.getByText("Go to Settings")).toBeTruthy();
  });

  it("shows command shortcuts", () => {
    render(<KeyboardShortcutsDialog />);
    fireEvent.keyDown(window, { key: "?" });
    expect(screen.getByText("Open command palette")).toBeTruthy();
    expect(screen.getByText("Show keyboard shortcuts")).toBeTruthy();
    expect(screen.getByText("Close dialog / palette")).toBeTruthy();
  });

  it("has close button", () => {
    render(<KeyboardShortcutsDialog />);
    fireEvent.keyDown(window, { key: "?" });
    const closeBtn = screen.getByLabelText("Close");
    expect(closeBtn).toBeTruthy();
    fireEvent.click(closeBtn);
    expect(screen.queryByText("Keyboard Shortcuts")).toBeNull();
  });

  it("toggles with ? key", () => {
    render(<KeyboardShortcutsDialog />);
    fireEvent.keyDown(window, { key: "?" });
    expect(screen.getByText("Keyboard Shortcuts")).toBeTruthy();
    fireEvent.keyDown(window, { key: "?" });
    expect(screen.queryByText("Keyboard Shortcuts")).toBeNull();
  });

  it("does not open when ? is pressed with meta key", () => {
    render(<KeyboardShortcutsDialog />);
    fireEvent.keyDown(window, { key: "?", metaKey: true });
    expect(screen.queryByText("Keyboard Shortcuts")).toBeNull();
  });

  it("closes on backdrop click", () => {
    render(<KeyboardShortcutsDialog />);
    fireEvent.keyDown(window, { key: "?" });
    const backdrop = document.querySelector(".fixed.inset-0.bg-black\\/60");
    if (backdrop) fireEvent.click(backdrop);
    expect(screen.queryByText("Keyboard Shortcuts")).toBeNull();
  });
});
