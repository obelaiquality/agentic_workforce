import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  connectMcpIntegration,
  createOrUpdateMcpIntegration,
  deleteMcpIntegration,
  disconnectMcpIntegration,
  getLspIntegrations,
  getMcpIntegrations,
  patchMcpIntegration,
} from "../../../lib/apiClient";
import { Chip, Panel, PanelHeader } from "../../UI";
import { LabeledInput } from "./SettingsShared";
import { toMcpServerIdCandidate } from "./types";

export function SettingsMcpSection() {
  const queryClient = useQueryClient();
  const [newMcpServer, setNewMcpServer] = useState<{
    id: string;
    name: string;
    transport: "stdio" | "sse";
    command: string;
    args: string;
    url: string;
    enabled: boolean;
  }>({
    id: "",
    name: "",
    transport: "stdio",
    command: "",
    args: "",
    url: "",
    enabled: true,
  });

  const mcpIntegrationsQuery = useQuery({
    queryKey: ["settings-integrations", "mcp"],
    queryFn: getMcpIntegrations,
    refetchInterval: 5000,
  });
  const lspIntegrationsQuery = useQuery({
    queryKey: ["settings-integrations", "lsp"],
    queryFn: getLspIntegrations,
    refetchInterval: 5000,
  });

  const mcpServers = mcpIntegrationsQuery.data?.items ?? [];
  const lspServers = lspIntegrationsQuery.data?.items ?? [];
  const connectedMcpServers = mcpServers.filter((server) => server.connected);
  const runningLspServers = lspServers.filter((server) => server.running);

  const invalidateIntegrationQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["settings-integrations", "mcp"] });
    queryClient.invalidateQueries({ queryKey: ["settings-integrations", "lsp"] });
  };
  const upsertMcpIntegrationMutation = useMutation({
    mutationFn: createOrUpdateMcpIntegration,
    onSuccess: () => {
      invalidateIntegrationQueries();
      setNewMcpServer({
        id: "",
        name: "",
        transport: "stdio",
        command: "",
        args: "",
        url: "",
        enabled: true,
      });
      toast.success("MCP server saved");
    },
    onError: () => toast.error("Failed to save MCP server"),
  });
  const patchMcpIntegrationMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof patchMcpIntegration>[1] }) =>
      patchMcpIntegration(id, patch),
    onSuccess: invalidateIntegrationQueries,
  });
  const connectMcpIntegrationMutation = useMutation({
    mutationFn: connectMcpIntegration,
    onSuccess: () => {
      invalidateIntegrationQueries();
      toast.success("MCP server connected");
    },
    onError: () => toast.error("Failed to connect MCP server"),
  });
  const disconnectMcpIntegrationMutation = useMutation({
    mutationFn: disconnectMcpIntegration,
    onSuccess: () => {
      invalidateIntegrationQueries();
      toast("MCP server disconnected");
    },
  });
  const deleteMcpIntegrationMutation = useMutation({
    mutationFn: deleteMcpIntegration,
    onSuccess: () => {
      invalidateIntegrationQueries();
      toast("MCP server removed");
    },
  });

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_0.85fr]">
      <Panel>
        <PanelHeader title="Model Context Protocol">
          <Chip variant={connectedMcpServers.length > 0 ? "ok" : "subtle"}>
            {connectedMcpServers.length}/{mcpServers.length || 0} connected
          </Chip>
        </PanelHeader>
        <div className="space-y-4 p-4">
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-white">Registered servers</div>
                <div className="mt-1 text-xs text-zinc-500">
                  These servers feed MCP tools into the same agentic runtime and mission surfaces. Enable a server to keep it eligible for connection, then connect it live from here.
                </div>
              </div>
              <Chip variant="subtle">agent runtime</Chip>
            </div>
            <div className="space-y-3">
              {mcpServers.map((server) => (
                <article key={server.id} className="rounded-xl border border-white/10 bg-black/20 p-3 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-zinc-100">{server.name}</div>
                      <div className="mt-1 text-xs text-zinc-500">{server.id} · {server.transport}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {server.connected ? <Chip variant="ok">connected</Chip> : <Chip variant="subtle">offline</Chip>}
                      {server.enabled ? <Chip variant="ok">enabled</Chip> : <Chip variant="stop">disabled</Chip>}
                      {server.healthStatus ? (
                        <Chip
                          variant={
                            server.healthStatus === "healthy"
                              ? "ok"
                              : server.healthStatus === "failed"
                              ? "stop"
                              : "warn"
                          }
                        >
                          {server.healthStatus}
                        </Chip>
                      ) : null}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
                    <label className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-zinc-300">
                      <span>Enabled for agent runs</span>
                      <input
                        type="checkbox"
                        checked={server.enabled}
                        onChange={(event) =>
                          patchMcpIntegrationMutation.mutate({
                            id: server.id,
                            patch: { enabled: event.target.checked },
                          })
                        }
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        server.connected
                          ? disconnectMcpIntegrationMutation.mutate(server.id)
                          : connectMcpIntegrationMutation.mutate(server.id)
                      }
                      disabled={!server.enabled}
                      className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-200 disabled:opacity-40"
                    >
                      {server.connected ? "Disconnect" : "Connect"}
                    </button>
                    <button
                      type="button"
                      onClick={() => connectMcpIntegrationMutation.mutate(server.id)}
                      disabled={!server.enabled}
                      className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100 disabled:opacity-40"
                    >
                      Reconnect
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteMcpIntegrationMutation.mutate(server.id)}
                      className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100"
                    >
                      Remove
                    </button>
                  </div>

                  <div className="space-y-1 text-xs text-zinc-400">
                    {server.transport === "stdio" ? (
                      <div>Command: <code>{[server.command, ...(server.args ?? [])].filter(Boolean).join(" ") || "not set"}</code></div>
                    ) : (
                      <div>URL: <code>{server.url || "not set"}</code></div>
                    )}
                    <div>Tools: {server.toolCount} · Resources: {server.resourceCount} · Env keys: {server.envKeys.length}</div>
                    {server.lastConnected ? <div>Last connected: {new Date(server.lastConnected).toLocaleString()}</div> : null}
                    {server.error ? <div className="text-rose-300">Last error: {server.error}</div> : null}
                  </div>
                </article>
              ))}
              {mcpServers.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 bg-black/20 p-4 text-xs text-zinc-500">
                  No MCP servers configured yet. Add a stdio or SSE server below to expose its tools to agentic runs.
                </div>
              ) : null}
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
            <div className="text-sm font-medium text-white">Add MCP server</div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <LabeledInput
                label="Display name"
                value={newMcpServer.name}
                onChange={(value) =>
                  setNewMcpServer((current) => ({
                    ...current,
                    name: value,
                    id: current.id || toMcpServerIdCandidate(value),
                  }))
                }
                placeholder="GitHub tools"
              />
              <LabeledInput
                label="Server id"
                value={newMcpServer.id}
                onChange={(value) => setNewMcpServer((current) => ({ ...current, id: value }))}
                placeholder="github-tools"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[140px_1fr]">
              <label className="space-y-1 block">
                <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Transport</div>
                <select
                  value={newMcpServer.transport}
                  onChange={(event) =>
                    setNewMcpServer((current) => ({
                      ...current,
                      transport: event.target.value as "stdio" | "sse",
                    }))
                  }
                  className="w-full rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-200"
                >
                  <option value="stdio">stdio</option>
                  <option value="sse">sse</option>
                </select>
              </label>
              {newMcpServer.transport === "stdio" ? (
                <LabeledInput
                  label="Command"
                  value={newMcpServer.command}
                  onChange={(value) => setNewMcpServer((current) => ({ ...current, command: value }))}
                  placeholder="npx"
                />
              ) : (
                <LabeledInput
                  label="SSE URL"
                  value={newMcpServer.url}
                  onChange={(value) => setNewMcpServer((current) => ({ ...current, url: value }))}
                  placeholder="http://127.0.0.1:3001/sse"
                />
              )}
            </div>
            {newMcpServer.transport === "stdio" ? (
              <LabeledInput
                label="Args (space separated)"
                value={newMcpServer.args}
                onChange={(value) => setNewMcpServer((current) => ({ ...current, args: value }))}
                placeholder="--stdio --readonly"
              />
            ) : null}
            <label className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-300">
              <span>Enable immediately</span>
              <input
                type="checkbox"
                checked={newMcpServer.enabled}
                onChange={(event) => setNewMcpServer((current) => ({ ...current, enabled: event.target.checked }))}
              />
            </label>
            <button
              type="button"
              onClick={() =>
                upsertMcpIntegrationMutation.mutate({
                  id: newMcpServer.id.trim() || toMcpServerIdCandidate(newMcpServer.name),
                  name: newMcpServer.name.trim() || "MCP Server",
                  transport: newMcpServer.transport,
                  command: newMcpServer.transport === "stdio" ? newMcpServer.command.trim() : undefined,
                  args:
                    newMcpServer.transport === "stdio"
                      ? newMcpServer.args.split(/\s+/).map((item) => item.trim()).filter(Boolean)
                      : [],
                  url: newMcpServer.transport === "sse" ? newMcpServer.url.trim() : undefined,
                  enabled: newMcpServer.enabled,
                })
              }
              disabled={!newMcpServer.name.trim() || (newMcpServer.transport === "stdio" ? !newMcpServer.command.trim() : !newMcpServer.url.trim())}
              className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              Save MCP server
            </button>
          </div>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Language Server Protocol">
          <Chip variant={runningLspServers.length > 0 ? "ok" : "subtle"}>
            {runningLspServers.length}/{lspServers.length || 0} running
          </Chip>
        </PanelHeader>
        <div className="space-y-3 p-4">
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-xs text-zinc-500">
            LSP-backed diagnostics, definition, references, and symbol lookup start lazily during project-aware runs. This panel shows whether each server binary is available and whether the shared runtime has an active process.
          </div>
          {lspServers.map((server) => (
            <article key={server.language} className="rounded-xl border border-white/10 bg-black/20 p-3 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-zinc-100 capitalize">{server.language}</div>
                  <div className="mt-1 text-xs text-zinc-500">{server.extensions.join(", ")}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {server.binaryAvailable ? <Chip variant="ok">installed</Chip> : <Chip variant="stop">missing</Chip>}
                  {server.running ? <Chip variant="ok">running</Chip> : <Chip variant="subtle">idle</Chip>}
                  {server.initialized ? <Chip variant="ok">initialized</Chip> : null}
                </div>
              </div>
              <div className="space-y-1 text-xs text-zinc-400">
                <div>Command: <code>{server.command.join(" ")}</code></div>
                <div>
                  Capabilities:
                  {" "}
                  {Object.entries(server.capabilities)
                    .filter(([, enabled]) => enabled)
                    .map(([capability]) => capability)
                    .join(", ") || "none"}
                </div>
                {server.worktreePath ? <div>Workspace: <code>{server.worktreePath}</code></div> : null}
                {server.processId ? <div>Process: {server.processId}</div> : null}
                {!server.binaryAvailable ? (
                  <div className="text-amber-300">Install the first command in the chain before LSP tools can start for this language.</div>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </Panel>
    </div>
  );
}
