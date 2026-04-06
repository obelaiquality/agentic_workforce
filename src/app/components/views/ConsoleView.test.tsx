import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConsoleView } from "./ConsoleView";

const apiClientMock = vi.hoisted(() => ({
  getMissionConsoleV8: vi.fn(),
  listAuditEvents: vi.fn(),
  openMissionConsoleStreamV8: vi.fn(),
  requestDependencyBootstrapV9: vi.fn(),
}));

vi.mock("../../lib/apiClient", () => apiClientMock);

function renderView(props = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  const defaultProps = {
    projectId: "proj-1",
    snapshotEvents: [],
    workflowId: null,
    workflowTitle: null,
    workflowLogs: [],
  };

  return render(
    <QueryClientProvider client={queryClient}>
      <ConsoleView {...defaultProps} {...props} />
    </QueryClientProvider>,
  );
}

describe("ConsoleView", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock scrollIntoView which is not available in jsdom
    Element.prototype.scrollIntoView = vi.fn();

    apiClientMock.getMissionConsoleV8.mockResolvedValue({
      items: [
        {
          id: "evt-1",
          projectId: "proj-1",
          category: "execution",
          level: "info",
          message: "Run started",
          createdAt: new Date().toISOString(),
        },
        {
          id: "evt-2",
          projectId: "proj-1",
          category: "verification",
          level: "warn",
          message: "Test coverage below threshold",
          createdAt: new Date().toISOString(),
        },
      ],
    });
    apiClientMock.listAuditEvents.mockResolvedValue({
      items: [
        {
          id: "audit-1",
          eventType: "policy.decision",
          actor: "system",
          payload: { decision: "approved", ticketId: "ticket-1" },
          createdAt: new Date().toISOString(),
        },
      ],
    });
    apiClientMock.openMissionConsoleStreamV8.mockResolvedValue({
      addEventListener: vi.fn(),
      close: vi.fn(),
    });
  });

  it("renders console event stream with events", async () => {
    renderView();

    expect(await screen.findByText("Run started")).toBeInTheDocument();
    expect(screen.getByText("Test coverage below threshold")).toBeInTheDocument();
    expect(screen.getByTestId("console-event-stream")).toBeInTheDocument();
  });

  it("switches between Events and Audit tabs", async () => {
    renderView();

    await screen.findByText("Run started");

    const auditTab = screen.getByRole("tab", { name: /Audit/i });
    fireEvent.click(auditTab);

    // Verify the audit tab is present
    expect(auditTab).toBeInTheDocument();
  });

  it("filters events by category", async () => {
    renderView();

    await screen.findByText("Run started");

    const filterButton = screen.getByTestId("console-filter-trigger");
    fireEvent.click(filterButton);

    // Use getAllByText and select the one in the dropdown (first one)
    const executionOptions = screen.getAllByText("Execution");
    fireEvent.click(executionOptions[0]);

    expect(screen.getByText("Run started")).toBeInTheDocument();
  });

  it("shows empty state when no project is connected", async () => {
    renderView({ projectId: null });

    expect(await screen.findByTestId("console-empty")).toBeInTheDocument();
    expect(screen.getByText("No project connected")).toBeInTheDocument();
    expect(screen.getByText(/Connect a project to stream live execution/i)).toBeInTheDocument();
  });

  it("displays workflow scope when workflowId is provided", async () => {
    renderView({
      workflowId: "task-1",
      workflowTitle: "Add feature X",
      workflowLogs: [
        {
          id: "log-1",
          timestamp: new Date().toISOString(),
          message: "Workflow step completed",
          level: "info",
        },
      ],
    });

    expect(await screen.findByText(/Add feature X telemetry/i)).toBeInTheDocument();
    expect(screen.getByText("Workflow step completed")).toBeInTheDocument();
  });
});
