import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CodebaseView } from "./CodebaseView";

const apiClientMock = vi.hoisted(() => ({
  getMissionCodebaseTreeV8: vi.fn(),
  getMissionCodeFileV8: vi.fn(),
  getMissionCodeFileDiffV8: vi.fn(),
  getCodeGraphStatusV5: vi.fn(),
  queryCodeGraphV5: vi.fn(),
  buildContextPackV5: vi.fn(),
  getLatestContextPackV5: vi.fn(),
}));

vi.mock("../../lib/apiClient", () => apiClientMock);

const mockUiStore = vi.hoisted(() => ({
  codebaseScope: "all",
  codebaseExpandedDirectoriesByRepo: {},
  codebaseSelectedFileByRepoScope: {},
  setCodebaseScope: vi.fn(),
  setCodebaseExpandedDirectories: vi.fn(),
  setCodebaseSelectedFile: vi.fn(),
  setActiveSection: vi.fn(),
}));

vi.mock("../../store/uiStore", () => ({
  useUiStore: (selector: (state: typeof mockUiStore) => unknown) => selector(mockUiStore),
}));

function renderView(props = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  const defaultProps = {
    repoId: "repo-1",
    contextPaths: [],
    testPaths: [],
    docPaths: [],
  };

  return render(
    <QueryClientProvider client={queryClient}>
      <CodebaseView {...defaultProps} {...props} />
    </QueryClientProvider>,
  );
}

describe("CodebaseView", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset UI store state
    mockUiStore.codebaseScope = "all";
    mockUiStore.codebaseExpandedDirectoriesByRepo = {};
    mockUiStore.codebaseSelectedFileByRepoScope = {};

    apiClientMock.getMissionCodebaseTreeV8.mockResolvedValue({
      items: [
        {
          kind: "directory",
          path: "src",
          children: [
            { kind: "file", path: "src/index.ts", status: "modified" },
            { kind: "file", path: "src/utils.ts", status: "unchanged" },
          ],
        },
        { kind: "file", path: "README.md", status: "unchanged" },
      ],
    });
    apiClientMock.getMissionCodeFileV8.mockResolvedValue({
      item: {
        path: "src/index.ts",
        content: "export function main() {\n  console.log('Hello');\n}",
        language: "typescript",
        truncated: false,
      },
    });
    apiClientMock.getMissionCodeFileDiffV8.mockResolvedValue({
      item: {
        available: true,
        patch: "diff --git a/src/index.ts b/src/index.ts\n+++ modified line",
        additions: 1,
        deletions: 0,
        truncated: false,
      },
    });
    apiClientMock.getCodeGraphStatusV5.mockResolvedValue({
      item: {
        repoId: "repo-1",
        indexed: true,
        nodeCount: 42,
        edgeCount: 17,
        lastIndexedAt: "2026-04-02T12:00:00Z",
      },
    });
    apiClientMock.queryCodeGraphV5.mockResolvedValue({
      items: [
        {
          id: "node-1",
          repoId: "repo-1",
          kind: "symbol",
          path: "src/index.ts",
          name: "main",
        },
      ],
    });
    apiClientMock.buildContextPackV5.mockResolvedValue({
      item: {
        id: "pack-1",
        repoId: "repo-1",
        objective: "test",
        queryMode: "basic",
        files: ["src/index.ts"],
      },
    });
    apiClientMock.getLatestContextPackV5.mockResolvedValue({
      item: {
        id: "pack-1",
        repoId: "repo-1",
        objective: "test objective",
        queryMode: "basic",
        files: ["src/index.ts", "src/utils.ts"],
      },
    });
  });

  it("renders file tree with directories and files", async () => {
    renderView();

    expect(await screen.findByTestId("codebase-file-tree")).toBeInTheDocument();

    // Wait for the tree to load
    await waitFor(() => {
      expect(apiClientMock.getMissionCodebaseTreeV8).toHaveBeenCalled();
    });
  });

  it("displays file content when a file is selected", async () => {
    renderView();

    // Wait for the tree to load
    await screen.findByText("index.ts");

    // Wait for the file content to load
    await waitFor(() => {
      expect(apiClientMock.getMissionCodeFileV8).toHaveBeenCalledWith("repo-1", "src/index.ts");
    });

    // Verify file viewer is present
    expect(screen.getByTestId("codebase-file-viewer")).toBeInTheDocument();
  });

  it("switches between scope filters", async () => {
    renderView({
      contextPaths: ["src/index.ts"],
      testPaths: ["src/index.test.ts"],
      docPaths: ["README.md"],
    });

    await screen.findByTestId("codebase-scope-toggle");

    const contextButton = screen.getByRole("button", { name: "Context" });
    fireEvent.click(contextButton);

    expect(mockUiStore.setCodebaseScope).toHaveBeenCalledWith("context");
  });

  it("provides search functionality", async () => {
    renderView();

    await screen.findByText("index.ts");

    const searchInput = screen.getByPlaceholderText(/Search paths or filenames/i);
    fireEvent.change(searchInput, { target: { value: "index" } });

    expect(searchInput).toHaveValue("index");
  });

  it("shows empty state when no project is connected", async () => {
    renderView({ repoId: null });

    expect(await screen.findByTestId("codebase-empty")).toBeInTheDocument();
    expect(screen.getByText("No project connected")).toBeInTheDocument();
    expect(screen.getByText(/Connect a project to browse files/i)).toBeInTheDocument();
  });

  it("switches to graph tab and displays graph status", async () => {
    renderView();

    await screen.findByText("index.ts");

    const graphButton = screen.getByRole("button", { name: "Graph" });
    fireEvent.click(graphButton);

    await waitFor(() => {
      expect(apiClientMock.getCodeGraphStatusV5).toHaveBeenCalledWith("repo-1");
    });

    expect(await screen.findByText("Indexed")).toBeInTheDocument();
    expect(screen.getByText("42 nodes")).toBeInTheDocument();
    expect(screen.getByText("17 edges")).toBeInTheDocument();
  });

  it("searches code graph and displays results", async () => {
    renderView();

    await screen.findByText("index.ts");

    const graphButton = screen.getByRole("button", { name: "Graph" });
    fireEvent.click(graphButton);

    const searchInput = await screen.findByPlaceholderText(/Search symbols/i);
    fireEvent.change(searchInput, { target: { value: "main" } });

    const searchButton = screen.getByRole("button", { name: "Search" });
    fireEvent.click(searchButton);

    await waitFor(() => {
      expect(apiClientMock.queryCodeGraphV5).toHaveBeenCalledWith("repo-1", "main", "basic");
    });

    expect(await screen.findByText("main")).toBeInTheDocument();
    expect(screen.getByText("src/index.ts")).toBeInTheDocument();
  });
});
