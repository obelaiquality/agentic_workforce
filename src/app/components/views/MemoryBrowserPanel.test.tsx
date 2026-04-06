import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryBrowserPanel } from "./MemoryBrowserPanel";
import * as apiClient from "../../lib/apiClient";
import type { MemoryRecord, KnowledgeHit } from "../../../shared/contracts";

vi.mock("../../lib/apiClient");

const mockMemories: MemoryRecord[] = [
  {
    id: "mem-1",
    kind: "episodic",
    repoId: "repo-1",
    aggregateId: "run-1",
    content: "Implemented user authentication flow",
    citations: ["src/auth.ts", "src/login.tsx"],
    confidence: 0.95,
    staleAfter: null,
    createdAt: "2024-01-15T10:00:00Z",
    updatedAt: "2024-01-15T10:00:00Z",
  },
  {
    id: "mem-2",
    kind: "fact",
    repoId: "repo-1",
    aggregateId: "run-1",
    content: "API endpoint uses JWT tokens for authentication",
    citations: ["docs/api.md"],
    confidence: 0.88,
    staleAfter: null,
    createdAt: "2024-01-14T15:30:00Z",
    updatedAt: "2024-01-14T15:30:00Z",
  },
];

const mockKnowledgeHits: KnowledgeHit[] = [
  {
    id: "kb-1",
    source: "docs",
    path: "/docs/api-guide.md",
    snippet: "The API uses RESTful endpoints with JSON responses",
    score: 0.95,
    embedding_id: null,
  },
  {
    id: "kb-2",
    source: "codebase",
    path: "/src/api/endpoints.ts",
    snippet: "export function createEndpoint(config: EndpointConfig)",
    score: 0.82,
    embedding_id: "emb-123",
  },
];

