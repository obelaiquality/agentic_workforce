import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RalphPanel } from "./RalphPanel";

const mockPauseMutate = vi.fn();
const mockResumeMutate = vi.fn();

const hooksMock = vi.hoisted(() => ({
  useRalphSession: vi.fn(),
  useRalphLedger: vi.fn(),
  usePauseRalph: vi.fn(),
  useResumeRalph: vi.fn(),
  useRalphStream: vi.fn(),
}));

vi.mock("../../hooks/useRalphMode", () => hooksMock);

function renderPanel(sessionId = "ralph-1") {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <RalphPanel sessionId={sessionId} />
    </QueryClientProvider>,
  );
}

describe("RalphPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    hooksMock.useRalphStream.mockReturnValue({
      events: [],
      connected: false,
      clear: vi.fn(),
    });

    hooksMock.usePauseRalph.mockReturnValue({
      mutate: mockPauseMutate,
      isPending: false,
    });

    hooksMock.useResumeRalph.mockReturnValue({
      mutate: mockResumeMutate,
      isPending: false,
    });
  });

  it("shows loading state", () => {
    hooksMock.useRalphSession.mockReturnValue({
      data: null,
      isLoading: true,
    });
    hooksMock.useRalphLedger.mockReturnValue({ data: null });

    renderPanel();

    expect(screen.getByText("Loading session...")).toBeInTheDocument();
  });

  it("shows loading state when data is null", () => {
    hooksMock.useRalphSession.mockReturnValue({
      data: null,
      isLoading: false,
    });
    hooksMock.useRalphLedger.mockReturnValue({ data: null });

    renderPanel();

    expect(screen.getByText("Loading session...")).toBeInTheDocument();
  });

  it("renders session with spec content in header", () => {
    hooksMock.useRalphSession.mockReturnValue({
      data: {
        session: {
          id: "ralph-1",
          status: "running",
          currentPhase: "execute",
          currentIteration: 2,
          maxIterations: 5,
          verificationTier: "THOROUGH",
          specContent: "Build the authentication module",
          progressLedger: null,
        },
      },
      isLoading: false,
    });
    hooksMock.useRalphLedger.mockReturnValue({
      data: {
        ledger: null,
        phaseExecutions: [],
        verifications: [],
      },
    });

    renderPanel();

    expect(screen.getByText(/Build the authentication module/)).toBeInTheDocument();
    expect(screen.getByText("Ralph:")).toBeInTheDocument();
  });

  it("renders phase timeline with current phase", () => {
    hooksMock.useRalphSession.mockReturnValue({
      data: {
        session: {
          id: "ralph-1",
          status: "running",
          currentPhase: "verify",
          currentIteration: 1,
          maxIterations: 3,
          verificationTier: "FAST",
          specContent: "Test spec",
          progressLedger: null,
        },
      },
      isLoading: false,
    });
    hooksMock.useRalphLedger.mockReturnValue({
      data: {
        ledger: null,
        phaseExecutions: [],
        verifications: [],
      },
    });

    renderPanel();

    // Phase timeline renders all phases
    expect(screen.getByText("Intake")).toBeInTheDocument();
    expect(screen.getByText("Execute")).toBeInTheDocument();
    expect(screen.getByText("Verify")).toBeInTheDocument();
  });

  it("renders verification badges when verifications exist", () => {
    hooksMock.useRalphSession.mockReturnValue({
      data: {
        session: {
          id: "ralph-1",
          status: "running",
          currentPhase: "deslop",
          currentIteration: 1,
          maxIterations: 3,
          verificationTier: "THOROUGH",
          specContent: "Spec",
          progressLedger: null,
        },
      },
      isLoading: false,
    });
    hooksMock.useRalphLedger.mockReturnValue({
      data: {
        ledger: null,
        phaseExecutions: [],
        verifications: [
          {
            tier: "THOROUGH",
            testsPassed: true,
            lintsPassed: true,
            deslopPassed: false,
            regressionsPassed: true,
          },
        ],
      },
    });

    renderPanel();

    expect(screen.getByText("Tests")).toBeInTheDocument();
    expect(screen.getByText("Lints")).toBeInTheDocument();
    // "Deslop" appears in both the phase timeline and verification badges
    expect(screen.getAllByText("Deslop").length).toBeGreaterThanOrEqual(2);
  });

  it("renders controls with iteration counter", () => {
    hooksMock.useRalphSession.mockReturnValue({
      data: {
        session: {
          id: "ralph-1",
          status: "running",
          currentPhase: "execute",
          currentIteration: 3,
          maxIterations: 5,
          verificationTier: "FAST",
          specContent: "Spec",
          progressLedger: null,
        },
      },
      isLoading: false,
    });
    hooksMock.useRalphLedger.mockReturnValue({
      data: { ledger: null, phaseExecutions: [], verifications: [] },
    });

    renderPanel();

    expect(screen.getByText("Iter 3/5")).toBeInTheDocument();
    expect(screen.getByText("Pause")).toBeInTheDocument();
  });
});
