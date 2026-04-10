/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";

const apiRequestMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/apiClient", () => ({
  apiRequest: apiRequestMock,
}));

import {
  useTeamSession,
  useTeamWorkers,
  useTeamTasks,
  useTeamMessages,
  useSendMessage,
  useStartTeam,
  useTeamStream,
} from "./useTeamMode";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe("useTeamSession", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not fetch when id is null", () => {
    const { result } = renderHook(() => useTeamSession(null), {
      wrapper: createWrapper(),
    });

    expect(result.current.data).toBeUndefined();
    expect(apiRequestMock).not.toHaveBeenCalled();
  });

  it("fetches session data when id is provided", async () => {
    apiRequestMock.mockResolvedValue({
      session: {
        id: "t-1",
        objective: "Build dashboard",
        phase: "team_exec",
        workerCount: 3,
        createdAt: "2026-04-01T00:00:00Z",
      },
    });

    const { result } = renderHook(() => useTeamSession("t-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data!.session.objective).toBe("Build dashboard");
    expect(result.current.data!.session.phase).toBe("team_exec");
  });
});

describe("useTeamWorkers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not fetch when id is null", () => {
    const { result } = renderHook(() => useTeamWorkers(null), {
      wrapper: createWrapper(),
    });

    expect(result.current.data).toBeUndefined();
    expect(apiRequestMock).not.toHaveBeenCalled();
  });

  it("fetches workers list", async () => {
    apiRequestMock.mockResolvedValue({
      workers: [
        { id: "w-1", workerId: "alpha", role: "coder", status: "executing", currentTaskId: null, lastHeartbeatAt: "2026-04-01T00:00:00Z" },
      ],
    });

    const { result } = renderHook(() => useTeamWorkers("t-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.workers).toHaveLength(1);
    expect(result.current.data!.workers[0].workerId).toBe("alpha");
  });
});

describe("useTeamTasks", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not fetch when id is null", () => {
    const { result } = renderHook(() => useTeamTasks(null), {
      wrapper: createWrapper(),
    });

    expect(result.current.data).toBeUndefined();
    expect(apiRequestMock).not.toHaveBeenCalled();
  });

  it("fetches tasks list", async () => {
    apiRequestMock.mockResolvedValue({
      tasks: [
        { id: "task-1", name: "Login", description: "Implement login", assignedTo: null, priority: 5, status: "pending", leaseExpires: null, result: null },
      ],
    });

    const { result } = renderHook(() => useTeamTasks("t-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.tasks).toHaveLength(1);
    expect(result.current.data!.tasks[0].name).toBe("Login");
  });
});

describe("useTeamMessages", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not fetch when id is null", () => {
    const { result } = renderHook(() => useTeamMessages(null), {
      wrapper: createWrapper(),
    });

    expect(result.current.data).toBeUndefined();
    expect(apiRequestMock).not.toHaveBeenCalled();
  });

  it("fetches messages for a session", async () => {
    apiRequestMock.mockResolvedValue({
      messages: [
        { id: "msg-1", fromWorkerId: "alpha", toWorkerId: null, content: "Hello", read: false, createdAt: "2026-04-01T00:00:00Z" },
      ],
    });

    const { result } = renderHook(() => useTeamMessages("t-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.messages).toHaveLength(1);
    expect(result.current.data!.messages[0].content).toBe("Hello");
  });

  it("fetches messages for specific worker", async () => {
    apiRequestMock.mockResolvedValue({ messages: [] });

    renderHook(() => useTeamMessages("t-1", "alpha"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        expect.stringContaining("/messages/alpha"),
      );
    });
  });
});

describe("useSendMessage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("posts message to the correct endpoint", async () => {
    apiRequestMock.mockResolvedValue({
      message: { id: "msg-new", fromWorkerId: "alpha", toWorkerId: null, content: "Done", read: false, createdAt: "2026-04-01T00:00:00Z" },
    });

    const { result } = renderHook(() => useSendMessage("t-1"), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ fromWorkerId: "alpha", content: "Done" });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiRequestMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/enhanced-team/t-1/message"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ fromWorkerId: "alpha", content: "Done" }),
      }),
    );
  });
});

