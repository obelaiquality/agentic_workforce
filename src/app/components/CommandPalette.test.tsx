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

const mockSetActiveSection = vi.fn();
const mockSetSettingsFocusTarget = vi.fn();
let mockLabsMode = false;

vi.mock("../store/uiStore", () => ({
  useUiStore: vi.fn((selector: any) => {
    const store = {
      setActiveSection: mockSetActiveSection,
      setSettingsFocusTarget: mockSetSettingsFocusTarget,
      get labsMode() {
        return mockLabsMode;
      },
    };
    return selector(store);
  }),
}));

describe("CommandPalette", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLabsMode = false;
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

  it("opens on Ctrl+K", () => {
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByTestId("cmdk-input")).toBeTruthy();
  });

  it("toggles closed when Cmd+K pressed while already open", () => {
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.getByTestId("cmdk-input")).toBeTruthy();
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.queryByTestId("cmdk-input")).toBeNull();
  });

  it("navigates to section when nav action is selected", () => {
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });

    const goToConsole = screen.getByText("Go to Console");
    fireEvent.click(goToConsole);

    expect(mockSetActiveSection).toHaveBeenCalledWith("console");
    // Palette should close after selection
    expect(screen.queryByTestId("cmdk-input")).toBeNull();
  });

  it("opens settings with providers focus when Open Essentials is selected", () => {
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });

    fireEvent.click(screen.getByText("Open Essentials"));

    expect(mockSetActiveSection).toHaveBeenCalledWith("settings");
    expect(mockSetSettingsFocusTarget).toHaveBeenCalledWith("providers");
  });

  it("opens settings with execution_profiles focus when Open Advanced Settings is selected", () => {
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });

    fireEvent.click(screen.getByText("Open Advanced Settings"));

    expect(mockSetActiveSection).toHaveBeenCalledWith("settings");
    expect(mockSetSettingsFocusTarget).toHaveBeenCalledWith("execution_profiles");
  });

  it("shows Labs group when labsMode is enabled", () => {
    mockLabsMode = true;

    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });

    expect(screen.getByText("Open Telemetry")).toBeTruthy();
    expect(screen.getByText("Labs")).toBeTruthy();
  });

  it("does not show Labs group when labsMode is disabled", () => {
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.queryByText("Open Telemetry")).toBeNull();
  });

  it("does nothing on Escape when palette is closed", () => {
    const { container } = render(<CommandPalette />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(container.innerHTML).toBe("");
  });
});
