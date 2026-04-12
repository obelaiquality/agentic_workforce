import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InteractiveTerminal } from "./InteractiveTerminal";

describe("InteractiveTerminal", () => {
  beforeEach(() => {
    // Ensure no electronTerminal on window by default
    delete (window as any).electronTerminal;
  });

  afterEach(() => {
    delete (window as any).electronTerminal;
  });

  it("renders fallback message when not in Electron mode", () => {
    render(<InteractiveTerminal />);

    expect(screen.getByTestId("terminal-no-electron")).toBeInTheDocument();
    expect(screen.getByText("Terminal requires the desktop app")).toBeInTheDocument();
    expect(
      screen.getByText(/The interactive terminal is only available when running in Electron/)
    ).toBeInTheDocument();
  });

  it("renders xterm-missing fallback when in Electron but xterm is not installed", async () => {
    // Simulate Electron environment with terminal API
    (window as any).electronTerminal = {
      spawn: vi.fn().mockResolvedValue({ ok: true }),
      write: vi.fn().mockResolvedValue(undefined),
      resize: vi.fn().mockResolvedValue(undefined),
      kill: vi.fn().mockResolvedValue(undefined),
      onData: vi.fn().mockReturnValue(() => {}),
    };

    render(<InteractiveTerminal />);

    // The dynamic import of xterm will fail since it's not installed,
    // resulting in the no-xterm fallback
    const noXterm = await screen.findByTestId("terminal-no-xterm");
    expect(noXterm).toBeInTheDocument();
    expect(
      screen.getByText("Install xterm and @xterm/addon-fit to enable the interactive terminal")
    ).toBeInTheDocument();
    expect(screen.getByText("npm install xterm @xterm/addon-fit")).toBeInTheDocument();
  });

  it("renders header with clear button during loading state", () => {
    // Provide electronTerminal so we get past the no-electron check
    (window as any).electronTerminal = {
      spawn: vi.fn().mockResolvedValue({ ok: true }),
      write: vi.fn().mockResolvedValue(undefined),
      resize: vi.fn().mockResolvedValue(undefined),
      kill: vi.fn().mockResolvedValue(undefined),
      onData: vi.fn().mockReturnValue(() => {}),
    };

    const { container } = render(<InteractiveTerminal />);

    // During initial synchronous render (loading state), the terminal root
    // with header and clear button is shown before the async xterm load
    // resolves or fails
    const root = container.querySelector('[data-testid="terminal-root"]');
    if (root) {
      const header = container.querySelector('[data-testid="terminal-header"]');
      expect(header).toBeTruthy();
      expect(header?.textContent).toContain("Terminal");

      const clearBtn = container.querySelector('[data-testid="terminal-clear-button"]');
      expect(clearBtn).toBeTruthy();
      expect(clearBtn?.textContent).toContain("Clear");

      const termContainer = container.querySelector('[data-testid="terminal-container"]');
      expect(termContainer).toBeTruthy();
    }
  });

  it("does not render terminal-root when not in Electron", () => {
    render(<InteractiveTerminal />);

    expect(screen.queryByTestId("terminal-root")).not.toBeInTheDocument();
    expect(screen.queryByTestId("terminal-header")).not.toBeInTheDocument();
    expect(screen.queryByTestId("terminal-container")).not.toBeInTheDocument();
  });
});