describe("useStartTeam", () => {
  beforeEach(() => vi.clearAllMocks());

  it("posts start request", async () => {
    apiRequestMock.mockResolvedValue({ sessionId: "t-new" });

    const { result } = renderHook(() => useStartTeam(), {
      wrapper: createWrapper(),
    });

    const input = {
      actor: "user-1",
      repoId: "repo-1",
      objective: "Build feature",
      worktreePath: "/tmp/project",
    };

    await act(async () => {
      result.current.mutate(input);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiRequestMock).toHaveBeenCalledWith(
      "/api/enhanced-team/start",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(input),
      }),
    );
  });
});

describe("useTeamStream", () => {
  let mockEventSource: {
    onopen: (() => void) | null;
    onmessage: ((evt: { data: string }) => void) | null;
    onerror: (() => void) | null;
    close: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockEventSource = {
      onopen: null,
      onmessage: null,
      onerror: null,
      close: vi.fn(),
    };

    vi.stubGlobal("EventSource", vi.fn(() => mockEventSource));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not connect when id is null", () => {
    const { result } = renderHook(() => useTeamStream(null));

    expect(result.current.connected).toBe(false);
    expect(EventSource).not.toHaveBeenCalled();
  });

  it("connects to EventSource when id is provided", () => {
    renderHook(() => useTeamStream("t-1"));

    expect(EventSource).toHaveBeenCalledWith(
      expect.stringContaining("/api/enhanced-team/t-1/stream"),
    );
  });

  it("sets connected to true on open", () => {
    const { result } = renderHook(() => useTeamStream("t-1"));

    act(() => {
      mockEventSource.onopen?.();
    });

    expect(result.current.connected).toBe(true);
  });

  it("accumulates events from messages", () => {
    const { result } = renderHook(() => useTeamStream("t-1"));

    act(() => {
      mockEventSource.onmessage?.({
        data: JSON.stringify({ type: "team_worker_status", workerId: "alpha" }),
      });
    });

    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0].type).toBe("team_worker_status");
  });

  it("sets connected to false on error", () => {
    const { result } = renderHook(() => useTeamStream("t-1"));

    act(() => {
      mockEventSource.onopen?.();
    });
    expect(result.current.connected).toBe(true);

    act(() => {
      mockEventSource.onerror?.();
    });
    expect(result.current.connected).toBe(false);
  });

  it("closes EventSource on unmount", () => {
    const { unmount } = renderHook(() => useTeamStream("t-1"));

    unmount();

    expect(mockEventSource.close).toHaveBeenCalled();
  });

  it("clears events when clearEvents is called", () => {
    const { result } = renderHook(() => useTeamStream("t-1"));

    act(() => {
      mockEventSource.onmessage?.({
        data: JSON.stringify({ type: "team_task_update" }),
      });
    });
    expect(result.current.events).toHaveLength(1);

    act(() => {
      result.current.clearEvents();
    });
    expect(result.current.events).toHaveLength(0);
  });

  it("caps event buffer at 100 entries", () => {
    const { result } = renderHook(() => useTeamStream("t-1"));

    act(() => {
      for (let i = 0; i < 110; i++) {
        mockEventSource.onmessage?.({
          data: JSON.stringify({ type: `event_${i}` }),
        });
      }
    });

    // The hook keeps last 100 via slice(-99) + new entry
    expect(result.current.events.length).toBeLessThanOrEqual(100);
  });

  it("resets events and disconnects when id changes to null", () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useTeamStream(id),
      { initialProps: { id: "t-1" as string | null } },
    );

    act(() => {
      mockEventSource.onopen?.();
      mockEventSource.onmessage?.({
        data: JSON.stringify({ type: "some_event" }),
      });
    });
    expect(result.current.connected).toBe(true);
    expect(result.current.events).toHaveLength(1);

    rerender({ id: null });

    expect(result.current.connected).toBe(false);
    expect(result.current.events).toHaveLength(0);
  });
});
