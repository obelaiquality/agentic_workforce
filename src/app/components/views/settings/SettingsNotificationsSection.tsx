import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  listNotificationChannels,
  upsertNotificationChannel,
  deleteNotificationChannel,
  testNotificationChannel,
} from "../../../lib/apiClient";
import { Chip, Panel, PanelHeader } from "../../UI";

// ---------------------------------------------------------------------------
// Types (mirrors server-side)
// ---------------------------------------------------------------------------

type NotificationChannelType = "slack" | "discord" | "webhook";

type NotificationEventType =
  | "task_completed"
  | "task_failed"
  | "approval_needed"
  | "agent_blocked"
  | "execution_started"
  | "execution_aborted";

interface NotificationChannel {
  id: string;
  type: NotificationChannelType;
  name: string;
  url: string;
  enabled: boolean;
  events: NotificationEventType[];
  metadata?: Record<string, unknown>;
}

const ALL_EVENTS: { value: NotificationEventType; label: string }[] = [
  { value: "task_completed", label: "Task Completed" },
  { value: "task_failed", label: "Task Failed" },
  { value: "approval_needed", label: "Approval Needed" },
  { value: "agent_blocked", label: "Agent Blocked" },
  { value: "execution_started", label: "Execution Started" },
  { value: "execution_aborted", label: "Execution Aborted" },
];

