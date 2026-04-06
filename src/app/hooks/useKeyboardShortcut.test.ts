/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { fireEvent } from "@testing-library/dom";
import { useKeyboardShortcut, useKeyboardShortcuts } from "./useKeyboardShortcut";

describe("useKeyboardShortcut", () => {
  it("calls handler when matching key is pressed", () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcut({ key: "k", modifiers: ["meta"], handler }));
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("does not call handler for non-matching key", () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcut({ key: "k", modifiers: ["meta"], handler }));
    fireEvent.keyDown(window, { key: "j", metaKey: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not call handler without required modifier", () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcut({ key: "k", modifiers: ["meta"], handler }));
    fireEvent.keyDown(window, { key: "k" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not fire when disabled", () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcut({ key: "k", modifiers: ["meta"], handler, enabled: false }));
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it("works with no modifiers", () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcut({ key: "?", handler }));
    fireEvent.keyDown(window, { key: "?" });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("skips when input is focused", () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcut({ key: "k", modifiers: ["meta"], handler }));
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: "k", metaKey: true });
    document.body.removeChild(input);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("useKeyboardShortcuts", () => {
  it("handles multiple shortcuts", () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts([
        { key: "1", modifiers: ["meta"], handler: handler1 },
        { key: "2", modifiers: ["meta"], handler: handler2 },
      ]),
    );
    fireEvent.keyDown(window, { key: "1", metaKey: true });
    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "2", metaKey: true });
    expect(handler2).toHaveBeenCalledOnce();
  });

  it("only fires first matching shortcut", () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts([
        { key: "1", modifiers: ["meta"], handler: handler1 },
        { key: "1", modifiers: ["meta"], handler: handler2 },
      ]),
    );
    fireEvent.keyDown(window, { key: "1", metaKey: true });
    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).not.toHaveBeenCalled();
  });
});
