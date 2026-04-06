import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChangeBriefStrip } from "./ChangeBriefStrip";
import type { MissionChangeBrief } from "../lib/missionTypes";

// Mock matchMedia, IntersectionObserver, and ResizeObserver for Embla carousel
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(query => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  global.IntersectionObserver = class IntersectionObserver {
    constructor() {}
    disconnect() {}
    observe() {}
    takeRecords() {
      return [];
    }
    unobserve() {}
  } as any;

  global.ResizeObserver = class ResizeObserver {
    constructor() {}
    disconnect() {}
    observe() {}
    unobserve() {}
  } as any;
});

const mockBriefs: MissionChangeBrief[] = [
  {
    task_id: "task-1",
    title: "Add Button Component",
    summary: "Created a new button component with accessibility props",
    status: "success",
    patches_applied: 2,
    worker_id: 1,
    token_total: 1500,
    generated_at: new Date().toISOString(),
    files: ["src/components/Button.tsx", "src/components/Button.test.tsx"],
  },
  {
    task_id: "task-2",
    title: "Fix Navigation Bug",
    summary: "[BUG] Fixed routing issue in navigation menu",
    status: "active",
    patches_applied: 1,
    worker_id: 2,
    token_total: 800,
    generated_at: new Date().toISOString(),
    files: ["src/nav/Menu.tsx"],
  },
  {
    task_id: "task-3",
    title: "Update Documentation",
    summary: "Updated README with new API endpoints",
    status: "failed",
    patches_applied: 0,
    worker_id: 1,
    token_total: 500,
    generated_at: new Date().toISOString(),
    files: ["README.md"],
  },
];

describe("ChangeBriefStrip", () => {
  it("renders all briefs", () => {
    render(<ChangeBriefStrip briefs={mockBriefs} onSelectTask={vi.fn()} />);

    expect(screen.getByText("Add Button Component")).toBeInTheDocument();
    expect(screen.getByText("Fix Navigation Bug")).toBeInTheDocument();
    expect(screen.getByText("Update Documentation")).toBeInTheDocument();
  });

  it("displays status counts", () => {
    render(<ChangeBriefStrip briefs={mockBriefs} onSelectTask={vi.fn()} />);

    expect(screen.getByText("Applied 1")).toBeInTheDocument();
    expect(screen.getByText("Active 1")).toBeInTheDocument();
    expect(screen.getByText("Fix 1")).toBeInTheDocument();
  });

  it("shows correct status badges", () => {
    render(<ChangeBriefStrip briefs={mockBriefs} onSelectTask={vi.fn()} />);

    expect(screen.getByText("Applied")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Needs Fix")).toBeInTheDocument();
  });

  it("displays brief summaries", () => {
    render(<ChangeBriefStrip briefs={mockBriefs} onSelectTask={vi.fn()} />);

    expect(screen.getByText(/Created a new button component with accessibility props/)).toBeInTheDocument();
    expect(screen.getByText(/Fixed routing issue in navigation menu/)).toBeInTheDocument();
  });

  it("shows patches applied count", () => {
    render(<ChangeBriefStrip briefs={mockBriefs} onSelectTask={vi.fn()} />);

    // Component renders "N patches" format
    expect(screen.getByText(/2 patches/)).toBeInTheDocument();
    expect(screen.getAllByText(/1 patches/).length).toBeGreaterThan(0);
  });

  it("displays worker information", () => {
    render(<ChangeBriefStrip briefs={mockBriefs} onSelectTask={vi.fn()} />);

    // Component renders worker-N format
    expect(screen.getAllByText(/worker-1/).length).toBeGreaterThan(0);
    expect(screen.getByText(/worker-2/)).toBeInTheDocument();
  });

  it("shows token counts", () => {
    render(<ChangeBriefStrip briefs={mockBriefs} onSelectTask={vi.fn()} />);

    expect(screen.getByText("1,500 tok")).toBeInTheDocument();
    expect(screen.getByText("800 tok")).toBeInTheDocument();
  });

  it("displays affected files", () => {
    render(<ChangeBriefStrip briefs={mockBriefs} onSelectTask={vi.fn()} />);

    expect(screen.getByText("Button.tsx")).toBeInTheDocument();
    expect(screen.getByText("Button.test.tsx")).toBeInTheDocument();
    expect(screen.getByText("Menu.tsx")).toBeInTheDocument();
  });

  it("calls onSelectTask when Inspect Task button is clicked", () => {
    const onSelectTask = vi.fn();
    render(<ChangeBriefStrip briefs={mockBriefs} onSelectTask={onSelectTask} />);

    const inspectButtons = screen.getAllByText(/Inspect Task/);
    fireEvent.click(inspectButtons[0]);
    expect(onSelectTask).toHaveBeenCalledWith("task-1");
  });

  it("navigates carousel with prev/next buttons", () => {
    const { container } = render(<ChangeBriefStrip briefs={mockBriefs} onSelectTask={vi.fn()} />);

    const prevButton = container.querySelector("button svg.lucide-chevron-left")?.closest("button");
    const nextButton = container.querySelector("button svg.lucide-chevron-right")?.closest("button");

    expect(prevButton).toBeInTheDocument();
    expect(nextButton).toBeInTheDocument();

    if (nextButton) {
      fireEvent.click(nextButton);
      // Carousel should advance
    }
  });

  it("shows navigation dots", () => {
    const { container } = render(<ChangeBriefStrip briefs={mockBriefs} onSelectTask={vi.fn()} />);

    const dots = container.querySelectorAll("button.rounded-full");
    expect(dots.length).toBe(3); // One dot per brief
  });

  it("truncates long file lists", () => {
    const briefWithManyFiles: MissionChangeBrief = {
      task_id: "task-4",
      title: "Update Multiple Files",
      summary: "Updated many files",
      status: "success",
      patches_applied: 5,
      worker_id: 1,
      token_total: 2000,
      generated_at: new Date().toISOString(),
      files: ["file1.tsx", "file2.tsx", "file3.tsx", "file4.tsx"],
    };

    render(<ChangeBriefStrip briefs={[briefWithManyFiles]} onSelectTask={vi.fn()} />);

    expect(screen.getByText("+2")).toBeInTheDocument(); // Shows +2 for additional files
  });
});
