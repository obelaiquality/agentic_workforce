import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../lib/apiClient";

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface TeamWorkerDto {
  id: string;
  workerId: string;
  role: string;
  status: string;
  currentTaskId: string | null;
  lastHeartbeatAt: string;
}

export interface TeamTaskDto {
  id: string;
  name: string;
  description: string;
  assignedTo: string | null;
  priority: number;
  status: string;
  leaseExpires: string | null;
  result: string | null;
}

export interface TeamMessageDto {
  id: string;
  fromWorkerId: string;
  toWorkerId: string | null;
  content: string;
  read: boolean;
  createdAt: string;
}

export interface TeamSessionDto {
  id: string;
  objective: string;
  phase: string;
  workerCount: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

export async function getTeamSession(id: string) {
  return apiRequest<{ session: TeamSessionDto }>(`/api/enhanced-team/${encodeURIComponent(id)}`);
}

export async function getTeamWorkers(id: string) {
  return apiRequest<{ workers: TeamWorkerDto[] }>(`/api/enhanced-team/${encodeURIComponent(id)}/workers`);
}

export async function getTeamTasks(id: string) {
  return apiRequest<{ tasks: TeamTaskDto[] }>(`/api/enhanced-team/${encodeURIComponent(id)}/tasks`);
}

export async function getTeamMessages(id: string, workerId?: string | null) {
  const base = `/api/enhanced-team/${encodeURIComponent(id)}/messages`;
  const url = workerId ? `${base}/${encodeURIComponent(workerId)}` : base;
  return apiRequest<{ messages: TeamMessageDto[] }>(url);
}

export async function sendTeamMessage(
  id: string,
  input: { fromWorkerId: string; toWorkerId?: string; content: string },
) {
  return apiRequest<{ message: TeamMessageDto }>(`/api/enhanced-team/${encodeURIComponent(id)}/message`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function startEnhancedTeam(input: {
  actor: string;
  repoId: string;
  objective: string;
  worktreePath: string;
  maxWorkers?: number;
}) {
  return apiRequest<{ sessionId: string }>("/api/enhanced-team/start", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// ---------------------------------------------------------------------------
// Stream event types
// ---------------------------------------------------------------------------

export interface TeamStreamEvent {
  type: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useTeamSession(id: string | null) {
  return useQuery({
    queryKey: ["enhanced-team-session", id],
    queryFn: () => getTeamSession(id!),
    enabled: Boolean(id),
    refetchInterval: 5000,
  });
}

export function useTeamWorkers(id: string | null) {
  return useQuery({
    queryKey: ["enhanced-team-workers", id],
    queryFn: () => getTeamWorkers(id!),
    enabled: Boolean(id),
    refetchInterval: 3000,
  });
}

export function useTeamTasks(id: string | null) {
  return useQuery({
    queryKey: ["enhanced-team-tasks", id],
    queryFn: () => getTeamTasks(id!),
    enabled: Boolean(id),
    refetchInterval: 3000,
  });
}

export function useTeamMessages(id: string | null, workerId?: string | null) {
  return useQuery({
    queryKey: ["enhanced-team-messages", id, workerId ?? "all"],
    queryFn: () => getTeamMessages(id!, workerId),
    enabled: Boolean(id),
    refetchInterval: 3000,
  });
}

export function useSendMessage(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { fromWorkerId: string; toWorkerId?: string; content: string }) =>
      sendTeamMessage(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["enhanced-team-messages", id] });
    },
  });
}

export function useStartTeam() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { actor: string; repoId: string; objective: string; worktreePath: string; maxWorkers?: number }) =>
      startEnhancedTeam(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["enhanced-team-session"] });
    },
  });
}

export function useTeamStream(id: string | null) {
  const [events, setEvents] = useState<TeamStreamEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);

  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  useEffect(() => {
    if (!id) {
      setConnected(false);
      setEvents([]);
      return;
    }

    const baseUrl = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8787";
    const es = new EventSource(`${baseUrl}/api/enhanced-team/${encodeURIComponent(id)}/stream`);
    sourceRef.current = es;

    es.onopen = () => {
      setConnected(true);
    };

    es.onmessage = (evt) => {
      try {
        const parsed = JSON.parse(evt.data) as TeamStreamEvent;
        setEvents((prev) => [...prev.slice(-99), parsed]);
      } catch {
        // ignore malformed events
      }
    };

    es.onerror = () => {
      setConnected(false);
    };

    return () => {
      es.close();
      sourceRef.current = null;
      setConnected(false);
    };
  }, [id]);

  return { events, connected, clearEvents };
}
