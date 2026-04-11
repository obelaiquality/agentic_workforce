import { useState } from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
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

/*
 * Mock Tabs to bypass Radix Presence animation issues in jsdom.
 * Radix TabsContent uses the Presence component which relies on
 * animation events and layout effects that don't fully work in jsdom,
 * preventing tab content from mounting when switching tabs across
 * separate Tabs instances sharing controlled state.
 */
vi.mock("../ui/tabs", () => {
  const React = require("react");
  const TabsContext = React.createContext<{ value: string; onValueChange?: (v: string) => void }>({ value: "" });

  function MockTabs({ value, onValueChange, children, className, ...rest }: any) {
    return (
      <TabsContext.Provider value={{ value, onValueChange }}>
        <div data-slot="tabs" className={className} {...rest}>{children}</div>
      </TabsContext.Provider>
    );
  }
  function MockTabsList({ children, className, ...rest }: any) {
    return <div data-slot="tabs-list" role="tablist" className={className} {...rest}>{children}</div>;
  }
  function MockTabsTrigger({ value, children, className, ...rest }: any) {
    const ctx = React.useContext(TabsContext);
    return (
      <button
        role="tab"
        aria-selected={ctx.value === value}
        data-state={ctx.value === value ? "active" : "inactive"}
        onClick={() => ctx.onValueChange?.(value)}
        className={className}
        {...rest}
      >
        {children}
      </button>
    );
  }
  function MockTabsContent({ value, children, className, ...rest }: any) {
    const ctx = React.useContext(TabsContext);
    if (ctx.value !== value) return null;
    return <div data-slot="tabs-content" role="tabpanel" className={className} {...rest}>{children}</div>;
  }

  return {
    Tabs: MockTabs,
    TabsList: MockTabsList,
    TabsTrigger: MockTabsTrigger,
    TabsContent: MockTabsContent,
  };
});

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

  it("shows error state when query fails and no snapshot events", async () => {
    apiClientMock.getMissionConsoleV8.mockRejectedValue(new Error("API down"));

    renderView({ snapshotEvents: undefined });

    expect(await screen.findByText("The console could not load project telemetry.")).toBeInTheDocument();
    expect(screen.getByText("API down")).toBeInTheDocument();
    expect(screen.getByText(/Check that the local API is running/i)).toBeInTheDocument();
  });

  it("shows generic error message for non-Error query failures", async () => {
    apiClientMock.getMissionConsoleV8.mockRejectedValue("string error");

    renderView({ snapshotEvents: undefined });

    expect(await screen.findByText("Unknown console error.")).toBeInTheDocument();
  });

  it("renders structured payload with headline and summary keys", async () => {
    const structuredMessage = `Pipeline launched {"execution_mode":"single_agent","provider_id":"onprem-qwen","model_role":"coder_default","run_id":"run-42"}`;
    apiClientMock.getMissionConsoleV8.mockResolvedValue({
      items: [
        {
          id: "evt-struct",
          projectId: "proj-1",
          category: "execution",
          level: "info",
          message: structuredMessage,
          createdAt: new Date().toISOString(),
        },
      ],
    });

    renderView();

    expect(await screen.findByText("Pipeline launched")).toBeInTheDocument();
    // Summary key labels displayed
    expect(screen.getByText("execution mode")).toBeInTheDocument();
    expect(screen.getByText("single_agent")).toBeInTheDocument();
    expect(screen.getByText("provider id")).toBeInTheDocument();
    expect(screen.getByText("onprem-qwen")).toBeInTheDocument();
  });

  it("renders execution profile snapshot with stages", async () => {
    const structuredMessage = `Profile active {"execution_profile_snapshot":{"profileName":"default","stages":[{"stage":"scope","role":"utility_fast","providerId":"onprem-qwen","model":"qwen-0.5b"},{"stage":"build","role":"coder_default","providerId":"onprem-qwen","model":"qwen-4b"}]}}`;
    apiClientMock.getMissionConsoleV8.mockResolvedValue({
      items: [
        {
          id: "evt-profile",
          projectId: "proj-1",
          category: "execution",
          level: "info",
          message: structuredMessage,
          createdAt: new Date().toISOString(),
        },
      ],
    });

    renderView();

    expect(await screen.findByText("Profile active")).toBeInTheDocument();
    expect(screen.getByText("Execution Profile")).toBeInTheDocument();
    expect(screen.getByText("default")).toBeInTheDocument();
    // Stage labels - "Build" appears both as stage label and as modelRoleLabel for coder_default
    expect(screen.getByText("Scope")).toBeInTheDocument();
    const buildElements = screen.getAllByText("Build");
    expect(buildElements.length).toBeGreaterThanOrEqual(1);
  });

  it("toggles detail expansion on structured events", async () => {
    const structuredMessage = `Task finished {"status":"ok","duration_ms":1234}`;
    apiClientMock.getMissionConsoleV8.mockResolvedValue({
      items: [
        {
          id: "evt-detail",
          projectId: "proj-1",
          category: "execution",
          level: "info",
          message: structuredMessage,
          createdAt: new Date().toISOString(),
        },
      ],
    });

    renderView();

    expect(await screen.findByText("Task finished")).toBeInTheDocument();

    const detailsButton = screen.getByRole("button", { name: /Details/i });
    fireEvent.click(detailsButton);

    // After expanding, detail entries should be visible
    expect(screen.getByText("status")).toBeInTheDocument();
    expect(screen.getByText("ok")).toBeInTheDocument();
    expect(screen.getByText("duration ms")).toBeInTheDocument();
    expect(screen.getByText("1234")).toBeInTheDocument();

    // Collapse again
    fireEvent.click(detailsButton);
  });

  it("renders detail entries with array and object values", async () => {
    const structuredMessage = `Analysis {"files":["a.ts","b.ts"],"nested":{"x":1},"simple":"hello"}`;
    apiClientMock.getMissionConsoleV8.mockResolvedValue({
      items: [
        {
          id: "evt-complex",
          projectId: "proj-1",
          category: "execution",
          level: "info",
          message: structuredMessage,
          createdAt: new Date().toISOString(),
        },
      ],
    });

    renderView();

    expect(await screen.findByText("Analysis")).toBeInTheDocument();

    const detailsButton = screen.getByRole("button", { name: /Details/i });
    fireEvent.click(detailsButton);

    // Array values rendered individually
    expect(screen.getByText("a.ts")).toBeInTheDocument();
    expect(screen.getByText("b.ts")).toBeInTheDocument();
    // Simple string value
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("switches scope between workflow and project when workflowId is set", async () => {
    renderView({
      workflowId: "task-1",
      workflowTitle: "My task",
      workflowLogs: [
        {
          id: "wlog-1",
          timestamp: new Date().toISOString(),
          message: "Workflow event",
          level: "info",
        },
      ],
    });

    expect(await screen.findByText("Workflow event")).toBeInTheDocument();

    // Switch to project scope
    const projectButton = screen.getByRole("button", { name: /Project/i });
    fireEvent.click(projectButton);

    // Switch back to workflow scope
    const workflowButton = screen.getByRole("button", { name: /Workflow/i });
    fireEvent.click(workflowButton);
  });

  it("renders audit tab with audit events", async () => {
    renderView();

    await screen.findByText("Run started");

    // Click the Audit tab trigger to switch activeTab state
    const auditTabs = screen.getAllByRole("tab", { name: /Audit/i });
    await act(async () => {
      fireEvent.click(auditTabs[0]);
    });

    // The second Tabs component should now show audit content
    expect(await screen.findByText("policy.decision")).toBeInTheDocument();
    expect(screen.getByText("actor: system")).toBeInTheDocument();
  });

  it("renders audit tab loading state", async () => {
    apiClientMock.listAuditEvents.mockImplementation(() => new Promise(() => {}));

    renderView();

    await screen.findByText("Run started");

    const auditTabs = screen.getAllByRole("tab", { name: /Audit/i });
    await act(async () => {
      fireEvent.click(auditTabs[0]);
    });

    expect(await screen.findByText("Loading audit events\u2026")).toBeInTheDocument();
  });

  it("renders audit tab error state", async () => {
    apiClientMock.listAuditEvents.mockRejectedValue(new Error("Audit API failed"));

    renderView();

    await screen.findByText("Run started");

    const auditTabs = screen.getAllByRole("tab", { name: /Audit/i });
    await act(async () => {
      fireEvent.click(auditTabs[0]);
    });

    expect(await screen.findByText("Failed to load audit events")).toBeInTheDocument();
    expect(screen.getByText("Audit API failed")).toBeInTheDocument();
  });

  it("renders audit tab with non-Error failure message", async () => {
    apiClientMock.listAuditEvents.mockRejectedValue("raw string");

    renderView();

    await screen.findByText("Run started");

    const auditTabs = screen.getAllByRole("tab", { name: /Audit/i });
    await act(async () => {
      fireEvent.click(auditTabs[0]);
    });

    expect(await screen.findByText("Unknown error")).toBeInTheDocument();
  });

  it("renders audit tab empty state", async () => {
    apiClientMock.listAuditEvents.mockResolvedValue({ items: [] });

    renderView();

    await screen.findByText("Run started");

    const auditTabs = screen.getAllByRole("tab", { name: /Audit/i });
    await act(async () => {
      fireEvent.click(auditTabs[0]);
    });

    expect(await screen.findByText("No audit events yet")).toBeInTheDocument();
  });

  it("shows 'Jump to latest' button when followTail is false", async () => {
    apiClientMock.getMissionConsoleV8.mockResolvedValue({
      items: Array.from({ length: 20 }, (_, i) => ({
        id: `evt-${i}`,
        projectId: "proj-1",
        category: "execution",
        level: "info",
        message: `Event ${i}`,
        createdAt: new Date(Date.now() + i * 1000).toISOString(),
      })),
    });

    renderView();

    await screen.findByText("Event 0");

    // Simulate scroll that moves away from bottom
    const stream = screen.getByTestId("console-event-stream");
    Object.defineProperty(stream, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(stream, "scrollTop", { value: 0, configurable: true });
    Object.defineProperty(stream, "clientHeight", { value: 200, configurable: true });
    fireEvent.scroll(stream);

    expect(screen.getByText("Jump to latest")).toBeInTheDocument();

    // Click the jump button
    fireEvent.click(screen.getByText("Jump to latest"));
  });

  it("renders empty event stream messages for workflow and project scopes", async () => {
    apiClientMock.getMissionConsoleV8.mockResolvedValue({ items: [] });

    renderView();

    // Project scope empty
    expect(await screen.findByText("No real events yet for this view")).toBeInTheDocument();
    expect(screen.getByText(/Run a task from Work/)).toBeInTheDocument();
  });

  it("renders workflow scope empty event stream message", async () => {
    apiClientMock.getMissionConsoleV8.mockResolvedValue({ items: [] });

    renderView({
      workflowId: "task-1",
      workflowTitle: null,
      workflowLogs: [],
    });

    expect(await screen.findByText("No real events yet for this view")).toBeInTheDocument();
    expect(screen.getByText(/Open a workflow from Work/)).toBeInTheDocument();
  });

  it("renders workflow telemetry banner without title", async () => {
    renderView({
      workflowId: "task-1",
      workflowTitle: null,
      workflowLogs: [
        {
          id: "log-1",
          timestamp: new Date().toISOString(),
          message: "Step done",
          level: "info",
        },
      ],
    });

    expect(await screen.findByText("Workflow telemetry")).toBeInTheDocument();
  });

  it("shows loading state while fetching events", async () => {
    apiClientMock.getMissionConsoleV8.mockImplementation(() => new Promise(() => {}));

    renderView({ snapshotEvents: undefined });

    // The loading text should appear
    await waitFor(() => {
      expect(screen.getByText("Loading event stream…")).toBeInTheDocument();
    });
  });

  it("renders events with different levels (warn, error)", async () => {
    apiClientMock.getMissionConsoleV8.mockResolvedValue({
      items: [
        {
          id: "evt-warn",
          projectId: "proj-1",
          category: "provider",
          level: "warn",
          message: "Rate limited",
          createdAt: new Date().toISOString(),
        },
        {
          id: "evt-err",
          projectId: "proj-1",
          category: "approval",
          level: "error",
          message: "Policy violation",
          createdAt: new Date().toISOString(),
          taskId: "task-xyz-1234-5678",
        },
      ],
    });

    renderView();

    expect(await screen.findByText("Rate limited")).toBeInTheDocument();
    expect(screen.getByText("Policy violation")).toBeInTheDocument();
    expect(screen.getByText("WARN")).toBeInTheDocument();
    expect(screen.getByText("ERR")).toBeInTheDocument();
    // Task ID display
    expect(screen.getByText("task:task-xyz")).toBeInTheDocument();
    // Category labels
    expect(screen.getByText("Providers")).toBeInTheDocument();
    expect(screen.getByText("Approvals")).toBeInTheDocument();
  });

  it("renders event without taskId showing 'project' label", async () => {
    apiClientMock.getMissionConsoleV8.mockResolvedValue({
      items: [
        {
          id: "evt-no-task",
          projectId: "proj-1",
          category: "indexing",
          level: "info",
          message: "Indexed repo",
          createdAt: new Date().toISOString(),
        },
      ],
    });

    renderView();

    expect(await screen.findByText("Indexed repo")).toBeInTheDocument();
    expect(screen.getByText("project")).toBeInTheDocument();
    expect(screen.getByText("Indexing")).toBeInTheDocument();
  });

  it("renders filter dropdown and selects a specific category", async () => {
    apiClientMock.getMissionConsoleV8.mockResolvedValue({
      items: [
        {
          id: "evt-exec",
          projectId: "proj-1",
          category: "execution",
          level: "info",
          message: "Exec event",
          createdAt: new Date().toISOString(),
        },
        {
          id: "evt-verif",
          projectId: "proj-1",
          category: "verification",
          level: "info",
          message: "Verify event",
          createdAt: new Date().toISOString(),
        },
      ],
    });

    renderView();

    await screen.findByText("Exec event");

    // Open filter dropdown
    const filterButton = screen.getByTestId("console-filter-trigger");
    fireEvent.click(filterButton);

    // Select Verification category
    const verificationOptions = screen.getAllByText("Verification");
    fireEvent.click(verificationOptions[0]);

    // Only verification event should remain visible
    expect(screen.getByText("Verify event")).toBeInTheDocument();
    expect(screen.queryByText("Exec event")).not.toBeInTheDocument();
  });

  it("closes filter dropdown on Escape key", async () => {
    renderView();

    await screen.findByText("Run started");

    const filterButton = screen.getByTestId("console-filter-trigger");
    fireEvent.click(filterButton);

    // Dropdown should be open with "All" visible
    expect(screen.getByText("All")).toBeInTheDocument();

    // Press Escape
    fireEvent.keyDown(window, { key: "Escape" });

    // Dropdown closes - "All" category label in dropdown is gone
    // (The filter button shows "All categories" which is always present)
    await waitFor(() => {
      // The dropdown items should no longer be rendered
      const allButtons = screen.queryAllByRole("button");
      const dropdownAll = allButtons.filter(b => b.textContent?.trim() === "All");
      // When closed, the dropdown items are removed
      expect(dropdownAll.length).toBeLessThanOrEqual(0);
    });
  });

  it("closes filter dropdown on outside click", async () => {
    renderView();

    await screen.findByText("Run started");

    const filterButton = screen.getByTestId("console-filter-trigger");
    fireEvent.click(filterButton);

    // Dropdown should be open
    expect(screen.getByText("All")).toBeInTheDocument();

    // Click outside (on the root element)
    fireEvent.mouseDown(document.body);

    await waitFor(() => {
      const allButtons = screen.queryAllByRole("button");
      const dropdownAll = allButtons.filter(b => b.textContent?.trim() === "All");
      expect(dropdownAll.length).toBeLessThanOrEqual(0);
    });
  });

  it("shows filter count when a non-all category is active", async () => {
    apiClientMock.getMissionConsoleV8.mockResolvedValue({
      items: [
        {
          id: "evt-e1",
          projectId: "proj-1",
          category: "execution",
          level: "info",
          message: "E1",
          createdAt: new Date().toISOString(),
        },
        {
          id: "evt-e2",
          projectId: "proj-1",
          category: "execution",
          level: "info",
          message: "E2",
          createdAt: new Date().toISOString(),
        },
      ],
    });

    renderView();

    await screen.findByText("E1");

    // Select Execution filter
    const filterButton = screen.getByTestId("console-filter-trigger");
    fireEvent.click(filterButton);

    const executionOptions = screen.getAllByText("Execution");
    fireEvent.click(executionOptions[0]);

    // Filter button should now show count
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("renders structured event with install deps button for infra_missing_tool", async () => {
    const structuredMessage = `Tool error {"run_id":"run-1","ticket_id":"ticket-1","error_class":"infra_missing_tool","stage":"build"}`;
    apiClientMock.getMissionConsoleV8.mockResolvedValue({
      items: [
        {
          id: "evt-deps",
          projectId: "proj-1",
          category: "execution",
          level: "error",
          message: structuredMessage,
          createdAt: new Date().toISOString(),
        },
      ],
    });

    apiClientMock.requestDependencyBootstrapV9.mockResolvedValue({
      item: { event: { policyDecision: "allowed" } },
    });

    renderView();

    expect(await screen.findByText("Tool error")).toBeInTheDocument();

    // Expand details
    const detailsButton = screen.getByRole("button", { name: /Details/i });
    fireEvent.click(detailsButton);

    // Should show install deps button
    const installButton = screen.getByRole("button", { name: /Install deps/i });
    expect(installButton).toBeInTheDocument();

    // Should show verification scope button
    expect(screen.getByRole("button", { name: /Verification scope/i })).toBeInTheDocument();

    // Click install deps - "allowed" decision triggers the else branch
    fireEvent.click(installButton);

    await waitFor(() => {
      expect(screen.getByText("Dependency bootstrap command queued.")).toBeInTheDocument();
    });
  });

  it("shows approval_required action message from dependency bootstrap", async () => {
    const structuredMessage = `Tool error {"run_id":"run-1","ticket_id":"ticket-1","error_class":"infra_missing_dependency"}`;
    apiClientMock.getMissionConsoleV8.mockResolvedValue({
      items: [
        {
          id: "evt-deps2",
          projectId: "proj-1",
          category: "execution",
          level: "error",
          message: structuredMessage,
          createdAt: new Date().toISOString(),
        },
      ],
    });

    apiClientMock.requestDependencyBootstrapV9.mockResolvedValue({
      item: { event: { policyDecision: "approval_required" } },
    });

    renderView();

    expect(await screen.findByText("Tool error")).toBeInTheDocument();

    const detailsButton = screen.getByRole("button", { name: /Details/i });
    fireEvent.click(detailsButton);

    fireEvent.click(screen.getByRole("button", { name: /Install deps/i }));

    await waitFor(() => {
      expect(screen.getByText("Dependency bootstrap requires approval before it can run.")).toBeInTheDocument();
    });
  });

  it("shows denied action message from dependency bootstrap", async () => {
    const structuredMessage = `Tool error {"run_id":"run-1","ticket_id":"ticket-1","error_class":"infra_missing_tool"}`;
    apiClientMock.getMissionConsoleV8.mockResolvedValue({
      items: [
        {
          id: "evt-denied",
          projectId: "proj-1",
          category: "execution",
          level: "error",
          message: structuredMessage,
          createdAt: new Date().toISOString(),
        },
      ],
    });

    apiClientMock.requestDependencyBootstrapV9.mockResolvedValue({
      item: { event: { policyDecision: "denied" } },
    });

    renderView();

    expect(await screen.findByText("Tool error")).toBeInTheDocument();

    const detailsButton = screen.getByRole("button", { name: /Details/i });
    fireEvent.click(detailsButton);

    fireEvent.click(screen.getByRole("button", { name: /Install deps/i }));

    await waitFor(() => {
      expect(screen.getByText("Dependency bootstrap was denied by ticket policy.")).toBeInTheDocument();
    });
  });

  it("shows error action message when dependency bootstrap fails", async () => {
    const structuredMessage = `Tool error {"run_id":"run-1","ticket_id":"ticket-1","error_class":"infra_missing_tool"}`;
    apiClientMock.getMissionConsoleV8.mockResolvedValue({
      items: [
        {
          id: "evt-fail",
          projectId: "proj-1",
          category: "execution",
          level: "error",
          message: structuredMessage,
          createdAt: new Date().toISOString(),
        },
      ],
    });

    apiClientMock.requestDependencyBootstrapV9.mockRejectedValue(new Error("Network error"));

    renderView();

    expect(await screen.findByText("Tool error")).toBeInTheDocument();

    const detailsButton = screen.getByRole("button", { name: /Details/i });
    fireEvent.click(detailsButton);

    fireEvent.click(screen.getByRole("button", { name: /Install deps/i }));

    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeInTheDocument();
    });
  });

  it("shows generic error for non-Error dependency bootstrap failure", async () => {
    const structuredMessage = `Tool error {"run_id":"run-1","ticket_id":"ticket-1","error_class":"infra_missing_tool"}`;
    apiClientMock.getMissionConsoleV8.mockResolvedValue({
      items: [
        {
          id: "evt-fail2",
          projectId: "proj-1",
          category: "execution",
          level: "error",
          message: structuredMessage,
          createdAt: new Date().toISOString(),
        },
      ],
    });

    apiClientMock.requestDependencyBootstrapV9.mockRejectedValue("raw failure");

    renderView();

    expect(await screen.findByText("Tool error")).toBeInTheDocument();

    const detailsButton = screen.getByRole("button", { name: /Details/i });
    fireEvent.click(detailsButton);

    fireEvent.click(screen.getByRole("button", { name: /Install deps/i }));

    await waitFor(() => {
      expect(screen.getByText("Failed to queue dependency bootstrap.")).toBeInTheDocument();
    });
  });

  it("renders view approvals button for approval_required policy decision", async () => {
    const structuredMessage = `Policy check {"run_id":"run-1","ticket_id":"ticket-1","policy_decision":"approval_required"}`;
    apiClientMock.getMissionConsoleV8.mockResolvedValue({
      items: [
        {
          id: "evt-approval",
          projectId: "proj-1",
          category: "approval",
          level: "warn",
          message: structuredMessage,
          createdAt: new Date().toISOString(),
        },
      ],
    });

    renderView();

    expect(await screen.findByText("Policy check")).toBeInTheDocument();

    const detailsButton = screen.getByRole("button", { name: /Details/i });
    fireEvent.click(detailsButton);

    const approvalButton = screen.getByRole("button", { name: /View approvals/i });
    expect(approvalButton).toBeInTheDocument();

    // Click it - should switch filter to approval
    fireEvent.click(approvalButton);
  });

  it("renders verification scope button and switches filter", async () => {
    const structuredMessage = `Tool error {"run_id":"run-1","ticket_id":"ticket-1","error_class":"infra_missing_tool"}`;
    apiClientMock.getMissionConsoleV8.mockResolvedValue({
      items: [
        {
          id: "evt-vs",
          projectId: "proj-1",
          category: "execution",
          level: "error",
          message: structuredMessage,
          createdAt: new Date().toISOString(),
        },
      ],
    });

    renderView();

    expect(await screen.findByText("Tool error")).toBeInTheDocument();

    const detailsButton = screen.getByRole("button", { name: /Details/i });
    fireEvent.click(detailsButton);

    const verifyButton = screen.getByRole("button", { name: /Verification scope/i });
    fireEvent.click(verifyButton);
  });

  it("renders non-structured plain text events", async () => {
    apiClientMock.getMissionConsoleV8.mockResolvedValue({
      items: [
        {
          id: "evt-plain",
          projectId: "proj-1",
          category: "execution",
          level: "info",
          message: "Just a plain message without JSON",
          createdAt: new Date().toISOString(),
        },
      ],
    });

    renderView();

    expect(await screen.findByText("Just a plain message without JSON")).toBeInTheDocument();
  });

  it("handles structured message with invalid JSON gracefully", async () => {
    apiClientMock.getMissionConsoleV8.mockResolvedValue({
      items: [
        {
          id: "evt-badjson",
          projectId: "proj-1",
          category: "execution",
          level: "info",
          message: "Some headline {invalid json}",
          createdAt: new Date().toISOString(),
        },
      ],
    });

    renderView();

    // Falls back to plain text rendering
    expect(await screen.findByText("Some headline {invalid json}")).toBeInTheDocument();
  });

  it("handles structured message with JSON array (not object) gracefully", async () => {
    apiClientMock.getMissionConsoleV8.mockResolvedValue({
      items: [
        {
          id: "evt-arr",
          projectId: "proj-1",
          category: "execution",
          level: "info",
          message: 'Array data [1,2,3]',
          createdAt: new Date().toISOString(),
        },
      ],
    });

    renderView();

    expect(await screen.findByText("Array data [1,2,3]")).toBeInTheDocument();
  });

  it("uses snapshotEvents when provided", async () => {
    renderView({
      snapshotEvents: [
        {
          id: "snap-1",
          projectId: "proj-1",
          category: "execution",
          level: "info",
          message: "Snapshot event",
          createdAt: new Date().toISOString(),
        },
      ],
    });

    expect(await screen.findByText("Snapshot event")).toBeInTheDocument();
  });

  it("converts workflowLogs with approval source to approval category", async () => {
    renderView({
      workflowId: "task-1",
      workflowTitle: "Test",
      workflowLogs: [
        {
          id: "wlog-appr",
          timestamp: new Date().toISOString(),
          message: "Approval required",
          level: "warn",
          source: "approval",
        },
      ],
    });

    expect(await screen.findByText("Approval required")).toBeInTheDocument();
  });

  it("converts workflowLogs with verify source to verification category", async () => {
    renderView({
      workflowId: "task-1",
      workflowTitle: "Test",
      workflowLogs: [
        {
          id: "wlog-verify",
          timestamp: new Date().toISOString(),
          message: "Verification check",
          level: "info",
          source: "verify-step",
        },
      ],
    });

    expect(await screen.findByText("Verification check")).toBeInTheDocument();
  });

  it("handles dependency bootstrap with missing context", async () => {
    const structuredMessage = `Tool error {"error_class":"infra_missing_tool","run_id":"run-1"}`;
    apiClientMock.getMissionConsoleV8.mockResolvedValue({
      items: [
        {
          id: "evt-no-ctx",
          projectId: "proj-1",
          category: "execution",
          level: "error",
          message: structuredMessage,
          createdAt: new Date().toISOString(),
        },
      ],
    });

    renderView();

    expect(await screen.findByText("Tool error")).toBeInTheDocument();

    // No install deps button since ticket_id is missing (no hasToolContext)
    const detailsButton = screen.getByRole("button", { name: /Details/i });
    fireEvent.click(detailsButton);

    expect(screen.queryByRole("button", { name: /Install deps/i })).not.toBeInTheDocument();
  });

  it("handles dependency bootstrap with default stage when stage is not a known value", async () => {
    const structuredMessage = `Tool error {"run_id":"run-1","ticket_id":"ticket-1","error_class":"infra_missing_tool","stage":"unknown_stage"}`;
    apiClientMock.getMissionConsoleV8.mockResolvedValue({
      items: [
        {
          id: "evt-defstage",
          projectId: "proj-1",
          category: "execution",
          level: "error",
          message: structuredMessage,
          createdAt: new Date().toISOString(),
        },
      ],
    });

    apiClientMock.requestDependencyBootstrapV9.mockResolvedValue({
      item: { event: { policyDecision: "allowed" } },
    });

    renderView();

    expect(await screen.findByText("Tool error")).toBeInTheDocument();

    const detailsButton = screen.getByRole("button", { name: /Details/i });
    fireEvent.click(detailsButton);

    fireEvent.click(screen.getByRole("button", { name: /Install deps/i }));

    // "allowed" decision triggers the queued message
    await waitFor(() => {
      expect(screen.getByText("Dependency bootstrap command queued.")).toBeInTheDocument();
    });
  });

  it("renders summary with number value formatting", async () => {
    const structuredMessage = `Metrics update {"max_lanes":4,"verification_depth":2.567}`;
    apiClientMock.getMissionConsoleV8.mockResolvedValue({
      items: [
        {
          id: "evt-num",
          projectId: "proj-1",
          category: "execution",
          level: "info",
          message: structuredMessage,
          createdAt: new Date().toISOString(),
        },
      ],
    });

    renderView();

    expect(await screen.findByText("Metrics update")).toBeInTheDocument();
    // Integer formatting
    expect(screen.getByText("4")).toBeInTheDocument();
    // Float formatting to 2 decimal places
    expect(screen.getByText("2.57")).toBeInTheDocument();
  });

  it("handles execution profile snapshot with invalid stage items", async () => {
    const structuredMessage = `Profile data {"execution_profile_snapshot":{"profileName":"test","stages":[null,"not an object",{"stage":"scope"}]}}`;
    apiClientMock.getMissionConsoleV8.mockResolvedValue({
      items: [
        {
          id: "evt-badstages",
          projectId: "proj-1",
          category: "execution",
          level: "info",
          message: structuredMessage,
          createdAt: new Date().toISOString(),
        },
      ],
    });

    renderView();

    expect(await screen.findByText("Profile data")).toBeInTheDocument();
    // No profile section should render since all stages are invalid
    expect(screen.queryByText("Execution Profile")).not.toBeInTheDocument();
  });

  it("handles execution profile snapshot with missing profileName", async () => {
    const structuredMessage = `Profile data {"execution_profile_snapshot":{"stages":[]}}`;
    apiClientMock.getMissionConsoleV8.mockResolvedValue({
      items: [
        {
          id: "evt-noprofile",
          projectId: "proj-1",
          category: "execution",
          level: "info",
          message: structuredMessage,
          createdAt: new Date().toISOString(),
        },
      ],
    });

    renderView();

    expect(await screen.findByText("Profile data")).toBeInTheDocument();
    expect(screen.queryByText("Execution Profile")).not.toBeInTheDocument();
  });

  it("handles execution profile snapshot that is an array (not object)", async () => {
    const structuredMessage = `Profile data {"execution_profile_snapshot":[1,2,3]}`;
    apiClientMock.getMissionConsoleV8.mockResolvedValue({
      items: [
        {
          id: "evt-arrprofile",
          projectId: "proj-1",
          category: "execution",
          level: "info",
          message: structuredMessage,
          createdAt: new Date().toISOString(),
        },
      ],
    });

    renderView();

    expect(await screen.findByText("Profile data")).toBeInTheDocument();
    expect(screen.queryByText("Execution Profile")).not.toBeInTheDocument();
  });

  it("renders all event categories with their category styles", async () => {
    const categories = ["execution", "verification", "provider", "approval", "indexing", "automation"] as const;
    apiClientMock.getMissionConsoleV8.mockResolvedValue({
      items: categories.map((cat, i) => ({
        id: `evt-cat-${i}`,
        projectId: "proj-1",
        category: cat,
        level: "info" as const,
        message: `${cat} message`,
        createdAt: new Date(Date.now() + i * 1000).toISOString(),
      })),
    });

    renderView();

    for (const cat of categories) {
      expect(await screen.findByText(`${cat} message`)).toBeInTheDocument();
    }
  });

  it("renders structured payload with null/undefined and object summary values", async () => {
    const structuredMessage = `Summary test {"execution_profile_name":null,"execution_mode":"parallel","provider_id":"","aggregate_type":{"nested":"val"},"repo_id":"repo-1"}`;
    apiClientMock.getMissionConsoleV8.mockResolvedValue({
      items: [
        {
          id: "evt-sum",
          projectId: "proj-1",
          category: "execution",
          level: "info",
          message: structuredMessage,
          createdAt: new Date().toISOString(),
        },
      ],
    });

    renderView();

    expect(await screen.findByText("Summary test")).toBeInTheDocument();
    // execution_mode should show
    expect(screen.getByText("parallel")).toBeInTheDocument();
    // aggregate_type is object, formatPayloadValue shows "1 fields"
    expect(screen.getByText("1 fields")).toBeInTheDocument();
  });

  it("renders structured payload summary with array value", async () => {
    const structuredMessage = `Array test {"execution_mode":["a","b","c"]}`;
    apiClientMock.getMissionConsoleV8.mockResolvedValue({
      items: [
        {
          id: "evt-arrval",
          projectId: "proj-1",
          category: "execution",
          level: "info",
          message: structuredMessage,
          createdAt: new Date().toISOString(),
        },
      ],
    });

    renderView();

    expect(await screen.findByText("Array test")).toBeInTheDocument();
    expect(screen.getByText("3 items")).toBeInTheDocument();
  });

  it("renders detail entries with null values as dash", async () => {
    const structuredMessage = `Null test {"some_field":null}`;
    apiClientMock.getMissionConsoleV8.mockResolvedValue({
      items: [
        {
          id: "evt-null",
          projectId: "proj-1",
          category: "execution",
          level: "info",
          message: structuredMessage,
          createdAt: new Date().toISOString(),
        },
      ],
    });

    renderView();

    expect(await screen.findByText("Null test")).toBeInTheDocument();

    const detailsButton = screen.getByRole("button", { name: /Details/i });
    fireEvent.click(detailsButton);

    // Null renders as "—" from String(null ?? "—") which is "—"
    // Actually String(null ?? "—") = "—" since null ?? "—" = "—"
    const dashElements = screen.getAllByText("\u2014");
    expect(dashElements.length).toBeGreaterThan(0);
  });

  it("renders detail entries with non-string array items as JSON", async () => {
    const structuredMessage = `Mixed array {"items":[{"a":1},42,"str"]}`;
    apiClientMock.getMissionConsoleV8.mockResolvedValue({
      items: [
        {
          id: "evt-mixed",
          projectId: "proj-1",
          category: "execution",
          level: "info",
          message: structuredMessage,
          createdAt: new Date().toISOString(),
        },
      ],
    });

    renderView();

    expect(await screen.findByText("Mixed array")).toBeInTheDocument();

    const detailsButton = screen.getByRole("button", { name: /Details/i });
    fireEvent.click(detailsButton);

    expect(screen.getByText('{"a":1}')).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("str")).toBeInTheDocument();
  });

  it("renders execution stage labels including escalate and default", async () => {
    const structuredMessage = `Stages {"execution_profile_snapshot":{"profileName":"multi","stages":[{"stage":"scope","role":"utility_fast","providerId":"onprem-qwen","model":"q1"},{"stage":"review","role":"review_deep","providerId":"onprem-qwen","model":"q2"},{"stage":"escalate","role":"overseer_escalation","providerId":"openai-responses","model":"gpt4"},{"stage":"custom_stage","role":"coder_default","providerId":"qwen-cli","model":"q3"}]}}`;
    apiClientMock.getMissionConsoleV8.mockResolvedValue({
      items: [
        {
          id: "evt-stages",
          projectId: "proj-1",
          category: "execution",
          level: "info",
          message: structuredMessage,
          createdAt: new Date().toISOString(),
        },
      ],
    });

    renderView();

    expect(await screen.findByText("Stages")).toBeInTheDocument();
    expect(screen.getByText("Scope")).toBeInTheDocument();
    // "Review" appears both as executionStageLabel and as modelRoleLabel for review_deep
    const reviewElements = screen.getAllByText("Review");
    expect(reviewElements.length).toBeGreaterThanOrEqual(1);
    // "Escalate" appears both as executionStageLabel and as modelRoleLabel for overseer_escalation
    const escalateElements = screen.getAllByText("Escalate");
    expect(escalateElements.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("custom_stage")).toBeInTheDocument();
  });
});
