import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PreflightGate } from "./PreflightGate";

const mockGetPreflight = vi.fn();

const mockDesktopBridge = vi.hoisted(() => ({
  getDesktopBridge: vi.fn(),
  openDesktopExternal: vi.fn(),
}));

vi.mock("../lib/desktopBridge", () => mockDesktopBridge);

describe("PreflightGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    mockDesktopBridge.getDesktopBridge.mockReturnValue({
      getPreflight: mockGetPreflight,
    });
  });

  it("renders children when no blocking checks exist", async () => {
    mockGetPreflight.mockResolvedValue({
      checks: [
        { key: "backend.available", ok: true, severity: "error", message: "Backend is available" },
        { key: "git.installed", ok: true, severity: "error", message: "Git is installed" },
      ],
      checkedAt: new Date().toISOString(),
    });

    render(
      <PreflightGate>
        <div>Test content</div>
      </PreflightGate>
    );

    expect(screen.getByText("Test content")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("Preflight Checks Need Attention")).not.toBeInTheDocument();
    });
  });

  it("shows error modal when blocking checks fail", async () => {
    mockGetPreflight.mockResolvedValue({
      checks: [
        { key: "backend.available", ok: false, severity: "error", message: "Backend is not available" },
        { key: "git.installed", ok: true, severity: "error", message: "Git is installed" },
      ],
      checkedAt: new Date().toISOString(),
    });

    render(
      <PreflightGate>
        <div>Test content</div>
      </PreflightGate>
    );

    expect(await screen.findByText("Preflight Checks Need Attention")).toBeInTheDocument();
    expect(screen.getByText("Backend is not available")).toBeInTheDocument();
    expect(screen.getByText("Test content")).toBeInTheDocument();
  });

  it("allows user to dismiss the modal", async () => {
    mockGetPreflight.mockResolvedValue({
      checks: [
        { key: "backend.available", ok: false, severity: "error", message: "Backend is not available" },
      ],
      checkedAt: new Date().toISOString(),
    });

    render(
      <PreflightGate>
        <div>Test content</div>
      </PreflightGate>
    );

    expect(await screen.findByText("Preflight Checks Need Attention")).toBeInTheDocument();

    const dismissButton = screen.getByRole("button", { name: /Continue anyway/i });
    fireEvent.click(dismissButton);

    await waitFor(() => {
      expect(screen.queryByText("Preflight Checks Need Attention")).not.toBeInTheDocument();
    });

    expect(window.sessionStorage.getItem("mission-control-preflight-dismissed")).toBe("1");
  });

  it("retries checks when retry button is clicked", async () => {
    mockGetPreflight.mockResolvedValue({
      checks: [
        { key: "backend.available", ok: false, severity: "error", message: "Backend is not available" },
      ],
      checkedAt: new Date().toISOString(),
    });

    render(
      <PreflightGate>
        <div>Test content</div>
      </PreflightGate>
    );

    expect(await screen.findByText("Preflight Checks Need Attention")).toBeInTheDocument();

    const retryButton = screen.getByRole("button", { name: /Retry checks/i });
    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(mockGetPreflight).toHaveBeenCalledTimes(2);
    });
  });

  it("handles missing desktop bridge gracefully", async () => {
    mockDesktopBridge.getDesktopBridge.mockReturnValue(null);

    render(
      <PreflightGate>
        <div>Test content</div>
      </PreflightGate>
    );

    expect(screen.getByText("Test content")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("Preflight Checks Need Attention")).not.toBeInTheDocument();
    });
  });
});
