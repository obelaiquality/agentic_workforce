import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AgentLanesView } from "./AgentLanesView";
import * as apiClient from "../../lib/apiClient";
import type { AgentLane } from "../../../shared/contracts";

vi.mock("../../lib/apiClient");

const createMockLane = (overrides?: Partial<AgentLane>): AgentLane => ({
  id: "lane-123",
  ticketId: "ticket-456",
  runId: "run-789",
  role: "implementer",
  state: "running",
  worktreePath: "/tmp/worktree",
  leaseExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  lastHeartbeatAt: new Date().toISOString(),
  contextManifestId: null,
  metadata: { summary: "Implementing feature X" },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("AgentLanesView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render loading state initially", () => {
    vi.mocked(apiClient.listAgentLanesV3).mockReturnValue(new Promise(() => {}));
    renderWithQueryClient(<AgentLanesView />);
    expect(screen.getByText("Loading agent lanes...")).toBeInTheDocument();
  });

  it("should render empty state when no lanes exist", async () => {
    vi.mocked(apiClient.listAgentLanesV3).mockResolvedValue({ items: [] });
    renderWithQueryClient(<AgentLanesView />);

    await waitFor(() => {
      expect(screen.getByText("No active agent lanes")).toBeInTheDocument();
    });
  });

  it("should display agent lanes", async () => {
    const mockLane = createMockLane({
      id: "lane-abc-def",
      role: "planner",
      state: "running",
      ticketId: "ticket-123",
    });

    vi.mocked(apiClient.listAgentLanesV3).mockResolvedValue({ items: [mockLane] });
    renderWithQueryClient(<AgentLanesView />);

    await waitFor(() => {
      expect(screen.getByText("1 active agent")).toBeInTheDocument();
      expect(screen.getByText("planner")).toBeInTheDocument();
      expect(screen.getByText("running")).toBeInTheDocument();
      expect(screen.getByText("ticket-123")).toBeInTheDocument();
    });
  });

  it("should toggle spawn form", async () => {
    vi.mocked(apiClient.listAgentLanesV3).mockResolvedValue({ items: [] });
    renderWithQueryClient(<AgentLanesView />);

    await waitFor(() => {
      expect(screen.getByText("Spawn agent")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /spawn agent/i }));

    expect(screen.getByLabelText("Ticket ID")).toBeInTheDocument();
    expect(screen.getByLabelText("Agent role")).toBeInTheDocument();
  });

  it("should call spawn mutation when form is submitted", async () => {
    vi.mocked(apiClient.listAgentLanesV3).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.spawnAgentLaneV3).mockResolvedValue({
      item: createMockLane(),
    });

    renderWithQueryClient(<AgentLanesView />);

    await waitFor(() => {
      expect(screen.getByText("Spawn agent")).toBeInTheDocument();
    });

    // Click the first spawn button (in the header)
    const buttons = screen.getAllByRole("button", { name: /spawn agent/i });
    fireEvent.click(buttons[0]);

    fireEvent.change(screen.getByLabelText("Ticket ID"), { target: { value: "ticket-999" } });

    // Click the second spawn button (in the form)
    const submitButtons = screen.getAllByRole("button", { name: /spawn agent/i });
    fireEvent.click(submitButtons[1]);

    await waitFor(() => {
      expect(apiClient.spawnAgentLaneV3).toHaveBeenCalledWith({
        actor: "user",
        ticket_id: "ticket-999",
        run_id: undefined,
        role: "implementer",
        summary: undefined,
      });
    });
  });

  it("should call reclaim mutation when reclaim button is clicked", async () => {
    const mockLane = createMockLane({ id: "lane-to-reclaim" });
    vi.mocked(apiClient.listAgentLanesV3).mockResolvedValue({ items: [mockLane] });
    vi.mocked(apiClient.reclaimAgentLaneV3).mockResolvedValue({ items: [] });

    renderWithQueryClient(<AgentLanesView />);

    await waitFor(() => {
      expect(screen.getByText("Reclaim")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /reclaim/i }));

    await waitFor(() => {
      expect(apiClient.reclaimAgentLaneV3).toHaveBeenCalledWith({
        actor: "user",
        lane_id: "lane-to-reclaim",
      });
    });
  });

  it("should show multiple agents with correct count", async () => {
    const lanes = [
      createMockLane({ id: "lane-1", role: "planner" }),
      createMockLane({ id: "lane-2", role: "implementer" }),
      createMockLane({ id: "lane-3", role: "verifier" }),
    ];

    vi.mocked(apiClient.listAgentLanesV3).mockResolvedValue({ items: lanes });
    renderWithQueryClient(<AgentLanesView />);

    await waitFor(() => {
      expect(screen.getByText("3 active agents")).toBeInTheDocument();
      expect(screen.getByText("planner")).toBeInTheDocument();
      expect(screen.getByText("implementer")).toBeInTheDocument();
      expect(screen.getByText("verifier")).toBeInTheDocument();
    });
  });
});
