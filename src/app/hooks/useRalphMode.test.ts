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
  useRalphSession,
  useRalphLedger,
  useStartRalph,
  usePauseRalph,
  useResumeRalph,
  useRalphStream,
} from "./useRalphMode";

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

describe("useRalphSession", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not fetch when id is null", () => {
    const { result } = renderHook(() => useRalphSession(null), {
      wrapper: createWrapper(),
    });

    expect(result.current.data).toBeUndefined();
    expect(apiRequestMock).not.toHaveBeenCalled();
  });

  it("fetches session data when id is provided", async () => {
    apiRequestMock.mockResolvedValue({
      session_id: "r-1",
      status: "running",
      current_phase: "execute",
      iteration: 2,
      max_iterations: 5,
      verification_tier: "THOROUGH",
      spec_content: "Build auth module",
      progress_ledger: null,
    });

    const { result } = renderHook(() => useRalphSession("r-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const session = result.current.data!.session;
    expect(session.id).toBe("r-1");
    expect(session.status).toBe("running");
    expect(session.currentPhase).toBe("execute");
    expect(session.currentIteration).toBe(2);
    expect(session.maxIterations).toBe(5);
  });
});

describe("useRalphLedger", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not fetch when id is null", () => {
    const { result } = renderHook(() => useRalphLedger(null), {
      wrapper: createWrapper(),
    });

    expect(result.current.data).toBeUndefined();
    expect(apiRequestMock).not.toHaveBeenCalled();
  });

  it("fetches ledger data with phase executions and verifications", async () => {
    apiRequestMock.mockResolvedValue({
      progress_ledger: {
        completedPhases: ["intake"],
        currentObjective: "Implement login",
        filesModified: ["src/auth.ts"],
        testResults: {},
        verificationsPassed: 1,
        deslopIssuesFound: 2,
        deslopIssuesFixed: 1,
      },
      phase_executions: [
        { phase: "execute", iteration: 1, status: "completed", output: "Done" },
      ],
      verifications: [
        { tier: "FAST", tests_passed: true, lints_passed: true, deslop_passed: false, regressions_passed: true },
      ],
    });

    const { result } = renderHook(() => useRalphLedger("r-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data!.ledger).not.toBeNull();
    expect(result.current.data!.phaseExecutions).toHaveLength(1);
    expect(result.current.data!.verifications).toHaveLength(1);
    expect(result.current.data!.verifications[0].testsPassed).toBe(true);
    expect(result.current.data!.verifications[0].deslopPassed).toBe(false);
  });
});

describe("useStartRalph", () => {
  beforeEach(() => vi.clearAllMocks());

  it("posts start request", async () => {
    apiRequestMock.mockResolvedValue({ session_id: "r-new" });

    const { result } = renderHook(() => useStartRalph(), {
      wrapper: createWrapper(),
    });

    const input = {
      actor: "user-1",
      project_id: "proj-1",
      spec_content: "Build feature X",
    };

    await act(async () => {
      result.current.mutate(input);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiRequestMock).toHaveBeenCalledWith(
      "/api/ralph/start",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(input),
      }),
    );
  });
});

describe("usePauseRalph", () => {
  beforeEach(() => vi.clearAllMocks());

  it("posts pause request", async () => {
    apiRequestMock.mockResolvedValue({ ok: true });

    const { result } = renderHook(() => usePauseRalph("r-1"), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiRequestMock).toHaveBeenCalledWith(
      "/api/ralph/r-1/pause",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

describe("useResumeRalph", () => {
  beforeEach(() => vi.clearAllMocks());

  it("posts resume request", async () => {
    apiRequestMock.mockResolvedValue({ ok: true });

    const { result } = renderHook(() => useResumeRalph("r-1"), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiRequestMock).toHaveBeenCalledWith(
      "/api/ralph/r-1/resume",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

describe("useRalphStream", () => {
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
    const { result } = renderHook(() => useRalphStream(null), {
      wrapper: createWrapper(),
    });

    expect(result.current.connected).toBe(false);
    expect(EventSource).not.toHaveBeenCalled();
  });

  it("connects to EventSource when id is provided", () => {
    renderHook(() => useRalphStream("r-1"), {
      wrapper: createWrapper(),
    });

    expect(EventSource).toHaveBeenCalledWith(
      expect.stringContaining("/api/ralph/r-1/stream"),
    );
  });

  it("sets connected to true on open", () => {
    const { result } = renderHook(() => useRalphStream("r-1"), {
      wrapper: createWrapper(),
    });

    act(() => {
      mockEventSource.onopen?.();
    });

    expect(result.current.connected).toBe(true);
  });

  it("accumulates events", () => {
    const { result } = renderHook(() => useRalphStream("r-1"), {
      wrapper: createWrapper(),
    });

    act(() => {
      mockEventSource.onmessage?.({
        data: JSON.stringify({ type: "ralph_phase_entered", data: {} }),
      });
    });

    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0].type).toBe("ralph_phase_entered");
  });

  it("sets connected to false on error", () => {
    const { result } = renderHook(() => useRalphStream("r-1"), {
      wrapper: createWrapper(),
    });

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
    const { unmount } = renderHook(() => useRalphStream("r-1"), {
      wrapper: createWrapper(),
    });

    unmount();

    expect(mockEventSource.close).toHaveBeenCalled();
  });

  it("clears events when clear is called", () => {
    const { result } = renderHook(() => useRalphStream("r-1"), {
      wrapper: createWrapper(),
    });

    act(() => {
      mockEventSource.onmessage?.({
        data: JSON.stringify({ type: "ralph_checkpoint", data: {} }),
      });
    });
    expect(result.current.events).toHaveLength(1);

    act(() => {
      result.current.clear();
    });
    expect(result.current.events).toHaveLength(0);
  });
});
