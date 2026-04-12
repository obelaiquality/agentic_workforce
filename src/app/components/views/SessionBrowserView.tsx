/**
 * SessionBrowserView — Browse, search, and resume past chat sessions.
 *
 * Displays a list of past sessions with search, filtering by project,
 * and the ability to open a session to view its conversation history.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Clock, MessageSquare, Search, Trash2, Edit2, Check, X } from "lucide-react";
import {
  listSessions,
  getSessionDetail,
  deleteSessionById,
  updateSessionTitle,
  type SessionSummary,
} from "../../lib/apiClient";
import { EmptyState } from "../ui/empty-state";
import { ProcessingIndicator } from "../ui/processing-indicator";

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMinutes = Math.floor(diffMs / 60000);

  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export function SessionBrowserView({
  repoId,
  onOpenSession,
}: {
  repoId?: string | null;
  onOpenSession?: (sessionId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const sessionsQuery = useQuery({
    queryKey: ["sessions", repoId, search],
    queryFn: () => listSessions({ repoId: repoId || undefined, search: search || undefined, limit: 50 }),
    staleTime: 5000,
  });

  const detailQuery = useQuery({
    queryKey: ["session-detail", selectedSessionId],
    queryFn: () => getSessionDetail(selectedSessionId!),
    enabled: Boolean(selectedSessionId),
    staleTime: 5000,
  });

  const deleteMutation = useMutation({
    mutationFn: (sessionId: string) => deleteSessionById(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      if (selectedSessionId) setSelectedSessionId(null);
    },
  });

  const renameMutation = useMutation({
    mutationFn: ({ sessionId, title }: { sessionId: string; title: string }) =>
      updateSessionTitle(sessionId, title),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      setEditingId(null);
    },
  });

  const sessions = sessionsQuery.data?.items ?? [];
  const detail = detailQuery.data?.item ?? null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
      {/* Session list */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sessions..."
            className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--surface-input)] py-2.5 pl-10 pr-4 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-cyan-500/30"
          />
        </div>

        {sessionsQuery.isLoading ? (
          <div className="flex items-center justify-center py-8">
            <ProcessingIndicator kind="processing" active size="sm" />
          </div>
        ) : sessions.length === 0 ? (
          <EmptyState
            title="No sessions yet"
            description={search ? "No sessions match your search." : "Start a conversation to create your first session."}
          />
        ) : (
          <div className="space-y-1">
            {sessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                selected={selectedSessionId === session.id}
                editing={editingId === session.id}
                editTitle={editTitle}
                onSelect={() => setSelectedSessionId(session.id)}
                onOpen={() => onOpenSession?.(session.id)}
                onDelete={() => deleteMutation.mutate(session.id)}
                onStartEdit={() => {
                  setEditingId(session.id);
                  setEditTitle(session.title);
                }}
                onCancelEdit={() => setEditingId(null)}
                onSaveEdit={() => renameMutation.mutate({ sessionId: session.id, title: editTitle })}
                onEditTitleChange={setEditTitle}
              />
            ))}
          </div>
        )}
      </div>

      {/* Session detail / conversation preview */}
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-panel)] overflow-hidden">
        {selectedSessionId && detail ? (
          <div className="flex flex-col h-full">
            <div className="border-b border-[var(--border-subtle)] px-4 py-3">
              <h3 className="text-sm font-medium text-[var(--text-primary)]">{detail.title}</h3>
              <div className="mt-1 flex items-center gap-3 text-xs text-[var(--text-muted)]">
                <span>{detail.messageCount} messages</span>
                <span>{formatRelativeTime(detail.updatedAt)}</span>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[600px]">
              {detail.messages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[80%] rounded-xl px-3.5 py-2.5 text-sm ${
                      msg.role === "user"
                        ? "bg-cyan-500/10 text-cyan-100 border border-cyan-500/20"
                        : msg.role === "system"
                        ? "bg-[var(--surface-overlay)] text-[var(--text-muted)] text-xs italic"
                        : "bg-[var(--surface-elevated)] text-[var(--text-primary)] border border-[var(--border-subtle)]"
                    }`}
                  >
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                    <div className="mt-1 text-[10px] text-[var(--text-muted)] text-right">
                      {formatRelativeTime(msg.createdAt)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-[var(--border-subtle)] px-4 py-3">
              <button
                onClick={() => onOpenSession?.(selectedSessionId)}
                className="w-full rounded-xl bg-cyan-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-cyan-500 transition-colors"
              >
                Resume Session
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-64 text-sm text-[var(--text-muted)]">
            Select a session to preview its conversation
          </div>
        )}
      </div>
    </div>
  );
}

function SessionCard({
  session,
  selected,
  editing,
  editTitle,
  onSelect,
  onOpen,
  onDelete,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onEditTitleChange,
}: {
  session: SessionSummary;
  selected: boolean;
  editing: boolean;
  editTitle: string;
  onSelect: () => void;
  onOpen: () => void;
  onDelete: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onEditTitleChange: (value: string) => void;
}) {
  return (
    <div
      onClick={onSelect}
      onDoubleClick={onOpen}
      className={`group cursor-pointer rounded-xl border px-3 py-2.5 transition-colors ${
        selected
          ? "border-cyan-500/20 bg-cyan-500/[0.06]"
          : "border-[var(--border-subtle)] bg-[var(--surface-panel)] hover:bg-[var(--surface-overlay)]"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={editTitle}
                onChange={(e) => onEditTitleChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSaveEdit();
                  if (e.key === "Escape") onCancelEdit();
                }}
                className="flex-1 rounded border border-cyan-500/30 bg-transparent px-1.5 py-0.5 text-sm text-[var(--text-primary)] outline-none"
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
              <button
                onClick={(e) => { e.stopPropagation(); onSaveEdit(); }}
                className="p-0.5 text-emerald-400 hover:text-emerald-300"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onCancelEdit(); }}
                className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div className="text-sm font-medium text-[var(--text-primary)] truncate">{session.title}</div>
          )}
          <div className="mt-1 flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
            <span className="flex items-center gap-1">
              <MessageSquare className="h-3 w-3" />
              {session.messageCount}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatRelativeTime(session.lastMessageAt || session.updatedAt)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); onStartEdit(); }}
            className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded"
            title="Rename"
          >
            <Edit2 className="h-3 w-3" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="p-1 text-[var(--text-muted)] hover:text-rose-400 rounded"
            title="Delete"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
