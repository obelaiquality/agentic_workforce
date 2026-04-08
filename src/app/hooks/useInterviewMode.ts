import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../lib/apiClient";
import type { InterviewDimensions, InterviewChallengeMode } from "../../shared/contracts";

// ---------------------------------------------------------------------------
// Local DTO types (no server-side DTO exported yet)
// ---------------------------------------------------------------------------

export interface InterviewQuestionDto {
  id: string;
  question: string;
  round: number;
  challengeMode?: InterviewChallengeMode;
  targetDimension: string;
  answer?: string;
}

export interface InterviewSessionDto {
  id: string;
  objective: string;
  status: "active" | "crystallized" | "handed_off";
  currentRound: number;
  maxRounds: number;
  ambiguityThreshold: number;
  questions: InterviewQuestionDto[];
  scores: Array<{ round: number; overall: number; dimensions: InterviewDimensions }>;
  specContent?: string;
  finalAmbiguity?: number;
  handoffMode?: "ralph" | "team" | "autopilot";
}

// ---------------------------------------------------------------------------
// SSE event types emitted by the interview stream
// ---------------------------------------------------------------------------

interface InterviewStreamEvent {
  type: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// API helper functions
// ---------------------------------------------------------------------------

async function getInterviewStatus(id: string) {
  const raw = await apiRequest<Record<string, unknown>>(
    `/api/interview/${encodeURIComponent(id)}/status`,
  );
  const questions = (raw.questions as Array<Record<string, unknown>>) ?? [];
  const scores = (raw.ambiguity_scores as Array<Record<string, unknown>>) ?? [];
  return {
    session: {
      id: raw.session_id as string,
      objective: raw.objective as string,
      status: (raw.status === "completed" ? "crystallized" : raw.status) as InterviewSessionDto["status"],
      currentRound: raw.current_round as number,
      maxRounds: raw.max_rounds as number,
      ambiguityThreshold: raw.ambiguity_threshold as number,
      questions: questions.map((q) => ({
        id: q.id as string,
        question: q.question as string,
        round: q.round as number,
        challengeMode: q.challenge_mode as InterviewChallengeMode | undefined,
        targetDimension: q.target_dimension as string,
        answer: q.answer as string | undefined,
      })),
      scores: scores.map((s) => ({
        round: s.round as number,
        overall: s.overall as number,
        dimensions: s.dimensions as InterviewDimensions,
      })),
      specContent: raw.final_spec as string | undefined,
      handoffMode: raw.handoff_mode as InterviewSessionDto["handoffMode"],
    } satisfies InterviewSessionDto,
  };
}

async function postSubmitAnswer(id: string, questionId: string, answer: string) {
  return apiRequest<{ events: unknown[] }>(
    `/api/interview/${encodeURIComponent(id)}/answer`,
    { method: "POST", body: JSON.stringify({ question_id: questionId, answer }) },
  );
}

async function postHandoff(id: string, mode: "ralph" | "team" | "autopilot") {
  return apiRequest<{ session_id: string; target_mode: string; spec: string }>(
    `/api/interview/${encodeURIComponent(id)}/handoff`,
    { method: "POST", body: JSON.stringify({ target_mode: mode }) },
  );
}

async function postStartInterview(input: {
  actor: string;
  repo_id: string;
  objective: string;
  worktree_path: string;
  is_greenfield?: boolean;
  max_rounds?: number;
  ambiguity_threshold?: number;
  handoff_mode?: "ralph" | "team" | "autopilot";
}) {
  return apiRequest<{ run_id: string; session_id: string; events: unknown[] }>(
    "/api/interview/start",
    { method: "POST", body: JSON.stringify(input) },
  );
}

// ---------------------------------------------------------------------------
// TanStack Query hooks
// ---------------------------------------------------------------------------

export function useInterviewSession(id: string | null) {
  return useQuery({
    queryKey: ["interview", "session", id],
    queryFn: () => getInterviewStatus(id!),
    enabled: !!id,
    refetchInterval: 5_000,
  });
}

export function useSubmitAnswer(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { questionId: string; answer: string }) =>
      postSubmitAnswer(id, input.questionId, input.answer),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["interview", "session", id] });
    },
  });
}

export function useHandoff(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (mode: "ralph" | "team" | "autopilot") => postHandoff(id, mode),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["interview", "session", id] });
    },
  });
}

export function useStartInterview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      actor: string;
      repo_id: string;
      objective: string;
      worktree_path: string;
      is_greenfield?: boolean;
      max_rounds?: number;
      ambiguity_threshold?: number;
      handoff_mode?: "ralph" | "team" | "autopilot";
    }) => postStartInterview(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["interview"] });
    },
  });
}

// ---------------------------------------------------------------------------
// SSE stream hook
// ---------------------------------------------------------------------------

export function useInterviewStream(id: string | null) {
  const [events, setEvents] = useState<InterviewStreamEvent[]>([]);
  const [latestScores, setLatestScores] = useState<
    Array<{ round: number; overall: number; dimensions: InterviewDimensions }>
  >([]);
  const [isConnected, setIsConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!id) {
      setIsConnected(false);
      return;
    }

    const baseUrl =
      import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8787";
    const es = new EventSource(
      `${baseUrl}/api/interview/${encodeURIComponent(id)}/stream`,
    );
    esRef.current = es;

    es.onopen = () => setIsConnected(true);

    es.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as InterviewStreamEvent;
        setEvents((prev) => [...prev, parsed]);

        if (parsed.type === "interview_scored") {
          setLatestScores((prev) => [
            ...prev,
            {
              round: parsed.round as number,
              overall: parsed.overall as number,
              dimensions: parsed.dimensions as InterviewDimensions,
            },
          ]);
        }
      } catch {
        // ignore non-JSON messages
      }
    };

    es.onerror = () => {
      setIsConnected(false);
    };

    return () => {
      es.close();
      esRef.current = null;
      setIsConnected(false);
    };
  }, [id]);

  const reset = useCallback(() => {
    setEvents([]);
    setLatestScores([]);
  }, []);

  return { events, latestScores, isConnected, reset };
}
