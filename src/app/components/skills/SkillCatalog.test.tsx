import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SkillCatalog } from "./SkillCatalog";

const apiClientMock = vi.hoisted(() => ({
  listSkills: vi.fn(),
  listSkillInvocations: vi.fn(),
  createSkill: vi.fn(),
  updateSkill: vi.fn(),
  deleteSkill: vi.fn(),
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
      <SkillCatalog />
    </QueryClientProvider>,
  );
}

describe("SkillCatalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiClientMock.listSkills.mockResolvedValue({
      items: [
        {
          id: "builtin_commit",
          name: "commit",
          description: "Commit staged changes",
          version: "1.0.0",
          contextMode: "inline",
          allowedTools: ["git_status"],
          maxIterations: null,
          systemPrompt: "Commit safely",
          referenceFiles: [],
          author: "system",
          tags: ["git"],
          builtIn: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: "custom_release",
          name: "release",
          description: "Prepare a release",
          version: "1.0.0",
          contextMode: "fork",
          allowedTools: ["bash"],
          maxIterations: 3,
          systemPrompt: "Release prompt",
          referenceFiles: [],
          author: "user",
          tags: ["ops"],
          builtIn: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });
    apiClientMock.listSkillInvocations.mockResolvedValue({
      items: [
        {
          id: "inv-1",
          skillId: "custom_release",
          skillName: "release",
          runId: "run-1",
          projectId: "proj-1",
          ticketId: "ticket-1",
          args: "ship staging",
          status: "completed",
          output: "done",
          childRunId: null,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        },
      ],
    });
    apiClientMock.createSkill.mockResolvedValue({ item: { id: "custom_new" } });
    apiClientMock.updateSkill.mockResolvedValue({ item: { id: "custom_release" } });
    apiClientMock.deleteSkill.mockResolvedValue({ ok: true });
  });

  it("renders built-in, custom, and recent invocation sections", async () => {
    renderView();

    expect(await screen.findByText("Built-in Skills")).toBeInTheDocument();
    expect(screen.getByText("commit")).toBeInTheDocument();
    expect(await screen.findAllByText("release")).toHaveLength(2);
    expect(screen.getByText("Recent Invocations")).toBeInTheDocument();
    expect(screen.getByText("done")).toBeInTheDocument();
  });

  it("creates a custom skill from the editor form", async () => {
    renderView();
    await screen.findByText("Skill Editor");

    fireEvent.change(screen.getByLabelText("Skill name"), { target: { value: "verify-release" } });
    fireEvent.change(screen.getByLabelText("Skill description"), { target: { value: "Verify the release branch" } });
    fireEvent.change(screen.getByLabelText("Skill allowed tools"), { target: { value: "bash, git_status" } });
    fireEvent.change(screen.getByLabelText("Skill max iterations"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Skill tags"), { target: { value: "release, verification" } });
    fireEvent.change(screen.getByLabelText("Skill system prompt"), { target: { value: "Run release verification and summarize risk." } });

    fireEvent.click(screen.getByRole("button", { name: "Create skill" }));

    await waitFor(() => {
      expect(apiClientMock.createSkill).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "verify-release",
          description: "Verify the release branch",
          allowedTools: ["bash", "git_status"],
          maxIterations: 4,
          tags: ["release", "verification"],
          systemPrompt: "Run release verification and summarize risk.",
        }),
      );
    });
  });

  it("edits and deletes a custom skill", async () => {
    renderView();
    expect(await screen.findAllByText("release")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: /Edit/i }));
    fireEvent.change(screen.getByLabelText("Skill description"), { target: { value: "Prepare and verify a release" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(apiClientMock.updateSkill).toHaveBeenCalledWith(
        "custom_release",
        expect.objectContaining({
          description: "Prepare and verify a release",
        }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: /Remove/i }));
    await waitFor(() => {
      expect(apiClientMock.deleteSkill).toHaveBeenCalledWith("custom_release");
    });
  });
});
