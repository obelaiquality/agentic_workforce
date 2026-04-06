import { useQuery } from "@tanstack/react-query";
import { Activity, Server, Cpu, Database, Plug, Stethoscope, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import {
  getDistillReadinessV2,
  listInferenceBackendsV2,
  getMcpIntegrations,
  getLspIntegrations,
  getSettings,
  apiRequest,
  getCacheBreakDiagnostics,
} from "../../lib/apiClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";

type HealthStatus = "connected" | "disconnected" | "degraded" | "unknown";

interface StatusIndicatorProps {
  status: HealthStatus;
  label: string;
}

function StatusIndicator({ status, label }: StatusIndicatorProps) {
  const config = {
    connected: { icon: CheckCircle, className: "text-emerald-400", bgClass: "bg-emerald-500/10" },
    degraded: { icon: AlertCircle, className: "text-amber-400", bgClass: "bg-amber-500/10" },
    disconnected: { icon: XCircle, className: "text-rose-400", bgClass: "bg-rose-500/10" },
    unknown: { icon: AlertCircle, className: "text-zinc-500", bgClass: "bg-zinc-500/10" },
  };

  const { icon: Icon, className, bgClass } = config[status];

  return (
    <div className="flex items-center gap-2">
      <div className={`flex items-center justify-center w-8 h-8 rounded-full ${bgClass}`}>
        <Icon className={`w-4 h-4 ${className}`} />
      </div>
      <div>
        <div className="text-sm font-medium text-zinc-100">{label}</div>
        <div className={`text-xs ${className} capitalize`}>{status.replace('_', ' ')}</div>
      </div>
    </div>
  );
}

export function DiagnosticsView() {
  const { data: backendConnectivity, isLoading: isLoadingBackend } = useQuery({
    queryKey: ["diagnostics-backend"],
    queryFn: async () => {
      try {
        await apiRequest("/api/v8/mission/snapshot");
        return { status: "connected" as HealthStatus };
      } catch {
        return { status: "disconnected" as HealthStatus };
      }
    },
    refetchInterval: 5000,
  });

  const { data: distillReadiness, isLoading: isLoadingDistill } = useQuery({
    queryKey: ["diagnostics-distill"],
    queryFn: async () => {
      try {
        const result = await getDistillReadinessV2();
        return result;
      } catch {
        return null;
      }
    },
  });

  const { data: inferenceBackends, isLoading: isLoadingBackends } = useQuery({
    queryKey: ["diagnostics-backends"],
    queryFn: async () => {
      try {
        const result = await listInferenceBackendsV2();
        return result.items;
      } catch {
        return [];
      }
    },
  });

  const { data: mcpServers, isLoading: isLoadingMcp } = useQuery({
    queryKey: ["diagnostics-mcp"],
    queryFn: async () => {
      try {
        const result = await getMcpIntegrations();
        return result.items;
      } catch {
        return [];
      }
    },
  });

  const { data: lspServers, isLoading: isLoadingLsp } = useQuery({
    queryKey: ["diagnostics-lsp"],
    queryFn: async () => {
      try {
        const result = await getLspIntegrations();
        return result.items;
      } catch {
        return [];
      }
    },
  });

  const { data: settings, isLoading: isLoadingSettings } = useQuery({
    queryKey: ["diagnostics-settings"],
    queryFn: async () => {
      try {
        const result = await getSettings();
        return result.items;
      } catch {
        return null;
      }
    },
  });

  const { data: cacheData, isLoading: isLoadingCache } = useQuery({
    queryKey: ["diagnostics-cache"],
    queryFn: getCacheBreakDiagnostics,
    refetchInterval: 5000,
  });

  const isLoading = isLoadingBackend || isLoadingDistill || isLoadingBackends || isLoadingMcp || isLoadingLsp || isLoadingSettings || isLoadingCache;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="flex items-center gap-2 text-zinc-400">
          <Activity className="w-5 h-5 animate-pulse" />
          <span>Loading diagnostics...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-purple-500/10 border border-purple-500/20">
          <Stethoscope className="w-6 h-6 text-purple-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">System Diagnostics</h1>
          <p className="text-sm text-zinc-400">Monitor the health of all system components</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Backend Connectivity */}
        <Card className="border-white/10 bg-white/[0.02]">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Server className="w-5 h-5 text-cyan-400" />
              <CardTitle className="text-base font-semibold text-white">Backend Connectivity</CardTitle>
            </div>
            <CardDescription className="text-xs text-zinc-500">API server connection status</CardDescription>
          </CardHeader>
          <CardContent>
            <StatusIndicator
              status={backendConnectivity?.status || "unknown"}
              label="API Server"
            />
          </CardContent>
        </Card>

        {/* Local Models */}
        <Card className="border-white/10 bg-white/[0.02]">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Cpu className="w-5 h-5 text-purple-400" />
              <CardTitle className="text-base font-semibold text-white">Local Models</CardTitle>
            </div>
            <CardDescription className="text-xs text-zinc-500">Distillation and model readiness</CardDescription>
          </CardHeader>
          <CardContent>
            {distillReadiness ? (
              <div className="space-y-3">
                <StatusIndicator
                  status={distillReadiness.ready ? "connected" : "disconnected"}
                  label="Distillation Ready"
                />
                {distillReadiness.blockers > 0 && (
                  <div className="text-xs text-rose-400">
                    {distillReadiness.blockers} blocker{distillReadiness.blockers !== 1 ? 's' : ''}
                  </div>
                )}
                {distillReadiness.warnings > 0 && (
                  <div className="text-xs text-amber-400">
                    {distillReadiness.warnings} warning{distillReadiness.warnings !== 1 ? 's' : ''}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-xs text-zinc-500">No distillation status available</div>
            )}
          </CardContent>
        </Card>

        {/* Inference Backends */}
        <Card className="border-white/10 bg-white/[0.02]">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Database className="w-5 h-5 text-emerald-400" />
              <CardTitle className="text-base font-semibold text-white">Inference Backends</CardTitle>
            </div>
            <CardDescription className="text-xs text-zinc-500">
              {inferenceBackends?.length || 0} backend{(inferenceBackends?.length || 0) !== 1 ? 's' : ''} configured
            </CardDescription>
          </CardHeader>
          <CardContent>
            {inferenceBackends && inferenceBackends.length > 0 ? (
              <div className="space-y-3">
                {inferenceBackends.map((backend) => (
                  <div key={backend.id} className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-zinc-200 truncate">{backend.label}</div>
                      <div className="text-xs text-zinc-500 truncate">{backend.baseUrlDefault}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {backend.active && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                          Active
                        </span>
                      )}
                      {backend.running ? (
                        <CheckCircle className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <XCircle className="w-4 h-4 text-zinc-600" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-zinc-500">No inference backends configured</div>
            )}
          </CardContent>
        </Card>

        {/* MCP Servers */}
        <Card className="border-white/10 bg-white/[0.02]">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Plug className="w-5 h-5 text-amber-400" />
              <CardTitle className="text-base font-semibold text-white">MCP Servers</CardTitle>
            </div>
            <CardDescription className="text-xs text-zinc-500">
              {mcpServers?.length || 0} server{(mcpServers?.length || 0) !== 1 ? 's' : ''} configured
            </CardDescription>
          </CardHeader>
          <CardContent>
            {mcpServers && mcpServers.length > 0 ? (
              <div className="space-y-3">
                {mcpServers.map((server) => (
                  <div key={server.id} className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-zinc-200 truncate">{server.name}</div>
                      <div className="text-xs text-zinc-500">
                        {server.transport} • {server.toolCount} tools • {server.resourceCount} resources
                      </div>
                      {server.error && (
                        <div className="text-xs text-rose-400 mt-1 truncate" title={server.error}>
                          Error: {server.error}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {server.enabled && !server.connected && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">
                          Enabled
                        </span>
                      )}
                      {server.connected ? (
                        <CheckCircle className="w-4 h-4 text-emerald-400" />
                      ) : server.enabled ? (
                        <AlertCircle className="w-4 h-4 text-amber-400" />
                      ) : (
                        <XCircle className="w-4 h-4 text-zinc-600" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-zinc-500">No MCP servers configured</div>
            )}
          </CardContent>
        </Card>

        {/* LSP Servers */}
        <Card className="border-white/10 bg-white/[0.02]">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-blue-400" />
              <CardTitle className="text-base font-semibold text-white">LSP Servers</CardTitle>
            </div>
            <CardDescription className="text-xs text-zinc-500">
              {lspServers?.length || 0} language server{(lspServers?.length || 0) !== 1 ? 's' : ''} available
            </CardDescription>
          </CardHeader>
          <CardContent>
            {lspServers && lspServers.length > 0 ? (
              <div className="space-y-3">
                {lspServers.map((server) => (
                  <div key={server.language} className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-zinc-200 capitalize">{server.language}</div>
                      <div className="text-xs text-zinc-500">
                        Extensions: {server.extensions.join(', ')}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {server.binaryAvailable ? (
                        server.running ? (
                          <CheckCircle className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <AlertCircle className="w-4 h-4 text-zinc-500" />
                        )
                      ) : (
                        <XCircle className="w-4 h-4 text-rose-400" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-zinc-500">No LSP servers configured</div>
            )}
          </CardContent>
        </Card>

        {/* System Info */}
        <Card className="border-white/10 bg-white/[0.02]">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Settings className="w-5 h-5 text-zinc-400" />
              <CardTitle className="text-base font-semibold text-white">System Configuration</CardTitle>
            </div>
            <CardDescription className="text-xs text-zinc-500">Active runtime and provider settings</CardDescription>
          </CardHeader>
          <CardContent>
            {settings ? (
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-zinc-400">Runtime Mode</span>
                  <span className="text-sm font-medium text-zinc-200 capitalize">
                    {settings.runtimeMode?.replace('_', ' ') || 'Unknown'}
                  </span>
                </div>
                {settings.executionProfiles && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-zinc-400">Execution Profile</span>
                    <span className="text-sm font-medium text-zinc-200">
                      {settings.executionProfiles.activeProfileId || 'Default'}
                    </span>
                  </div>
                )}
                {settings.onPremQwen && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-zinc-400">On-Prem Backend</span>
                    <span className="text-sm font-medium text-zinc-200">
                      {settings.onPremQwen.inferenceBackendId || 'None'}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-xs text-zinc-500">Settings unavailable</div>
            )}
          </CardContent>
        </Card>

        {/* Cache Performance */}
        <Card className="border-white/10 bg-white/[0.02]">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-indigo-400" />
              <CardTitle className="text-base font-semibold text-white">Cache Performance</CardTitle>
            </div>
            <CardDescription className="text-xs text-zinc-500">Prompt cache hit rate monitoring</CardDescription>
          </CardHeader>
          <CardContent>
            {cacheData ? (
              <div className="space-y-3">
                <StatusIndicator
                  status={
                    cacheData.hitRateEstimate > 0.6
                      ? "connected"
                      : cacheData.hitRateEstimate > 0.3
                      ? "degraded"
                      : "disconnected"
                  }
                  label="Cache Performance"
                />
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-zinc-400">Hit Rate</span>
                    <span className="text-sm font-medium text-zinc-200">
                      {(cacheData.hitRateEstimate * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-zinc-400">Samples</span>
                    <span className="text-sm font-medium text-zinc-200">
                      {cacheData.sampleCount}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-zinc-400">Baseline Tokens</span>
                    <span className="text-sm font-medium text-zinc-200">
                      {cacheData.baselineCacheReadTokens.toLocaleString()}
                    </span>
                  </div>
                </div>
                {cacheData.recentBreaks.length > 0 && (
                  <div className="pt-2 border-t border-white/5">
                    <div className="text-xs font-medium text-zinc-400 mb-2">Recent Cache Breaks</div>
                    <div className="space-y-2">
                      {cacheData.recentBreaks.slice(0, 3).map((breakEvent, idx) => (
                        <div key={idx} className="text-xs">
                          <div className="text-zinc-500">
                            {new Date(breakEvent.timestamp).toLocaleString()}
                          </div>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {breakEvent.possibleCauses.map((cause, causeIdx) => (
                              <span
                                key={causeIdx}
                                className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20"
                              >
                                {cause.replace(/_/g, ' ')}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-xs text-zinc-500">No cache data available</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Refresh notice */}
      <div className="text-xs text-center text-zinc-600">
        Diagnostics auto-refresh every 5 seconds
      </div>
    </div>
  );
}

function Settings(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
