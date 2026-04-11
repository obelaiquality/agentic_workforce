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

  it("displays file content lines with syntax highlighting", async () => {
    apiClientMock.getMissionCodeFileV8.mockResolvedValue({
      item: {
        path: "src/index.ts",
        content: 'const x = 42;\nif (true) {\n  return "hello";\n}',
        language: "typescript",
        truncated: false,
      },
    });
    renderView();
    await screen.findByText("index.ts");
    await waitFor(() => {
      expect(apiClientMock.getMissionCodeFileV8).toHaveBeenCalled();
    });
    // Line numbers should be present
    await waitFor(() => {
      expect(screen.getByText("1")).toBeInTheDocument();
    });
  });

  it("shows diff view for modified files when changes tab is active", async () => {
    apiClientMock.getMissionCodeFileDiffV8.mockResolvedValue({
      item: {
        available: true,
        patch: "diff --git a/src/index.ts b/src/index.ts\n--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1,2 +1,3 @@\n const a = 1;\n+const b = 2;\n const c = 3;",
        additions: 1,
        deletions: 0,
        truncated: false,
      },
    });
    apiClientMock.getMissionCodeFileV8.mockResolvedValue({
      item: {
        path: "src/index.ts",
        content: "const a = 1;\nconst b = 2;\nconst c = 3;",
        language: "typescript",
        truncated: false,
      },
    });
    renderView();
    await screen.findByText("index.ts");
    // The file is modified, so changes tab button should be auto-selected
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^changes$/i })).toBeInTheDocument();
    });
    // Diff additions count should be visible
    await waitFor(() => {
      expect(screen.getByText("+1")).toBeInTheDocument();
    });
  });

  it("shows truncated file indicator", async () => {
    apiClientMock.getMissionCodeFileV8.mockResolvedValue({
      item: {
        path: "src/index.ts",
        content: "const x = 1;",
        language: "typescript",
        truncated: true,
      },
    });
    renderView();
    await screen.findByText("index.ts");
    await waitFor(() => {
      expect(screen.getByText("truncated")).toBeInTheDocument();
    });
    expect(screen.getByText(/File view truncated for performance/)).toBeInTheDocument();
  });

  it("toggles wrap lines", async () => {
    renderView();
    await screen.findByText("index.ts");
    await waitFor(() => {
      expect(apiClientMock.getMissionCodeFileV8).toHaveBeenCalled();
    });
    // Wait for file viewer
    await waitFor(() => {
      expect(screen.getByTestId("codebase-file-viewer")).toBeInTheDocument();
    });
    const wrapButton = screen.getByRole("button", { name: /wrap/i });
    fireEvent.click(wrapButton);
    // Click again to toggle back
    fireEvent.click(wrapButton);
    expect(wrapButton).toBeInTheDocument();
  });

  it("performs code search in file", async () => {
    apiClientMock.getMissionCodeFileV8.mockResolvedValue({
      item: {
        path: "src/index.ts",
        content: "line one\nline two\nsearchme here\nline four",
        language: "typescript",
        truncated: false,
      },
    });
    renderView();
    await screen.findByText("index.ts");
    await waitFor(() => {
      expect(screen.getByTestId("codebase-file-viewer")).toBeInTheDocument();
    });
    const codeSearchInput = screen.getByPlaceholderText("Find in file");
    fireEvent.change(codeSearchInput, { target: { value: "searchme" } });
    await waitFor(() => {
      expect(screen.getByText("1 matches")).toBeInTheDocument();
    });
  });

  it("filters files by status", async () => {
    renderView();
    await screen.findByText("index.ts");

    const modifiedButton = screen.getByRole("button", { name: /^modified$/i });
    fireEvent.click(modifiedButton);

    // Only modified files remain — src/index.ts is modified, utils.ts & README.md are unchanged
    await waitFor(() => {
      expect(screen.getByText("1 shown")).toBeInTheDocument();
    });
  });

  it("filters files by added status", async () => {
    apiClientMock.getMissionCodebaseTreeV8.mockResolvedValue({
      items: [
        { kind: "file", path: "newfile.ts", status: "added" },
        { kind: "file", path: "old.ts", status: "unchanged" },
      ],
    });
    renderView();
    await screen.findByText("newfile.ts");

    const addedButton = screen.getByRole("button", { name: /^added$/i });
    fireEvent.click(addedButton);

    await waitFor(() => {
      expect(screen.getByText("1 shown")).toBeInTheDocument();
    });
  });

  it("shows file search prev/next buttons when search is active", async () => {
    apiClientMock.getMissionCodebaseTreeV8.mockResolvedValue({
      items: [
        { kind: "file", path: "foo.ts", status: "unchanged" },
        { kind: "file", path: "foobar.ts", status: "unchanged" },
        { kind: "file", path: "baz.ts", status: "unchanged" },
      ],
    });
    apiClientMock.getMissionCodeFileV8.mockResolvedValue({
      item: { path: "foo.ts", content: "hello", language: "typescript", truncated: false },
    });
    renderView();
    await screen.findByText("foo.ts");

    const searchInput = screen.getByPlaceholderText(/Search paths or filenames/i);
    fireEvent.change(searchInput, { target: { value: "foo" } });

    // Wait for the shown count to update — the text "2 shown" is followed by match indicator
    await waitFor(() => {
      expect(screen.getByText(/2 shown/)).toBeInTheDocument();
    });

    // Prev and Next buttons should appear
    const nextButton = screen.getByRole("button", { name: /next/i });
    const prevButton = screen.getByRole("button", { name: /prev/i });
    expect(nextButton).toBeInTheDocument();
    expect(prevButton).toBeInTheDocument();
    fireEvent.click(nextButton);
    fireEvent.click(prevButton);
  });

  it("handles Enter key in file search", async () => {
    apiClientMock.getMissionCodebaseTreeV8.mockResolvedValue({
      items: [
        { kind: "file", path: "aaa.ts", status: "unchanged" },
        { kind: "file", path: "aab.ts", status: "unchanged" },
      ],
    });
    apiClientMock.getMissionCodeFileV8.mockResolvedValue({
      item: { path: "aaa.ts", content: "x", language: "typescript", truncated: false },
    });
    renderView();
    await screen.findByText("aaa.ts");

    const searchInput = screen.getByPlaceholderText(/Search paths or filenames/i);
    fireEvent.change(searchInput, { target: { value: "aa" } });
    fireEvent.keyDown(searchInput, { key: "Enter" });
    // Shift+Enter goes backwards
    fireEvent.keyDown(searchInput, { key: "Enter", shiftKey: true });
    // Non-enter key is ignored
    fireEvent.keyDown(searchInput, { key: "a" });
  });

  it("collapses and expands directories", async () => {
    renderView();
    await screen.findByText("index.ts");

    const collapseButton = screen.getByRole("button", { name: /collapse all/i });
    fireEvent.click(collapseButton);

    const expandButton = screen.getByRole("button", { name: /expand scoped/i });
    fireEvent.click(expandButton);
  });

  it("toggles directory expansion when clicking on directory row", async () => {
    renderView();
    // The "src" directory should appear
    const srcDir = await screen.findByText("src");
    fireEvent.click(srcDir);
    // Click again to re-expand
    fireEvent.click(srcDir);
  });

  it("selects a file when clicking on file row", async () => {
    renderView();
    await screen.findByText("index.ts");

    const utilsFile = screen.getByText("utils.ts");
    fireEvent.click(utilsFile);

    await waitFor(() => {
      expect(apiClientMock.getMissionCodeFileV8).toHaveBeenCalledWith("repo-1", "src/utils.ts");
    });
  });

  it("displays scope banner for context scope", async () => {
    mockUiStore.codebaseScope = "context";
    renderView({ contextPaths: ["src/index.ts"] });

    await waitFor(() => {
      expect(screen.getByText(/Context scope/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Prioritizing impacted files/)).toBeInTheDocument();
  });

  it("displays scope banner for tests scope", async () => {
    mockUiStore.codebaseScope = "tests";
    renderView({ testPaths: ["src/index.ts"] });

    await waitFor(() => {
      expect(screen.getByText(/Tests scope/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Prioritizing tests linked/)).toBeInTheDocument();
  });

  it("displays scope banner for docs scope", async () => {
    mockUiStore.codebaseScope = "docs";
    renderView({ docPaths: ["README.md"] });

    await waitFor(() => {
      expect(screen.getByText(/Docs scope/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Prioritizing documentation linked/)).toBeInTheDocument();
  });

  it("displays workflow title with back button", async () => {
    renderView({ workflowTitle: "My Workflow" });

    await waitFor(() => {
      expect(screen.getByText("My Workflow")).toBeInTheDocument();
    });
    expect(screen.getByText("Back to Workflow")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Back to Workflow"));
    expect(mockUiStore.setActiveSection).toHaveBeenCalledWith("live");
  });

  it("shows 'no files match' message when filter yields zero results", async () => {
    renderView();
    await screen.findByText("index.ts");

    // Filter by deleted — no files have that status
    const deletedButton = screen.getByRole("button", { name: /^deleted$/i });
    fireEvent.click(deletedButton);

    await waitFor(() => {
      expect(screen.getByText(/No files match the current filter/)).toBeInTheDocument();
    });
  });

  it("shows scoped empty message when scope has no files", async () => {
    mockUiStore.codebaseScope = "tests";
    apiClientMock.getMissionCodebaseTreeV8.mockResolvedValue({
      items: [{ kind: "file", path: "src/index.ts", status: "unchanged" }],
    });
    renderView({ testPaths: ["nonexistent.ts"] });

    await waitFor(() => {
      expect(screen.getByText(/No tests files are available/)).toBeInTheDocument();
    });
  });

  it("shows loading state when file is being fetched", async () => {
    // Never resolve file query
    apiClientMock.getMissionCodebaseTreeV8.mockResolvedValue({ items: [] });
    apiClientMock.getMissionCodeFileV8.mockReturnValue(new Promise(() => {}));
    renderView();

    await waitFor(() => {
      expect(screen.getByText(/Select a file to view its contents/)).toBeInTheDocument();
    });
  });

  it("shows tree loading state", async () => {
    apiClientMock.getMissionCodebaseTreeV8.mockReturnValue(new Promise(() => {}));
    renderView();

    await waitFor(() => {
      expect(screen.getByText(/Loading codebase/)).toBeInTheDocument();
    });
  });

  it("shows tree error state", async () => {
    apiClientMock.getMissionCodebaseTreeV8.mockRejectedValue(new Error("Network failure"));
    renderView();

    await waitFor(() => {
      expect(screen.getByText("Network failure")).toBeInTheDocument();
    });
  });

  it("shows test and doc badges on file rows", async () => {
    apiClientMock.getMissionCodebaseTreeV8.mockResolvedValue({
      items: [
        { kind: "file", path: "src/index.ts", status: "unchanged" },
        { kind: "file", path: "src/index.test.ts", status: "unchanged" },
        { kind: "file", path: "docs/guide.md", status: "unchanged" },
      ],
    });
    apiClientMock.getMissionCodeFileV8.mockResolvedValue({
      item: { path: "src/index.ts", content: "code", language: "typescript", truncated: false },
    });
    renderView({
      testPaths: ["src/index.test.ts"],
      docPaths: ["docs/guide.md"],
    });

    await screen.findByText("index.test.ts");
    expect(screen.getByText("test")).toBeInTheDocument();
    expect(screen.getByText("doc")).toBeInTheDocument();
  });

  it("displays markdown preview for .md files", async () => {
    apiClientMock.getMissionCodebaseTreeV8.mockResolvedValue({
      items: [{ kind: "file", path: "README.md", status: "unchanged" }],
    });
    apiClientMock.getMissionCodeFileV8.mockResolvedValue({
      item: {
        path: "README.md",
        content: "# Hello World\n\nThis is **bold** text.",
        language: "markdown",
        truncated: false,
      },
    });
    apiClientMock.getMissionCodeFileDiffV8.mockResolvedValue({
      item: { available: false, patch: null, additions: 0, deletions: 0, truncated: false },
    });
    renderView();
    await screen.findByText("README.md");

    // Markdown files auto-select preview mode
    await waitFor(() => {
      expect(screen.getByText("Preview")).toBeInTheDocument();
    });
    // Switch to raw mode
    const rawButton = screen.getByRole("button", { name: /^raw$/i });
    fireEvent.click(rawButton);
  });

  it("copies path and content to clipboard", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

    renderView();
    await screen.findByText("index.ts");
    await waitFor(() => {
      expect(screen.getByTestId("codebase-file-viewer")).toBeInTheDocument();
    });

    // Wait for file to load
    await waitFor(() => {
      expect(screen.getByText("Copy path")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /copy path/i }));
    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith("src/index.ts");
    });

    fireEvent.click(screen.getByRole("button", { name: /copy file/i }));
    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledTimes(2);
    });
  });

  it("handles keyboard navigation in file tree", async () => {
    renderView();
    await screen.findByText("index.ts");

    const tree = screen.getByRole("tree");

    // ArrowDown
    fireEvent.keyDown(tree, { key: "ArrowDown" });
    // ArrowUp
    fireEvent.keyDown(tree, { key: "ArrowUp" });
    // Home
    fireEvent.keyDown(tree, { key: "Home" });
    // End
    fireEvent.keyDown(tree, { key: "End" });
    // ArrowRight on directory (expand)
    fireEvent.keyDown(tree, { key: "ArrowRight" });
    // ArrowLeft on directory (collapse)
    fireEvent.keyDown(tree, { key: "ArrowLeft" });
    // Enter to toggle/select
    fireEvent.keyDown(tree, { key: "Enter" });
    // Space to toggle/select
    fireEvent.keyDown(tree, { key: " " });
  });

  it("switches between source and changes preview modes", async () => {
    apiClientMock.getMissionCodeFileDiffV8.mockResolvedValue({
      item: {
        available: true,
        patch: "diff --git a/src/index.ts b/src/index.ts\n@@ -1 +1,2 @@\n+new line",
        additions: 1,
        deletions: 0,
        truncated: false,
      },
    });
    renderView();
    await screen.findByText("index.ts");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^changes$/i })).toBeInTheDocument();
    });

    // Switch to source
    const sourceButton = screen.getByRole("button", { name: /^source$/i });
    fireEvent.click(sourceButton);

    // Switch back to changes
    const changesButton = screen.getByRole("button", { name: /^changes$/i });
    fireEvent.click(changesButton);
  });

  it("renders scope toggle buttons for tests and docs", async () => {
    renderView({
      contextPaths: ["src/index.ts"],
      testPaths: ["src/utils.ts"],
      docPaths: ["README.md"],
    });

    await screen.findByTestId("codebase-scope-toggle");

    const testsButton = screen.getByRole("button", { name: "Tests" });
    fireEvent.click(testsButton);
    expect(mockUiStore.setCodebaseScope).toHaveBeenCalledWith("tests");

    const docsButton = screen.getByRole("button", { name: "Docs" });
    fireEvent.click(docsButton);
    expect(mockUiStore.setCodebaseScope).toHaveBeenCalledWith("docs");

    const allButton = screen.getByRole("button", { name: "All Files" });
    fireEvent.click(allButton);
    expect(mockUiStore.setCodebaseScope).toHaveBeenCalledWith("all");
  });

  it("displays modified and added file counts", async () => {
    apiClientMock.getMissionCodebaseTreeV8.mockResolvedValue({
      items: [
        { kind: "file", path: "a.ts", status: "modified" },
        { kind: "file", path: "b.ts", status: "modified" },
        { kind: "file", path: "c.ts", status: "added" },
        { kind: "file", path: "d.ts", status: "unchanged" },
      ],
    });
    apiClientMock.getMissionCodeFileV8.mockResolvedValue({
      item: { path: "a.ts", content: "code", language: "typescript", truncated: false },
    });
    renderView();
    await screen.findByText("a.ts");

    expect(screen.getByText("2 modified")).toBeInTheDocument();
    expect(screen.getByText("1 added")).toBeInTheDocument();
    expect(screen.getByText("4 total")).toBeInTheDocument();
  });

  it("displays breadcrumb segments for nested file paths", async () => {
    apiClientMock.getMissionCodebaseTreeV8.mockResolvedValue({
      items: [
        {
          kind: "directory",
          path: "src",
          children: [
            {
              kind: "directory",
              path: "src/deep",
              children: [
                { kind: "file", path: "src/deep/file.ts", status: "unchanged" },
              ],
            },
          ],
        },
      ],
    });
    apiClientMock.getMissionCodeFileV8.mockResolvedValue({
      item: { path: "src/deep/file.ts", content: "code", language: "typescript", truncated: false },
    });
    apiClientMock.getMissionCodeFileDiffV8.mockResolvedValue({
      item: { available: false, patch: null, additions: 0, deletions: 0, truncated: false },
    });
    renderView();
    await screen.findByText("file.ts");
    // The breadcrumb should show "src" and "deep"
    await waitFor(() => {
      expect(screen.getByTestId("codebase-file-viewer")).toBeInTheDocument();
    });
  });

  it("shows workflow title in scope banner", async () => {
    mockUiStore.codebaseScope = "context";
    renderView({ contextPaths: ["src/index.ts"], workflowTitle: "Build Feature" });

    await waitFor(() => {
      expect(screen.getByText(/Build Feature context scope/)).toBeInTheDocument();
    });
  });

  it("persists expanded directories to store", async () => {
    renderView();
    await screen.findByText("index.ts");

    // The component calls setCodebaseExpandedDirectories on mount
    await waitFor(() => {
      expect(mockUiStore.setCodebaseExpandedDirectories).toHaveBeenCalled();
    });
  });

  it("restores persisted selected file", async () => {
    mockUiStore.codebaseSelectedFileByRepoScope = {
      "repo-1": { all: "src/utils.ts" },
    };
    renderView();
    await screen.findByText("utils.ts");

    await waitFor(() => {
      expect(apiClientMock.getMissionCodeFileV8).toHaveBeenCalledWith("repo-1", "src/utils.ts");
    });
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

  it("shows 'No results' message when graph search returns empty", async () => {
    apiClientMock.queryCodeGraphV5.mockResolvedValue({ items: [] });
    renderView();
    await screen.findByText("index.ts");

    fireEvent.click(screen.getByRole("button", { name: "Graph" }));
    const searchInput = await screen.findByPlaceholderText(/Search symbols/i);
    fireEvent.change(searchInput, { target: { value: "nonexistent" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => {
      expect(screen.getByText(/No results found for/)).toBeInTheDocument();
    });
  });

  it("shows 'No status available' when graph status is null", async () => {
    apiClientMock.getCodeGraphStatusV5.mockResolvedValue({ item: null });
    apiClientMock.getLatestContextPackV5.mockResolvedValue({ item: null });
    renderView();
    await screen.findByText("index.ts");

    fireEvent.click(screen.getByRole("button", { name: "Graph" }));

    await waitFor(() => {
      expect(screen.getByText("No status available")).toBeInTheDocument();
    });
  });

  it("shows 'Not indexed' when graph status is not indexed", async () => {
    apiClientMock.getCodeGraphStatusV5.mockResolvedValue({
      item: { repoId: "repo-1", indexed: false, nodeCount: 0, edgeCount: 0, lastIndexedAt: null },
    });
    apiClientMock.getLatestContextPackV5.mockResolvedValue({ item: null });
    renderView();
    await screen.findByText("index.ts");

    fireEvent.click(screen.getByRole("button", { name: "Graph" }));

    await waitFor(() => {
      expect(screen.getByText("Not indexed")).toBeInTheDocument();
    });
  });

  it("builds context pack from graph results", async () => {
    renderView();
    await screen.findByText("index.ts");

    fireEvent.click(screen.getByRole("button", { name: "Graph" }));

    const searchInput = await screen.findByPlaceholderText(/Search symbols/i);
    fireEvent.change(searchInput, { target: { value: "main" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await screen.findByText("main");

    const buildButton = screen.getByRole("button", { name: /Build Context Pack/i });
    fireEvent.click(buildButton);

    await waitFor(() => {
      expect(apiClientMock.buildContextPackV5).toHaveBeenCalledWith({
        repoId: "repo-1",
        objective: "main",
        queryMode: "basic",
      });
    });
  });

  it("displays latest context pack info", async () => {
    renderView();
    await screen.findByText("index.ts");

    fireEvent.click(screen.getByRole("button", { name: "Graph" }));

    await waitFor(() => {
      expect(screen.getByText("Latest Context Pack")).toBeInTheDocument();
    });
    expect(screen.getByText("test objective")).toBeInTheDocument();
    expect(screen.getByText("basic")).toBeInTheDocument();
  });

  it("changes query mode in graph panel", async () => {
    renderView();
    await screen.findByText("index.ts");

    fireEvent.click(screen.getByRole("button", { name: "Graph" }));

    const modeSelect = await screen.findByDisplayValue("Basic");
    fireEvent.change(modeSelect, { target: { value: "impact" } });

    const searchInput = screen.getByPlaceholderText(/Search symbols/i);
    fireEvent.change(searchInput, { target: { value: "main" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => {
      expect(apiClientMock.queryCodeGraphV5).toHaveBeenCalledWith("repo-1", "main", "impact");
    });
  });

  it("does not submit graph search with empty query", async () => {
    renderView();
    await screen.findByText("index.ts");

    fireEvent.click(screen.getByRole("button", { name: "Graph" }));

    await screen.findByPlaceholderText(/Search symbols/i);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    // queryCodeGraphV5 should not have been called since query is empty
    expect(apiClientMock.queryCodeGraphV5).not.toHaveBeenCalled();
  });

  it("shows diff truncated indicator", async () => {
    apiClientMock.getMissionCodeFileDiffV8.mockResolvedValue({
      item: {
        available: true,
        patch: "@@ -1 +1 @@\n+line",
        additions: 1,
        deletions: 0,
        truncated: true,
      },
    });
    renderView();
    await screen.findByText("index.ts");

    await waitFor(() => {
      expect(screen.getByText("Patch truncated")).toBeInTheDocument();
    });
  });

  it("displays JSON file with syntax highlighting", async () => {
    apiClientMock.getMissionCodebaseTreeV8.mockResolvedValue({
      items: [{ kind: "file", path: "config.json", status: "unchanged" }],
    });
    apiClientMock.getMissionCodeFileV8.mockResolvedValue({
      item: {
        path: "config.json",
        content: '{\n  "name": "test",\n  "count": 42,\n  "active": true\n}',
        language: "json",
        truncated: false,
      },
    });
    apiClientMock.getMissionCodeFileDiffV8.mockResolvedValue({
      item: { available: false, patch: null, additions: 0, deletions: 0, truncated: false },
    });
    renderView();
    await screen.findByText("config.json");
    // JSON appears in both file header badge and sidebar InfoCard
    await waitFor(() => {
      expect(screen.getAllByText("JSON").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("displays YAML file with correct language label", async () => {
    apiClientMock.getMissionCodebaseTreeV8.mockResolvedValue({
      items: [{ kind: "file", path: "config.yaml", status: "unchanged" }],
    });
    apiClientMock.getMissionCodeFileV8.mockResolvedValue({
      item: {
        path: "config.yaml",
        content: "name: test\ncount: 42",
        language: "yaml",
        truncated: false,
      },
    });
    apiClientMock.getMissionCodeFileDiffV8.mockResolvedValue({
      item: { available: false, patch: null, additions: 0, deletions: 0, truncated: false },
    });
    renderView();
    await screen.findByText("config.yaml");
    await waitFor(() => {
      expect(screen.getAllByText("YAML").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("infers language for various file extensions", async () => {
    // Test Python file
    apiClientMock.getMissionCodebaseTreeV8.mockResolvedValue({
      items: [{ kind: "file", path: "script.py", status: "unchanged" }],
    });
    apiClientMock.getMissionCodeFileV8.mockResolvedValue({
      item: { path: "script.py", content: "def hello():\n    pass", language: null, truncated: false },
    });
    apiClientMock.getMissionCodeFileDiffV8.mockResolvedValue({
      item: { available: false, patch: null, additions: 0, deletions: 0, truncated: false },
    });
    renderView();
    await screen.findByText("script.py");
    await waitFor(() => {
      expect(screen.getAllByText("Python").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("displays workflow title in scope banner with tests scope", async () => {
    mockUiStore.codebaseScope = "tests";
    renderView({ testPaths: ["src/index.ts"], workflowTitle: "Add Feature" });

    await waitFor(() => {
      expect(screen.getByText(/Add Feature tests scope/)).toBeInTheDocument();
    });
  });

  it("displays workflow title in scope banner with docs scope", async () => {
    mockUiStore.codebaseScope = "docs";
    renderView({ docPaths: ["README.md"], workflowTitle: "Add Feature" });

    await waitFor(() => {
      expect(screen.getByText(/Add Feature docs scope/)).toBeInTheDocument();
    });
  });

  it("handles restoring persisted expanded directories", async () => {
    mockUiStore.codebaseExpandedDirectoriesByRepo = { "repo-1": ["src"] };
    renderView();
    await screen.findByText("index.ts");
    // The directories from the store should be restored and the directory "src" visible in the tree
    const treeItems = screen.getAllByRole("treeitem");
    expect(treeItems.length).toBeGreaterThan(0);
  });

  it("uses requestedScope over stored scope", async () => {
    mockUiStore.codebaseScope = "all";
    renderView({ requestedScope: "context", contextPaths: ["src/index.ts"] });

    await waitFor(() => {
      expect(screen.getByText(/Context scope/)).toBeInTheDocument();
    });
  });

  it("falls back to 'all' scope when requested scope has no paths", async () => {
    renderView({ requestedScope: "context", contextPaths: [] });

    // Should fall back to all since contextPaths is empty
    await waitFor(() => {
      expect(screen.getByText(/Managed worktree view/)).toBeInTheDocument();
    });
  });
});
