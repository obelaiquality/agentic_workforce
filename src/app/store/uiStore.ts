import { create } from "zustand";
import { persist } from "zustand/middleware";

type Section = "live" | "codebase" | "console" | "projects" | "settings" | "overseer" | "runs" | "benchmarks";

interface UiStore {
  activeSection: Section;
  selectedSessionId: string | null;
  selectedTicketId: string | null;
  selectedRepoId: string | null;
  selectedRunId: string | null;
  selectedBenchmarkRunId: string | null;
  labsMode: boolean;
  setActiveSection: (section: UiStore["activeSection"]) => void;
  setSelectedSessionId: (sessionId: string | null) => void;
  setSelectedTicketId: (ticketId: string | null) => void;
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
      selectedRepoId: null,
      selectedRunId: null,
      selectedBenchmarkRunId: null,
      labsMode: false,
      setActiveSection: (activeSection) => set({ activeSection }),
      setSelectedSessionId: (selectedSessionId) => set({ selectedSessionId }),
      setSelectedTicketId: (selectedTicketId) => set({ selectedTicketId }),
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
        } as UiStore;
      },
    }
  )
);
