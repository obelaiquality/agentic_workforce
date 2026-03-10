import { useMemo } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  Bot,
  FolderGit2,
  Github,
  MessageSquareText,
  Play,
  SendHorizontal,
  ShieldAlert,
  Sparkles,
  StopCircle,
} from "lucide-react";
import { Chip, Panel, PanelHeader } from "../UI";
import type { ChatMessageDto, ContextPack, ModelRole, RepoRegistration, RoutingDecision, V2PolicyPendingItem } from "../../../shared/contracts";
import type { RecentRepoPath } from "../../lib/desktopBridge";
import { executionModeLabel, modelRoleLabel, providerLabel } from "../../lib/missionLabels";

export function OverseerDrawer({
  repo,
  messages,
  input,
  setInput,
  route,
  contextPack,
  pendingApprovals,
  selectedModelRole,
  setSelectedModelRole,
  roleLabels,
  actionMessage,
  repoPickerMessage,
  hasDesktopPicker,
  isActing,
  streaming,
  chooseLocalRepo,
  connectGithub,
  openRecentPath,
  reviewRoute,
  executeRoute,
  sendMessage,
  decideApproval,
  recentRepoPaths,
  openProjects,
}: {
  repo: RepoRegistration | null;
  messages: ChatMessageDto[];
  input: string;
  setInput: (value: string) => void;
  route: RoutingDecision | null;
  contextPack: ContextPack | null;
  pendingApprovals: V2PolicyPendingItem[];
  selectedModelRole: ModelRole;
  setSelectedModelRole: (role: ModelRole) => void;
  roleLabels: Record<ModelRole, string>;
  actionMessage: string | null;
  repoPickerMessage: string | null;
  hasDesktopPicker: boolean;
  isActing: boolean;
  streaming: boolean;
  chooseLocalRepo: () => void;
  connectGithub: () => void;
  openRecentPath: (path: string, label?: string) => void;
  reviewRoute: () => void;
  executeRoute: () => void;
  sendMessage: () => void;
  decideApproval: (id: string, decision: "approved" | "rejected") => void;
  recentRepoPaths: RecentRepoPath[];
  openProjects: () => void;
}) {
  const visibleMessages = useMemo(() => messages.slice(-14), [messages]);

  return (
    <div className="min-w-0 lg:sticky lg:top-4 lg:h-fit">
      <Panel className="min-h-[760px] max-h-[calc(100vh-7rem)]">
        <PanelHeader title="Overseer">
          {repo ? <Chip variant="subtle" className="text-[10px]">{repo.displayName}</Chip> : <Chip variant="warn" className="text-[10px]">connect repo</Chip>}
        </PanelHeader>

        {!repo ? (
          <div className="p-4 flex-1 flex flex-col gap-4 justify-center">
            <div>
              <div className="text-lg font-semibold text-white">Connect a repo to begin</div>
              <p className="mt-2 text-sm text-zinc-400">
                Choose a local repo and the app will create a safe working copy automatically.
              </p>
            </div>

            <div className="space-y-2">
              <button
                onClick={chooseLocalRepo}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-cyan-500"
              >
                <FolderGit2 className="h-4 w-4" />
                Choose Local Repo
              </button>
              <button
                onClick={connectGithub}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-zinc-200 hover:bg-white/[0.08]"
              >
                <Github className="h-4 w-4" />
                Connect GitHub Repo
              </button>
            </div>

            {repoPickerMessage ? (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/8 p-3 text-xs text-amber-100">
                {repoPickerMessage}
              </div>
            ) : !hasDesktopPicker ? (
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-xs text-zinc-400">
                Repo picker is available in the desktop app. This browser preview can still open already-connected repos.
              </div>
            ) : null}

            {recentRepoPaths.length ? (
              <div className="space-y-2">
                <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Recent repos</div>
                {recentRepoPaths.slice(0, 5).map((item) => (
                  <button
                    key={item.path}
                    onClick={() => openRecentPath(item.path, item.label)}
                    className="w-full rounded-lg border border-white/10 bg-zinc-950/40 px-3 py-2 text-left hover:bg-white/[0.05]"
                  >
                    <div className="text-sm text-white truncate">{item.label}</div>
                    <div className="text-xs text-zinc-500 truncate">{item.path}</div>
                  </button>
                ))}
              </div>
            ) : null}

            <button onClick={openProjects} className="text-sm text-cyan-300 hover:text-cyan-200 text-left">
              Open Projects
            </button>
          </div>
        ) : (
          <>
            <div className="p-4 border-b border-white/5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Route</div>
                  <div className="mt-1 text-sm font-medium text-white">
                    {route ? `${executionModeLabel(route.executionMode)} · ${modelRoleLabel(route.modelRole)}` : "Review the route to lock the execution lane."}
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    {route ? `${route.verificationDepth} verification · ${providerLabel(route.providerId)} · max ${route.maxLanes} lanes` : "No route planned yet"}
                  </div>
                </div>
                <Chip variant={pendingApprovals.length ? "warn" : "subtle"} className="text-[10px] shrink-0">
                  {pendingApprovals.length ? `${pendingApprovals.length} pending` : "clear"}
                </Chip>
              </div>

              {contextPack ? (
                <div className="rounded-lg border border-white/5 bg-zinc-950/40 p-3 text-xs text-zinc-400">
                  <div className="flex items-center gap-2 text-zinc-300 mb-1">
                    <Sparkles className="h-3.5 w-3.5 text-purple-400" />
                    Context Pack
                  </div>
                  <div>{contextPack.files.length} files · {contextPack.tests.length} tests · {contextPack.docs.length} docs</div>
                </div>
              ) : null}

              {route ? (
                <details className="rounded-lg border border-white/5 bg-zinc-950/30 p-3 text-xs text-zinc-400">
                  <summary className="cursor-pointer list-none text-zinc-300">Details</summary>
                  <div className="mt-3 space-y-1">
                    <div>Provider: {providerLabel(route.providerId)}</div>
                    <div>Mode: {modelRoleLabel(route.modelRole)}</div>
                    <div>Execution: {executionModeLabel(route.executionMode)}</div>
                  </div>
                </details>
              ) : null}
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3 min-h-[280px]">
              {visibleMessages.length === 0 ? (
                <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 text-sm text-zinc-400">
                  State the objective. The overseer will compact the code context, suggest the route, and queue execution.
                </div>
              ) : null}

              {visibleMessages.map((message) => (
                <div
                  key={message.id}
                  className={`rounded-xl border px-3 py-3 ${
                    message.role === "user"
                      ? "border-cyan-500/20 bg-cyan-500/8"
                      : "border-white/5 bg-white/[0.02]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 text-xs text-zinc-400">
                      {message.role === "assistant" ? <Bot className="h-3.5 w-3.5 text-purple-400" /> : <MessageSquareText className="h-3.5 w-3.5 text-cyan-300" />}
                      <span className="capitalize">{message.role === "assistant" ? "Overseer" : message.role}</span>
                    </div>
                    <span className="text-[10px] text-zinc-600">{formatDistanceToNow(new Date(message.createdAt), { addSuffix: true })}</span>
                  </div>
                  <div className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">{message.content}</div>
                </div>
              ))}
            </div>

            {pendingApprovals.length ? (
              <div className="px-4 pb-4 space-y-2 border-t border-white/5 pt-4">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                  <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />
                  Pending approvals
                </div>
                {pendingApprovals.slice(0, 3).map((approval) => (
                  <div key={approval.approval_id} className="rounded-lg border border-white/5 bg-zinc-950/40 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm text-white">{approval.action_type.replace(/_/g, " ")}</div>
                      <Chip variant="warn" className="text-[10px]">pending</Chip>
                    </div>
                    <div className="mt-1 text-xs text-zinc-500">{approval.reason || "Approval required before execution can continue."}</div>
                    <div className="mt-3 flex gap-2">
                      <button onClick={() => decideApproval(approval.approval_id, "approved")} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500">Approve</button>
                      <button onClick={() => decideApproval(approval.approval_id, "rejected")} className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-500">Reject</button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="border-t border-white/5 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Mode</div>
                </div>
                <select
                  value={selectedModelRole}
                  onChange={(event) => setSelectedModelRole(event.target.value as ModelRole)}
                  className="rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-200"
                >
                  {Object.entries(roleLabels).map(([role, label]) => (
                    <option key={role} value={role}>{label}</option>
                  ))}
                </select>
              </div>

              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Describe what should change in this repo. Example: add CSV export to the client list and verify the tests."
                className="min-h-[120px] w-full rounded-xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
              />

              {actionMessage ? <div className="text-xs text-zinc-400">{actionMessage}</div> : null}

              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={reviewRoute}
                  disabled={isActing || !input.trim()}
                  className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-zinc-200 hover:bg-white/[0.08] disabled:opacity-50"
                >
                  Review Route
                </button>
                <button
                  onClick={executeRoute}
                  disabled={isActing || !input.trim()}
                  className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
                >
                  <Play className="h-4 w-4" />
                  Execute
                </button>
                <button
                  onClick={sendMessage}
                  disabled={isActing || !input.trim()}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-purple-600 text-white hover:bg-purple-500 disabled:opacity-50"
                >
                  {streaming ? <StopCircle className="h-4 w-4" /> : <SendHorizontal className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}
