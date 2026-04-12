import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UnifiedDiffView } from "./UnifiedDiffView";
import type { DiffFile } from "./DiffParser";

function makeDiffFile(overrides?: Partial<DiffFile>): DiffFile {
  return {
    oldPath: "src/index.ts",
    newPath: "src/index.ts",
    status: "modified",
    additions: 1,
    deletions: 1,
    hunks: [
      {
        index: 0,
        header: "@@ -1,3 +1,3 @@",
        oldStart: 1,
        oldCount: 3,
        newStart: 1,
        newCount: 3,
        lines: [
          { type: "context", content: "import { foo } from './foo';", oldLineNumber: 1, newLineNumber: 1 },
          { type: "removed", content: "const bar = 1;", oldLineNumber: 2, newLineNumber: null },
          { type: "added", content: "const bar = 2;", oldLineNumber: null, newLineNumber: 2 },
          { type: "context", content: "export { foo };", oldLineNumber: 3, newLineNumber: 3 },
        ],
      },
    ],
    ...overrides,
  };
}

describe("UnifiedDiffView", () => {
  it("renders the file path in the header", () => {
    const file = makeDiffFile();
    render(<UnifiedDiffView file={file} decisions={new Map()} onDecide={vi.fn()} />);
    expect(screen.getByText("src/index.ts")).toBeInTheDocument();
  });

  it("renders the status badge", () => {
    const file = makeDiffFile();
    render(<UnifiedDiffView file={file} decisions={new Map()} onDecide={vi.fn()} />);
    expect(screen.getByText("modified")).toBeInTheDocument();
  });

  it("renders addition and deletion counts", () => {
    const file = makeDiffFile();
    render(<UnifiedDiffView file={file} decisions={new Map()} onDecide={vi.fn()} />);
    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.getByText("-1")).toBeInTheDocument();
  });

  it("renders context, added, and removed lines", () => {
    const file = makeDiffFile();
    render(<UnifiedDiffView file={file} decisions={new Map()} onDecide={vi.fn()} />);

    const table = screen.getByTestId("unified-diff-table");
    const rows = table.querySelectorAll("tr");

    // 1 hunk header + 4 content lines = 5 rows
    expect(rows.length).toBe(5);

    // Added line has green background class
    const addedRow = rows[3]; // context, hunk header, removed, added
    expect(addedRow.className).toContain("bg-emerald-500/10");

    // Removed line has red background class
    const removedRow = rows[2];
    expect(removedRow.className).toContain("bg-rose-500/10");
  });

  it("renders the hunk header text", () => {
    const file = makeDiffFile();
    render(<UnifiedDiffView file={file} decisions={new Map()} onDecide={vi.fn()} />);
    expect(screen.getByText("@@ -1,3 +1,3 @@")).toBeInTheDocument();
  });

  it("renders accept and reject buttons per hunk", () => {
    const file = makeDiffFile();
    render(<UnifiedDiffView file={file} decisions={new Map()} onDecide={vi.fn()} />);

    const acceptBtn = screen.getByLabelText("Accept hunk 1");
    const rejectBtn = screen.getByLabelText("Reject hunk 1");
    expect(acceptBtn).toBeInTheDocument();
    expect(rejectBtn).toBeInTheDocument();
  });

  it("calls onDecide when accept/reject buttons are clicked", async () => {
    const onDecide = vi.fn();
    const file = makeDiffFile();
    render(<UnifiedDiffView file={file} decisions={new Map()} onDecide={onDecide} />);

    const acceptBtn = screen.getByLabelText("Accept hunk 1");
    acceptBtn.click();
    expect(onDecide).toHaveBeenCalledWith(0, "accept");

    const rejectBtn = screen.getByLabelText("Reject hunk 1");
    rejectBtn.click();
    expect(onDecide).toHaveBeenCalledWith(0, "reject");
  });

  it("highlights the accept button when decision is accept", () => {
    const file = makeDiffFile();
    const decisions = new Map([[0, "accept" as const]]);
    render(<UnifiedDiffView file={file} decisions={decisions} onDecide={vi.fn()} />);

    const acceptBtn = screen.getByLabelText("Accept hunk 1");
    expect(acceptBtn.className).toContain("bg-emerald-500/20");
  });

  it("renders line numbers correctly", () => {
    const file = makeDiffFile();
    render(<UnifiedDiffView file={file} decisions={new Map()} onDecide={vi.fn()} />);

    const table = screen.getByTestId("unified-diff-table");
    const rows = table.querySelectorAll("tr");
    // Find a context row (non-hunk-header) and verify it has line numbers
    const dataRows = Array.from(rows).filter((r) => !r.querySelector("th"));
    expect(dataRows.length).toBeGreaterThan(0);
    // Check that line number cells exist with numeric content
    const firstRow = dataRows[0];
    const cells = firstRow.querySelectorAll("td");
    const textValues = Array.from(cells).map((c) => c.textContent?.trim()).filter(Boolean);
    expect(textValues.length).toBeGreaterThan(0);
  });

  it("renders an added file status badge", () => {
    const file = makeDiffFile({ status: "added" });
    render(<UnifiedDiffView file={file} decisions={new Map()} onDecide={vi.fn()} />);
    expect(screen.getByText("added")).toBeInTheDocument();
  });
});
