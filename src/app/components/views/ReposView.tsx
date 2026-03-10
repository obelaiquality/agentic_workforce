import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  activateProjectV5,
  connectGithubProjectV5,
  connectLocalProjectV5,
  getCodeGraphStatusV5,
  getLatestContextPackV5,
  getProjectGuidelinesV5,
  getProjectStateV5,
  importManagedPackV4,
  listBenchmarkProjectsV4,
  listReposV4,
  syncProjectV5,
} from "../../lib/apiClient";
import { listRecentRepoPaths, pickRepoDirectory, rememberRepoPath } from "../../lib/desktopBridge";
import { getRecentRepos, getVisibleRepos } from "../../lib/projectVisibility";
import { useUiStore } from "../../store/uiStore";
import { Chip, Panel, PanelHeader } from "../UI";
import { FolderGit2, Github, Plus, RefreshCw } from "lucide-react";

export function ReposView() {
  const queryClient = useQueryClient();
  const selectedRepoId = useUiStore((state) => state.selectedRepoId);
  const selectedTicketId = useUiStore((state) => state.selectedTicketId);
  const selectedSessionId = useUiStore((state) => state.selectedSessionId);
  const selectedBenchmarkRunId = useUiStore((state) => state.selectedBenchmarkRunId);
  const setSelectedRepoId = useUiStore((state) => state.setSelectedRepoId);
  const setActiveSection = useUiStore((state) => state.setActiveSection);
  const setSelectedTicketId = useUiStore((state) => state.setSelectedTicketId);
  const setSelectedSessionId = useUiStore((state) => state.setSelectedSessionId);
  const setSelectedRunId = useUiStore((state) => state.setSelectedRunId);
  const labsMode = useUiStore((state) => state.labsMode);

  const [search, setSearch] = useState("");
  const [githubOwner, setGithubOwner] = useState("");
  const [githubRepo, setGithubRepo] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [manualPath, setManualPath] = useState("");
  const [showAdvancedConnect, setShowAdvancedConnect] = useState(false);
  const [showAdvancedProjectDetails, setShowAdvancedProjectDetails] = useState(false);
  const [packKey, setPackKey] = useState("react-dashboard-lite");

  const reposQuery = useQuery({
    queryKey: ["repos-v4"],
    queryFn: listReposV4,
    refetchInterval: 15000,
  });

  const recentFoldersQuery = useQuery({
    queryKey: ["desktop-recent-repos"],
    queryFn: listRecentRepoPaths,
    staleTime: 10000,
  });

  const benchmarkProjectsQuery = useQuery({
    queryKey: ["benchmark-projects-v4"],
    queryFn: listBenchmarkProjectsV4,
    enabled: labsMode,
  });

  const visibleRepos = useMemo(() => getVisibleRepos(reposQuery.data?.items ?? [], labsMode), [reposQuery.data?.items, labsMode]);
  const recentRepos = useMemo(() => getRecentRepos(reposQuery.data?.items ?? [], labsMode), [reposQuery.data?.items, labsMode]);

  useEffect(() => {
    if (!selectedRepoId && recentRepos[0]?.id) {
      setSelectedRepoId(recentRepos[0].id);
    }
  }, [recentRepos, selectedRepoId, setSelectedRepoId]);

  const selectedRepo = useMemo(() => {
    return visibleRepos.find((repo) => repo.id === selectedRepoId) ?? recentRepos[0] ?? null;
  }, [recentRepos, selectedRepoId, visibleRepos]);

  const filteredRepos = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return recentRepos;
    }
    return recentRepos.filter((repo) => {
      return repo.displayName.toLowerCase().includes(query) || repo.sourceUri.toLowerCase().includes(query);
    });
  }, [recentRepos, search]);

  const guidelinesQuery = useQuery({
    queryKey: ["project-guidelines-v5", selectedRepo?.id],
    enabled: Boolean(selectedRepo?.id),
    queryFn: () => getProjectGuidelinesV5(selectedRepo!.id),
  });

  const stateQuery = useQuery({
    queryKey: ["project-state-v5", selectedRepo?.id],
    enabled: Boolean(selectedRepo?.id),
    queryFn: () => getProjectStateV5(selectedRepo!.id),
  });

  const contextPackQuery = useQuery({
    queryKey: ["project-context-pack-v5", selectedRepo?.id],
    enabled: Boolean(selectedRepo?.id),
    queryFn: () => getLatestContextPackV5(selectedRepo!.id),
  });

  const codeGraphQuery = useQuery({
    queryKey: ["project-codegraph-status-v5", selectedRepo?.id],
    enabled: Boolean(selectedRepo?.id),
    queryFn: () => getCodeGraphStatusV5(selectedRepo!.id),
  });

  const connectLocalMutation = useMutation({
    mutationFn: async ({ sourcePath, displayName }: { sourcePath: string; displayName?: string }) => {
      const result = await connectLocalProjectV5({
        actor: "user",
        source_path: sourcePath,
        display_name: displayName || undefined,
      });
      await rememberRepoPath(sourcePath, displayName || result.repo.displayName);
      const activation = await activateProjectV5({
        actor: "user",
        repo_id: result.repo.id,
        state: {
          selectedTicketId,
          selectedRunId: selectedBenchmarkRunId,
          recentChatSessionIds: selectedSessionId ? [selectedSessionId] : [],
        },
      });
      return { result, activation };
    },
    onSuccess: ({ result }) => {
      queryClient.invalidateQueries({ queryKey: ["repos-v4"] });
      queryClient.invalidateQueries({ queryKey: ["project-guidelines-v5"] });
      queryClient.invalidateQueries({ queryKey: ["project-codegraph-status-v5"] });
      queryClient.invalidateQueries({ queryKey: ["desktop-recent-repos"] });
      setSelectedRepoId(result.repo.id);
      setSelectedTicketId(null);
      setSelectedSessionId(null);
      setSelectedRunId(null);
      setActiveSection("overseer");
      setDisplayName("");
      setManualPath("");
    },
  });

  const connectGithubMutation = useMutation({
    mutationFn: async () => {
      const result = await connectGithubProjectV5({
        actor: "user",
        owner: githubOwner,
        repo: githubRepo,
      });
      const activation = await activateProjectV5({
        actor: "user",
        repo_id: result.repo.id,
        state: {
          selectedTicketId,
          selectedRunId: selectedBenchmarkRunId,
          recentChatSessionIds: selectedSessionId ? [selectedSessionId] : [],
        },
      });
      return { result, activation };
    },
    onSuccess: ({ result }) => {
      queryClient.invalidateQueries({ queryKey: ["repos-v4"] });
      setSelectedRepoId(result.repo.id);
      setSelectedTicketId(null);
      setSelectedSessionId(null);
      setSelectedRunId(null);
      setActiveSection("overseer");
      setGithubOwner("");
      setGithubRepo("");
    },
  });

  const syncMutation = useMutation({
    mutationFn: (repoId: string) => syncProjectV5({ actor: "user", repo_id: repoId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repos-v4"] });
      queryClient.invalidateQueries({ queryKey: ["project-codegraph-status-v5", selectedRepo?.id] });
      queryClient.invalidateQueries({ queryKey: ["project-context-pack-v5", selectedRepo?.id] });
    },
  });

  const activateMutation = useMutation({
    mutationFn: (repoId: string) =>
      activateProjectV5({
        actor: "user",
        repo_id: repoId,
        state: {
          selectedRunId: selectedBenchmarkRunId,
          selectedTicketId,
          recentChatSessionIds: selectedSessionId ? [selectedSessionId] : [],
        },
      }),
    onSuccess: ({ repo }) => {
      queryClient.invalidateQueries({ queryKey: ["repos-v4"] });
      setSelectedRepoId(repo.id);
      setSelectedTicketId(null);
      setSelectedSessionId(null);
      setSelectedRunId(null);
      setActiveSection("overseer");
    },
  });

  const importPackMutation = useMutation({
    mutationFn: () => importManagedPackV4({ actor: "user", project_key: packKey }),
    onSuccess: ({ repo }) => {
      queryClient.invalidateQueries({ queryKey: ["repos-v4"] });
      setSelectedRepoId(repo.id);
    },
  });

  const packOptions = benchmarkProjectsQuery.data?.items.filter((item) => item.sourceKind === "managed_pack") || [];
  const allRepos = reposQuery.data?.items ?? [];

  async function handleChooseLocalRepo() {
    const picked = await pickRepoDirectory();
    if (picked.canceled || !picked.path) {
      return;
    }
    const existing = allRepos.find((repo) => repo.sourceKind === "local_path" && repo.sourceUri === picked.path);
    if (existing) {
      activateMutation.mutate(existing.id);
      return;
    }
    connectLocalMutation.mutate({ sourcePath: picked.path, displayName: displayName || undefined });
  }

  function connectRecentPath(sourcePath: string, label?: string) {
    const existing = allRepos.find((repo) => repo.sourceKind === "local_path" && repo.sourceUri === sourcePath);
    if (existing) {
      activateMutation.mutate(existing.id);
      return;
    }
    connectLocalMutation.mutate({ sourcePath, displayName: label || undefined });
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[380px_minmax(0,1fr)] gap-4 min-h-[780px]">
      <div className="space-y-4">
        <Panel>
          <PanelHeader title="Connect Repo">
            <Chip variant="subtle">Local-first</Chip>
          </PanelHeader>
          <div className="p-4 space-y-4">
            <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/8 p-4">
              <div className="text-sm text-white font-medium">Plug in your own repo</div>
              <div className="text-xs text-zinc-400 mt-1">Choose a local Git repo and the app will create a safe working copy automatically.</div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => void handleChooseLocalRepo()}
                  disabled={connectLocalMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  <FolderGit2 className="w-4 h-4" />
                  Choose Local Repo
                </button>
                <button
                  onClick={() => setShowAdvancedConnect((current) => !current)}
                  className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-300"
                >
                  {showAdvancedConnect ? "Hide advanced" : "Advanced"}
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm text-white font-medium">GitHub project</div>
                  <div className="text-xs text-zinc-500 mt-1">GitHub App flow is the intended path. Raw owner/repo fallback stays hidden unless you need it.</div>
                </div>
                <Chip variant="subtle">Hybrid local + remote</Chip>
              </div>
              {showAdvancedConnect ? (
                <div className="mt-3 space-y-2">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <input
                      value={githubOwner}
                      onChange={(event) => setGithubOwner(event.target.value)}
                      placeholder="owner"
                      className="w-full rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-200"
                    />
                    <input
                      value={githubRepo}
                      onChange={(event) => setGithubRepo(event.target.value)}
                      placeholder="repo"
                      className="w-full rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-200"
                    />
                  </div>
                  <button
                    onClick={() => connectGithubMutation.mutate()}
                    disabled={!githubOwner.trim() || !githubRepo.trim() || connectGithubMutation.isPending}
                    className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    <Github className="w-4 h-4" />
                    Connect GitHub Repo
                  </button>
                </div>
              ) : (
                <div className="mt-3 text-xs text-zinc-500">Use local repo connect for now, or open advanced to use the owner/repo fallback.</div>
              )}
            </div>

            {showAdvancedConnect ? (
              <div className="rounded-xl border border-white/10 bg-zinc-950/60 p-4 space-y-2">
                <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Advanced local connect</div>
                <input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Display name (optional)"
                  className="w-full rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-200"
                />
                <input
                  value={manualPath}
                  onChange={(event) => setManualPath(event.target.value)}
                  placeholder="/absolute/path/to/repo"
                  className="w-full rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-200"
                />
                <button
                  onClick={() => connectRecentPath(manualPath, displayName || undefined)}
                  disabled={!manualPath.trim() || connectLocalMutation.isPending}
                  className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-300 disabled:opacity-50"
                >
                  Connect from path
                </button>
              </div>
            ) : null}
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Open Recent">
            <Chip variant="subtle">{Math.min((recentFoldersQuery.data?.length || 0) + recentRepos.length, 8)}</Chip>
          </PanelHeader>
          <div className="p-3 space-y-2">
            {(recentFoldersQuery.data ?? []).slice(0, 4).map((item) => (
              <button
                key={item.path}
                onClick={() => connectRecentPath(item.path, item.label)}
                className="w-full rounded-lg border border-white/10 bg-zinc-950/70 px-3 py-2 text-left hover:bg-white/[0.04]"
              >
                <div className="text-sm text-zinc-100 truncate">{item.label}</div>
                <div className="text-[11px] text-zinc-500 truncate">{item.path}</div>
              </button>
            ))}
            {(recentFoldersQuery.data ?? []).length === 0 && recentRepos.length === 0 ? (
              <div className="text-xs text-zinc-600">No recent repos yet.</div>
            ) : null}
          </div>
        </Panel>

        {labsMode ? (
          <Panel>
            <PanelHeader title="Developer Labs">
              <Chip variant="warn">Hidden from users</Chip>
            </PanelHeader>
            <div className="p-4 space-y-3">
              <div>
                <div className="text-sm text-white font-medium">Demo projects and benchmarks</div>
                <div className="text-xs text-zinc-500 mt-1">These stay out of the normal user flow and live here for internal testing and training work.</div>
              </div>
              {packOptions.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <select
                    value={packKey}
                    onChange={(event) => setPackKey(event.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-200"
                  >
                    {packOptions.map((item) => (
                      <option key={item.projectKey} value={item.projectKey}>
                        {item.displayName}
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <button
                      onClick={() => importPackMutation.mutate()}
                      disabled={importPackMutation.isPending}
                      className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
                    >
                      Import Demo Project
                    </button>
                    <button
                      onClick={() => setActiveSection("benchmarks")}
                      className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-300"
                    >
                      Open Benchmarks Lab
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </Panel>
        ) : null}
      </div>

      <div className="space-y-4">
        <Panel>
          <PanelHeader title="Workspace Summary">
            {selectedRepo ? <Chip variant="ok">{selectedRepo.active ? "active" : "warm"}</Chip> : <Chip variant="subtle">No project</Chip>}
          </PanelHeader>
          <div className="p-4">
            {selectedRepo ? (
              <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1.2fr)_minmax(300px,360px)] gap-4">
                <div className="space-y-4">
                  <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-lg text-white font-semibold truncate">{selectedRepo.displayName}</div>
                        <div className="text-sm text-zinc-500 truncate mt-1">{selectedRepo.sourceUri}</div>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button
                          onClick={() => {
                            activateMutation.mutate(selectedRepo.id);
                          }}
                          className="rounded-lg bg-cyan-600 px-3 py-2 text-xs font-medium text-white"
                        >
                          Open in Overseer
                        </button>
                        <button
                          onClick={() => syncMutation.mutate(selectedRepo.id)}
                          disabled={syncMutation.isPending}
                          className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-300 disabled:opacity-50"
                        >
                          <RefreshCw className="w-3.5 h-3.5 inline mr-1" /> Sync
                        </button>
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-2">
                      <div className="rounded-lg border border-white/8 bg-zinc-950/60 p-3">
                        <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Branch</div>
                        <div className="text-sm text-zinc-100 mt-1">{selectedRepo.branch || selectedRepo.defaultBranch}</div>
                      </div>
                      <div className="rounded-lg border border-white/8 bg-zinc-950/60 p-3">
                        <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Code Graph</div>
                        <div className="text-sm text-zinc-100 mt-1">{codeGraphQuery.data?.item?.status || "not indexed"}</div>
                      </div>
                      <div className="rounded-lg border border-white/8 bg-zinc-950/60 p-3">
                        <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Context Pack</div>
                        <div className="text-sm text-zinc-100 mt-1">{contextPackQuery.data?.item ? `${(contextPackQuery.data.item.confidence * 100).toFixed(0)}% confidence` : "not built yet"}</div>
                      </div>
                      <div className="rounded-lg border border-white/8 bg-zinc-950/60 p-3">
                        <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Last Active</div>
                        <div className="text-sm text-zinc-100 mt-1">{new Date(selectedRepo.lastUsedAt || selectedRepo.updatedAt).toLocaleDateString()}</div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-sm text-white font-medium">Repo guidance</div>
                        <div className="text-xs text-zinc-500 mt-1">The app extracts testing, docs, and review expectations from this repo automatically.</div>
                      </div>
                      <button
                        onClick={() => setShowAdvancedProjectDetails((current) => !current)}
                        className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-300"
                      >
                        {showAdvancedProjectDetails ? "Hide details" : "Details"}
                      </button>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(guidelinesQuery.data?.item?.requiredArtifacts || []).slice(0, 4).map((item) => (
                        <Chip key={item} variant="subtle">{item}</Chip>
                      ))}
                      {(!guidelinesQuery.data?.item?.requiredArtifacts || guidelinesQuery.data.item.requiredArtifacts.length === 0) && (
                        <div className="text-xs text-zinc-600">Guidance will appear after extraction finishes.</div>
                      )}
                    </div>
                    {showAdvancedProjectDetails ? (
                      <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <div className="rounded-lg border border-white/8 bg-zinc-950/60 p-3">
                          <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Guideline sources</div>
                          <div className="mt-2 space-y-1 text-xs text-zinc-400">
                            {(guidelinesQuery.data?.item?.sourceRefs || []).map((item) => (
                              <div key={item} className="truncate">{item}</div>
                            ))}
                          </div>
                        </div>
                        <div className="rounded-lg border border-white/8 bg-zinc-950/60 p-3">
                          <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Advanced state</div>
                          <div className="mt-2 space-y-1 text-xs text-zinc-400">
                            <div>worktree: {stateQuery.data?.item?.activeWorktreePath || "n/a"}</div>
                            <div>recent chats: {stateQuery.data?.item?.recentChatSessionIds.length || 0}</div>
                            <div>code graph nodes: {codeGraphQuery.data?.item?.nodeCount || 0}</div>
                            <div>code graph edges: {codeGraphQuery.data?.item?.edgeCount || 0}</div>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 h-fit">
                  <div className="text-sm text-white font-medium">Recent projects</div>
                  <div className="text-xs text-zinc-500 mt-1">Switch projects without losing warm state.</div>
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search projects"
                    className="mt-3 w-full rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-200"
                  />
                  <div className="mt-3 space-y-2 max-h-[540px] overflow-y-auto custom-scrollbar pr-1">
                    {filteredRepos.map((repo) => (
                      <button
                        key={repo.id}
                        onClick={() => setSelectedRepoId(repo.id)}
                        className={`w-full rounded-lg border p-3 text-left transition-colors ${
                          repo.id === selectedRepo.id ? "border-cyan-400/40 bg-cyan-500/10" : "border-white/10 bg-zinc-950/60 hover:bg-white/[0.04]"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm text-zinc-100 truncate">{repo.displayName}</div>
                            <div className="text-[11px] text-zinc-500 truncate mt-1">{repo.sourceUri}</div>
                          </div>
                          <Chip variant={repo.active ? "ok" : "subtle"}>{repo.active ? "active" : repo.sourceKind.replaceAll("_", " ")}</Chip>
                        </div>
                      </button>
                    ))}
                    {filteredRepos.length === 0 ? <div className="text-xs text-zinc-600">No matching projects.</div> : null}
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-10 text-center">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-200">
                  <Plus className="w-6 h-6" />
                </div>
                <div className="text-xl text-white font-semibold mt-4">Connect your first repo</div>
                <div className="text-sm text-zinc-500 mt-2 max-w-xl mx-auto">
                  Use a local repo first. The app will prepare a safe working copy automatically and drop you straight into Overseer.
                </div>
                <div className="mt-5 flex justify-center gap-2">
                  <button
                    onClick={() => void handleChooseLocalRepo()}
                    disabled={connectLocalMutation.isPending}
                    className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    <FolderGit2 className="w-4 h-4" /> Choose Local Repo
                  </button>
                  <button
                    onClick={() => setShowAdvancedConnect(true)}
                    className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-zinc-300"
                  >
                    <Github className="w-4 h-4 inline mr-2" /> Connect GitHub Repo
                  </button>
                </div>
              </div>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
