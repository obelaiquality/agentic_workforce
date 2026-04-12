import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DiffActions, type DiffViewMode } from "./DiffActions";
import type { DiffFile } from "./DiffParser";

function makeFiles(): DiffFile[] {
  return [
    {
      oldPath: "src/a.ts",
      newPath: "src/a.ts",
      status: "modified",
      hunks: [],
      additions: 3,
      deletions: 1,
    },
    {
      oldPath: "src/b.ts",
      newPath: "src/b.ts",
      status: "added",
      hunks: [],
      additions: 10,
      deletions: 0,
    },
  ];
}

describe("DiffActions", () => {
  it("renders the file selector when multiple files are present", () => {
    render(
      <DiffActions
        files={makeFiles()}
        selectedFileIndex={0}
        onSelectFile={vi.fn()}
        viewMode="unified"
        onViewModeChange={vi.fn()}
        decisions={new Map()}
        totalHunkCount={5}
        onAcceptAll={vi.fn()}
        onRejectAll={vi.fn()}
      />
    );

    const select = screen.getByLabelText("Select file");
    expect(select).toBeInTheDocument();
    expect(select.querySelectorAll("option")).toHaveLength(2);
  });

  it("shows the hunk counter text", () => {
    const decisions = new Map<number, "accept" | "reject">([
      [0, "accept"],
      [1, "accept"],
      [2, "reject"],
    ]);

    render(
      <DiffActions
        files={makeFiles()}
        selectedFileIndex={0}
        onSelectFile={vi.fn()}
        viewMode="unified"
        onViewModeChange={vi.fn()}
        decisions={decisions}
        totalHunkCount={5}
        onAcceptAll={vi.fn()}
        onRejectAll={vi.fn()}
      />
    );

    const counter = screen.getByTestId("hunk-counter");
    expect(counter.textContent).toContain("2 of 5 hunks accepted");
    expect(counter.textContent).toContain("1 rejected");
  });

  it("calls onAcceptAll when Accept All is clicked", () => {
    const onAcceptAll = vi.fn();
    render(
      <DiffActions
        files={makeFiles()}
        selectedFileIndex={0}
        onSelectFile={vi.fn()}
        viewMode="unified"
        onViewModeChange={vi.fn()}
        decisions={new Map()}
        totalHunkCount={3}
        onAcceptAll={onAcceptAll}
        onRejectAll={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId("accept-all-btn"));
    expect(onAcceptAll).toHaveBeenCalledTimes(1);
  });

  it("calls onRejectAll when Reject All is clicked", () => {
    const onRejectAll = vi.fn();
    render(
      <DiffActions
        files={makeFiles()}
        selectedFileIndex={0}
        onSelectFile={vi.fn()}
        viewMode="unified"
        onViewModeChange={vi.fn()}
        decisions={new Map()}
        totalHunkCount={3}
        onAcceptAll={vi.fn()}
        onRejectAll={onRejectAll}
      />
    );

    fireEvent.click(screen.getByTestId("reject-all-btn"));
    expect(onRejectAll).toHaveBeenCalledTimes(1);
  });

  it("renders Unified and Split view toggle buttons", () => {
    render(
      <DiffActions
        files={makeFiles()}
        selectedFileIndex={0}
        onSelectFile={vi.fn()}
        viewMode="unified"
        onViewModeChange={vi.fn()}
        decisions={new Map()}
        totalHunkCount={3}
        onAcceptAll={vi.fn()}
        onRejectAll={vi.fn()}
      />
    );

    expect(screen.getByText("Unified")).toBeInTheDocument();
    expect(screen.getByText("Split")).toBeInTheDocument();
  });

  it("renders the view mode tabs with the correct active state", () => {
    const { rerender } = render(
      <DiffActions
        files={makeFiles()}
        selectedFileIndex={0}
        onSelectFile={vi.fn()}
        viewMode="unified"
        onViewModeChange={vi.fn()}
        decisions={new Map()}
        totalHunkCount={3}
        onAcceptAll={vi.fn()}
        onRejectAll={vi.fn()}
      />
    );

    const unifiedTrigger = screen.getByText("Unified");
    const splitTrigger = screen.getByText("Split");
    expect(unifiedTrigger).toBeInTheDocument();
    expect(splitTrigger).toBeInTheDocument();

    // When viewMode changes to "side-by-side", the Tabs value updates
    rerender(
      <DiffActions
        files={makeFiles()}
        selectedFileIndex={0}
        onSelectFile={vi.fn()}
        viewMode="side-by-side"
        onViewModeChange={vi.fn()}
        decisions={new Map()}
        totalHunkCount={3}
        onAcceptAll={vi.fn()}
        onRejectAll={vi.fn()}
      />
    );

    // Split tab should now be active
    expect(splitTrigger.getAttribute("data-state")).toBe("active");
  });

  it("calls onSelectFile when file selector changes", () => {
    const onSelectFile = vi.fn();
    render(
      <DiffActions
        files={makeFiles()}
        selectedFileIndex={0}
        onSelectFile={onSelectFile}
        viewMode="unified"
        onViewModeChange={vi.fn()}
        decisions={new Map()}
        totalHunkCount={3}
        onAcceptAll={vi.fn()}
        onRejectAll={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("Select file"), { target: { value: "1" } });
    expect(onSelectFile).toHaveBeenCalledWith(1);
  });

  it("shows file name when only one file is present", () => {
    const files = [makeFiles()[0]];
    render(
      <DiffActions
        files={files}
        selectedFileIndex={0}
        onSelectFile={vi.fn()}
        viewMode="unified"
        onViewModeChange={vi.fn()}
        decisions={new Map()}
        totalHunkCount={3}
        onAcceptAll={vi.fn()}
        onRejectAll={vi.fn()}
      />
    );

    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    expect(screen.queryByLabelText("Select file")).not.toBeInTheDocument();
  });
});
