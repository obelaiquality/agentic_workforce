import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TaskLifecycleStatus, Ticket, V2TaskBoard, V2TaskCard } from "../../../shared/contracts";
import { createTicket, getBoardV2, getTaskContextV3, intakeTaskV2, listAgentLanesV3, listTickets, reserveTaskV2, transitionTaskV2, updateTicket } from "../../lib/apiClient";
import { useUiStore } from "../../store/uiStore";
import { Chip, Panel, PanelHeader } from "../UI";
import { Plus, WandSparkles } from "lucide-react";

const COLUMNS: Array<{ key: TaskLifecycleStatus; label: string }> = [
  { key: "inactive", label: "Backlog" },
  { key: "reserved", label: "Reserved" },
  { key: "active", label: "Ready" },
  { key: "in_progress", label: "In-Progress" },
  { key: "blocked", label: "Blocked" },
  { key: "completed", label: "Done" },
];

export function BacklogView() {
  const queryClient = useQueryClient();
  const selectedTicketId = useUiStore((state) => state.selectedTicketId);
  const selectedRepoId = useUiStore((state) => state.selectedRepoId);
  const setSelectedTicketId = useUiStore((state) => state.setSelectedTicketId);

  const [createTitle, setCreateTitle] = useState("");

  const boardQuery = useQuery({
    queryKey: ["board-v2", selectedRepoId],
    queryFn: () => getBoardV2(selectedRepoId || undefined),
    refetchInterval: 10000,
  });

  const ticketsQuery = useQuery({
    queryKey: ["tickets", selectedRepoId],
    queryFn: () => listTickets(selectedRepoId || undefined),
    refetchInterval: 15000,
  });

  const lanesQuery = useQuery({
    queryKey: ["agent-lanes-v3"],
    queryFn: () => listAgentLanesV3(),
    refetchInterval: 7000,
  });

  const taskContextQuery = useQuery({
    queryKey: ["task-context-v3", selectedTicketId],
    enabled: Boolean(selectedTicketId),
    queryFn: () => getTaskContextV3(selectedTicketId as string),
    refetchInterval: 7000,
  });

  const createTicketMutation = useMutation({
    mutationFn: (title: string) => createTicket({ title, priority: "p2", risk: "medium", repoId: selectedRepoId || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["board-v2", selectedRepoId] });
      queryClient.invalidateQueries({ queryKey: ["tickets", selectedRepoId] });
      setCreateTitle("");
    },
  });

  const intakeMutation = useMutation({
    mutationFn: (strategy: "weighted-random-next" | "deterministic-next") =>
      intakeTaskV2({
        strategy,
        actor: "user",
      }),
    onSuccess: (result) => {
      if (result.allocation?.ticket_id) {
        setSelectedTicketId(result.allocation.ticket_id);
      }
      queryClient.invalidateQueries({ queryKey: ["board-v2", selectedRepoId] });
    },
  });

  const reserveTicketMutation = useMutation({
    mutationFn: (ticket_id: string) =>
      reserveTaskV2({
        ticket_id,
        actor: "user",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["board-v2", selectedRepoId] });
    },
  });

  const moveTicketMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskLifecycleStatus }) =>
      transitionTaskV2({
        ticket_id: id,
        actor: "user",
        status,
      }),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: ["board-v2", selectedRepoId] });
      const previous = queryClient.getQueryData<V2TaskBoard>(["board-v2", selectedRepoId]);

      if (previous) {
        const next: Record<TaskLifecycleStatus, V2TaskCard[]> = {
          inactive: [...previous.columns.inactive],
          reserved: [...previous.columns.reserved],
          active: [...previous.columns.active],
          in_progress: [...previous.columns.in_progress],
          blocked: [...previous.columns.blocked],
          completed: [...previous.columns.completed],
        };

        let moved: V2TaskCard | null = null;

        for (const column of COLUMNS) {
          const index = next[column.key].findIndex((ticket) => ticket.ticket_id === id);
          if (index >= 0) {
            moved = { ...next[column.key][index], status };
            next[column.key].splice(index, 1);
            break;
          }
        }

        if (moved) {
          next[status].unshift(moved);
        }

        queryClient.setQueryData(["board-v2", selectedRepoId], {
          ...previous,
          columns: next,
        });
      }

      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["board-v2", selectedRepoId], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["board-v2", selectedRepoId] });
      queryClient.invalidateQueries({ queryKey: ["tickets", selectedRepoId] });
    },
  });

  const updateTicketMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Ticket> }) => updateTicket(id, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["board-v2", selectedRepoId] });
      queryClient.invalidateQueries({ queryKey: ["tickets", selectedRepoId] });
    },
  });

  const board = boardQuery.data?.columns ?? {
    inactive: [],
    reserved: [],
    active: [],
    in_progress: [],
    blocked: [],
    completed: [],
  };

  const selectedTicket = useMemo(() => {
    if (!selectedTicketId) {
      return null;
    }
    return ticketsQuery.data?.items.find((ticket) => ticket.id === selectedTicketId) ?? null;
  }, [selectedTicketId, ticketsQuery.data?.items]);

  useEffect(() => {
    const tickets = ticketsQuery.data?.items || [];
    if (!tickets.length) {
      return;
    }
    if (!selectedTicketId || !tickets.some((ticket) => ticket.id === selectedTicketId)) {
      setSelectedTicketId(tickets[0].id);
    }
  }, [selectedTicketId, setSelectedTicketId, ticketsQuery.data?.items]);

  const lanesByTicket = useMemo(() => {
    const map = new Map<string, number>();
    for (const lane of lanesQuery.data?.items ?? []) {
      map.set(lane.ticketId, (map.get(lane.ticketId) || 0) + 1);
    }
    return map;
  }, [lanesQuery.data?.items]);

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader title="Backlog Command">
          <div className="flex items-center gap-2 flex-wrap">
            <input
              value={createTitle}
              onChange={(event) => setCreateTitle(event.target.value)}
              className="bg-zinc-900 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-zinc-200 w-72"
              placeholder="New ticket title"
            />
            <button
              onClick={() => {
                if (!createTitle.trim()) {
                  return;
                }
                createTicketMutation.mutate(createTitle.trim());
              }}
              className="px-2.5 py-1.5 rounded-md bg-purple-600 hover:bg-purple-500 text-white text-xs"
            >
              <Plus className="w-3.5 h-3.5 inline mr-1" /> Create
            </button>
            <button
              onClick={() => intakeMutation.mutate("weighted-random-next")}
              className="px-2.5 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 border border-white/10 text-zinc-200 text-xs"
            >
              <WandSparkles className="w-3.5 h-3.5 inline mr-1" /> Weighted Intake
            </button>
            <button
              onClick={() => intakeMutation.mutate("deterministic-next")}
              className="px-2.5 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 border border-white/10 text-zinc-200 text-xs"
            >
              Deterministic Intake
            </button>
          </div>
        </PanelHeader>
      </Panel>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-4">
        <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3 items-start">
          {COLUMNS.map((column) => (
            <Panel key={column.key} className="min-h-[220px]">
              <PanelHeader title={column.label}>
                <Chip variant="subtle" className="text-[10px]">
                  {board[column.key].length}
                </Chip>
              </PanelHeader>

              <div
                className="p-2.5 space-y-2 min-h-[180px]"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  const ticketId = event.dataTransfer.getData("ticket-id");
                  if (!ticketId) {
                    return;
                  }
                  moveTicketMutation.mutate({ id: ticketId, status: column.key });
                }}
              >
                {board[column.key].map((ticket) => (
                  <article
                    key={ticket.ticket_id}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData("ticket-id", ticket.ticket_id);
                    }}
                    onClick={() => setSelectedTicketId(ticket.ticket_id)}
                    className={`rounded-md border p-2.5 cursor-pointer transition-colors ${
                      ticket.ticket_id === selectedTicketId
                        ? "bg-purple-500/10 border-purple-500/35"
                        : "bg-zinc-900/40 border-white/10 hover:border-white/20"
                    }`}
                  >
                    <div className="text-xs text-zinc-100 font-medium line-clamp-2">{ticket.title}</div>
                    <div className="flex gap-1 mt-2">
                      <Chip variant="subtle" className="text-[9px]">
                        {ticket.priority}
                      </Chip>
                      <Chip variant="subtle" className="text-[9px]">
                      {ticket.risk}
                      </Chip>
                      {lanesByTicket.get(ticket.ticket_id) ? (
                        <Chip variant="subtle" className="text-[9px]">
                          {lanesByTicket.get(ticket.ticket_id)} lanes
                        </Chip>
                      ) : null}
                      {ticket.reservation?.stale ? (
                        <Chip variant="stop" className="text-[9px]">
                          stale
                        </Chip>
                      ) : null}
                    </div>
                    {ticket.reservation ? (
                      <div className="text-[10px] text-zinc-500 mt-1">
                        reserved by {ticket.reservation.reserved_by}
                      </div>
                    ) : (
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          reserveTicketMutation.mutate(ticket.ticket_id);
                        }}
                        className="mt-2 text-[10px] px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 border border-white/10 text-zinc-300"
                      >
                        Reserve 4h
                      </button>
                    )}
                  </article>
                ))}
              </div>
            </Panel>
          ))}
        </div>

        <Panel className="min-h-[460px]">
          <PanelHeader title="Ticket Quick Refine" />
          <div className="p-3 space-y-3">
            {selectedTicket ? (
              <>
                {taskContextQuery.data?.routing?.[0] ? (
                  <article className="rounded-md border border-cyan-500/20 bg-cyan-500/10 p-2.5">
                    <div className="text-[11px] text-cyan-200 uppercase tracking-wide">Route hint</div>
                    <div className="text-xs text-cyan-100 mt-1">
                      {taskContextQuery.data.routing[0].executionMode} · {taskContextQuery.data.routing[0].providerId}
                    </div>
                    <div className="text-[10px] text-cyan-100/70 mt-1">
                      role {taskContextQuery.data.routing[0].modelRole} · max lanes {taskContextQuery.data.routing[0].maxLanes}
                    </div>
                  </article>
                ) : null}
                <div>
                  <label className="text-[11px] text-zinc-500 uppercase tracking-wide">Title</label>
                  <input
                    value={selectedTicket.title}
                    onChange={(event) => {
                      updateTicketMutation.mutate({
                        id: selectedTicket.id,
                        patch: { title: event.target.value },
                      });
                    }}
                    className="mt-1 w-full bg-zinc-900 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-zinc-200"
                  />
                </div>

                <div>
                  <label className="text-[11px] text-zinc-500 uppercase tracking-wide">Description</label>
                  <textarea
                    value={selectedTicket.description}
                    onChange={(event) => {
                      updateTicketMutation.mutate({
                        id: selectedTicket.id,
                        patch: { description: event.target.value },
                      });
                    }}
                    className="mt-1 w-full bg-zinc-900 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-zinc-200 min-h-[120px]"
                  />
                </div>

                <div>
                  <label className="text-[11px] text-zinc-500 uppercase tracking-wide">Acceptance Criteria</label>
                  <textarea
                    value={selectedTicket.acceptanceCriteria.join("\n")}
                    onChange={(event) => {
                      updateTicketMutation.mutate({
                        id: selectedTicket.id,
                        patch: {
                          acceptanceCriteria: event.target.value
                            .split("\n")
                            .map((item) => item.trim())
                            .filter(Boolean),
                        },
                      });
                    }}
                    className="mt-1 w-full bg-zinc-900 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-zinc-200 min-h-[120px]"
                  />
                </div>
              </>
            ) : (
              <div className="text-xs text-zinc-600">Select a ticket card to refine details.</div>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
