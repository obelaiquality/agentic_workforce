import { create } from "zustand";
import { persist } from "zustand/middleware";

type Section = "live" | "codebase" | "console" | "projects" | "settings" | "overseer" | "runs" | "benchmarks";
type WorkflowStatusFilter = "all" | "backlog" | "in_progress" | "needs_review" | "completed";
type CommandDrawerMode = "overseer" | "task" | "approval" | "run";
type WorkflowViewMode = "board" | "list";

interface UiStore {
  activeSection: Section;
  selectedSessionId: string | null;
  selectedTicketId: string | null;
  selectedWorkflowId: string | null;
  selectedWorkflowStatus: WorkflowStatusFilter;
  workflowViewMode: WorkflowViewMode;
  commandDrawerMode: CommandDrawerMode;
  selectedRepoId: string | null;
  selectedRunId: string | null;
  selectedBenchmarkRunId: string | null;
  labsMode: boolean;
  setActiveSection: (section: UiStore["activeSection"]) => void;
  setSelectedSessionId: (sessionId: string | null) => void;
  setSelectedTicketId: (ticketId: string | null) => void;
  setSelectedWorkflowId: (workflowId: string | null) => void;
  setSelectedWorkflowStatus: (status: WorkflowStatusFilter) => void;
  setWorkflowViewMode: (mode: WorkflowViewMode) => void;
  setCommandDrawerMode: (mode: CommandDrawerMode) => void;
  setSelectedRepoId: (repoId: string | null) => void;
  setSelectedRunId: (runId: string | null) => void;
  setSelectedBenchmarkRunId: (runId: string | null) => void;
  setLabsMode: (labsMode: boolean) => void;
}

export const useUiStore = create<UiStore>()(
  persist(
    (set) => ({
      activeSection: "live",
      selectedSessionId: null,
      selectedTicketId: null,
      selectedWorkflowId: null,
      selectedWorkflowStatus: "all",
      workflowViewMode: "board",
      commandDrawerMode: "overseer",
      selectedRepoId: null,
      selectedRunId: null,
      selectedBenchmarkRunId: null,
      labsMode: false,
      setActiveSection: (activeSection) => set({ activeSection }),
      setSelectedSessionId: (selectedSessionId) => set({ selectedSessionId }),
      setSelectedTicketId: (selectedTicketId) => set({ selectedTicketId }),
      setSelectedWorkflowId: (selectedWorkflowId) => set({ selectedWorkflowId }),
      setSelectedWorkflowStatus: (selectedWorkflowStatus) => set({ selectedWorkflowStatus }),
      setWorkflowViewMode: (workflowViewMode) => set({ workflowViewMode }),
      setCommandDrawerMode: (commandDrawerMode) => set({ commandDrawerMode }),
      setSelectedRepoId: (selectedRepoId) => set({ selectedRepoId }),
      setSelectedRunId: (selectedRunId) => set({ selectedRunId }),
      setSelectedBenchmarkRunId: (selectedBenchmarkRunId) => set({ selectedBenchmarkRunId }),
      setLabsMode: (labsMode) => set({ labsMode }),
    }),
    {
      name: "agentic-ui-store-v7",
      partialize: (state) => ({
        activeSection: state.activeSection,
        selectedRepoId: state.selectedRepoId,
        labsMode: state.labsMode,
        workflowViewMode: state.workflowViewMode,
      }),
      migrate: (persistedState: unknown) => {
        const state = (persistedState ?? {}) as Partial<UiStore>;
        const activeSection =
          state.activeSection === "overseer" || state.activeSection === "runs"
            ? "live"
            : state.activeSection || "live";

        return {
          ...state,
          activeSection,
          workflowViewMode: state.workflowViewMode || "board",
        } as UiStore;
      },
    }
  )
);
