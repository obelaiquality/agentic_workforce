import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InterviewPanel } from "./InterviewPanel";

const mockSubmitMutate = vi.fn();
const mockHandoffMutate = vi.fn();

const hooksMock = vi.hoisted(() => ({
  useInterviewSession: vi.fn(),
  useInterviewStream: vi.fn(),
  useSubmitAnswer: vi.fn(),
  useHandoff: vi.fn(),
}));

vi.mock("../../hooks/useInterviewMode", () => hooksMock);

// Mock recharts for child chart components
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  AreaChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Area: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  Tooltip: () => <div />,
  ReferenceLine: () => <div />,
  RadarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Radar: () => <div />,
  PolarGrid: () => <div />,
  PolarAngleAxis: () => <div />,
  PolarRadiusAxis: () => <div />,
}));

function renderPanel(sessionId = "session-1") {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <InterviewPanel sessionId={sessionId} />
    </QueryClientProvider>,
  );
}

describe("InterviewPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    hooksMock.useInterviewStream.mockReturnValue({
      latestScores: [],
      isConnected: false,
    });

    hooksMock.useSubmitAnswer.mockReturnValue({
      mutate: mockSubmitMutate,
      isPending: false,
    });

    hooksMock.useHandoff.mockReturnValue({
      mutate: mockHandoffMutate,
    });
  });

  it("shows loading state while session is loading", () => {
    hooksMock.useInterviewSession.mockReturnValue({
      data: null,
      isLoading: true,
    });

    renderPanel();

    expect(screen.getByText("Loading session...")).toBeInTheDocument();
  });

  it("shows session not found when data is null", () => {
    hooksMock.useInterviewSession.mockReturnValue({
      data: null,
      isLoading: false,
    });

    renderPanel();

    expect(screen.getByText("Session not found")).toBeInTheDocument();
  });

  it("renders session with objective and round info", () => {
    hooksMock.useInterviewSession.mockReturnValue({
      data: {
        session: {
          id: "session-1",
          objective: "Build a chat app",
          status: "active",
          currentRound: 2,
          maxRounds: 5,
          ambiguityThreshold: 0.3,
          questions: [
            {
              id: "q-1",
              question: "What protocol?",
              round: 1,
              targetDimension: "architecture",
              answer: "WebSocket",
            },
            {
              id: "q-2",
              question: "How many users?",
              round: 2,
              targetDimension: "scope",
            },
          ],
          scores: [{ round: 1, overall: 0.7, dimensions: { intent: 0.6, scope: 0.5, architecture: 0.8, constraints: 0.4, priorities: 0.6 } }],
        },
      },
      isLoading: false,
    });

    renderPanel();

    expect(screen.getByText(/Build a chat app/)).toBeInTheDocument();
    expect(screen.getByText("Round 2/5")).toBeInTheDocument();
  });

  it("renders current question with answer input", () => {
    hooksMock.useInterviewSession.mockReturnValue({
      data: {
        session: {
          id: "session-1",
          objective: "Build an API",
          status: "active",
          currentRound: 1,
          maxRounds: 5,
          ambiguityThreshold: 0.3,
          questions: [
            {
              id: "q-1",
              question: "What language?",
              round: 1,
              targetDimension: "architecture",
            },
          ],
          scores: [],
        },
      },
      isLoading: false,
    });

    renderPanel();

    expect(screen.getByText("What language?")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Type your answer...")).toBeInTheDocument();
  });

  it("shows all-answered state when no current question and not crystallized", () => {
    hooksMock.useInterviewSession.mockReturnValue({
      data: {
        session: {
          id: "session-1",
          objective: "Something",
          status: "active",
          currentRound: 1,
          maxRounds: 5,
          ambiguityThreshold: 0.3,
          questions: [
            {
              id: "q-1",
              question: "First question?",
              round: 1,
              targetDimension: "scope",
              answer: "My answer",
            },
          ],
          scores: [],
        },
      },
      isLoading: false,
    });

    renderPanel();

    expect(screen.getByText("All questions answered. Waiting for next round...")).toBeInTheDocument();
  });

  it("shows handoff selector when session is crystallized", () => {
    hooksMock.useInterviewSession.mockReturnValue({
      data: {
        session: {
          id: "session-1",
          objective: "Build feature",
          status: "crystallized",
          currentRound: 3,
          maxRounds: 5,
          ambiguityThreshold: 0.3,
          questions: [],
          scores: [],
          specContent: "The spec content here.",
        },
      },
      isLoading: false,
    });

    renderPanel();

    expect(screen.getByText("Crystallized Spec")).toBeInTheDocument();
    expect(screen.getByText("Ralph Mode")).toBeInTheDocument();
    expect(screen.getByText("Team Mode")).toBeInTheDocument();
    expect(screen.getByText("crystallized")).toBeInTheDocument();
  });

  it("toggles previous Q&A section", () => {
    hooksMock.useInterviewSession.mockReturnValue({
      data: {
        session: {
          id: "session-1",
          objective: "Test",
          status: "active",
          currentRound: 2,
          maxRounds: 5,
          ambiguityThreshold: 0.3,
          questions: [
            {
              id: "q-1",
              question: "Answered question?",
              round: 1,
              targetDimension: "scope",
              answer: "Yes",
            },
            {
              id: "q-2",
              question: "Current question?",
              round: 2,
              targetDimension: "intent",
            },
          ],
          scores: [],
        },
      },
      isLoading: false,
    });

    renderPanel();

    // Previous Q&A section should be present but collapsed
    const toggleButton = screen.getByText(/Previous Q&A/);
    expect(toggleButton).toBeInTheDocument();

    // Click to expand
    fireEvent.click(toggleButton);

    // Now the answered question should be visible
    expect(screen.getByText("Yes")).toBeInTheDocument();
  });

  it("shows connection indicator when stream is connected", () => {
    hooksMock.useInterviewStream.mockReturnValue({
      latestScores: [],
      isConnected: true,
    });

    hooksMock.useInterviewSession.mockReturnValue({
      data: {
        session: {
          id: "session-1",
          objective: "Test",
          status: "active",
          currentRound: 1,
          maxRounds: 5,
          ambiguityThreshold: 0.3,
          questions: [],
          scores: [],
        },
      },
      isLoading: false,
    });

    const { container } = renderPanel();

    // The green pulse dot is rendered when connected
    const pulseDot = container.querySelector(".bg-emerald-400.animate-pulse");
    expect(pulseDot).not.toBeNull();
  });
});
