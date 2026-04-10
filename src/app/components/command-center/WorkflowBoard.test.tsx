import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkflowBoard } from "./WorkflowBoard";
import { LANE_META } from "./helpers";

vi.mock("react-dnd", () => ({
  DndProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useDrag: () => [{ isDragging: false }, () => {}],
  useDrop: () => [{ isOver: false, canDrop: false }, () => {}],
}));

vi.mock("react-dnd-html5-backend", () => ({
  HTML5Backend: {},
}));

function makeMission(overrides: Record<string, unknown> = {}) {
  return {
    timeline: [],
    contextPack: null,
    moveWorkflow: vi.fn(),
    addTaskComment: vi.fn(),
    isCommenting: false,
    ticketLifecycleNotices: {},
    ...overrides,
  };
}

function makeLaneActivity() {
  return LANE_META.map((lane) => ({
    ...lane,
    summary: { key: lane.key, label: lane.label, count: 0, blockedCount: 0, workflowIds: [] },
    items: [],
  }));
}

describe("WorkflowBoard", () => {
  it("renders the board with all four lanes", () => {
    render(
      <WorkflowBoard
        mission={makeMission() as never}
        workflowCards={[]}
        selectedWorkflowId={null}
        detailPinned={false}
        taskDetail={null}
        laneActivity={makeLaneActivity()}
        selectedLane={null}
        workflowViewMode="board"
        onSelectWorkflow={vi.fn()}
        onOpenApprovals={vi.fn()}
        onSetWorkflowViewMode={vi.fn()}
      />
    );

    expect(screen.getByText("Task Board")).toBeInTheDocument();
    expect(screen.getByTestId("work-lane-backlog")).toBeInTheDocument();
    expect(screen.getByTestId("work-lane-in_progress")).toBeInTheDocument();
    expect(screen.getByTestId("work-lane-needs_review")).toBeInTheDocument();
    expect(screen.getByTestId("work-lane-completed")).toBeInTheDocument();
  });

  it("renders board/list view toggle", () => {
    render(
      <WorkflowBoard
        mission={makeMission() as never}
        workflowCards={[]}
        selectedWorkflowId={null}
        detailPinned={false}
        taskDetail={null}
        laneActivity={makeLaneActivity()}
        selectedLane={null}
        workflowViewMode="board"
        onSelectWorkflow={vi.fn()}
        onOpenApprovals={vi.fn()}
        onSetWorkflowViewMode={vi.fn()}
      />
    );

    expect(screen.getByTestId("work-view-toggle")).toBeInTheDocument();
    expect(screen.getByText("Board")).toBeInTheDocument();
    expect(screen.getByText("List")).toBeInTheDocument();
  });

  it("shows 'All Workflows' chip when no lane is selected", () => {
    render(
      <WorkflowBoard
        mission={makeMission() as never}
        workflowCards={[]}
        selectedWorkflowId={null}
        detailPinned={false}
        taskDetail={null}
        laneActivity={makeLaneActivity()}
        selectedLane={null}
        workflowViewMode="board"
        onSelectWorkflow={vi.fn()}
        onOpenApprovals={vi.fn()}
        onSetWorkflowViewMode={vi.fn()}
      />
    );

    expect(screen.getByText("All Workflows")).toBeInTheDocument();
  });
});
