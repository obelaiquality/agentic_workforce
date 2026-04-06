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
});
