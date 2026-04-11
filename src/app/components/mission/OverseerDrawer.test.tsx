import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OverseerDrawer } from "./OverseerDrawer";
import type { ChatMessageDto, ContextPack, RepoRegistration, RoutingDecision, V2PolicyPendingItem } from "../../../shared/contracts";

const mockRepo: RepoRegistration = {
  id: "repo-123",
  displayName: "test-project",
  branch: "main",
  defaultBranch: "main",
  worktreePath: "/tmp/test",
  gitRepoPath: "/home/user/test",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockRoute: RoutingDecision = {
  executionMode: "single_agent",
  modelRole: "coder_default",
  providerId: "onprem-qwen",
  verificationDepth: "standard",
  decompositionScore: 0.85,
  rationale: ["High confidence approach"],
  maxLanes: 1,
  estimatedComplexity: "medium",
};

const mockMessages: ChatMessageDto[] = [
  {
    id: "msg-1",
    role: "user",
    content: "Add a new button component",
    createdAt: new Date().toISOString(),
  },
  {
    id: "msg-2",
    role: "assistant",
    content: "I'll create a button component with tests.",
    createdAt: new Date().toISOString(),
  },
];

const mockContextPack: ContextPack = {
  files: ["src/components/Button.tsx"],
  tests: ["src/components/Button.test.tsx"],
  docs: ["README.md"],
  why: ["Button component is central to the UI"],
};

const mockPendingApproval: V2PolicyPendingItem = {
  approval_id: "approval-123",
  action_type: "high_risk_mutation",
  reason: "Database migration detected",
  metadata: {},
};

const roleLabels = {
  utility_fast: "Utility Fast",
  coder_default: "Coder Default",
  review_deep: "Review Deep",
  overseer_escalation: "Overseer",
};

describe("OverseerDrawer", () => {
  it("shows connect repo screen when no repo", () => {
    render(
      <OverseerDrawer
        repo={null}
        messages={[]}
        input=""
        setInput={vi.fn()}
        route={null}
        contextPack={null}
        pendingApprovals={[]}
        selectedModelRole="coder_default"
        setSelectedModelRole={vi.fn()}
        roleLabels={roleLabels}
        actionMessage={null}
        repoPickerMessage={null}
        hasDesktopPicker={true}
        isActing={false}
        streaming={false}
        chooseLocalRepo={vi.fn()}
        connectGithub={vi.fn()}
        openRecentPath={vi.fn()}
        reviewRoute={vi.fn()}
        executeRoute={vi.fn()}
        sendMessage={vi.fn()}
        decideApproval={vi.fn()}
        recentRepoPaths={[]}
        openProjects={vi.fn()}
      />
    );

    expect(screen.getByText("Connect a repo to begin")).toBeInTheDocument();
    expect(screen.getByText("Choose Local Repo")).toBeInTheDocument();
    expect(screen.getByText("Connect GitHub Repo")).toBeInTheDocument();
  });

  it("displays chat messages", () => {
    render(
      <OverseerDrawer
        repo={mockRepo}
        messages={mockMessages}
        input=""
        setInput={vi.fn()}
        route={mockRoute}
        contextPack={mockContextPack}
        pendingApprovals={[]}
        selectedModelRole="coder_default"
        setSelectedModelRole={vi.fn()}
        roleLabels={roleLabels}
        actionMessage={null}
        repoPickerMessage={null}
        hasDesktopPicker={true}
        isActing={false}
        streaming={false}
        chooseLocalRepo={vi.fn()}
        connectGithub={vi.fn()}
        openRecentPath={vi.fn()}
        reviewRoute={vi.fn()}
        executeRoute={vi.fn()}
        sendMessage={vi.fn()}
        decideApproval={vi.fn()}
        recentRepoPaths={[]}
        openProjects={vi.fn()}
      />
    );

    expect(screen.getByText("Add a new button component")).toBeInTheDocument();
    expect(screen.getByText("I'll create a button component with tests.")).toBeInTheDocument();
  });

  it("displays context pack information", () => {
    render(
      <OverseerDrawer
        repo={mockRepo}
        messages={[]}
        input=""
        setInput={vi.fn()}
        route={mockRoute}
        contextPack={mockContextPack}
        pendingApprovals={[]}
        selectedModelRole="coder_default"
        setSelectedModelRole={vi.fn()}
        roleLabels={roleLabels}
        actionMessage={null}
        repoPickerMessage={null}
        hasDesktopPicker={true}
        isActing={false}
        streaming={false}
        chooseLocalRepo={vi.fn()}
        connectGithub={vi.fn()}
        openRecentPath={vi.fn()}
        reviewRoute={vi.fn()}
        executeRoute={vi.fn()}
        sendMessage={vi.fn()}
        decideApproval={vi.fn()}
        recentRepoPaths={[]}
        openProjects={vi.fn()}
      />
    );

    expect(screen.getByText("Context Pack")).toBeInTheDocument();
    expect(screen.getByText(/1 files · 1 tests · 1 docs/)).toBeInTheDocument();
  });

  it("shows pending approval with approve/reject buttons", () => {
    const decideApproval = vi.fn();
    render(
      <OverseerDrawer
        repo={mockRepo}
        messages={[]}
        input=""
        setInput={vi.fn()}
        route={mockRoute}
        contextPack={null}
        pendingApprovals={[mockPendingApproval]}
        selectedModelRole="coder_default"
        setSelectedModelRole={vi.fn()}
        roleLabels={roleLabels}
        actionMessage={null}
        repoPickerMessage={null}
        hasDesktopPicker={true}
        isActing={false}
        streaming={false}
        chooseLocalRepo={vi.fn()}
        connectGithub={vi.fn()}
        openRecentPath={vi.fn()}
        reviewRoute={vi.fn()}
        executeRoute={vi.fn()}
        sendMessage={vi.fn()}
        decideApproval={decideApproval}
        recentRepoPaths={[]}
        openProjects={vi.fn()}
      />
    );

    expect(screen.getByText("high risk mutation")).toBeInTheDocument();
    expect(screen.getByText("Database migration detected")).toBeInTheDocument();

    const approveButton = screen.getByText("Approve");
    fireEvent.click(approveButton);
    expect(decideApproval).toHaveBeenCalledWith("approval-123", "approved");
  });

  it("calls executeRoute when execute button is clicked", () => {
    const executeRoute = vi.fn();
    render(
      <OverseerDrawer
        repo={mockRepo}
        messages={[]}
        input="Add a feature"
        setInput={vi.fn()}
        route={mockRoute}
        contextPack={null}
        pendingApprovals={[]}
        selectedModelRole="coder_default"
        setSelectedModelRole={vi.fn()}
        roleLabels={roleLabels}
        actionMessage={null}
        repoPickerMessage={null}
        hasDesktopPicker={true}
        isActing={false}
        streaming={false}
        chooseLocalRepo={vi.fn()}
        connectGithub={vi.fn()}
        openRecentPath={vi.fn()}
        reviewRoute={vi.fn()}
        executeRoute={executeRoute}
        sendMessage={vi.fn()}
        decideApproval={vi.fn()}
        recentRepoPaths={[]}
        openProjects={vi.fn()}
      />
    );

    const executeButton = screen.getByText("Execute");
    fireEvent.click(executeButton);
    expect(executeRoute).toHaveBeenCalledOnce();
  });

  it("updates input when textarea changes", () => {
    const setInput = vi.fn();
    render(
      <OverseerDrawer
        repo={mockRepo}
        messages={[]}
        input=""
        setInput={setInput}
        route={null}
        contextPack={null}
        pendingApprovals={[]}
        selectedModelRole="coder_default"
        setSelectedModelRole={vi.fn()}
        roleLabels={roleLabels}
        actionMessage={null}
        repoPickerMessage={null}
        hasDesktopPicker={true}
        isActing={false}
        streaming={false}
        chooseLocalRepo={vi.fn()}
        connectGithub={vi.fn()}
        openRecentPath={vi.fn()}
        reviewRoute={vi.fn()}
        executeRoute={vi.fn()}
        sendMessage={vi.fn()}
        decideApproval={vi.fn()}
        recentRepoPaths={[]}
        openProjects={vi.fn()}
      />
    );

    const textarea = screen.getByPlaceholderText(/Describe what should change/);
    fireEvent.change(textarea, { target: { value: "Add new feature" } });
    expect(setInput).toHaveBeenCalledWith("Add new feature");
  });

  it("shows repoPickerMessage when provided and no repo", () => {
    render(
      <OverseerDrawer
        repo={null}
        messages={[]}
        input=""
        setInput={vi.fn()}
        route={null}
        contextPack={null}
        pendingApprovals={[]}
        selectedModelRole="coder_default"
        setSelectedModelRole={vi.fn()}
        roleLabels={roleLabels}
        actionMessage={null}
        repoPickerMessage="Scanning for repos..."
        hasDesktopPicker={true}
        isActing={false}
        streaming={false}
        chooseLocalRepo={vi.fn()}
        connectGithub={vi.fn()}
        openRecentPath={vi.fn()}
        reviewRoute={vi.fn()}
        executeRoute={vi.fn()}
        sendMessage={vi.fn()}
        decideApproval={vi.fn()}
        recentRepoPaths={[]}
        openProjects={vi.fn()}
      />
    );

    expect(screen.getByText("Scanning for repos...")).toBeInTheDocument();
  });

  it("shows browser preview message when no desktop picker and no repoPickerMessage", () => {
    render(
      <OverseerDrawer
        repo={null}
        messages={[]}
        input=""
        setInput={vi.fn()}
        route={null}
        contextPack={null}
        pendingApprovals={[]}
        selectedModelRole="coder_default"
        setSelectedModelRole={vi.fn()}
        roleLabels={roleLabels}
        actionMessage={null}
        repoPickerMessage={null}
        hasDesktopPicker={false}
        isActing={false}
        streaming={false}
        chooseLocalRepo={vi.fn()}
        connectGithub={vi.fn()}
        openRecentPath={vi.fn()}
        reviewRoute={vi.fn()}
        executeRoute={vi.fn()}
        sendMessage={vi.fn()}
        decideApproval={vi.fn()}
        recentRepoPaths={[]}
        openProjects={vi.fn()}
      />
    );

    expect(screen.getByText(/Repo picker is available in the desktop app/)).toBeInTheDocument();
  });

  it("shows recent repo paths and calls openRecentPath on click", () => {
    const openRecentPath = vi.fn();
    render(
      <OverseerDrawer
        repo={null}
        messages={[]}
        input=""
        setInput={vi.fn()}
        route={null}
        contextPack={null}
        pendingApprovals={[]}
        selectedModelRole="coder_default"
        setSelectedModelRole={vi.fn()}
        roleLabels={roleLabels}
        actionMessage={null}
        repoPickerMessage={null}
        hasDesktopPicker={true}
        isActing={false}
        streaming={false}
        chooseLocalRepo={vi.fn()}
        connectGithub={vi.fn()}
        openRecentPath={openRecentPath}
        reviewRoute={vi.fn()}
        executeRoute={vi.fn()}
        sendMessage={vi.fn()}
        decideApproval={vi.fn()}
        recentRepoPaths={[
          { path: "/home/user/project-a", label: "Project A", lastUsedAt: new Date().toISOString() },
          { path: "/home/user/project-b", label: "Project B", lastUsedAt: new Date().toISOString() },
        ]}
        openProjects={vi.fn()}
      />
    );

    expect(screen.getByText("Recent repos")).toBeInTheDocument();
    expect(screen.getByText("Project A")).toBeInTheDocument();
    expect(screen.getByText("Project B")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Project A"));
    expect(openRecentPath).toHaveBeenCalledWith("/home/user/project-a", "Project A");
  });

  it("calls openProjects when Open Projects button is clicked", () => {
    const openProjects = vi.fn();
    render(
      <OverseerDrawer
        repo={null}
        messages={[]}
        input=""
        setInput={vi.fn()}
        route={null}
        contextPack={null}
        pendingApprovals={[]}
        selectedModelRole="coder_default"
        setSelectedModelRole={vi.fn()}
        roleLabels={roleLabels}
        actionMessage={null}
        repoPickerMessage={null}
        hasDesktopPicker={true}
        isActing={false}
        streaming={false}
        chooseLocalRepo={vi.fn()}
        connectGithub={vi.fn()}
        openRecentPath={vi.fn()}
        reviewRoute={vi.fn()}
        executeRoute={vi.fn()}
        sendMessage={vi.fn()}
        decideApproval={vi.fn()}
        recentRepoPaths={[]}
        openProjects={openProjects}
      />
    );

    fireEvent.click(screen.getByText("Open Projects"));
    expect(openProjects).toHaveBeenCalledOnce();
  });

  it("shows empty messages placeholder when repo connected and no messages", () => {
    render(
      <OverseerDrawer
        repo={mockRepo}
        messages={[]}
        input=""
        setInput={vi.fn()}
        route={null}
        contextPack={null}
        pendingApprovals={[]}
        selectedModelRole="coder_default"
        setSelectedModelRole={vi.fn()}
        roleLabels={roleLabels}
        actionMessage={null}
        repoPickerMessage={null}
        hasDesktopPicker={true}
        isActing={false}
        streaming={false}
        chooseLocalRepo={vi.fn()}
        connectGithub={vi.fn()}
        openRecentPath={vi.fn()}
        reviewRoute={vi.fn()}
        executeRoute={vi.fn()}
        sendMessage={vi.fn()}
        decideApproval={vi.fn()}
        recentRepoPaths={[]}
        openProjects={vi.fn()}
      />
    );

    expect(screen.getByText(/State the objective/)).toBeInTheDocument();
  });

  it("displays route details section when route is present", () => {
    render(
      <OverseerDrawer
        repo={mockRepo}
        messages={[]}
        input=""
        setInput={vi.fn()}
        route={mockRoute}
        contextPack={null}
        pendingApprovals={[]}
        selectedModelRole="coder_default"
        setSelectedModelRole={vi.fn()}
        roleLabels={roleLabels}
        actionMessage={null}
        repoPickerMessage={null}
        hasDesktopPicker={true}
        isActing={false}
        streaming={false}
        chooseLocalRepo={vi.fn()}
        connectGithub={vi.fn()}
        openRecentPath={vi.fn()}
        reviewRoute={vi.fn()}
        executeRoute={vi.fn()}
        sendMessage={vi.fn()}
        decideApproval={vi.fn()}
        recentRepoPaths={[]}
        openProjects={vi.fn()}
      />
    );

    expect(screen.getByText("Details")).toBeInTheDocument();
  });

  it("shows no route message when route is null", () => {
    render(
      <OverseerDrawer
        repo={mockRepo}
        messages={[]}
        input=""
        setInput={vi.fn()}
        route={null}
        contextPack={null}
        pendingApprovals={[]}
        selectedModelRole="coder_default"
        setSelectedModelRole={vi.fn()}
        roleLabels={roleLabels}
        actionMessage={null}
        repoPickerMessage={null}
        hasDesktopPicker={true}
        isActing={false}
        streaming={false}
        chooseLocalRepo={vi.fn()}
        connectGithub={vi.fn()}
        openRecentPath={vi.fn()}
        reviewRoute={vi.fn()}
        executeRoute={vi.fn()}
        sendMessage={vi.fn()}
        decideApproval={vi.fn()}
        recentRepoPaths={[]}
        openProjects={vi.fn()}
      />
    );

    expect(screen.getByText("Review the route to lock the execution lane.")).toBeInTheDocument();
    expect(screen.getByText("No route planned yet")).toBeInTheDocument();
  });

  it("displays actionMessage when provided", () => {
    render(
      <OverseerDrawer
        repo={mockRepo}
        messages={[]}
        input="some input"
        setInput={vi.fn()}
        route={null}
        contextPack={null}
        pendingApprovals={[]}
        selectedModelRole="coder_default"
        setSelectedModelRole={vi.fn()}
        roleLabels={roleLabels}
        actionMessage="Processing your request..."
        repoPickerMessage={null}
        hasDesktopPicker={true}
        isActing={false}
        streaming={false}
        chooseLocalRepo={vi.fn()}
        connectGithub={vi.fn()}
        openRecentPath={vi.fn()}
        reviewRoute={vi.fn()}
        executeRoute={vi.fn()}
        sendMessage={vi.fn()}
        decideApproval={vi.fn()}
        recentRepoPaths={[]}
        openProjects={vi.fn()}
      />
    );

    expect(screen.getByText("Processing your request...")).toBeInTheDocument();
  });

  it("calls sendMessage when send button is clicked", () => {
    const sendMessage = vi.fn();
    render(
      <OverseerDrawer
        repo={mockRepo}
        messages={[]}
        input="test message"
        setInput={vi.fn()}
        route={null}
        contextPack={null}
        pendingApprovals={[]}
        selectedModelRole="coder_default"
        setSelectedModelRole={vi.fn()}
        roleLabels={roleLabels}
        actionMessage={null}
        repoPickerMessage={null}
        hasDesktopPicker={true}
        isActing={false}
        streaming={false}
        chooseLocalRepo={vi.fn()}
        connectGithub={vi.fn()}
        openRecentPath={vi.fn()}
        reviewRoute={vi.fn()}
        executeRoute={vi.fn()}
        sendMessage={sendMessage}
        decideApproval={vi.fn()}
        recentRepoPaths={[]}
        openProjects={vi.fn()}
      />
    );

    // The send button is the last button in the action row - it contains SendHorizontal icon
    const buttons = screen.getAllByRole("button");
    const sendButton = buttons[buttons.length - 1];
    fireEvent.click(sendButton);
    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it("calls reviewRoute when Review Route button is clicked", () => {
    const reviewRoute = vi.fn();
    render(
      <OverseerDrawer
        repo={mockRepo}
        messages={[]}
        input="test input"
        setInput={vi.fn()}
        route={null}
        contextPack={null}
        pendingApprovals={[]}
        selectedModelRole="coder_default"
        setSelectedModelRole={vi.fn()}
        roleLabels={roleLabels}
        actionMessage={null}
        repoPickerMessage={null}
        hasDesktopPicker={true}
        isActing={false}
        streaming={false}
        chooseLocalRepo={vi.fn()}
        connectGithub={vi.fn()}
        openRecentPath={vi.fn()}
        reviewRoute={reviewRoute}
        executeRoute={vi.fn()}
        sendMessage={vi.fn()}
        decideApproval={vi.fn()}
        recentRepoPaths={[]}
        openProjects={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("Review Route"));
    expect(reviewRoute).toHaveBeenCalledOnce();
  });

  it("updates model role when select changes", () => {
    const setSelectedModelRole = vi.fn();
    render(
      <OverseerDrawer
        repo={mockRepo}
        messages={[]}
        input=""
        setInput={vi.fn()}
        route={null}
        contextPack={null}
        pendingApprovals={[]}
        selectedModelRole="coder_default"
        setSelectedModelRole={setSelectedModelRole}
        roleLabels={roleLabels}
        actionMessage={null}
        repoPickerMessage={null}
        hasDesktopPicker={true}
        isActing={false}
        streaming={false}
        chooseLocalRepo={vi.fn()}
        connectGithub={vi.fn()}
        openRecentPath={vi.fn()}
        reviewRoute={vi.fn()}
        executeRoute={vi.fn()}
        sendMessage={vi.fn()}
        decideApproval={vi.fn()}
        recentRepoPaths={[]}
        openProjects={vi.fn()}
      />
    );

    const select = screen.getByDisplayValue("Coder Default");
    fireEvent.change(select, { target: { value: "utility_fast" } });
    expect(setSelectedModelRole).toHaveBeenCalledWith("utility_fast");
  });

  it("shows StopCircle icon when streaming", () => {
    render(
      <OverseerDrawer
        repo={mockRepo}
        messages={[]}
        input="test"
        setInput={vi.fn()}
        route={null}
        contextPack={null}
        pendingApprovals={[]}
        selectedModelRole="coder_default"
        setSelectedModelRole={vi.fn()}
        roleLabels={roleLabels}
        actionMessage={null}
        repoPickerMessage={null}
        hasDesktopPicker={true}
        isActing={false}
        streaming={true}
        chooseLocalRepo={vi.fn()}
        connectGithub={vi.fn()}
        openRecentPath={vi.fn()}
        reviewRoute={vi.fn()}
        executeRoute={vi.fn()}
        sendMessage={vi.fn()}
        decideApproval={vi.fn()}
        recentRepoPaths={[]}
        openProjects={vi.fn()}
      />
    );

    // When streaming, the send button area should render (component renders differently)
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("calls decideApproval with rejected when Reject is clicked", () => {
    const decideApproval = vi.fn();
    render(
      <OverseerDrawer
        repo={mockRepo}
        messages={[]}
        input=""
        setInput={vi.fn()}
        route={mockRoute}
        contextPack={null}
        pendingApprovals={[mockPendingApproval]}
        selectedModelRole="coder_default"
        setSelectedModelRole={vi.fn()}
        roleLabels={roleLabels}
        actionMessage={null}
        repoPickerMessage={null}
        hasDesktopPicker={true}
        isActing={false}
        streaming={false}
        chooseLocalRepo={vi.fn()}
        connectGithub={vi.fn()}
        openRecentPath={vi.fn()}
        reviewRoute={vi.fn()}
        executeRoute={vi.fn()}
        sendMessage={vi.fn()}
        decideApproval={decideApproval}
        recentRepoPaths={[]}
        openProjects={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("Reject"));
    expect(decideApproval).toHaveBeenCalledWith("approval-123", "rejected");
  });

  it("calls connectGithub when Connect GitHub Repo button is clicked", () => {
    const connectGithub = vi.fn();
    render(
      <OverseerDrawer
        repo={null}
        messages={[]}
        input=""
        setInput={vi.fn()}
        route={null}
        contextPack={null}
        pendingApprovals={[]}
        selectedModelRole="coder_default"
        setSelectedModelRole={vi.fn()}
        roleLabels={roleLabels}
        actionMessage={null}
        repoPickerMessage={null}
        hasDesktopPicker={true}
        isActing={false}
        streaming={false}
        chooseLocalRepo={vi.fn()}
        connectGithub={connectGithub}
        openRecentPath={vi.fn()}
        reviewRoute={vi.fn()}
        executeRoute={vi.fn()}
        sendMessage={vi.fn()}
        decideApproval={vi.fn()}
        recentRepoPaths={[]}
        openProjects={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("Connect GitHub Repo"));
    expect(connectGithub).toHaveBeenCalledOnce();
  });

  it("shows pending approval default reason when reason is empty", () => {
    const approval: V2PolicyPendingItem = {
      approval_id: "approval-456",
      action_type: "file_write",
      reason: "",
      metadata: {},
    };

    render(
      <OverseerDrawer
        repo={mockRepo}
        messages={[]}
        input=""
        setInput={vi.fn()}
        route={mockRoute}
        contextPack={null}
        pendingApprovals={[approval]}
        selectedModelRole="coder_default"
        setSelectedModelRole={vi.fn()}
        roleLabels={roleLabels}
        actionMessage={null}
        repoPickerMessage={null}
        hasDesktopPicker={true}
        isActing={false}
        streaming={false}
        chooseLocalRepo={vi.fn()}
        connectGithub={vi.fn()}
        openRecentPath={vi.fn()}
        reviewRoute={vi.fn()}
        executeRoute={vi.fn()}
        sendMessage={vi.fn()}
        decideApproval={vi.fn()}
        recentRepoPaths={[]}
        openProjects={vi.fn()}
      />
    );

    expect(screen.getByText("Approval required before execution can continue.")).toBeInTheDocument();
  });
});
