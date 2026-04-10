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
  useInterviewSession,
  useSubmitAnswer,
  useHandoff,
  useStartInterview,
  useInterviewStream,
} from "./useInterviewMode";

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

describe("useInterviewSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not fetch when id is null", () => {
    const { result } = renderHook(() => useInterviewSession(null), {
      wrapper: createWrapper(),
    });

    expect(result.current.data).toBeUndefined();
    expect(apiRequestMock).not.toHaveBeenCalled();
  });

  it("fetches session data when id is provided", async () => {
    apiRequestMock.mockResolvedValue({
      session_id: "s-1",
      objective: "Build an API",
      status: "active",
      current_round: 2,
      max_rounds: 5,
      ambiguity_threshold: 0.3,
      questions: [
        {
          id: "q-1",
          question: "What framework?",
          round: 1,
          target_dimension: "architecture",
          answer: "Express",
        },
      ],
      ambiguity_scores: [
        {
          round: 1,
          overall: 0.6,
          dimensions: { intent: 0.5, scope: 0.7, architecture: 0.6, constraints: 0.4, priorities: 0.8 },
        },
      ],
    });

    const { result } = renderHook(() => useInterviewSession("s-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const session = result.current.data!.session;
    expect(session.id).toBe("s-1");
    expect(session.objective).toBe("Build an API");
    expect(session.status).toBe("active");
    expect(session.currentRound).toBe(2);
    expect(session.questions).toHaveLength(1);
    expect(session.questions[0].targetDimension).toBe("architecture");
    expect(session.scores).toHaveLength(1);
  });

  it("maps completed status to crystallized", async () => {
    apiRequestMock.mockResolvedValue({
      session_id: "s-1",
      objective: "Test",
      status: "completed",
      current_round: 3,
      max_rounds: 5,
      ambiguity_threshold: 0.3,
      questions: [],
      ambiguity_scores: [],
    });

    const { result } = renderHook(() => useInterviewSession("s-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data!.session.status).toBe("crystallized");
  });
});

describe("useSubmitAnswer", () => {
  beforeEach(() => vi.clearAllMocks());

  it("posts answer to the correct endpoint", async () => {
    apiRequestMock.mockResolvedValue({ events: [] });

    const { result } = renderHook(() => useSubmitAnswer("s-1"), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ questionId: "q-1", answer: "Express" });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiRequestMock).toHaveBeenCalledWith(
      "/api/interview/s-1/answer",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ question_id: "q-1", answer: "Express" }),
      }),
    );
  });
});

describe("useHandoff", () => {
  beforeEach(() => vi.clearAllMocks());

  it("posts handoff with the specified mode", async () => {
    apiRequestMock.mockResolvedValue({ session_id: "s-1", target_mode: "ralph", spec: "spec" });

    const { result } = renderHook(() => useHandoff("s-1"), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate("ralph");
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiRequestMock).toHaveBeenCalledWith(
      "/api/interview/s-1/handoff",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ target_mode: "ralph" }),
      }),
    );
  });
});

describe("useStartInterview", () => {
  beforeEach(() => vi.clearAllMocks());

  it("posts start interview request", async () => {
    apiRequestMock.mockResolvedValue({ run_id: "r-1", session_id: "s-1", events: [] });

    const { result } = renderHook(() => useStartInterview(), {
      wrapper: createWrapper(),
    });

    const input = {
      actor: "user-1",
      repo_id: "repo-1",
      objective: "Build auth",
      worktree_path: "/tmp/project",
    };

    await act(async () => {
      result.current.mutate(input);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiRequestMock).toHaveBeenCalledWith(
      "/api/interview/start",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(input),
      }),
    );
  });
});

describe("useInterviewStream", () => {
  let mockEventSource: {
    onopen: (() => void) | null;
    onmessage: ((evt: { data: string }) => void) | null;
    onerror: (() => void) | null;
    close: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
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
    const { result } = renderHook(() => useInterviewStream(null));

    expect(result.current.isConnected).toBe(false);
    expect(EventSource).not.toHaveBeenCalled();
  });

  it("connects to EventSource when id is provided", () => {
    renderHook(() => useInterviewStream("s-1"));

    expect(EventSource).toHaveBeenCalledWith(
      expect.stringContaining("/api/interview/s-1/stream"),
    );
  });

  it("sets isConnected to true on open", () => {
    const { result } = renderHook(() => useInterviewStream("s-1"));

    act(() => {
      mockEventSource.onopen?.();
    });

    expect(result.current.isConnected).toBe(true);
  });

  it("accumulates score events", () => {
    const { result } = renderHook(() => useInterviewStream("s-1"));

    act(() => {
      mockEventSource.onopen?.();
      mockEventSource.onmessage?.({
        data: JSON.stringify({
          type: "interview_scored",
          round: 1,
          overall: 0.7,
          dimensions: { intent: 0.5, scope: 0.8 },
        }),
      });
    });

    expect(result.current.latestScores).toHaveLength(1);
    expect(result.current.latestScores[0].round).toBe(1);
    expect(result.current.latestScores[0].overall).toBe(0.7);
  });

  it("sets isConnected to false on error", () => {
    const { result } = renderHook(() => useInterviewStream("s-1"));

    act(() => {
      mockEventSource.onopen?.();
    });
    expect(result.current.isConnected).toBe(true);

    act(() => {
      mockEventSource.onerror?.();
    });
    expect(result.current.isConnected).toBe(false);
  });

  it("closes EventSource on unmount", () => {
    const { unmount } = renderHook(() => useInterviewStream("s-1"));

    unmount();

    expect(mockEventSource.close).toHaveBeenCalled();
  });

  it("resets state when reset is called", () => {
    const { result } = renderHook(() => useInterviewStream("s-1"));

    act(() => {
      mockEventSource.onmessage?.({
        data: JSON.stringify({ type: "interview_scored", round: 1, overall: 0.5, dimensions: {} }),
      });
    });
    expect(result.current.latestScores).toHaveLength(1);

    act(() => {
      result.current.reset();
    });

    expect(result.current.latestScores).toHaveLength(0);
    expect(result.current.events).toHaveLength(0);
  });
});
