import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HookList } from "./HookList";

const apiClientMock = vi.hoisted(() => ({
  listHooks: vi.fn(),
  listHookExecutions: vi.fn(),
  createHook: vi.fn(),
  updateHook: vi.fn(),
  deleteHook: vi.fn(),
  testHook: vi.fn(),
}));

vi.mock("../../lib/apiClient", () => apiClientMock);

function renderView() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <HookList />
    </QueryClientProvider>,
  );
}

describe("HookList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiClientMock.listHooks.mockResolvedValue({
      items: [
        {
          id: "hook-1",
          name: "Tool guard",
          description: "Review edits",
          enabled: true,
          eventType: "PreToolUse",
          hookType: "Prompt",
          command: null,
          promptTemplate: "Inspect {{tool_name}}",
          agentObjective: null,
          allowedTools: ["edit_file"],
          canOverride: false,
          continueOnError: true,
          timeoutMs: 30000,
          projectId: "proj-1",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });
    apiClientMock.listHookExecutions.mockResolvedValue({
      items: [
        {
          id: "log-1",
          hookId: "hook-1",
          hookName: "Tool guard",
          runId: "run-1",
          eventType: "PreToolUse",
          success: true,
          output: "Inspect edit_file",
          error: null,
          durationMs: 10,
          createdAt: new Date().toISOString(),
        },
      ],
    });
    apiClientMock.createHook.mockResolvedValue({ item: { id: "hook-2" } });
    apiClientMock.updateHook.mockResolvedValue({ item: { id: "hook-1", enabled: false } });
    apiClientMock.deleteHook.mockResolvedValue({ ok: true });
    apiClientMock.testHook.mockResolvedValue({
      output: {
        success: true,
        continue: true,
        systemMessage: "Hook executed successfully",
        durationMs: 2,
      },
    });
  });

  it("renders hooks and execution logs", async () => {
    renderView();

    expect(await screen.findAllByText("Tool guard")).toHaveLength(2);
    expect(screen.getByText("Execution Log")).toBeInTheDocument();
    expect(screen.getByText("Inspect edit_file")).toBeInTheDocument();
  });

  it("creates a prompt hook from the editor", async () => {
    renderView();
    await screen.findByText("Hook Editor");

    fireEvent.change(screen.getByLabelText("Hook name"), { target: { value: "Approval gate" } });
    fireEvent.change(screen.getByLabelText("Hook description"), { target: { value: "Require extra review" } });
    fireEvent.change(screen.getByLabelText("Hook event"), { target: { value: "PermissionRequest" } });
    fireEvent.change(screen.getByLabelText("Hook type"), { target: { value: "Prompt" } });
    fireEvent.change(screen.getByLabelText("Hook prompt template"), { target: { value: "Review {{tool_name}}" } });
    fireEvent.change(screen.getByLabelText("Hook allowed tools"), { target: { value: "bash, edit_file" } });
    fireEvent.change(screen.getByLabelText("Hook timeout"), { target: { value: "45000" } });

    fireEvent.click(screen.getByRole("button", { name: "Create hook" }));

    await waitFor(() => {
      expect(apiClientMock.createHook).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Approval gate",
          description: "Require extra review",
          eventType: "PermissionRequest",
          hookType: "Prompt",
          promptTemplate: "Review {{tool_name}}",
          allowedTools: ["bash", "edit_file"],
          timeoutMs: 45000,
        }),
      );
    });
  });

  it("tests, toggles, edits, and deletes an existing hook", async () => {
    renderView();
    expect(await screen.findAllByText("Tool guard")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Test hook Tool guard" }));
    await waitFor(() => {
      expect(apiClientMock.testHook).toHaveBeenCalledWith(
        "hook-1",
        expect.objectContaining({
          tool_name: "bash",
        }),
      );
    });
    expect(await screen.findByText("Hook executed successfully")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Disable hook Tool guard" }));
    await waitFor(() => {
      expect(apiClientMock.updateHook).toHaveBeenCalledWith("hook-1", { enabled: false });
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit hook Tool guard" }));
    fireEvent.change(screen.getByLabelText("Hook description"), { target: { value: "Review edits carefully" } });
    fireEvent.click(screen.getByRole("button", { name: "Save hook" }));

    await waitFor(() => {
      expect(apiClientMock.updateHook).toHaveBeenCalledWith(
        "hook-1",
        expect.objectContaining({
          description: "Review edits carefully",
        }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete hook Tool guard" }));
    await waitFor(() => {
      expect(apiClientMock.deleteHook).toHaveBeenCalledWith("hook-1");
    });
  });

  it("shows loading state while hooks are loading", () => {
    apiClientMock.listHooks.mockReturnValue(new Promise(() => {}));
    apiClientMock.listHookExecutions.mockReturnValue(new Promise(() => {}));

    renderView();

    expect(screen.getByText("Loading hooks...")).toBeInTheDocument();
  });

  it("shows empty hooks placeholder when no hooks exist", async () => {
    apiClientMock.listHooks.mockResolvedValue({ items: [] });
    apiClientMock.listHookExecutions.mockResolvedValue({ items: [] });

    renderView();

    await waitFor(() => {
      expect(screen.getByText(/No hooks configured/)).toBeInTheDocument();
    });
  });

  it("shows empty execution log message when no logs exist", async () => {
    apiClientMock.listHookExecutions.mockResolvedValue({ items: [] });

    renderView();

    await waitFor(() => {
      expect(screen.getByText("No hook executions recorded yet.")).toBeInTheDocument();
    });
  });

  it("shows Command input field when hook type is Command", async () => {
    renderView();
    await screen.findByText("Hook Editor");

    fireEvent.change(screen.getByLabelText("Hook type"), { target: { value: "Command" } });

    expect(screen.getByLabelText("Hook command")).toBeInTheDocument();
  });

  it("shows Agent objective field when hook type is Agent", async () => {
    renderView();
    await screen.findByText("Hook Editor");

    fireEvent.change(screen.getByLabelText("Hook type"), { target: { value: "Agent" } });

    expect(screen.getByLabelText("Hook agent objective")).toBeInTheDocument();
  });

  it("creates a command hook with command field", async () => {
    renderView();
    await screen.findByText("Hook Editor");

    fireEvent.change(screen.getByLabelText("Hook name"), { target: { value: "My Command Hook" } });
    fireEvent.change(screen.getByLabelText("Hook type"), { target: { value: "Command" } });
    fireEvent.change(screen.getByLabelText("Hook command"), { target: { value: "echo test" } });

    fireEvent.click(screen.getByRole("button", { name: "Create hook" }));

    await waitFor(() => {
      expect(apiClientMock.createHook).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "My Command Hook",
          hookType: "Command",
          command: "echo test",
        }),
      );
    });
  });

  it("creates an agent hook with agent objective field", async () => {
    renderView();
    await screen.findByText("Hook Editor");

    fireEvent.change(screen.getByLabelText("Hook name"), { target: { value: "My Agent Hook" } });
    fireEvent.change(screen.getByLabelText("Hook type"), { target: { value: "Agent" } });
    fireEvent.change(screen.getByLabelText("Hook agent objective"), { target: { value: "Review all code" } });

    fireEvent.click(screen.getByRole("button", { name: "Create hook" }));

    await waitFor(() => {
      expect(apiClientMock.createHook).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "My Agent Hook",
          hookType: "Agent",
          agentObjective: "Review all code",
        }),
      );
    });
  });

  it("toggles enabled, canOverride, and continueOnError checkboxes", async () => {
    renderView();
    await screen.findByText("Hook Editor");

    const enabledCheckbox = screen.getByLabelText("Enabled");
    const canOverrideCheckbox = screen.getByLabelText("Can override");
    const continueOnErrorCheckbox = screen.getByLabelText("Continue on error");

    // Enabled defaults to true, uncheck it
    expect(enabledCheckbox).toBeChecked();
    fireEvent.click(enabledCheckbox);
    expect(enabledCheckbox).not.toBeChecked();

    // canOverride defaults to false, check it
    expect(canOverrideCheckbox).not.toBeChecked();
    fireEvent.click(canOverrideCheckbox);
    expect(canOverrideCheckbox).toBeChecked();

    // continueOnError defaults to true, uncheck it
    expect(continueOnErrorCheckbox).toBeChecked();
    fireEvent.click(continueOnErrorCheckbox);
    expect(continueOnErrorCheckbox).not.toBeChecked();
  });

  it("shows Cancel button when editing and resets form on click", async () => {
    renderView();
    await screen.findAllByText("Tool guard");

    // Enter edit mode
    fireEvent.click(screen.getByRole("button", { name: "Edit hook Tool guard" }));
    expect(screen.getByRole("button", { name: "Save hook" })).toBeInTheDocument();

    // Cancel button should be visible
    const cancelButton = screen.getByText("Cancel");
    expect(cancelButton).toBeInTheDocument();

    fireEvent.click(cancelButton);

    // Should switch back to "Create hook" mode
    expect(screen.getByRole("button", { name: "Create hook" })).toBeInTheDocument();
  });

  it("resets form when New hook button is clicked", async () => {
    renderView();
    await screen.findAllByText("Tool guard");

    // Enter edit mode first
    fireEvent.click(screen.getByRole("button", { name: "Edit hook Tool guard" }));
    expect(screen.getByRole("button", { name: "Save hook" })).toBeInTheDocument();

    // Click New hook
    fireEvent.click(screen.getByText("New hook"));

    // Should switch back to create mode
    expect(screen.getByRole("button", { name: "Create hook" })).toBeInTheDocument();
    // Name field should be empty
    expect((screen.getByLabelText("Hook name") as HTMLInputElement).value).toBe("");
  });

  it("renders hook without description", async () => {
    apiClientMock.listHooks.mockResolvedValue({
      items: [
        {
          id: "hook-no-desc",
          name: "No Desc Hook",
          description: "",
          enabled: false,
          eventType: "PostToolUse",
          hookType: "Command",
          command: "echo hello",
          promptTemplate: null,
          agentObjective: null,
          allowedTools: [],
          canOverride: true,
          continueOnError: false,
          timeoutMs: 5000,
          projectId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });

    renderView();

    await waitFor(() => {
      expect(screen.getByText("No Desc Hook")).toBeInTheDocument();
      // PostToolUse appears both in the hook chip and the event dropdown, so use getAllByText
      expect(screen.getAllByText("PostToolUse").length).toBeGreaterThanOrEqual(1);
      // Command appears both in the hook chip and the hook type dropdown, so use getAllByText
      expect(screen.getAllByText("Command").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("handles test hook with error result", async () => {
    apiClientMock.testHook.mockResolvedValue({
      output: {
        success: false,
        continue: false,
        error: "Hook timed out",
        durationMs: 30000,
      },
    });

    renderView();
    await screen.findAllByText("Tool guard");

    fireEvent.click(screen.getByRole("button", { name: "Test hook Tool guard" }));

    await waitFor(() => {
      expect(screen.getByText("Error: Hook timed out")).toBeInTheDocument();
    });
  });

  it("shows project scope input and updates it", async () => {
    renderView();
    await screen.findByText("Hook Editor");

    const projectInput = screen.getByLabelText("Hook project scope");
    fireEvent.change(projectInput, { target: { value: "proj-xyz" } });
    expect((projectInput as HTMLInputElement).value).toBe("proj-xyz");
  });

  it("enables the Enable hook button for disabled hook", async () => {
    apiClientMock.listHooks.mockResolvedValue({
      items: [
        {
          id: "hook-disabled",
          name: "Disabled Hook",
          description: "This is disabled",
          enabled: false,
          eventType: "PreToolUse",
          hookType: "Prompt",
          command: null,
          promptTemplate: "test",
          agentObjective: null,
          allowedTools: [],
          canOverride: false,
          continueOnError: true,
          timeoutMs: 30000,
          projectId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });

    renderView();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Enable hook Disabled Hook" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Enable hook Disabled Hook" }));

    await waitFor(() => {
      expect(apiClientMock.updateHook).toHaveBeenCalledWith("hook-disabled", { enabled: true });
    });
  });

  it("renders execution log with error message", async () => {
    apiClientMock.listHookExecutions.mockResolvedValue({
      items: [
        {
          id: "log-err",
          hookId: "hook-1",
          hookName: "Error Hook",
          runId: "run-1",
          eventType: "PreToolUse",
          success: false,
          output: null,
          error: "Timeout after 30s",
          durationMs: 30000,
          createdAt: new Date().toISOString(),
        },
      ],
    });

    renderView();

    await waitFor(() => {
      expect(screen.getByText("Timeout after 30s")).toBeInTheDocument();
    });
  });

  it("renders execution log with no output or error", async () => {
    apiClientMock.listHookExecutions.mockResolvedValue({
      items: [
        {
          id: "log-empty",
          hookId: "hook-1",
          hookName: "Silent Hook",
          runId: "run-1",
          eventType: "PostCompact",
          success: true,
          output: null,
          error: null,
          durationMs: 1,
          createdAt: new Date().toISOString(),
        },
      ],
    });

    renderView();

    await waitFor(() => {
      expect(screen.getByText("No message recorded.")).toBeInTheDocument();
    });
  });
});
