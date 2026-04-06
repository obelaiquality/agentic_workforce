import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CommandPalette } from "./CommandPalette";

vi.mock("cmdk", () => {
  function Command({ children, ...props }: any) {
    return <div data-testid="cmdk-root" {...props}>{children}</div>;
  }
  Command.Input = (props: any) => <input data-testid="cmdk-input" {...props} />;
  Command.List = ({ children, ...props }: any) => <div {...props}>{children}</div>;
  Command.Empty = ({ children, ...props }: any) => <div {...props}>{children}</div>;
  Command.Group = ({ heading, children, ...props }: any) => (
    <div {...props}>
      <div>{heading}</div>
      {children}
    </div>
  );
  Command.Item = ({ children, onSelect, value, ...props }: any) => (
    <button onClick={onSelect} data-value={value} {...props}>{children}</button>
  );
  return { Command };
});

vi.mock("../store/uiStore", () => ({
  useUiStore: vi.fn((selector: any) => {
    const store = {
      setActiveSection: vi.fn(),
      setSettingsFocusTarget: vi.fn(),
      labsMode: false,
    };
    return selector(store);
  }),
}));

describe("CommandPalette", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when closed", () => {
    const { container } = render(<CommandPalette />);
    expect(container.innerHTML).toBe("");
  });

  it("opens on Cmd+K", () => {
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.getByTestId("cmdk-input")).toBeTruthy();
  });

  it("closes on Escape", () => {
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.getByTestId("cmdk-input")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("cmdk-input")).toBeNull();
  });

  it("shows navigation items", () => {
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.getByText("Go to Work")).toBeTruthy();
    expect(screen.getByText("Go to Codebase")).toBeTruthy();
    expect(screen.getByText("Go to Console")).toBeTruthy();
    expect(screen.getByText("Go to Projects")).toBeTruthy();
    expect(screen.getByText("Go to Settings")).toBeTruthy();
  });

  it("shows quick actions", () => {
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.getByText("Open Learnings Lab")).toBeTruthy();
    expect(screen.getByText("Open Essentials")).toBeTruthy();
    expect(screen.getByText("Open Advanced Settings")).toBeTruthy();
  });

  it("has keyboard hint in footer", () => {
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.getByText("Navigate")).toBeTruthy();
    expect(screen.getByText("Enter to select")).toBeTruthy();
  });

  it("closes on backdrop click", () => {
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    const backdrop = document.querySelector(".fixed.inset-0.bg-black\\/60");
    if (backdrop) fireEvent.click(backdrop);
    expect(screen.queryByTestId("cmdk-input")).toBeNull();
  });

  it("shows ESC key hint", () => {
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.getByText("ESC")).toBeTruthy();
  });
});
