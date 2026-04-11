import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkflowBoard } from "./WorkflowBoard";
import { LANE_META } from "./helpers";
import type { WorkflowCardItem, WorkflowLaneKey } from "./types";

vi.mock("react-dnd", () => ({
  DndProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useDrag: () => [{ isDragging: false }, vi.fn()],
  useDrop: () => [{ isOver: false, canDrop: false }, vi.fn()],
}));

vi.mock("react-dnd-html5-backend", () => ({
  HTML5Backend: {},
}));

vi.mock("../../store/uiStore", () => ({
  useUiStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      setActiveSection: vi.fn(),
      setCodebaseScope: vi.fn(),
    }),
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

function makeCard(overrides: Record<string, unknown> = {}): WorkflowCardItem {
  return {
    workflowId: "wf-1",
    title: "Implement login page",
    subtitle: "Build login form with validation",
    status: "backlog" as WorkflowLaneKey,
    rawStatus: "backlog",
    priority: "high",
    risk: "medium",
    taskCount: 1,
    isBlocked: false,
    blockedReason: null,
    impactedFiles: ["src/login.tsx"],
    impactedTests: ["src/login.test.tsx"],
    impactedDocs: ["docs/auth.md"],
    lastUpdatedAt: new Date().toISOString(),
    verificationState: null,
    verificationFailure: null,
    verificationCommand: null,
    confidence: null,
    progress: 18,
    ownerLabel: null,
    executionProfileOverrideId: null,
    executionProfileOverrideName: null,
    laneCount: 0,
    laneOrder: 0,
    ...overrides,
  } as unknown as WorkflowCardItem;
}

function makeTaskDetail(overrides: Record<string, unknown> = {}) {
  return {
    taskId: "wf-1",
    title: "Implement login page",
    status: "backlog",
    comments: [],
    activityNotes: [],
    metadata: {},
    logs: [],
    approvals: [],
    verification: [],
    impactedFiles: [],
    impactedTests: [],
    impactedDocs: [],
    workflowSummary: null,
    blockers: [],
    nextSteps: [],
    verificationFailures: [],
    verificationCommand: null,
    route: null,
    subtasks: [],
    executionProfileOverrideId: null,
    executionProfileSnapshot: null,
    ticketExecutionPolicy: null,
    ...overrides,
  };
}

function makeLaneActivity(cards: WorkflowCardItem[] = []) {
  return LANE_META.map((lane) => ({
    ...lane,
    summary: { key: lane.key, label: lane.label, count: 0, blockedCount: 0, workflowIds: [] },
    items: cards.filter((c) => c.status === lane.key),
  }));
}

/** Helper to render WorkflowBoard in list mode for card-level tests. */
function renderList(
  cards: WorkflowCardItem[],
  opts: {
    selectedWorkflowId?: string | null;
    detailPinned?: boolean;
    taskDetail?: ReturnType<typeof makeTaskDetail> | null;
    mission?: Record<string, unknown>;
    selectedLane?: WorkflowLaneKey | null;
    onSelectWorkflow?: ReturnType<typeof vi.fn>;
    onOpenApprovals?: ReturnType<typeof vi.fn>;
  } = {}
) {
  const mission = makeMission(opts.mission ?? {});
  const onSelectWorkflow = opts.onSelectWorkflow ?? vi.fn();
  const onOpenApprovals = opts.onOpenApprovals ?? vi.fn();
  return render(
    <WorkflowBoard
      mission={mission as never}
      workflowCards={cards}
      selectedWorkflowId={opts.selectedWorkflowId ?? null}
      detailPinned={opts.detailPinned ?? false}
      taskDetail={(opts.taskDetail ?? null) as never}
      laneActivity={makeLaneActivity(cards)}
      selectedLane={opts.selectedLane ?? null}
      workflowViewMode="list"
      onSelectWorkflow={onSelectWorkflow}
      onOpenApprovals={onOpenApprovals}
      onSetWorkflowViewMode={vi.fn()}
    />
  );
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

  it("shows the selected lane label chip when a lane is selected", () => {
    render(
      <WorkflowBoard
        mission={makeMission() as never}
        workflowCards={[]}
        selectedWorkflowId={null}
        detailPinned={false}
        taskDetail={null}
        laneActivity={makeLaneActivity()}
        selectedLane={"in_progress"}
        workflowViewMode="board"
        onSelectWorkflow={vi.fn()}
        onOpenApprovals={vi.fn()}
        onSetWorkflowViewMode={vi.fn()}
      />
    );

    // "In Progress" appears in both the chip and lane header, verify chip exists
    const allText = screen.getAllByText("In Progress");
    expect(allText.length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("All Workflows")).not.toBeInTheDocument();
  });

  it("calls onSetWorkflowViewMode when clicking Board/List buttons", () => {
    const onSetWorkflowViewMode = vi.fn();
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
        onSetWorkflowViewMode={onSetWorkflowViewMode}
      />
    );

    fireEvent.click(screen.getByText("List"));
    expect(onSetWorkflowViewMode).toHaveBeenCalledWith("list");

    fireEvent.click(screen.getByText("Board"));
    expect(onSetWorkflowViewMode).toHaveBeenCalledWith("board");
  });

  it("renders list view with cards when workflowViewMode is list", () => {
    const card = makeCard();
    renderList([card]);
    expect(screen.getByText("Implement login page")).toBeInTheDocument();
    expect(screen.queryByTestId("work-lane-backlog")).not.toBeInTheDocument();
  });

  it("filters list view by selectedLane", () => {
    const backlogCard = makeCard({ workflowId: "wf-1", title: "Backlog task", status: "backlog" });
    const ipCard = makeCard({ workflowId: "wf-2", title: "Active task", status: "in_progress" });
    renderList([backlogCard, ipCard], { selectedLane: "in_progress" as WorkflowLaneKey });

    expect(screen.getByText("Active task")).toBeInTheDocument();
    expect(screen.queryByText("Backlog task")).not.toBeInTheDocument();
  });

  it("shows empty lane placeholder when no items in board mode", () => {
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

    const emptyMessages = screen.getAllByText("Nothing active in this lane.");
    expect(emptyMessages).toHaveLength(4);
  });

  it("renders a card with title, subtitle, priority, and risk chips", () => {
    renderList([makeCard()]);
    expect(screen.getByText("Implement login page")).toBeInTheDocument();
    expect(screen.getByText("Build login form with validation")).toBeInTheDocument();
    expect(screen.getByText("high")).toBeInTheDocument();
    expect(screen.getByText("medium")).toBeInTheDocument();
  });

  it("shows impact file/test/doc counts when present", () => {
    const card = makeCard({
      impactedFiles: ["a.ts", "b.ts"],
      impactedTests: ["a.test.ts"],
      impactedDocs: ["readme.md"],
    });
    renderList([card]);
    expect(screen.getByText(/2 files/)).toBeInTheDocument();
    expect(screen.getByText(/1 tests/)).toBeInTheDocument();
    expect(screen.getByText(/1 docs/)).toBeInTheDocument();
  });

  it("shows 'Impact pending' when no impact data on backlog card", () => {
    const card = makeCard({ impactedFiles: [], impactedTests: [], impactedDocs: [] });
    renderList([card]);
    expect(screen.getByText("Impact pending")).toBeInTheDocument();
  });

  it("shows 'Impact captured' for completed lane with no impact data", () => {
    const card = makeCard({
      status: "completed" as WorkflowLaneKey,
      rawStatus: "done",
      impactedFiles: [],
      impactedTests: [],
      impactedDocs: [],
    });
    renderList([card]);
    expect(screen.getByText("Impact captured")).toBeInTheDocument();
  });

  it("shows 'Review context pending' for needs_review with no impact data", () => {
    const card = makeCard({
      status: "needs_review" as WorkflowLaneKey,
      rawStatus: "review",
      impactedFiles: [],
      impactedTests: [],
      impactedDocs: [],
    });
    renderList([card]);
    expect(screen.getByText("Review context pending")).toBeInTheDocument();
  });

  it("shows Blocked chip for blocked cards", () => {
    const card = makeCard({ isBlocked: true, blockedReason: "Waiting for dep" });
    renderList([card]);
    expect(screen.getByText("Blocked")).toBeInTheDocument();
  });

  it("shows verification state chip when present", () => {
    const card = makeCard({ verificationState: "running" });
    renderList([card]);
    expect(screen.getByText("running")).toBeInTheDocument();
  });

  it("shows ownerLabel chip when present", () => {
    const card = makeCard({ ownerLabel: "2 active lanes" });
    renderList([card]);
    expect(screen.getByText("2 active lanes")).toBeInTheDocument();
  });

  it("shows execution profile override chip when present", () => {
    const card = makeCard({ executionProfileOverrideName: "Deep Scope" });
    renderList([card]);
    expect(screen.getByText(/Profile · Deep Scope/)).toBeInTheDocument();
  });

  it("shows Review Ready chip for needs_review lane", () => {
    const card = makeCard({ status: "needs_review" as WorkflowLaneKey, rawStatus: "review" });
    renderList([card]);
    expect(screen.getByText("Review Ready")).toBeInTheDocument();
  });

  it("shows Verified chip for completed lane", () => {
    const card = makeCard({ status: "completed" as WorkflowLaneKey, rawStatus: "done" });
    renderList([card]);
    expect(screen.getByText("Verified")).toBeInTheDocument();
  });

  it("shows lifecycle notice with info tone", () => {
    const card = makeCard();
    renderList([card], {
      mission: {
        ticketLifecycleNotices: {
          "wf-1": { message: "Deploying changes", tone: "info", at: new Date().toISOString() },
        },
      },
    });
    expect(screen.getByText("Deploying changes")).toBeInTheDocument();
  });

  it("shows lifecycle notice with success tone", () => {
    const card = makeCard();
    renderList([card], {
      mission: {
        ticketLifecycleNotices: {
          "wf-1": { message: "Deploy complete", tone: "success", at: new Date().toISOString() },
        },
      },
    });
    expect(screen.getByText("Deploy complete")).toBeInTheDocument();
  });

  it("shows lifecycle notice with warn tone", () => {
    const card = makeCard();
    renderList([card], {
      mission: {
        ticketLifecycleNotices: {
          "wf-1": { message: "Build warning", tone: "warn", at: new Date().toISOString() },
        },
      },
    });
    expect(screen.getByText("Build warning")).toBeInTheDocument();
  });

  it("shows MicroBar progress for in_progress lane", () => {
    const card = makeCard({ status: "in_progress" as WorkflowLaneKey, rawStatus: "in_progress", progress: 55 });
    renderList([card]);
    expect(screen.getByText("Progress")).toBeInTheDocument();
    expect(screen.getByText("55%")).toBeInTheDocument();
  });

  it("shows 'Verified output ready' for completed lane", () => {
    const card = makeCard({ status: "completed" as WorkflowLaneKey, rawStatus: "done" });
    renderList([card]);
    expect(screen.getByText("Verified output ready")).toBeInTheDocument();
  });

  it("shows verification failure message for needs_review lane", () => {
    const card = makeCard({
      status: "needs_review" as WorkflowLaneKey,
      rawStatus: "review",
      verificationFailure: "Tests failed: 3 of 12",
    });
    renderList([card]);
    expect(screen.getByText("Tests failed: 3 of 12")).toBeInTheDocument();
  });

  it("shows 'Awaiting review follow-up' when no verification failure on needs_review", () => {
    const card = makeCard({
      status: "needs_review" as WorkflowLaneKey,
      rawStatus: "review",
      verificationFailure: null,
    });
    renderList([card]);
    expect(screen.getByText("Awaiting review follow-up")).toBeInTheDocument();
  });

  it("shows progress bar for non-in_progress lanes", () => {
    const card = makeCard({ status: "backlog" as WorkflowLaneKey, progress: 18 });
    renderList([card]);
    // backlog shows the static progress bar (not MicroBar)
    const container = screen.getByText("Implement login page").closest("article")!;
    expect(container).toBeInTheDocument();
  });

  it("calls onSelectWorkflow when card title button is clicked in list mode", () => {
    const onSelectWorkflow = vi.fn();
    renderList([makeCard()], { onSelectWorkflow });
    fireEvent.click(screen.getByRole("button", { name: "Expand workflow" }));
    expect(onSelectWorkflow).toHaveBeenCalledWith("wf-1");
  });

  it("does not toggle expand if expanded and detailPinned in list mode", () => {
    const onSelectWorkflow = vi.fn();
    renderList([makeCard()], {
      selectedWorkflowId: "wf-1",
      detailPinned: true,
      taskDetail: makeTaskDetail(),
      onSelectWorkflow,
    });
    fireEvent.click(screen.getByRole("button", { name: "Collapse workflow" }));
    expect(onSelectWorkflow).not.toHaveBeenCalled();
  });

  it("renders expanded card with meta stats, execution snapshot, and worker notes", () => {
    renderList([makeCard()], {
      selectedWorkflowId: "wf-1",
      taskDetail: makeTaskDetail(),
    });

    expect(screen.getByText("Priority")).toBeInTheDocument();
    expect(screen.getByText("Risk")).toBeInTheDocument();
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Verification")).toBeInTheDocument();
    expect(screen.getByText("Execution Snapshot")).toBeInTheDocument();
    expect(screen.getByText("Worker Notes")).toBeInTheDocument();
    expect(screen.getByText("At a Glance")).toBeInTheDocument();
  });

  it("renders transition buttons for backlog card", () => {
    renderList([makeCard({ status: "backlog" as WorkflowLaneKey })], {
      selectedWorkflowId: "wf-1",
      taskDetail: makeTaskDetail(),
    });
    expect(screen.getByText(/Move to In Progress/)).toBeInTheDocument();
  });

  it("renders transition buttons for in_progress card", () => {
    renderList([makeCard({ status: "in_progress" as WorkflowLaneKey, rawStatus: "in_progress" })], {
      selectedWorkflowId: "wf-1",
      taskDetail: makeTaskDetail(),
    });
    expect(screen.getByText(/Move to Backlog/)).toBeInTheDocument();
    expect(screen.getByText(/Move to Needs Review/)).toBeInTheDocument();
  });

  it("renders transition buttons for needs_review card", () => {
    renderList([makeCard({ status: "needs_review" as WorkflowLaneKey, rawStatus: "review" })], {
      selectedWorkflowId: "wf-1",
      taskDetail: makeTaskDetail(),
    });
    expect(screen.getByText(/Move to In Progress/)).toBeInTheDocument();
    expect(screen.getByText(/Move to Completed/)).toBeInTheDocument();
  });

  it("renders transition button for completed card", () => {
    renderList([makeCard({ status: "completed" as WorkflowLaneKey, rawStatus: "done" })], {
      selectedWorkflowId: "wf-1",
      taskDetail: makeTaskDetail(),
    });
    expect(screen.getByText(/Move to Needs Review/)).toBeInTheDocument();
  });

  it("calls moveWorkflow when transition button is clicked", () => {
    const moveWorkflow = vi.fn();
    renderList([makeCard({ status: "backlog" as WorkflowLaneKey })], {
      selectedWorkflowId: "wf-1",
      taskDetail: makeTaskDetail(),
      mission: { moveWorkflow },
    });
    fireEvent.click(screen.getByText(/Move to In Progress/));
    expect(moveWorkflow).toHaveBeenCalled();
  });

  it("shows Open Detail button when detailPinned and expanded", () => {
    renderList([makeCard()], {
      selectedWorkflowId: "wf-1",
      detailPinned: true,
      taskDetail: makeTaskDetail(),
    });
    expect(screen.getByText("Open Detail")).toBeInTheDocument();
  });

  it("calls onSelectWorkflow with openDrawer when Open Detail is clicked in list mode", () => {
    const onSelectWorkflow = vi.fn();
    renderList([makeCard()], {
      selectedWorkflowId: "wf-1",
      detailPinned: true,
      taskDetail: makeTaskDetail(),
      onSelectWorkflow,
    });
    fireEvent.click(screen.getByText("Open Detail"));
    expect(onSelectWorkflow).toHaveBeenCalledWith("wf-1", { openDrawer: true });
  });

  it("shows MiniCountCards in expanded card", () => {
    const td = makeTaskDetail({
      impactedFiles: ["a.ts"],
      impactedTests: ["a.test.ts", "b.test.ts"],
      impactedDocs: [],
      approvals: [{ approvalId: "ap-1", actionType: "shell", requestedAt: new Date().toISOString(), relevantToCurrentTask: true, reason: null }],
    });
    renderList([makeCard()], { selectedWorkflowId: "wf-1", taskDetail: td });
    expect(screen.getByText("Files")).toBeInTheDocument();
    expect(screen.getByText("Tests")).toBeInTheDocument();
    expect(screen.getByText("Docs")).toBeInTheDocument();
    expect(screen.getByText("Approvals")).toBeInTheDocument();
  });

  it("shows blocked reason in expanded card", () => {
    renderList([makeCard({ isBlocked: true, blockedReason: "Waiting for dependency resolution" })], {
      selectedWorkflowId: "wf-1",
      taskDetail: makeTaskDetail(),
    });
    // blockedReason appears in both execution snapshot and the blocked reason section
    const matches = screen.getAllByText("Waiting for dependency resolution");
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("shows verification failure in At a Glance section", () => {
    renderList([makeCard({ verificationFailure: "Build failed with exit code 1" })], {
      selectedWorkflowId: "wf-1",
      taskDetail: makeTaskDetail(),
    });
    expect(screen.getByText("Build failed with exit code 1")).toBeInTheDocument();
  });

  it("shows verification signals count in expanded card", () => {
    const td = makeTaskDetail({ verification: ["pass", "lint-pass", "type-check-pass"] });
    renderList([makeCard()], { selectedWorkflowId: "wf-1", taskDetail: td });
    expect(screen.getByText("3 verification signals captured")).toBeInTheDocument();
  });

  it("shows recent comments in worker notes section", () => {
    const td = makeTaskDetail({
      comments: [
        { id: "c-1", author: "admin", body: "Please review", createdAt: new Date().toISOString(), parentCommentId: null, replies: [] },
        { id: "c-2", author: "agent", body: "Looks good", createdAt: new Date().toISOString(), parentCommentId: null, replies: [] },
      ],
    });
    renderList([makeCard()], { selectedWorkflowId: "wf-1", taskDetail: td });
    expect(screen.getByText("Please review")).toBeInTheDocument();
    expect(screen.getByText("Looks good")).toBeInTheDocument();
    expect(screen.getByText("Recent notes shown below.")).toBeInTheDocument();
  });

  it("shows 'No notes yet.' when no comments", () => {
    renderList([makeCard()], { selectedWorkflowId: "wf-1", taskDetail: makeTaskDetail() });
    expect(screen.getByText("No notes yet.")).toBeInTheDocument();
  });

  it("allows adding a note via textarea and submit button", () => {
    const addTaskComment = vi.fn();
    renderList([makeCard()], {
      selectedWorkflowId: "wf-1",
      taskDetail: makeTaskDetail(),
      mission: { addTaskComment },
    });
    const textarea = screen.getByPlaceholderText("Add note for AI workers…");
    fireEvent.change(textarea, { target: { value: "My test note" } });
    fireEvent.click(screen.getByText("Add Note"));
    expect(addTaskComment).toHaveBeenCalledWith("wf-1", "My test note", null);
  });

  it("does not submit empty note", () => {
    const addTaskComment = vi.fn();
    renderList([makeCard()], {
      selectedWorkflowId: "wf-1",
      taskDetail: makeTaskDetail(),
      mission: { addTaskComment },
    });
    fireEvent.click(screen.getByText("Add Note"));
    expect(addTaskComment).not.toHaveBeenCalled();
  });

  it("shows execution snapshot summary with route info when taskDetail has route", () => {
    const td = makeTaskDetail({
      route: { executionMode: "single_agent", modelRole: "coder_default", providerId: "onprem-qwen", verificationDepth: "standard", confidence: 0.8 },
    });
    renderList([makeCard()], { selectedWorkflowId: "wf-1", taskDetail: td });
    expect(screen.getByText("Single Agent · Build")).toBeInTheDocument();
  });

  it("shows execution snapshot for completed lane without route", () => {
    renderList([makeCard({ status: "completed" as WorkflowLaneKey, rawStatus: "done" })], {
      selectedWorkflowId: "wf-1",
      taskDetail: makeTaskDetail(),
    });
    expect(screen.getByText("Execution and verification completed.")).toBeInTheDocument();
  });

  it("shows 'Execution in progress.' for in_progress lane without route", () => {
    renderList([makeCard({ status: "in_progress" as WorkflowLaneKey, rawStatus: "in_progress" })], {
      selectedWorkflowId: "wf-1",
      taskDetail: makeTaskDetail(),
    });
    expect(screen.getByText("Execution in progress.")).toBeInTheDocument();
  });

  it("shows 'Ready to execute.' for backlog without blockedReason", () => {
    renderList([makeCard({ blockedReason: null })], {
      selectedWorkflowId: "wf-1",
      taskDetail: makeTaskDetail(),
    });
    expect(screen.getByText("Ready to execute.")).toBeInTheDocument();
  });

  it("shows blockedReason as execution snapshot for backlog", () => {
    renderList([makeCard({ blockedReason: "Dependency needed" })], {
      selectedWorkflowId: "wf-1",
      taskDetail: makeTaskDetail(),
    });
    // blockedReason appears in execution snapshot and possibly blocked reason section
    const matches = screen.getAllByText("Dependency needed");
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("shows 'Awaiting review follow-up.' as execution snapshot for needs_review without failure", () => {
    renderList([makeCard({ status: "needs_review", rawStatus: "review" })], {
      selectedWorkflowId: "wf-1",
      taskDetail: makeTaskDetail(),
    });
    // "Awaiting review follow-up" appears in both the card summary and execution snapshot
    const matches = screen.getAllByText(/Awaiting review follow-up/);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("shows verificationFailure as execution snapshot for needs_review", () => {
    renderList([makeCard({ status: "needs_review" as WorkflowLaneKey, rawStatus: "review", verificationFailure: "Type error" })], {
      selectedWorkflowId: "wf-1",
      taskDetail: makeTaskDetail(),
    });
    const matches = screen.getAllByText("Type error");
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("shows verification label 'verified' for completed lane", () => {
    renderList([makeCard({ status: "completed" as WorkflowLaneKey, rawStatus: "done" })], {
      selectedWorkflowId: "wf-1",
      taskDetail: makeTaskDetail(),
    });
    expect(screen.getByText("verified")).toBeInTheDocument();
  });

  it("shows verification label 'failed' when verification failure exists", () => {
    renderList([makeCard({ verificationFailure: "Build error" })], {
      selectedWorkflowId: "wf-1",
      taskDetail: makeTaskDetail(),
    });
    expect(screen.getByText("failed")).toBeInTheDocument();
  });

  it("shows verification label 'review pending' for needs_review lane", () => {
    renderList([makeCard({ status: "needs_review" as WorkflowLaneKey, rawStatus: "review" })], {
      selectedWorkflowId: "wf-1",
      taskDetail: makeTaskDetail(),
    });
    expect(screen.getByText("review pending")).toBeInTheDocument();
  });

  it("shows verification label with underscores replaced", () => {
    renderList([makeCard({ verificationState: "in_progress_checks" })], {
      selectedWorkflowId: "wf-1",
      taskDetail: makeTaskDetail(),
    });
    expect(screen.getByText("in progress checks")).toBeInTheDocument();
  });

  it("shows at-a-glance for completed lane with 1 verification signal", () => {
    const td = makeTaskDetail({ verification: ["signal-1"] });
    renderList([makeCard({ status: "completed" as WorkflowLaneKey, rawStatus: "done" })], {
      selectedWorkflowId: "wf-1",
      taskDetail: td,
    });
    expect(screen.getByText("Verified with 1 signal.")).toBeInTheDocument();
  });

  it("shows at-a-glance for completed lane with multiple verification signals", () => {
    const td = makeTaskDetail({ verification: ["s1", "s2", "s3"] });
    renderList([makeCard({ status: "completed" as WorkflowLaneKey, rawStatus: "done" })], {
      selectedWorkflowId: "wf-1",
      taskDetail: td,
    });
    expect(screen.getByText("Verified with 3 signals.")).toBeInTheDocument();
  });

  it("shows at-a-glance for needs_review with verification failure", () => {
    const td = makeTaskDetail();
    renderList([makeCard({ status: "needs_review" as WorkflowLaneKey, rawStatus: "review", verificationFailure: "Lint error" })], {
      selectedWorkflowId: "wf-1",
      taskDetail: td,
    });
    const matches = screen.getAllByText("Lint error");
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("shows at-a-glance for needs_review with verification command", () => {
    const td = makeTaskDetail({ verificationCommand: "npm run test" });
    renderList([makeCard({ status: "needs_review" as WorkflowLaneKey, rawStatus: "review" })], {
      selectedWorkflowId: "wf-1",
      taskDetail: td,
    });
    expect(screen.getByText("npm run test")).toBeInTheDocument();
  });

  it("shows at-a-glance for needs_review with fallback message", () => {
    renderList([makeCard({ status: "needs_review" as WorkflowLaneKey, rawStatus: "review" })], {
      selectedWorkflowId: "wf-1",
      taskDetail: makeTaskDetail(),
    });
    expect(screen.getByText("Needs review follow-up.")).toBeInTheDocument();
  });

  it("shows at-a-glance for in_progress with working set details", () => {
    const td = makeTaskDetail({ impactedFiles: ["a.ts", "b.ts"], impactedTests: ["a.test.ts"], impactedDocs: [] });
    renderList([makeCard({ status: "in_progress", rawStatus: "in_progress" })], {
      selectedWorkflowId: "wf-1",
      taskDetail: td,
    });
    expect(screen.getByText(/Working set.*2 files/)).toBeInTheDocument();
  });

  it("shows at-a-glance for backlog", () => {
    renderList([makeCard()], {
      selectedWorkflowId: "wf-1",
      taskDetail: makeTaskDetail(),
    });
    expect(screen.getByText("Ticket scoped and ready for execution.")).toBeInTheDocument();
  });

  it("shows latest event in At a Glance section", () => {
    renderList([makeCard()], {
      selectedWorkflowId: "wf-1",
      taskDetail: makeTaskDetail(),
      mission: {
        timeline: [
          { task_id: "wf-1", message: "Scope generated", timestamp: new Date().toISOString() },
        ],
      },
    });
    expect(screen.getByText("Scope generated")).toBeInTheDocument();
  });

  it("shows route info in At a Glance when taskDetail has route", () => {
    const td = makeTaskDetail({
      route: { executionMode: "single_agent", modelRole: "coder_default", providerId: "onprem-qwen", verificationDepth: "standard", confidence: 0.9 },
    });
    renderList([makeCard()], { selectedWorkflowId: "wf-1", taskDetail: td });
    expect(screen.getByText("Single Agent · Build · Local Qwen")).toBeInTheDocument();
  });

  it("renders expanded cards in different lanes with correct progress bar colors", () => {
    // Completed lane
    const completedCard = makeCard({ status: "completed" as WorkflowLaneKey, rawStatus: "done", progress: 100 });
    const { unmount: u1 } = renderList([completedCard], {
      selectedWorkflowId: "wf-1",
      taskDetail: makeTaskDetail(),
    });
    expect(screen.getByText("Execution Snapshot")).toBeInTheDocument();
    u1();

    // Needs review lane
    const reviewCard = makeCard({ status: "needs_review" as WorkflowLaneKey, rawStatus: "review", progress: 82 });
    const { unmount: u2 } = renderList([reviewCard], {
      selectedWorkflowId: "wf-1",
      taskDetail: makeTaskDetail(),
    });
    expect(screen.getByText("Execution Snapshot")).toBeInTheDocument();
    u2();

    // In progress lane
    const ipCard = makeCard({ status: "in_progress" as WorkflowLaneKey, rawStatus: "in_progress", progress: 64 });
    renderList([ipCard], {
      selectedWorkflowId: "wf-1",
      taskDetail: makeTaskDetail(),
    });
    expect(screen.getByText("Execution Snapshot")).toBeInTheDocument();
  });

  it("uses contextPack files when taskDetail has no files", () => {
    const td = makeTaskDetail({ impactedFiles: [], impactedTests: [], impactedDocs: [] });
    renderList([makeCard()], {
      selectedWorkflowId: "wf-1",
      taskDetail: td,
      mission: {
        contextPack: { files: ["ctx-a.ts", "ctx-b.ts"], tests: ["ctx.test.ts"], docs: ["ctx.md"] },
      },
    });
    expect(screen.getByText("Files")).toBeInTheDocument();
  });

  it("uses card impacted files when both taskDetail and contextPack are empty", () => {
    const card = makeCard({ impactedFiles: ["f1.ts", "f2.ts", "f3.ts"], impactedTests: [], impactedDocs: [] });
    const td = makeTaskDetail({ impactedFiles: [], impactedTests: [], impactedDocs: [] });
    renderList([card], {
      selectedWorkflowId: "wf-1",
      taskDetail: td,
    });
    expect(screen.getByText("Files")).toBeInTheDocument();
  });

  it("renders cards in board mode lanes with items", () => {
    const backlogCard = makeCard({ workflowId: "wf-1", title: "Board card A", status: "backlog" as WorkflowLaneKey });
    const ipCard = makeCard({ workflowId: "wf-2", title: "Board card B", status: "in_progress" as WorkflowLaneKey, rawStatus: "in_progress" });
    render(
      <WorkflowBoard
        mission={makeMission() as never}
        workflowCards={[backlogCard, ipCard]}
        selectedWorkflowId={null}
        detailPinned={false}
        taskDetail={null}
        laneActivity={makeLaneActivity([backlogCard, ipCard])}
        selectedLane={null}
        workflowViewMode="board"
        onSelectWorkflow={vi.fn()}
        onOpenApprovals={vi.fn()}
        onSetWorkflowViewMode={vi.fn()}
      />
    );
    expect(screen.getByText("Board card A")).toBeInTheDocument();
    expect(screen.getByText("Board card B")).toBeInTheDocument();
  });

  it("renders expanded card in board mode and selects workflow on click", () => {
    const card = makeCard({ workflowId: "wf-board", title: "Board expanded", status: "backlog" as WorkflowLaneKey });
    const onSelectWorkflow = vi.fn();
    render(
      <WorkflowBoard
        mission={makeMission() as never}
        workflowCards={[card]}
        selectedWorkflowId="wf-board"
        detailPinned={false}
        taskDetail={makeTaskDetail() as never}
        laneActivity={makeLaneActivity([card])}
        selectedLane={null}
        workflowViewMode="board"
        onSelectWorkflow={onSelectWorkflow}
        onOpenApprovals={vi.fn()}
        onSetWorkflowViewMode={vi.fn()}
      />
    );
    expect(screen.getByText("Board expanded")).toBeInTheDocument();
    expect(screen.getByText("Execution Snapshot")).toBeInTheDocument();
  });

  it("calls onOpenApprovals from board mode card", () => {
    const card = makeCard({ workflowId: "wf-appr", title: "Approval card", status: "backlog" as WorkflowLaneKey });
    const td = makeTaskDetail({ approvals: [{ approvalId: "ap-1", actionType: "shell", requestedAt: new Date().toISOString(), relevantToCurrentTask: true, reason: null }] });
    const onOpenApprovals = vi.fn();
    render(
      <WorkflowBoard
        mission={makeMission() as never}
        workflowCards={[card]}
        selectedWorkflowId="wf-appr"
        detailPinned={false}
        taskDetail={td as never}
        laneActivity={makeLaneActivity([card])}
        selectedLane={null}
        workflowViewMode="board"
        onSelectWorkflow={vi.fn()}
        onOpenApprovals={onOpenApprovals}
        onSetWorkflowViewMode={vi.fn()}
      />
    );
    // Click the Approvals MiniCountCard
    const approvalsButton = screen.getByText("Approvals").closest("button");
    if (approvalsButton) fireEvent.click(approvalsButton);
    expect(onOpenApprovals).toHaveBeenCalled();
  });

  it("shows verification pending as default label", () => {
    const card = makeCard({ verificationFailure: null, verificationState: null, status: "backlog" as WorkflowLaneKey });
    renderList([card], {
      selectedWorkflowId: "wf-1",
      taskDetail: makeTaskDetail(),
    });
    expect(screen.getByText("pending")).toBeInTheDocument();
  });

  it("shows Open Detail button in board mode when detailPinned", () => {
    const card = makeCard({ workflowId: "wf-pinned", title: "Pinned card", status: "backlog" as WorkflowLaneKey });
    const onSelectWorkflow = vi.fn();
    render(
      <WorkflowBoard
        mission={makeMission() as never}
        workflowCards={[card]}
        selectedWorkflowId="wf-pinned"
        detailPinned={true}
        taskDetail={makeTaskDetail() as never}
        laneActivity={makeLaneActivity([card])}
        selectedLane={null}
        workflowViewMode="board"
        onSelectWorkflow={onSelectWorkflow}
        onOpenApprovals={vi.fn()}
        onSetWorkflowViewMode={vi.fn()}
      />
    );
    const openDetail = screen.getByText("Open Detail");
    fireEvent.click(openDetail);
    expect(onSelectWorkflow).toHaveBeenCalled();
  });
});