const CHANNEL_TYPES: { value: NotificationChannelType; label: string }[] = [
  { value: "slack", label: "Slack" },
  { value: "discord", label: "Discord" },
  { value: "webhook", label: "Generic Webhook" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SettingsNotificationsSection() {
  const queryClient = useQueryClient();

  const [showAddForm, setShowAddForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState<NotificationChannelType>("slack");
  const [formUrl, setFormUrl] = useState("");
  const [formEvents, setFormEvents] = useState<Set<NotificationEventType>>(new Set());
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const channelsQuery = useQuery({
    queryKey: ["notification-channels"],
    queryFn: listNotificationChannels,
  });

  const upsertMutation = useMutation({
    mutationFn: upsertNotificationChannel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notification-channels"] });
      toast.success("Channel saved");
    },
    onError: () => toast.error("Failed to save channel"),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteNotificationChannel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notification-channels"] });
      toast("Channel deleted");
      setDeleteConfirmId(null);
    },
    onError: () => toast.error("Failed to delete channel"),
  });

  const testMutation = useMutation({
    mutationFn: testNotificationChannel,
    onSuccess: () => toast.success("Test notification sent"),
    onError: () => toast.error("Test notification failed"),
  });

  const channels = channelsQuery.data?.items ?? [];

  const resetForm = () => {
    setFormName("");
    setFormType("slack");
    setFormUrl("");
    setFormEvents(new Set());
    setShowAddForm(false);
  };

  const handleSubmit = () => {
    if (!formName.trim() || !formUrl.trim() || formEvents.size === 0) return;

    const id = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    upsertMutation.mutate(
      {
        id,
        name: formName.trim(),
        type: formType,
        url: formUrl.trim(),
        enabled: true,
        events: Array.from(formEvents),
      },
      { onSuccess: resetForm },
    );
  };

  const toggleEvent = (eventType: NotificationEventType) => {
    setFormEvents((prev) => {
      const next = new Set(prev);
      if (next.has(eventType)) {
        next.delete(eventType);
      } else {
        next.add(eventType);
      }
      return next;
    });
  };

  const toggleChannelEnabled = (channel: NotificationChannel) => {
    upsertMutation.mutate({
      ...channel,
      enabled: !channel.enabled,
    });
  };

  return (
    <div className="p-4">
      <Panel>
        <PanelHeader title="Notification Channels" />
        <div className="p-4 space-y-4">
          {/* Existing channels */}
          {channels.length === 0 ? (
            <div className="text-xs text-zinc-600 text-center py-4">
              No notification channels configured.
            </div>
          ) : (
            <div className="space-y-2">
              {channels.map((channel) => (
                <div
                  key={channel.id}
                  className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium text-white truncate">{channel.name}</span>
                      <Chip variant="subtle" className="text-[10px]">{channel.type}</Chip>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => testMutation.mutate(channel.id)}
                        disabled={testMutation.isPending}
                        className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] text-zinc-300 hover:bg-white/[0.06] transition disabled:opacity-40"
                      >
                        Test
                      </button>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <span className="text-[10px] text-zinc-500">
                          {channel.enabled ? "On" : "Off"}
                        </span>
                        <input
                          type="checkbox"
                          checked={channel.enabled}
                          onChange={() => toggleChannelEnabled(channel)}
                          className="w-3.5 h-3.5 rounded border-white/20 bg-zinc-900 text-cyan-500 focus:ring-cyan-500/30"
                        />
                      </label>
                      {deleteConfirmId === channel.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => deleteMutation.mutate(channel.id)}
                            className="rounded px-2 py-1 text-[10px] bg-red-500/10 text-red-400 hover:bg-red-500/20"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setDeleteConfirmId(null)}
                            className="rounded px-2 py-1 text-[10px] bg-white/5 text-zinc-400 hover:bg-white/10"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirmId(channel.id)}
                          className="rounded px-2 py-1 text-[10px] bg-white/5 text-zinc-400 hover:bg-white/10"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="text-[10px] text-zinc-600 truncate">{channel.url}</div>
                  <div className="flex flex-wrap gap-1">
                    {channel.events.map((evt) => (
                      <Chip key={evt} variant="subtle" className="text-[9px]">
                        {evt.replace(/_/g, " ")}
                      </Chip>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add channel form */}
          {showAddForm ? (
            <div className="rounded-xl border border-cyan-400/20 bg-cyan-500/[0.03] p-4 space-y-3">
              <div className="text-sm font-medium text-white">Add Notification Channel</div>

              <div className="grid grid-cols-[1fr_auto] gap-2">
                <label className="space-y-1 block">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Name</div>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="My Slack channel"
                    className="w-full rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-200"
                  />
                </label>
                <label className="space-y-1 block">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Type</div>
                  <select
                    value={formType}
                    onChange={(e) => setFormType(e.target.value as NotificationChannelType)}
                    className="w-full rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-200"
                  >
                    {CHANNEL_TYPES.map((ct) => (
                      <option key={ct.value} value={ct.value}>{ct.label}</option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="space-y-1 block">
                <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Webhook URL</div>
                <input
                  type="url"
                  value={formUrl}
                  onChange={(e) => setFormUrl(e.target.value)}
                  placeholder="https://hooks.slack.com/services/..."
                  className="w-full rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-200"
                />
              </label>

              <div className="space-y-1">
                <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Events</div>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {ALL_EVENTS.map((evt) => (
                    <label
                      key={evt.value}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer transition text-xs ${
                        formEvents.has(evt.value)
                          ? "border-cyan-400/30 bg-cyan-500/10 text-cyan-100"
                          : "border-white/10 bg-white/[0.02] text-zinc-400 hover:bg-white/[0.04]"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={formEvents.has(evt.value)}
                        onChange={() => toggleEvent(evt.value)}
                        className="w-3.5 h-3.5 rounded border-white/20 bg-zinc-900 text-cyan-500 focus:ring-cyan-500/30"
                      />
                      {evt.label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleSubmit}
                  disabled={!formName.trim() || !formUrl.trim() || formEvents.size === 0 || upsertMutation.isPending}
                  className="rounded-lg bg-cyan-600 px-4 py-2 text-xs font-medium text-white disabled:opacity-40 transition"
                >
                  Save Channel
                </button>
                <button
                  onClick={resetForm}
                  className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-2 text-xs text-zinc-300 hover:bg-white/[0.06] transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowAddForm(true)}
              className="rounded-lg border border-dashed border-white/10 bg-white/[0.01] px-4 py-3 text-xs text-zinc-400 hover:bg-white/[0.04] hover:border-white/20 transition w-full"
            >
              + Add Notification Channel
            </button>
          )}
        </div>
      </Panel>
    </div>
  );
}
