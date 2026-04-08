import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../lib/apiClient";
import type { RalphProgressLedger } from "../../shared/contracts";

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

export interface RalphSessionDto {
  id: string;
  status: string;
  currentPhase: string;
  currentIteration: number;
  maxIterations: number;
  verificationTier: string;
  specContent: string;
  progressLedger: RalphProgressLedger | null;
}

export async function getRalphStatus(id: string) {
  const raw = await apiRequest<Record<string, unknown>>(
    `/api/ralph/${encodeURIComponent(id)}/status`,
  );
  return {
    session: {
      id: raw.session_id as string,
      status: raw.status as string,
      currentPhase: raw.current_phase as string,
      currentIteration: raw.iteration as number,
      maxIterations: raw.max_iterations as number,
      verificationTier: raw.verification_tier as string,
      specContent: raw.spec_content as string,
      progressLedger: raw.progress_ledger as RalphProgressLedger | null,
    } satisfies RalphSessionDto,
  };
}

export async function getRalphLedger(id: string) {
  const raw = await apiRequest<Record<string, unknown>>(
    `/api/ralph/${encodeURIComponent(id)}/ledger`,
  );
  const pe = (raw.phase_executions as Array<Record<string, unknown>>) ?? [];
  const v = (raw.verifications as Array<Record<string, unknown>>) ?? [];
  return {
    ledger: raw.progress_ledger as RalphProgressLedger | null,
    phaseExecutions: pe.map((p) => ({
      phase: p.phase as string,
      iteration: p.iteration as number,
      status: p.status as string,
      output: p.output as string | undefined,
    })),
    verifications: v.map((vi) => ({
      tier: vi.tier as string,
      testsPassed: vi.tests_passed as boolean,
      lintsPassed: vi.lints_passed as boolean,
      deslopPassed: vi.deslop_passed as boolean,
      regressionsPassed: vi.regressions_passed as boolean,
    })),
  };
}

export async function startRalph(input: {
  actor: string;
  project_id: string;
  spec_content: string;
}) {
  return apiRequest<{ session_id: string }>("/api/ralph/start", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function pauseRalph(id: string) {
  return apiRequest<{ ok: boolean }>(
    `/api/ralph/${encodeURIComponent(id)}/pause`,
    { method: "POST" },
  );
}

export async function resumeRalph(id: string) {
  return apiRequest<{ ok: boolean }>(
    `/api/ralph/${encodeURIComponent(id)}/resume`,
    { method: "POST" },
  );
}

// ---------------------------------------------------------------------------
// TanStack Query hooks
// ---------------------------------------------------------------------------

export function useRalphSession(id: string | null) {
  return useQuery({
    queryKey: ["ralph", "session", id],
    queryFn: () => getRalphStatus(id!),
    enabled: !!id,
    refetchInterval: 3_000,
  });
}

export function useRalphLedger(id: string | null) {
  return useQuery({
    queryKey: ["ralph", "ledger", id],
    queryFn: () => getRalphLedger(id!),
    enabled: !!id,
    refetchInterval: 5_000,
  });
}

export function useStartRalph() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: startRalph,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ralph"] });
    },
  });
}

export function usePauseRalph(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => pauseRalph(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ralph", "session", id] });
    },
  });
}

export function useResumeRalph(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => resumeRalph(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ralph", "session", id] });
    },
  });
}

// ---------------------------------------------------------------------------
// EventSource streaming hook
// ---------------------------------------------------------------------------

export interface RalphStreamEvent {
  type: string;
  data: Record<string, unknown>;
}

export function useRalphStream(id: string | null) {
  const [events, setEvents] = useState<RalphStreamEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const qc = useQueryClient();

  const clear = useCallback(() => setEvents([]), []);

  useEffect(() => {
    if (!id) return;

    const baseUrl =
      import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8787";
    const es = new EventSource(`${baseUrl}/api/ralph/${id}/stream`);

    es.onopen = () => setConnected(true);

    es.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data) as RalphStreamEvent;
        setEvents((prev) => [...prev, parsed]);

        // Invalidate queries on key events so UI stays in sync
        if (
          parsed.type === "ralph_phase_entered" ||
          parsed.type === "ralph_phase_exited" ||
          parsed.type === "ralph_verification" ||
          parsed.type === "ralph_checkpoint"
        ) {
          qc.invalidateQueries({ queryKey: ["ralph", "session", id] });
          qc.invalidateQueries({ queryKey: ["ralph", "ledger", id] });
        }
      } catch {
        // ignore malformed messages
      }
    };

    es.onerror = () => setConnected(false);

    return () => {
      es.close();
      setConnected(false);
    };
  }, [id, qc]);

  return { events, connected, clear };
}
