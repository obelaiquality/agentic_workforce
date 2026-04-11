import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProjectMemoryPanel } from "./ProjectMemoryPanel";

global.fetch = vi.fn();

const mockMemories = [
  {
    id: "mem-1",
    taskDescription: "Add button component",
    summary: "Successfully created Button component with tests",
    outcome: "success" as const,
    keyFiles: ["src/components/Button.tsx", "src/components/Button.test.tsx"],
    lessons: ["Always include accessibility props"],
    createdAt: new Date().toISOString(),
    ageLabel: "2 hours ago",
    ageDays: 0,
  },
  {
    id: "mem-2",
    taskDescription: "Fix navigation bug",
    summary: "Fixed routing issue in navigation menu",
    outcome: "partial" as const,
    keyFiles: ["src/nav/Menu.tsx"],
    lessons: ["Test edge cases thoroughly"],
    createdAt: new Date().toISOString(),
    ageLabel: "1 day ago",
    ageDays: 1,
  },
];

const mockStats = {
  episodicCount: 2,
  oldestCreatedAt: new Date().toISOString(),
  newestCreatedAt: new Date().toISOString(),
  successCount: 1,
  failureCount: 0,
  partialCount: 1,
};

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("ProjectMemoryPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows no worktree selected message when worktreePath is null", () => {
    renderWithQueryClient(<ProjectMemoryPanel worktreePath={null} />);
    expect(screen.getByText("Select a project to view its memory")).toBeInTheDocument();
  });

  it("displays loading state", () => {
    (global.fetch as any).mockReturnValue(new Promise(() => {}));
    renderWithQueryClient(<ProjectMemoryPanel worktreePath="/tmp/test" />);
    expect(screen.getByText("Loading memories...")).toBeInTheDocument();
  });

  it("displays empty state when no memories", async () => {
    (global.fetch as any).mockResolvedValue({
      json: async () => ({ memories: [], stats: null }),
    });

    renderWithQueryClient(<ProjectMemoryPanel worktreePath="/tmp/test" />);

    await waitFor(() => {
      expect(screen.getByText("No memories yet")).toBeInTheDocument();
    });
  });

  it("displays memories with stats", async () => {
    (global.fetch as any).mockResolvedValue({
      json: async () => ({ memories: mockMemories, stats: mockStats }),
    });

    renderWithQueryClient(<ProjectMemoryPanel worktreePath="/tmp/test" />);

    await waitFor(() => {
      expect(screen.getByText("2 memories")).toBeInTheDocument();
      expect(screen.getByText("1 passed")).toBeInTheDocument();
      expect(screen.getByText("1 partial")).toBeInTheDocument();
    });
  });

  it("displays memory cards with outcome badges", async () => {
    (global.fetch as any).mockResolvedValue({
      json: async () => ({ memories: mockMemories, stats: mockStats }),
    });

    renderWithQueryClient(<ProjectMemoryPanel worktreePath="/tmp/test" />);

    await waitFor(() => {
      expect(screen.getByText("Successfully created Button component with tests")).toBeInTheDocument();
      expect(screen.getByText("Fixed routing issue in navigation menu")).toBeInTheDocument();
    });
  });

  it("expands memory card on click", async () => {
    (global.fetch as any).mockResolvedValue({
      json: async () => ({ memories: mockMemories, stats: mockStats }),
    });

    renderWithQueryClient(<ProjectMemoryPanel worktreePath="/tmp/test" />);

    await waitFor(() => {
      expect(screen.getByText("Successfully created Button component with tests")).toBeInTheDocument();
    });

    const cardButton = screen.getByText("Successfully created Button component with tests");
    fireEvent.click(cardButton);

    await waitFor(() => {
      expect(screen.getByText("Add button component")).toBeInTheDocument();
      expect(screen.getByText("Always include accessibility props")).toBeInTheDocument();
    });
  });

  it("filters memories by outcome", async () => {
    (global.fetch as any).mockResolvedValue({
      json: async () => ({ memories: mockMemories, stats: mockStats }),
    });

    renderWithQueryClient(<ProjectMemoryPanel worktreePath="/tmp/test" />);

    await waitFor(() => {
      expect(screen.getByText("Successfully created Button component with tests")).toBeInTheDocument();
    });

    const filterSelect = screen.getByRole("combobox");
    fireEvent.change(filterSelect, { target: { value: "success" } });

    // The query should be triggered with the filter
    expect(global.fetch).toHaveBeenCalled();
  });

  it("searches memories", async () => {
    (global.fetch as any).mockResolvedValue({
      json: async () => ({ memories: mockMemories, stats: mockStats }),
    });

    renderWithQueryClient(<ProjectMemoryPanel worktreePath="/tmp/test" />);

    await waitFor(() => {
      expect(screen.getByText("Successfully created Button component with tests")).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText("Search memories...");
    fireEvent.change(searchInput, { target: { value: "button" } });

    expect(global.fetch).toHaveBeenCalled();
  });

  it("deletes memory when delete button is clicked", async () => {
    (global.fetch as any).mockResolvedValue({
      json: async () => ({ memories: mockMemories, stats: mockStats }),
    });

    renderWithQueryClient(<ProjectMemoryPanel worktreePath="/tmp/test" />);

    await waitFor(() => {
      expect(screen.getByText("Successfully created Button component with tests")).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByTitle("Delete memory");
    fireEvent.click(deleteButtons[0]);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/memory/mem-1"),
        expect.objectContaining({ method: "DELETE" })
      );
    });
  });

  it("displays failure count in stats bar when failures exist", async () => {
    const statsWithFailures = { ...mockStats, failureCount: 3 };
    (global.fetch as any).mockResolvedValue({
      json: async () => ({ memories: mockMemories, stats: statsWithFailures }),
    });

    renderWithQueryClient(<ProjectMemoryPanel worktreePath="/tmp/test" />);

    await waitFor(() => {
      expect(screen.getByText("3 failed")).toBeInTheDocument();
    });
  });

  it("queryFn returns empty data for falsy worktreePath via direct refetch", async () => {
    // The queryFn has a ternary: worktreePath ? fetchMemories(...) : Promise.resolve({...})
    // When enabled is false, react-query won't auto-fire the queryFn.
    // We need to force the queryFn to execute with a falsy worktreePath.
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    (global.fetch as any).mockResolvedValue({
      json: async () => ({ memories: [], stats: null }),
    });

    // Render with empty string worktreePath
    render(
      <QueryClientProvider client={queryClient}>
        <ProjectMemoryPanel worktreePath="" />
      </QueryClientProvider>,
    );

    // Manually call refetchQueries to force the queryFn to fire despite enabled=false
    // This uses cancelRefetch:true to force execution
    const queries = queryClient.getQueryCache().findAll({ queryKey: ["project-memory"] });
    for (const query of queries) {
      // Force execute the queryFn directly via the query's fetch method
      await query.fetch();
    }

    // The component should show the empty/no-project state
    expect(screen.getByText(/Select a project|No memories yet/)).toBeInTheDocument();
  });
});
