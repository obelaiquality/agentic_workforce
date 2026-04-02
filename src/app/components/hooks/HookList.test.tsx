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
});