describe("MemoryBrowserPanel", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    vi.clearAllMocks();
  });

  function renderComponent(props = {}) {
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryBrowserPanel {...props} />
      </QueryClientProvider>
    );
  }

  it("renders memory browser header", () => {
    vi.mocked(apiClient.searchMemoryV3).mockResolvedValue({ items: [] });
    renderComponent();
    expect(screen.getByText("Memory Browser")).toBeInTheDocument();
    expect(screen.getByText("Episodic and working memory")).toBeInTheDocument();
  });

  it("displays search input", () => {
    vi.mocked(apiClient.searchMemoryV3).mockResolvedValue({ items: [] });
    renderComponent();
    expect(screen.getByPlaceholderText("Search memories...")).toBeInTheDocument();
  });

  it("displays add memory button", () => {
    vi.mocked(apiClient.searchMemoryV3).mockResolvedValue({ items: [] });
    renderComponent();
    expect(screen.getByRole("button", { name: /add memory/i })).toBeInTheDocument();
  });

  it("loads and displays memories", async () => {
    vi.mocked(apiClient.searchMemoryV3).mockResolvedValue({ items: mockMemories });
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Implemented user authentication flow")).toBeInTheDocument();
      expect(screen.getByText("API endpoint uses JWT tokens for authentication")).toBeInTheDocument();
    });
  });

  it("displays memory kind badges", async () => {
    vi.mocked(apiClient.searchMemoryV3).mockResolvedValue({ items: mockMemories });
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Episodic")).toBeInTheDocument();
      expect(screen.getByText("Fact")).toBeInTheDocument();
    });
  });

  it("displays confidence scores", async () => {
    vi.mocked(apiClient.searchMemoryV3).mockResolvedValue({ items: mockMemories });
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("95% confidence")).toBeInTheDocument();
      expect(screen.getByText("88% confidence")).toBeInTheDocument();
    });
  });

  it("displays citations", async () => {
    vi.mocked(apiClient.searchMemoryV3).mockResolvedValue({ items: mockMemories });
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("src/auth.ts")).toBeInTheDocument();
      expect(screen.getByText("src/login.tsx")).toBeInTheDocument();
      expect(screen.getByText("docs/api.md")).toBeInTheDocument();
    });
  });

  it("shows empty state when no memories exist", async () => {
    vi.mocked(apiClient.searchMemoryV3).mockResolvedValue({ items: [] });
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("No memories stored yet.")).toBeInTheDocument();
    });
  });

  it("shows loading state", () => {
    vi.mocked(apiClient.searchMemoryV3).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );
    renderComponent();
    expect(screen.getByText("Loading memories...")).toBeInTheDocument();
  });

  it("filters memories based on search query", async () => {
        vi.mocked(apiClient.searchMemoryV3).mockResolvedValue({ items: mockMemories });
    renderComponent();

    const searchInput = screen.getByPlaceholderText("Search memories...");
    fireEvent.change(searchInput, { target: { value: "authentication" } });

    await waitFor(() => {
      expect(apiClient.searchMemoryV3).toHaveBeenCalledWith("authentication");
    });
  });

  it("opens add memory form when button clicked", async () => {
        vi.mocked(apiClient.searchMemoryV3).mockResolvedValue({ items: [] });
    renderComponent();

    const addButton = screen.getByRole("button", { name: /add memory/i });
    fireEvent.click(addButton);

    expect(screen.getByText("Add New Memory")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Memory content...")).toBeInTheDocument();
  });

  it("submits new memory", async () => {
        vi.mocked(apiClient.searchMemoryV3).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.commitMemoryV3).mockResolvedValue({
      item: {
        id: "new-mem",
        kind: "episodic",
        repoId: null,
        aggregateId: "global",
        content: "Test memory content",
        citations: [],
        confidence: 0.8,
        staleAfter: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    renderComponent({ projectId: "test-project" });

    // Open form
    fireEvent.click(screen.getByRole("button", { name: /add memory/i }));

    // Fill form
    const contentInput = screen.getByPlaceholderText("Memory content...");
    fireEvent.change(contentInput, { target: { value: "Test memory content" } });

    // Submit
    const saveButton = screen.getByRole("button", { name: /save memory/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(apiClient.commitMemoryV3).toHaveBeenCalledWith({
        actor: "user",
        repo_id: "test-project",
        aggregate_id: "test-project",
        kind: "episodic",
        content: "Test memory content",
        citations: [],
        confidence: 0.8,
      });
    });
  });

  it("cancels add memory form", async () => {
        vi.mocked(apiClient.searchMemoryV3).mockResolvedValue({ items: [] });
    renderComponent();

    // Open form
    fireEvent.click(screen.getByRole("button", { name: /add memory/i }));
    expect(screen.getByText("Add New Memory")).toBeInTheDocument();

    // Cancel
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    await waitFor(() => {
      expect(screen.queryByText("Add New Memory")).not.toBeInTheDocument();
    });
  });

  it("displays memory count", async () => {
    vi.mocked(apiClient.searchMemoryV3).mockResolvedValue({ items: mockMemories });
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Showing 2 memories")).toBeInTheDocument();
    });
  });

  it("shows correct empty state for search with no results", async () => {
        vi.mocked(apiClient.searchMemoryV3)
      .mockResolvedValueOnce({ items: mockMemories })
      .mockResolvedValueOnce({ items: [] });

    renderComponent();

    const searchInput = screen.getByPlaceholderText("Search memories...");
    fireEvent.change(searchInput, { target: { value: "nonexistent" } });

    await waitFor(() => {
      expect(screen.getByText("No memories match your search.")).toBeInTheDocument();
    });
  });

  describe("Knowledge Tab", () => {
    it("renders both Memories and Knowledge tabs", () => {
      vi.mocked(apiClient.searchMemoryV3).mockResolvedValue({ items: [] });
      renderComponent();

      expect(screen.getByRole("button", { name: /memories/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /knowledge/i })).toBeInTheDocument();
    });

    it("switches to Knowledge tab when clicked", async () => {
      vi.mocked(apiClient.searchMemoryV3).mockResolvedValue({ items: [] });
      vi.mocked(apiClient.searchKnowledgeV2).mockResolvedValue({ items: [] });

      renderComponent();

      const knowledgeTab = screen.getByRole("button", { name: /knowledge/i });
      fireEvent.click(knowledgeTab);

      await waitFor(() => {
        expect(screen.getByPlaceholderText("Search knowledge base...")).toBeInTheDocument();
      });
    });

    it("hides Add Memory button on Knowledge tab", async () => {
      vi.mocked(apiClient.searchMemoryV3).mockResolvedValue({ items: [] });
      vi.mocked(apiClient.searchKnowledgeV2).mockResolvedValue({ items: [] });

      renderComponent();

      // Button visible on Memories tab
      expect(screen.getByRole("button", { name: /add memory/i })).toBeInTheDocument();

      // Switch to Knowledge tab
      const knowledgeTab = screen.getByRole("button", { name: /knowledge/i });
      fireEvent.click(knowledgeTab);

      await waitFor(() => {
        expect(screen.queryByRole("button", { name: /add memory/i })).not.toBeInTheDocument();
      });
    });

    it("shows prompt to enter search query by default", async () => {
      vi.mocked(apiClient.searchMemoryV3).mockResolvedValue({ items: [] });
      vi.mocked(apiClient.searchKnowledgeV2).mockResolvedValue({ items: [] });

      renderComponent();

      const knowledgeTab = screen.getByRole("button", { name: /knowledge/i });
      fireEvent.click(knowledgeTab);

      await waitFor(() => {
        expect(screen.getByText("Enter a search query to find knowledge items.")).toBeInTheDocument();
      });
    });

    it("searches and displays knowledge results", async () => {
      vi.mocked(apiClient.searchMemoryV3).mockResolvedValue({ items: [] });
      vi.mocked(apiClient.searchKnowledgeV2).mockResolvedValue({ items: mockKnowledgeHits });

      renderComponent();

      // Switch to Knowledge tab
      const knowledgeTab = screen.getByRole("button", { name: /knowledge/i });
      fireEvent.click(knowledgeTab);

      // Type search query
      const searchInput = await screen.findByPlaceholderText("Search knowledge base...");
      fireEvent.change(searchInput, { target: { value: "API endpoints" } });

      await waitFor(() => {
        expect(apiClient.searchKnowledgeV2).toHaveBeenCalledWith("API endpoints");
        expect(screen.getByText("docs")).toBeInTheDocument();
        expect(screen.getByText("/docs/api-guide.md")).toBeInTheDocument();
        expect(screen.getByText("The API uses RESTful endpoints with JSON responses")).toBeInTheDocument();
        expect(screen.getByText("95% relevance")).toBeInTheDocument();
      });
    });

    it("displays knowledge source badges", async () => {
      vi.mocked(apiClient.searchMemoryV3).mockResolvedValue({ items: [] });
      vi.mocked(apiClient.searchKnowledgeV2).mockResolvedValue({ items: mockKnowledgeHits });

      renderComponent();

      const knowledgeTab = screen.getByRole("button", { name: /knowledge/i });
      fireEvent.click(knowledgeTab);

      const searchInput = await screen.findByPlaceholderText("Search knowledge base...");
      fireEvent.change(searchInput, { target: { value: "test" } });

      await waitFor(() => {
        expect(screen.getByText("docs")).toBeInTheDocument();
        expect(screen.getByText("codebase")).toBeInTheDocument();
      });
    });

    it("displays knowledge hit paths", async () => {
      vi.mocked(apiClient.searchMemoryV3).mockResolvedValue({ items: [] });
      vi.mocked(apiClient.searchKnowledgeV2).mockResolvedValue({ items: mockKnowledgeHits });

      renderComponent();

      const knowledgeTab = screen.getByRole("button", { name: /knowledge/i });
      fireEvent.click(knowledgeTab);

      const searchInput = await screen.findByPlaceholderText("Search knowledge base...");
      fireEvent.change(searchInput, { target: { value: "test" } });

      await waitFor(() => {
        expect(screen.getByText("/docs/api-guide.md")).toBeInTheDocument();
        expect(screen.getByText("/src/api/endpoints.ts")).toBeInTheDocument();
      });
    });

    it("shows knowledge hit count", async () => {
      vi.mocked(apiClient.searchMemoryV3).mockResolvedValue({ items: [] });
      vi.mocked(apiClient.searchKnowledgeV2).mockResolvedValue({ items: mockKnowledgeHits });

      renderComponent();

      const knowledgeTab = screen.getByRole("button", { name: /knowledge/i });
      fireEvent.click(knowledgeTab);

      const searchInput = await screen.findByPlaceholderText("Search knowledge base...");
      fireEvent.change(searchInput, { target: { value: "test" } });

      await waitFor(() => {
        expect(screen.getByText("Showing 2 results")).toBeInTheDocument();
      });
    });

    it("shows empty state when no knowledge results found", async () => {
      vi.mocked(apiClient.searchMemoryV3).mockResolvedValue({ items: [] });
      vi.mocked(apiClient.searchKnowledgeV2).mockResolvedValue({ items: [] });

      renderComponent();

      const knowledgeTab = screen.getByRole("button", { name: /knowledge/i });
      fireEvent.click(knowledgeTab);

      const searchInput = await screen.findByPlaceholderText("Search knowledge base...");
      fireEvent.change(searchInput, { target: { value: "nonexistent" } });

      await waitFor(() => {
        expect(screen.getByText("No knowledge items match your search.")).toBeInTheDocument();
      });
    });

    it("does not call searchKnowledgeV2 until query is entered", async () => {
      vi.mocked(apiClient.searchMemoryV3).mockResolvedValue({ items: [] });
      vi.mocked(apiClient.searchKnowledgeV2).mockResolvedValue({ items: [] });

      renderComponent();

      const knowledgeTab = screen.getByRole("button", { name: /knowledge/i });
      fireEvent.click(knowledgeTab);

      await waitFor(() => {
        expect(screen.getByPlaceholderText("Search knowledge base...")).toBeInTheDocument();
      });

      // searchKnowledgeV2 should not be called
      expect(apiClient.searchKnowledgeV2).not.toHaveBeenCalled();
    });

    it("switches back to Memories tab", async () => {
      vi.mocked(apiClient.searchMemoryV3).mockResolvedValue({ items: mockMemories });
      vi.mocked(apiClient.searchKnowledgeV2).mockResolvedValue({ items: [] });

      renderComponent();

      // Switch to Knowledge
      const knowledgeTab = screen.getByRole("button", { name: /knowledge/i });
      fireEvent.click(knowledgeTab);

      await waitFor(() => {
        expect(screen.getByPlaceholderText("Search knowledge base...")).toBeInTheDocument();
      });

      // Switch back to Memories
      const memoriesTab = screen.getByRole("button", { name: /memories/i });
      fireEvent.click(memoriesTab);

      await waitFor(() => {
        expect(screen.getByPlaceholderText("Search memories...")).toBeInTheDocument();
        expect(screen.getByText("Implemented user authentication flow")).toBeInTheDocument();
      });
    });
  });
});
