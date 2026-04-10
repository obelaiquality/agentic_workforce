import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TeamPanel } from "./TeamPanel";

const hooksMock = vi.hoisted(() => ({
  useTeamSession: vi.fn(),
  useTeamWorkers: vi.fn(),
  useTeamTasks: vi.fn(),
  useTeamMessages: vi.fn(),
  useTeamStream: vi.fn(),
}));

vi.mock("../../hooks/useTeamMode", () => hooksMock);

function renderPanel(sessionId = "team-1") {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <TeamPanel sessionId={sessionId} />
    </QueryClientProvider>,
  );
}

describe("TeamPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    hooksMock.useTeamStream.mockReturnValue({
      connected: true,
      events: [],
      clearEvents: vi.fn(),
    });
  });

  it("shows loading state", () => {
    hooksMock.useTeamSession.mockReturnValue({ data: null, isLoading: true, isError: false });
    hooksMock.useTeamWorkers.mockReturnValue({ data: null, isLoading: true, isError: false });
    hooksMock.useTeamTasks.mockReturnValue({ data: null, isLoading: true, isError: false });
    hooksMock.useTeamMessages.mockReturnValue({ data: null, isLoading: false, isError: false });

    renderPanel();

    expect(screen.getByText("Loading team session...")).toBeInTheDocument();
  });

  it("shows error state when session query fails", () => {
    hooksMock.useTeamSession.mockReturnValue({ data: null, isLoading: false, isError: true });
    hooksMock.useTeamWorkers.mockReturnValue({ data: null, isLoading: false, isError: false });
    hooksMock.useTeamTasks.mockReturnValue({ data: null, isLoading: false, isError: false });
    hooksMock.useTeamMessages.mockReturnValue({ data: null, isLoading: false, isError: false });

    renderPanel();

    expect(screen.getByText("Failed to load team session.")).toBeInTheDocument();
  });

  it("shows error state when session data is null after loading", () => {
    hooksMock.useTeamSession.mockReturnValue({ data: null, isLoading: false, isError: false });
    hooksMock.useTeamWorkers.mockReturnValue({ data: null, isLoading: false, isError: false });
    hooksMock.useTeamTasks.mockReturnValue({ data: null, isLoading: false, isError: false });
    hooksMock.useTeamMessages.mockReturnValue({ data: null, isLoading: false, isError: false });

    renderPanel();

    expect(screen.getByText("Failed to load team session.")).toBeInTheDocument();
  });

  it("renders session objective", () => {
    hooksMock.useTeamSession.mockReturnValue({
      data: {
        session: {
          id: "team-1",
          objective: "Build the dashboard feature",
          phase: "team_exec",
          workerCount: 3,
          createdAt: new Date().toISOString(),
        },
      },
      isLoading: false,
      isError: false,
    });
    hooksMock.useTeamWorkers.mockReturnValue({ data: { workers: [] }, isLoading: false, isError: false });
    hooksMock.useTeamTasks.mockReturnValue({ data: { tasks: [] }, isLoading: false, isError: false });
    hooksMock.useTeamMessages.mockReturnValue({ data: { messages: [] }, isLoading: false, isError: false });

    renderPanel();

    expect(screen.getByText(/Build the dashboard feature/)).toBeInTheDocument();
  });

  it("renders phase indicator", () => {
    hooksMock.useTeamSession.mockReturnValue({
      data: {
        session: {
          id: "team-1",
          objective: "Test",
          phase: "team_verify",
          workerCount: 2,
          createdAt: new Date().toISOString(),
        },
      },
      isLoading: false,
      isError: false,
    });
    hooksMock.useTeamWorkers.mockReturnValue({ data: { workers: [] }, isLoading: false, isError: false });
    hooksMock.useTeamTasks.mockReturnValue({ data: { tasks: [] }, isLoading: false, isError: false });
    hooksMock.useTeamMessages.mockReturnValue({ data: { messages: [] }, isLoading: false, isError: false });

    renderPanel();

    expect(screen.getByText("Verifying")).toBeInTheDocument();
  });

  it("renders worker count", () => {
    hooksMock.useTeamSession.mockReturnValue({
      data: {
        session: {
          id: "team-1",
          objective: "Test",
          phase: "team_exec",
          workerCount: 3,
          createdAt: new Date().toISOString(),
        },
      },
      isLoading: false,
      isError: false,
    });
    hooksMock.useTeamWorkers.mockReturnValue({
      data: {
        workers: [
          { id: "w-1", workerId: "alpha", role: "coder", status: "executing", currentTaskId: null, lastHeartbeatAt: new Date().toISOString() },
          { id: "w-2", workerId: "beta", role: "reviewer", status: "idle", currentTaskId: null, lastHeartbeatAt: new Date().toISOString() },
        ],
      },
      isLoading: false,
      isError: false,
    });
    hooksMock.useTeamTasks.mockReturnValue({ data: { tasks: [] }, isLoading: false, isError: false });
    hooksMock.useTeamMessages.mockReturnValue({ data: { messages: [] }, isLoading: false, isError: false });

    renderPanel();

    expect(screen.getByText("Workers: 2")).toBeInTheDocument();
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
  });

  it("shows disconnected indicator when stream is not connected", () => {
    hooksMock.useTeamStream.mockReturnValue({
      connected: false,
      events: [],
      clearEvents: vi.fn(),
    });

    hooksMock.useTeamSession.mockReturnValue({
      data: {
        session: {
          id: "team-1",
          objective: "Test",
          phase: "team_plan",
          workerCount: 0,
          createdAt: new Date().toISOString(),
        },
      },
      isLoading: false,
      isError: false,
    });
    hooksMock.useTeamWorkers.mockReturnValue({ data: { workers: [] }, isLoading: false, isError: false });
    hooksMock.useTeamTasks.mockReturnValue({ data: { tasks: [] }, isLoading: false, isError: false });
    hooksMock.useTeamMessages.mockReturnValue({ data: { messages: [] }, isLoading: false, isError: false });

    renderPanel();

    expect(screen.getByText("Disconnected")).toBeInTheDocument();
  });

  it("renders tasks and messages sections", () => {
    hooksMock.useTeamSession.mockReturnValue({
      data: {
        session: {
          id: "team-1",
          objective: "Test",
          phase: "team_exec",
          workerCount: 0,
          createdAt: new Date().toISOString(),
        },
      },
      isLoading: false,
      isError: false,
    });
    hooksMock.useTeamWorkers.mockReturnValue({ data: { workers: [] }, isLoading: false, isError: false });
    hooksMock.useTeamTasks.mockReturnValue({ data: { tasks: [] }, isLoading: false, isError: false });
    hooksMock.useTeamMessages.mockReturnValue({ data: { messages: [] }, isLoading: false, isError: false });

    renderPanel();

    expect(screen.getByText("Workers")).toBeInTheDocument();
    expect(screen.getByText("Tasks")).toBeInTheDocument();
    expect(screen.getByText("Messages")).toBeInTheDocument();
  });
});
