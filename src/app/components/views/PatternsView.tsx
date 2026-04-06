import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Zap, Trophy, TrendingUp, Activity, Clock, Plus, CheckCircle, XCircle } from "lucide-react";
import {
  getLatestInferenceBenchmarksV2,
  getChampionVsChallengerV3,
  getRunSummaryV3,
  getInferenceBenchmarkHistoryV2,
  registerChallengeV3,
  reviewChallengeV3,
} from "../../lib/apiClient";
import { Card } from "../ui/card";
import { Badge } from "../ui/badge";
import { Progress } from "../ui/progress";

export function PatternsView() {
  const queryClient = useQueryClient();
  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [modelPluginId, setModelPluginId] = useState("");
  const [datasetId, setDatasetId] = useState("");
  const [evalRunId, setEvalRunId] = useState("");

  const benchmarksQuery = useQuery({
    queryKey: ["latestBenchmarks"],
    queryFn: () => getLatestInferenceBenchmarksV2(),
  });

  const championQuery = useQuery({
    queryKey: ["championVsChallenger"],
    queryFn: () => getChampionVsChallengerV3(),
  });

  const historyQuery = useQuery({
    queryKey: ["benchmarkHistory"],
    queryFn: () => getInferenceBenchmarkHistoryV2({ limit: 10 }),
  });

  const registerMutation = useMutation({
    mutationFn: (input: { model_plugin_id: string; dataset_id: string; eval_run_id: string }) =>
      registerChallengeV3({
        actor: "user",
        model_plugin_id: input.model_plugin_id,
        dataset_id: input.dataset_id,
        eval_run_id: input.eval_run_id,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["championVsChallenger"] });
      setModelPluginId("");
      setDatasetId("");
      setEvalRunId("");
      setShowRegisterForm(false);
    },
  });

  const reviewMutation = useMutation({
    mutationFn: (input: { candidate_id: string; status: "approved" | "rejected" | "promoted" }) =>
      reviewChallengeV3({
        actor: "user",
        candidate_id: input.candidate_id,
        status: input.status,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["championVsChallenger"] });
    },
  });

  const handleRegisterChallenge = () => {
    if (!modelPluginId || !datasetId || !evalRunId) return;
    registerMutation.mutate({
      model_plugin_id: modelPluginId,
      dataset_id: datasetId,
      eval_run_id: evalRunId,
    });
  };

  if (benchmarksQuery.isLoading) {
    return <div className="p-4 text-sm text-zinc-500">Loading patterns...</div>;
  }

  const latestBenchmarks = benchmarksQuery.data?.items || [];
  const championData = championQuery.data;
  const history = historyQuery.data?.items || [];

  const hasData = latestBenchmarks.length > 0 || championData?.champions.length || championData?.challengers.length || history.length > 0;

  if (!hasData) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 p-8 text-center">
        <Activity className="mx-auto mb-3 h-8 w-8 text-zinc-700" />
        <div className="text-sm text-zinc-400">No pattern data available</div>
        <div className="mt-1 text-xs text-zinc-600">
          Run inference benchmarks or model evaluations to see patterns
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-white/8 bg-black/20 p-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-cyan-400" />
          <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Execution Patterns</div>
        </div>
        <div className="mt-1 text-sm text-zinc-300">
          Model performance and execution analytics
        </div>
      </div>

      {latestBenchmarks.length > 0 && (
        <section className="space-y-3">
          <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">
            Model Performance
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {latestBenchmarks.map((benchmark) => (
              <BenchmarkCard key={`${benchmark.backendId}-${benchmark.profile}`} benchmark={benchmark} />
            ))}
          </div>
        </section>
      )}

      {championData && (championData.champions.length > 0 || championData.challengers.length > 0) && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">
              Champion vs Challenger
            </div>
            <button
              onClick={() => setShowRegisterForm(!showRegisterForm)}
              className="rounded-lg border border-purple-500/20 bg-purple-500/10 px-3 py-1.5 text-xs font-medium text-purple-200 hover:bg-purple-500/16 hover:border-purple-500/30 transition-colors flex items-center gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" />
              Register Challenge
            </button>
          </div>

          {showRegisterForm && (
            <Card className="rounded-xl border border-white/6 bg-black/20 p-4">
              <div className="space-y-3">
                <div className="text-sm font-medium text-zinc-200">Register New Challenger</div>
                <div className="space-y-2">
                  <div>
                    <label className="text-xs text-zinc-500">Model Plugin ID</label>
                    <input
                      type="text"
                      value={modelPluginId}
                      onChange={(e) => setModelPluginId(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-purple-500/30 focus:outline-none focus:ring-1 focus:ring-purple-500/20"
                      placeholder="e.g., qwen-2.5-coder-7b-instruct"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500">Dataset ID</label>
                    <input
                      type="text"
                      value={datasetId}
                      onChange={(e) => setDatasetId(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-purple-500/30 focus:outline-none focus:ring-1 focus:ring-purple-500/20"
                      placeholder="Dataset ID"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500">Eval Run ID</label>
                    <input
                      type="text"
                      value={evalRunId}
                      onChange={(e) => setEvalRunId(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-purple-500/30 focus:outline-none focus:ring-1 focus:ring-purple-500/20"
                      placeholder="Benchmark Run ID (optional)"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleRegisterChallenge}
                    disabled={!modelPluginId || !datasetId || !evalRunId || registerMutation.isPending}
                    className="rounded-lg border border-purple-500/20 bg-purple-500/10 px-4 py-2 text-sm font-medium text-purple-200 hover:bg-purple-500/16 hover:border-purple-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {registerMutation.isPending ? "Registering..." : "Register"}
                  </button>
                  <button
                    onClick={() => setShowRegisterForm(false)}
                    className="rounded-lg border border-white/10 bg-black/20 px-4 py-2 text-sm font-medium text-zinc-400 hover:bg-white/[0.03] hover:border-white/20 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
                {registerMutation.isError && (
                  <div className="text-xs text-red-400">
                    Failed to register challenge: {registerMutation.error instanceof Error ? registerMutation.error.message : "Unknown error"}
                  </div>
                )}
              </div>
            </Card>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            {championData.champions.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-zinc-400 flex items-center gap-1.5">
                  <Trophy className="h-3.5 w-3.5 text-amber-400" />
                  Champions
                </div>
                {championData.champions.map((champion) => (
                  <ChampionCard key={champion.pluginId} champion={champion} />
                ))}
              </div>
            )}
            {championData.challengers.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-zinc-400 flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-purple-400" />
                  Challengers
                </div>
                {championData.challengers.map((challenger) => (
                  <ChallengerCard
                    key={challenger.id}
                    challenger={challenger}
                    onReview={(status) => reviewMutation.mutate({ candidate_id: challenger.id, status })}
                    isReviewing={reviewMutation.isPending}
                  />
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {history.length > 0 && (
        <section className="space-y-3">
          <div className="text-xs uppercase tracking-[0.18em] text-zinc-500 flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5" />
            Benchmark History
          </div>
          <div className="space-y-2">
            {history.map((entry, idx) => (
              <HistoryCard key={`${entry.backendId}-${entry.createdAt}-${idx}`} entry={entry} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function BenchmarkCard({ benchmark }: { benchmark: { backendId: string; profile: string; ttftMsP95: number; outputTokPerSec: number; latencyMsP95: number; errorRate: number; memoryHeadroomPct: number; score: number; selected: boolean } }) {
  return (
    <Card className="rounded-xl border border-white/6 bg-black/20 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className="text-sm font-medium text-zinc-200">{benchmark.backendId}</span>
            <Badge variant="outline" className="text-[10px] border-zinc-700/50 bg-zinc-800/50">
              {benchmark.profile}
            </Badge>
            {benchmark.selected && (
              <Badge className="bg-emerald-500/10 text-emerald-300 border-emerald-500/20 text-[10px]">
                active
              </Badge>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <div className="text-zinc-500">Latency (P95)</div>
              <div className="font-mono text-zinc-300">{benchmark.latencyMsP95.toFixed(0)}ms</div>
            </div>
            <div>
              <div className="text-zinc-500">Throughput</div>
              <div className="font-mono text-zinc-300">{benchmark.outputTokPerSec.toFixed(1)} tok/s</div>
            </div>
            <div>
              <div className="text-zinc-500">TTFT (P95)</div>
              <div className="font-mono text-zinc-300">{benchmark.ttftMsP95.toFixed(0)}ms</div>
            </div>
            <div>
              <div className="text-zinc-500">Score</div>
              <div className="font-mono text-zinc-300">{benchmark.score.toFixed(1)}</div>
            </div>
          </div>

          {benchmark.errorRate > 0 && (
            <div className="mt-2">
              <div className="text-[10px] text-zinc-500 mb-1">Error Rate</div>
              <Progress value={benchmark.errorRate * 100} className="h-1.5" />
              <div className="text-[10px] text-rose-400 mt-0.5">{(benchmark.errorRate * 100).toFixed(1)}%</div>
            </div>
          )}

          {benchmark.memoryHeadroomPct < 30 && (
            <div className="mt-2 flex items-center gap-1.5 text-[10px] text-amber-400">
              <Activity className="h-3 w-3" />
              Low memory headroom ({benchmark.memoryHeadroomPct.toFixed(0)}%)
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function ChampionCard({ champion }: { champion: { pluginId: string; modelId: string; active: boolean; promoted: boolean; paramsB: number; updatedAt: string } }) {
  return (
    <Card className="rounded-lg border border-white/6 bg-black/20 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-zinc-200">{champion.modelId}</span>
            {champion.active && (
              <Badge className="bg-emerald-500/10 text-emerald-300 border-emerald-500/20 text-[10px]">
                active
              </Badge>
            )}
            {champion.promoted && (
              <Badge className="bg-amber-500/10 text-amber-300 border-amber-500/20 text-[10px]">
                promoted
              </Badge>
            )}
          </div>
          <div className="text-[10px] text-zinc-500">
            {champion.paramsB}B params • Updated {new Date(champion.updatedAt).toLocaleDateString()}
          </div>
        </div>
      </div>
    </Card>
  );
}

function ChallengerCard({
  challenger,
  onReview,
  isReviewing,
}: {
  challenger: { id: string; modelPluginId: string; status: string; metrics?: Record<string, unknown>; createdAt: string };
  onReview?: (status: "approved" | "rejected" | "promoted") => void;
  isReviewing?: boolean;
}) {
  const statusColors: Record<string, string> = {
    draft: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
    pending_review: "bg-amber-500/10 text-amber-300 border-amber-500/20",
    approved: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
    rejected: "bg-rose-500/10 text-rose-300 border-rose-500/20",
    promoted: "bg-purple-500/10 text-purple-300 border-purple-500/20",
  };

  const isPending = challenger.status === "pending_review";

  return (
    <Card className="rounded-lg border border-white/6 bg-black/20 p-3">
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-zinc-200">{challenger.modelPluginId}</span>
              <Badge className={statusColors[challenger.status] || statusColors.draft}>
                {challenger.status.replace(/_/g, " ")}
              </Badge>
            </div>
            <div className="text-[10px] text-zinc-500">
              Created {new Date(challenger.createdAt).toLocaleDateString()}
            </div>
            {challenger.metrics && Object.keys(challenger.metrics).length > 0 && (
              <div className="text-[10px] text-zinc-400 mt-1">
                {Object.entries(challenger.metrics).slice(0, 2).map(([key, value]) => (
                  <div key={key}>
                    {key}: {String(value)}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {isPending && onReview && (
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => onReview("approved")}
              disabled={isReviewing}
              className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300 hover:bg-emerald-500/16 hover:border-emerald-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              <CheckCircle className="h-3 w-3" />
              Approve
            </button>
            <button
              onClick={() => onReview("rejected")}
              disabled={isReviewing}
              className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1 text-xs font-medium text-red-300 hover:bg-red-500/16 hover:border-red-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              <XCircle className="h-3 w-3" />
              Reject
            </button>
            <button
              onClick={() => onReview("promoted")}
              disabled={isReviewing}
              className="rounded-lg border border-purple-500/20 bg-purple-500/10 px-3 py-1 text-xs font-medium text-purple-300 hover:bg-purple-500/16 hover:border-purple-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              <Trophy className="h-3 w-3" />
              Promote
            </button>
          </div>
        )}
      </div>
    </Card>
  );
}

function HistoryCard({ entry }: { entry: { backendId: string; profile: string; ttftMsP95: number; outputTokPerSec: number; latencyMsP95: number; score: number; createdAt: string; selected: boolean } }) {
  const date = new Date(entry.createdAt);
  const isRecent = Date.now() - date.getTime() < 24 * 60 * 60 * 1000;

  return (
    <Card className="rounded-lg border border-white/6 bg-black/20 p-3">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-xs font-medium text-zinc-200">{entry.backendId}</span>
            <Badge variant="outline" className="text-[10px] border-zinc-700/50 bg-zinc-800/50">
              {entry.profile}
            </Badge>
            {entry.selected && (
              <Badge className="bg-emerald-500/10 text-emerald-300 border-emerald-500/20 text-[10px]">
                selected
              </Badge>
            )}
            {isRecent && (
              <Badge className="bg-cyan-500/10 text-cyan-300 border-cyan-500/20 text-[10px]">
                recent
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3 text-[10px] text-zinc-500">
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {date.toLocaleString()}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 text-right shrink-0">
          <div>
            <div className="text-[10px] text-zinc-500">Latency</div>
            <div className="font-mono text-xs text-zinc-300">{entry.latencyMsP95.toFixed(0)}ms</div>
          </div>
          <div>
            <div className="text-[10px] text-zinc-500">Tok/s</div>
            <div className="font-mono text-xs text-zinc-300">{entry.outputTokPerSec.toFixed(1)}</div>
          </div>
          <div>
            <div className="text-[10px] text-zinc-500">Score</div>
            <div className="font-mono text-xs text-zinc-300">{entry.score.toFixed(1)}</div>
          </div>
        </div>
      </div>
    </Card>
  );
}
