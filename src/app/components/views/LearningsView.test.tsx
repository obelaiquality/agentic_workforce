import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LearningsView } from "./LearningsView";

const apiClientMock = vi.hoisted(() => ({
  listLearnings: vi.fn(),
  listPrinciples: vi.fn(),
  deleteLearning: vi.fn(),
  triggerDreamCycle: vi.fn(),
  getDreamStats: vi.fn(),
  listSuggestedSkills: vi.fn(),
  approveSuggestedSkill: vi.fn(),
  dismissSuggestedSkill: vi.fn(),
  listGlobalPrinciples: vi.fn(),
}));

vi.mock("../../lib/apiClient", () => apiClientMock);

function renderView(props: { projectId?: string | null } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <LearningsView projectId={props.projectId ?? "proj-1"} />
    </QueryClientProvider>,
  );
}

describe("LearningsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    apiClientMock.listLearnings.mockResolvedValue({
      items: [
        {
          id: "l-1",
          category: "pattern",
          summary: "Use barrel exports for modules",
          detail: "Barrel exports simplify imports",
          confidence: 0.85,
          occurrences: 3,
          relatedTools: ["file_write"],
        },
        {
          id: "l-2",
          category: "antipattern",
          summary: "Avoid deeply nested callbacks",
          detail: null,
          confidence: 0.72,
          occurrences: 2,
          relatedTools: [],
        },
      ],
    });

    apiClientMock.listPrinciples.mockResolvedValue({
      items: [
        {
          id: "p-1",
          principle: "Keep modules under 200 lines",
          confidence: 0.9,
          reasoning: "Improves readability",
        },
      ],
    });

    apiClientMock.getDreamStats.mockResolvedValue({
      dreamCount: 5,
      lastDreamAt: "2026-04-01T12:00:00Z",
      learningsCount: 10,
      principlesCount: 3,
      suggestedSkillsCount: 1,
    });

    apiClientMock.listSuggestedSkills.mockResolvedValue({
      items: [
        {
          id: "sk-1",
          name: "Auto-Format",
          description: "Automatically formats code on save",
          confidence: 0.88,
          status: "pending",
          allowedTools: ["file_write", "shell"],
        },
      ],
    });

    apiClientMock.listGlobalPrinciples.mockResolvedValue({ items: [] });
    apiClientMock.deleteLearning.mockResolvedValue({ ok: true });
    apiClientMock.triggerDreamCycle.mockResolvedValue({ ok: true });
    apiClientMock.approveSuggestedSkill.mockResolvedValue({ ok: true });
    apiClientMock.dismissSuggestedSkill.mockResolvedValue({ ok: true });
  });

  it("renders dream cycle stats", async () => {
    renderView();

    expect(await screen.findByText("Dream Cycle")).toBeInTheDocument();
    expect(await screen.findByText("5")).toBeInTheDocument(); // dreamCount
  });

  it("renders learnings with category labels", async () => {
    renderView();

    expect(await screen.findByText("Use barrel exports for modules")).toBeInTheDocument();
    expect(screen.getByText("Avoid deeply nested callbacks")).toBeInTheDocument();
    expect(screen.getByText("Pattern")).toBeInTheDocument();
    expect(screen.getByText("Antipattern")).toBeInTheDocument();
  });

  it("renders consolidated principles", async () => {
    renderView();

    expect(await screen.findByText("Keep modules under 200 lines")).toBeInTheDocument();
    expect(screen.getByText("Improves readability")).toBeInTheDocument();
  });

  it("renders suggested skills with approve and dismiss buttons", async () => {
    renderView();

    expect(await screen.findByText("Auto-Format")).toBeInTheDocument();
    expect(screen.getByText("Automatically formats code on save")).toBeInTheDocument();
    expect(screen.getByText("Approve")).toBeInTheDocument();
    expect(screen.getByText("Dismiss")).toBeInTheDocument();
  });

  it("shows empty state when no learnings exist", async () => {
    apiClientMock.listLearnings.mockResolvedValue({ items: [] });

    renderView();

    expect(
      await screen.findByText("No learnings recorded yet. Learnings are extracted automatically from agentic runs."),
    ).toBeInTheDocument();
  });

  it("shows empty state when no principles exist", async () => {
    apiClientMock.listPrinciples.mockResolvedValue({ items: [] });

    renderView();

    expect(
      await screen.findByText("No principles consolidated yet. Principles emerge after multiple dream cycles."),
    ).toBeInTheDocument();
  });

  it("filters learnings by category", async () => {
    renderView();

    await screen.findByText("Use barrel exports for modules");

    const patternButton = screen.getByRole("button", { name: /^pattern$/i });
    fireEvent.click(patternButton);

    await waitFor(() => {
      expect(apiClientMock.listLearnings).toHaveBeenCalledWith(
        expect.objectContaining({ category: "pattern" }),
      );
    });
  });

  it("triggers dream cycle on button click", async () => {
    renderView();

    const triggerButton = await screen.findByText("Trigger Dream");
    fireEvent.click(triggerButton);

    await waitFor(() => {
      expect(apiClientMock.triggerDreamCycle).toHaveBeenCalledTimes(1);
    });
  });

  it("approves a suggested skill", async () => {
    renderView();

    const approveButton = await screen.findByText("Approve");
    fireEvent.click(approveButton);

    await waitFor(() => {
      expect(apiClientMock.approveSuggestedSkill).toHaveBeenCalledWith("sk-1");
    });
  });

  it("dismisses a suggested skill", async () => {
    renderView();

    const dismissButton = await screen.findByText("Dismiss");
    fireEvent.click(dismissButton);

    await waitFor(() => {
      expect(apiClientMock.dismissSuggestedSkill).toHaveBeenCalledWith("sk-1");
    });
  });

  it("does not show suggested skills section when none are pending", async () => {
    apiClientMock.listSuggestedSkills.mockResolvedValue({ items: [] });

    renderView();

    await screen.findByText("Dream Cycle");

    expect(screen.queryByText("Suggested Skills (")).not.toBeInTheDocument();
  });

  it("renders global principles when present", async () => {
    apiClientMock.listGlobalPrinciples.mockResolvedValue({
      items: [
        {
          id: "gp-1",
          principle: "Always add error handling",
          confidence: 0.95,
          reasoning: "Prevents crashes",
          sourceProjectCount: 3,
          techFingerprint: ["typescript", "react"],
        },
      ],
    });

    renderView();

    expect(await screen.findByText("Always add error handling")).toBeInTheDocument();
    expect(screen.getByText("3 projects")).toBeInTheDocument();
    expect(screen.getByText("typescript")).toBeInTheDocument();
    expect(screen.getByText("react")).toBeInTheDocument();
  });

  it("renders without project id", async () => {
    renderView({ projectId: null });

    expect(await screen.findByText("Dream Cycle")).toBeInTheDocument();
  });
});
