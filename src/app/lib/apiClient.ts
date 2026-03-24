import type {
  ApprovalRequestDto,
  AgentLane,
  AuditEventDto,
  BackendBenchmarkResult,
  DistillDatasetDto,
  DistillEvalRun,
  DistillExample,
  DistillQuotaState,
  DistillReadinessStatus,
  DistillReviewDecision,
  DistillRun,
  DistillRunLogEntry,
  DistillTeacherRateLimitConfig,
  DistillTrainingStartResult,
  BenchmarkProject,
  BenchmarkRun,
  BenchmarkScorecard,
  BenchmarkTask,
  ChannelEventRecord,
  ChatMessageDto,
  ChatSessionDto,
  ChallengeCandidate,
  CodeFilePayload,
  CodeFileDiffPayload,
  CodeGraphEdge,
  CodeGraphNode,
  CodebaseTreeNode,
  ConsoleEvent,
  ContextManifest,
  ContextPack,
  DomainEvent,
  ExperimentalChannelsConfig,
  ExecutionAttempt,
  ExecutionProfileSettings,
  ExecutionRunSummary,
  GitHubRepoBinding,
  InferenceAutotuneResult,
  KnowledgeHit,
  MemoryRecord,
  MergeReport,
  MissionActionCapabilities,
  MissionControlSnapshot,
  PolicyDecision,
  ProjectBlueprint,
  ProjectBinding,
  ProjectStarterDefinition,
  ProjectStarterId,
  ProviderBudgetState,
  ProviderDescriptor,
  ProviderId,
  QwenAccountAuthSession,
  QwenAccountProfile,
  RepoGuidelineProfile,
  RepoIndexSnapshot,
  RepoRegistration,
  RepoStateCapsule,
  ScaffoldExecutionResult,
  ScaffoldPlan,
  RetrievalTrace,
  RoutingDecision,
  ShareableRunReport,
  SubagentActivityRecord,
  Ticket,
  TaskLifecycleStatus,
  TaskAllocation,
  TicketCommentThread,
  TicketExecutionPolicy,
  ToolInvocationEvent,
  V2CommandLogItem,
  V2PolicyPendingItem,
  V2TaskBoard,
  VerificationBundle,
  WorkflowCardSummary,
  WorkflowMoveRequest,
  WorkflowStatusPillar,
  WorkflowTaskDetail,
  WorkflowStateRecord,
  OnPremInferenceBackendDescriptor,
  OnPremQwenModelPlugin,
  OutcomeEvidence,
  OnPremRoleRuntimeStatus,
  OnPremRoleRuntimeTestResult,
} from "../../shared/contracts";
import { getDesktopBridge } from "./desktopBridge";

interface ApiConfig {
  baseUrl: string;
}

export interface ApiEventStream {
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  close(): void;
}

type DesktopApiResponse = {
  ok: boolean;
  status: number;
  body?: unknown;
  text?: string;
};

type DesktopApiRequest = {
  method?: string;
  path: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
};

let cachedConfig: ApiConfig | null = null;

async function resolveApiConfig(): Promise<ApiConfig> {
  if (cachedConfig) {
    return cachedConfig;
  }

  cachedConfig = {
    baseUrl: import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8787",
  };
  return cachedConfig;
}

function withQuery(path: string, query?: Record<string, string | number | boolean | null | undefined>) {
  if (!query || Object.keys(query).length === 0) {
    return path;
  }
  const url = new URL(path, "http://local");
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return `${url.pathname}${url.search}`;
}

function parseDesktopError(response: DesktopApiResponse) {
  if (typeof response.body === "object" && response.body && "error" in (response.body as Record<string, unknown>)) {
    const error = (response.body as Record<string, unknown>).error;
    if (typeof error === "string" && error.trim()) {
      return error;
    }
  }
  if (typeof response.text === "string" && response.text.trim()) {
    return response.text;
  }
  return `API request failed with ${response.status}`;
}

async function desktopApiRequest<T>(request: DesktopApiRequest): Promise<T> {
  const desktopBridge = getDesktopBridge();
  const response = await desktopBridge!.apiRequest({
    ...request,
    path: withQuery(request.path, request.query),
  });

  if (!response.ok) {
    throw new Error(parseDesktopError(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.body as T;
}

async function browserApiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const config = await resolveApiConfig();
  const token = import.meta.env.VITE_API_TOKEN || "";
  if (!token) {
    throw new Error("VITE_API_TOKEN is required when running the web preview outside Electron.");
  }

  const response = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-local-api-token": token,
      ...(init?.headers || {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `API request failed with ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const desktopBridge = getDesktopBridge();
  if (desktopBridge?.apiRequest) {
    return desktopApiRequest<T>({
      method: init?.method,
      path,
      body:
        typeof init?.body === "string"
          ? JSON.parse(init.body)
          : init?.body !== undefined
          ? init.body
          : undefined,
      headers: init?.headers ? Object.fromEntries(new Headers(init.headers).entries()) : undefined,
    });
  }
  return browserApiRequest<T>(path, init);
}

function createStreamEvent(data: string) {
  if (typeof MessageEvent !== "undefined") {
    return new MessageEvent("message", { data });
  }
  return { data } as MessageEvent;
}

class LocalEventStream implements ApiEventStream {
  private readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  private readonly cleanupCallbacks: Array<() => void> = [];
  private closed = false;

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const bucket = this.listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>();
    bucket.add(listener);
    this.listeners.set(type, bucket);
  }

  onCleanup(callback: () => void) {
    this.cleanupCallbacks.push(callback);
  }

  emit(type: string, data: string) {
    if (this.closed) return;
    const event = createStreamEvent(data);
    for (const listener of this.listeners.get(type) ?? []) {
      if (typeof listener === "function") {
        listener(event);
      } else {
        listener.handleEvent(event);
      }
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    while (this.cleanupCallbacks.length) {
      const callback = this.cleanupCallbacks.pop();
      callback?.();
    }
    this.listeners.clear();
  }
}

async function openDesktopEventStream(path: string, query?: Record<string, string | number | boolean | null | undefined>) {
  const desktopBridge = getDesktopBridge();
  const stream = new LocalEventStream();
  const { streamId } = await desktopBridge!.openStream({
    path,
    query,
  });
  const unsubscribe = desktopBridge!.onStreamEvent(streamId, ({ event, data }) => {
    if (event === "__close__") {
      stream.close();
      return;
    }
    if (event === "__error__") {
      stream.emit("error", data);
      stream.close();
      return;
    }
    stream.emit(event, data);
  });
  stream.onCleanup(() => {
    unsubscribe();
    void desktopBridge!.closeStream(streamId);
  });
  return stream;
}

async function openBrowserEventStream(path: string, query?: Record<string, string | number | boolean | null | undefined>) {
  const stream = new LocalEventStream();
  const controller = new AbortController();
  stream.onCleanup(() => controller.abort());

  const config = await resolveApiConfig();
  const token = import.meta.env.VITE_API_TOKEN || "";
  if (!token) {
    throw new Error("VITE_API_TOKEN is required when running the web preview outside Electron.");
  }

  const url = withQuery(path, query);
  const response = await fetch(`${config.baseUrl}${url}`, {
    method: "GET",
    headers: {
      accept: "text/event-stream",
      "x-local-api-token": token,
    },
    signal: controller.signal,
  });

  if (!response.ok || !response.body) {
    const text = await response.text();
    throw new Error(text || `Failed to open stream (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  void (async () => {
    let buffer = "";
    let eventName = "message";
    let dataLines: string[] = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line) {
            if (dataLines.length > 0) {
              stream.emit(eventName, dataLines.join("\n"));
            }
            eventName = "message";
            dataLines = [];
            continue;
          }
          if (line.startsWith("event:")) {
            eventName = line.slice(6).trim() || "message";
            continue;
          }
          if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trimStart());
          }
        }
      }
      if (dataLines.length > 0) {
        stream.emit(eventName, dataLines.join("\n"));
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        stream.emit("error", error instanceof Error ? error.message : "Stream failed");
      }
    } finally {
      stream.close();
    }
  })();

  return stream;
}

async function openApiEventStream(path: string, query?: Record<string, string | number | boolean | null | undefined>) {
  const desktopBridge = getDesktopBridge();
  if (desktopBridge?.openStream) {
    return openDesktopEventStream(path, query);
  }
  return openBrowserEventStream(path, query);
}

export async function listProviders() {
  return apiRequest<{ activeProvider: ProviderId; providers: ProviderDescriptor[] }>("/api/v1/providers");
}

export async function setActiveProvider(providerId: ProviderId) {
  return apiRequest<{ ok: true; requiresApproval?: boolean; approvalId?: string }>("/api/v1/providers/active", {
    method: "POST",
    body: JSON.stringify({ providerId }),
  });
}

export async function activateProviderV2(providerId: ProviderId, actor = "user") {
  return apiRequest<{
    command_id: string;
    status: "activated" | "approval_required" | "rejected";
    policy: PolicyDecision;
    approval_id?: string;
  }>("/api/v2/commands/provider.activate", {
    method: "POST",
    body: JSON.stringify({ provider_id: providerId, actor }),
  });
}

export async function listQwenAccounts() {
  return apiRequest<{ items: QwenAccountProfile[] }>("/api/v1/providers/qwen/accounts");
}

export async function listOnPremQwenPlugins() {
  return apiRequest<{ items: OnPremQwenModelPlugin[] }>("/api/v1/providers/onprem/plugins");
}

export async function listOnPremInferenceBackends() {
  return apiRequest<{ items: OnPremInferenceBackendDescriptor[] }>("/api/v1/providers/onprem/backends");
}

export async function listOnPremRoleRuntimes() {
  return apiRequest<{ items: OnPremRoleRuntimeStatus[] }>("/api/v1/providers/onprem/role-runtimes");
}

export async function testOnPremRoleRuntime(input: {
  actor: string;
  role: "utility_fast" | "coder_default" | "review_deep";
}) {
  return apiRequest<{ item: OnPremRoleRuntimeTestResult }>("/api/v1/providers/onprem/role-runtimes/test", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function startOnPremRoleRuntime(input: {
  actor: string;
  role: "utility_fast" | "coder_default" | "review_deep";
}) {
  return apiRequest<{ ok: boolean; role: string; started: boolean; alreadyRunning?: boolean; pid?: number | null; reason?: string }>(
    "/api/v1/providers/onprem/role-runtimes/start",
    {
      method: "POST",
      body: JSON.stringify(input),
    }
  );
}

export async function stopOnPremRoleRuntime(input: {
  actor: string;
  role: "utility_fast" | "coder_default" | "review_deep";
}) {
  return apiRequest<{ ok: boolean; role: string; stopped: boolean }>("/api/v1/providers/onprem/role-runtimes/stop", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function startEnabledOnPremRoleRuntimes(actor = "user") {
  return apiRequest<{ ok: boolean; started: Array<Record<string, unknown>> }>("/api/v1/providers/onprem/role-runtimes/start-enabled", {
    method: "POST",
    body: JSON.stringify({ actor }),
  });
}

export async function createQwenAccount(input: { label: string; profilePath: string; keychainRef?: string }) {
  return apiRequest<{ ok: true; item: QwenAccountProfile }>("/api/v1/providers/qwen/accounts", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function bootstrapQwenAccount(input: { label: string; importCurrentAuth?: boolean }) {
  return apiRequest<{ ok: true; item: QwenAccountProfile }>("/api/v1/providers/qwen/accounts/bootstrap", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateQwenAccount(id: string, patch: Partial<QwenAccountProfile>) {
  return apiRequest<{ ok: true; item: QwenAccountProfile }>(`/api/v1/providers/qwen/accounts/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function reauthQwenAccount(id: string) {
  return apiRequest<{ ok: true; item: QwenAccountProfile }>(`/api/v1/providers/qwen/accounts/${id}/reauth`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function startQwenAccountAuth(id: string) {
  return apiRequest<{ ok: true; item: QwenAccountAuthSession }>(`/api/v1/providers/qwen/accounts/${id}/auth/start`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function listQwenAccountAuthSessions() {
  return apiRequest<{ items: QwenAccountAuthSession[] }>("/api/v1/providers/qwen/accounts/auth-sessions");
}

export async function listQuotaStatus() {
  return apiRequest<{ items: QwenAccountProfile[] }>("/api/v1/providers/qwen/quota");
}

export async function listChatSessions(repoId?: string) {
  const suffix = repoId ? `?repoId=${encodeURIComponent(repoId)}` : "";
  return apiRequest<{ items: ChatSessionDto[] }>(`/api/v1/chat/sessions${suffix}`);
}

export async function createChatSession(title: string, repoId?: string) {
  return apiRequest<{ ok: true; item: ChatSessionDto }>("/api/v1/chat/sessions", {
    method: "POST",
    body: JSON.stringify({ title, repoId }),
  });
}

export async function listMessages(sessionId: string) {
  return apiRequest<{ items: ChatMessageDto[] }>(`/api/v1/chat/sessions/${sessionId}/messages`);
}

export async function sendMessage(sessionId: string, content: string) {
  return apiRequest<{ ok: true; item: ChatMessageDto }>(`/api/v1/chat/sessions/${sessionId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

export async function sendMessageWithRole(
  sessionId: string,
  content: string,
  modelRole: "utility_fast" | "coder_default" | "review_deep" | "overseer_escalation"
) {
  return apiRequest<{ ok: true; item: ChatMessageDto }>(`/api/v1/chat/sessions/${sessionId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content, modelRole }),
  });
}

export async function openSessionStream(sessionId: string) {
  return openApiEventStream(`/api/v1/chat/sessions/${sessionId}/stream`);
}

export async function listTickets(repoId?: string) {
  const suffix = repoId ? `?repoId=${encodeURIComponent(repoId)}` : "";
  return apiRequest<{ items: Ticket[] }>(`/api/v1/tickets${suffix}`);
}

export async function createTicket(input: Partial<Ticket> & { title: string; repoId?: string | null }) {
  return apiRequest<{ ok: true; item: Ticket }>("/api/v1/tickets", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateTicket(id: string, patch: Partial<Ticket>) {
  return apiRequest<{ ok: true; item: Ticket }>(`/api/v1/tickets/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function moveTicket(id: string, status: Ticket["status"]) {
  return apiRequest<{ ok: true; item: Ticket }>(`/api/v1/tickets/${id}/move`, {
    method: "POST",
    body: JSON.stringify({ status }),
  });
}

export async function listTicketComments(ticketId: string) {
  return apiRequest<{ items: TicketCommentThread[] }>(`/api/v1/tickets/${ticketId}/comments`);
}

export async function addTicketComment(
  ticketId: string,
  input: { author?: string; body: string; parentCommentId?: string | null }
) {
  return apiRequest<{ ok: true; item: TicketCommentThread }>(
    `/api/v1/tickets/${ticketId}/comments`,
    {
      method: "POST",
      body: JSON.stringify(input),
    }
  );
}

export async function getBoard(repoId?: string) {
  const suffix = repoId ? `?repoId=${encodeURIComponent(repoId)}` : "";
  return apiRequest<{ items: Record<Ticket["status"], Ticket[]> }>(`/api/v1/board${suffix}`);
}

export async function getBoardV2(repoId?: string) {
  const suffix = repoId ? `?repoId=${encodeURIComponent(repoId)}` : "";
  return apiRequest<V2TaskBoard>(`/api/v2/tasks/board${suffix}`);
}

export async function intakeTaskV2(input: {
  strategy: "weighted-random-next" | "deterministic-next";
  actor: string;
  seed?: string;
  reservation_ttl_seconds?: number;
}) {
  return apiRequest<{
    command_id: string;
    decision: PolicyDecision;
    allocation: TaskAllocation | null;
  }>("/api/v2/commands/task.intake", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function reserveTaskV2(input: { ticket_id: string; actor: string; reservation_ttl_seconds?: number }) {
  return apiRequest<{ command_id: string; reservation_expires_at: string }>("/api/v2/commands/task.reserve", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function transitionTaskV2(input: {
  ticket_id: string;
  actor: string;
  status: TaskLifecycleStatus;
  risk_level?: "low" | "medium" | "high";
}) {
  return apiRequest<{
    command_id: string;
    decision: PolicyDecision;
    transitioned: boolean;
  }>("/api/v2/commands/task.transition", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function requestExecutionV2(input: {
  ticket_id: string;
  repo_id?: string;
  actor: string;
  prompt: string;
  retrieval_context_ids: string[];
  workspace_path?: string;
  risk_level?: "low" | "medium" | "high";
  routing_decision_id?: string;
  model_role?: "utility_fast" | "coder_default" | "review_deep" | "overseer_escalation";
  provider_id?: "qwen-cli" | "openai-compatible" | "onprem-qwen" | "openai-responses";
}) {
  return apiRequest<{
    command_id: string;
    run_id: string;
    policy: PolicyDecision;
    status: "queued" | "approval_required" | "rejected";
    approval_id?: string;
    routing_decision_id?: string | null;
    model_role?: "utility_fast" | "coder_default" | "review_deep" | "overseer_escalation";
    provider_id?: "qwen-cli" | "openai-compatible" | "onprem-qwen" | "openai-responses";
  }>("/api/v2/commands/execution.request", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function policyDecideV2(input: {
  action_type: string;
  actor: string;
  risk_level?: "low" | "medium" | "high";
  workspace_path?: string;
  payload?: Record<string, unknown>;
  dry_run?: boolean;
  aggregate_id?: string;
}) {
  return apiRequest<{
    command_id: string;
    decision: PolicyDecision;
  }>("/api/v2/commands/policy.decide", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function runInferenceAutotuneV2(input: {
  actor: string;
  profile?: "interactive" | "batch" | "tool_heavy";
  dry_run?: boolean;
}) {
  return apiRequest<InferenceAutotuneResult>("/api/v2/commands/inference.autotune", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function startInferenceBackendV2(input: {
  actor: string;
  backend_id:
    | "mlx-lm"
    | "sglang"
    | "vllm-openai"
    | "trtllm-openai"
    | "llama-cpp-openai"
    | "transformers-openai"
    | "ollama-openai";
}) {
  return apiRequest<{ ok: boolean; backendId: string; pid: number | null; command: string }>(
    "/api/v2/commands/inference.backend.start",
    {
      method: "POST",
      body: JSON.stringify(input),
    }
  );
}

export async function stopInferenceBackendV2(input: {
  actor: string;
  backend_id:
    | "mlx-lm"
    | "sglang"
    | "vllm-openai"
    | "trtllm-openai"
    | "llama-cpp-openai"
    | "transformers-openai"
    | "ollama-openai";
}) {
  return apiRequest<{ ok: boolean; backendId: string; stopped: boolean }>("/api/v2/commands/inference.backend.stop", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function switchInferenceBackendV2(input: {
  actor: string;
  backend_id:
    | "mlx-lm"
    | "sglang"
    | "vllm-openai"
    | "trtllm-openai"
    | "llama-cpp-openai"
    | "transformers-openai"
    | "ollama-openai";
}) {
  return apiRequest<{ ok: boolean; backendId: string; baseUrl: string }>("/api/v2/commands/inference.backend.switch", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function listInferenceBackendsV2() {
  return apiRequest<{
    items: Array<
      OnPremInferenceBackendDescriptor & {
        active: boolean;
        running: boolean;
        commandAvailable: boolean;
      }
    >;
  }>("/api/v2/inference/backends");
}

export async function getLatestInferenceBenchmarksV2(profile?: "interactive" | "batch" | "tool_heavy") {
  const query = profile ? `?profile=${encodeURIComponent(profile)}` : "";
  return apiRequest<{ items: BackendBenchmarkResult[] }>(`/api/v2/inference/benchmarks/latest${query}`);
}

export async function getInferenceBenchmarkHistoryV2(input?: { profile?: "interactive" | "batch" | "tool_heavy"; limit?: number }) {
  const params = new URLSearchParams();
  if (input?.profile) params.set("profile", input.profile);
  if (typeof input?.limit === "number") params.set("limit", String(input.limit));
  const query = params.toString() ? `?${params.toString()}` : "";
  return apiRequest<{ items: BackendBenchmarkResult[] }>(`/api/v2/inference/benchmarks/history${query}`);
}

export async function listModelPluginsV2() {
  return apiRequest<{
    items: Array<
      OnPremQwenModelPlugin & {
        active: boolean;
        promoted: boolean;
      }
    >;
  }>("/api/v2/model/plugins");
}

export async function activateModelPluginV2(input: { actor: string; plugin_id: string }) {
  return apiRequest<{ ok: true; plugin: OnPremQwenModelPlugin }>("/api/v2/commands/model.plugin.activate", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function generateDistillDatasetV2(input: {
  actor: string;
  title: string;
  sample_count: number;
  retrieval_context_ids: string[];
  model?: string;
}) {
  return apiRequest<{
    status: "generated" | "rejected";
    dataset?: DistillDatasetDto;
    examples?: DistillExample[];
    policy?: PolicyDecision;
  }>("/api/v2/commands/distill.dataset.generate", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function reviewDistillDatasetV2(input: {
  actor: string;
  dataset_id: string;
  decisions: Array<{ example_id: string; decision: DistillReviewDecision; note?: string }>;
}) {
  return apiRequest<{
    dataset: DistillDatasetDto;
  }>("/api/v2/commands/distill.dataset.review", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function startDistillTrainingV2(input: {
  actor: string;
  dataset_id: string;
  stage: "sft" | "orpo" | "tool_rl";
  student_model_id: string;
}) {
  return apiRequest<DistillTrainingStartResult>("/api/v2/commands/distill.train.start", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function runDistillEvalV2(input: { actor: string; run_id: string; baseline_model_id?: string }) {
  return apiRequest<{ eval: DistillEvalRun }>("/api/v2/commands/distill.eval.run", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function promoteDistillModelV2(input: { actor: string; run_id: string }) {
  return apiRequest<{ run: DistillRun; promotedModelId: string }>("/api/v2/commands/distill.model.promote", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getDistillDatasetV2(id: string) {
  return apiRequest<{ dataset: DistillDatasetDto; examples: DistillExample[] }>(`/api/v2/distill/datasets/${id}`);
}

export async function getDistillRunV2(id: string) {
  return apiRequest<{ run: DistillRun }>(`/api/v2/distill/runs/${id}`);
}

export async function getDistillRunLogsV2(id: string) {
  return apiRequest<{ items: DistillRunLogEntry[] }>(`/api/v2/distill/runs/${id}/logs`);
}

export async function getDistillEvalV2(id: string) {
  return apiRequest<{ eval: DistillEvalRun }>(`/api/v2/distill/evals/${id}`);
}

export async function getDistillQuotaV2() {
  return apiRequest<{ quota: DistillQuotaState; rateLimit: DistillTeacherRateLimitConfig }>(`/api/v2/distill/quota`);
}

export async function getDistillReadinessV2() {
  return apiRequest<DistillReadinessStatus>(`/api/v2/distill/readiness`);
}

export async function listDistillModelsV2() {
  return apiRequest<{
    items: Array<{
      modelId: string;
      promoted: boolean;
      artifacts: string[];
      updatedAt: string;
    }>;
  }>("/api/v2/distill/models");
}

export async function listRecentCommandsV2(limit = 80) {
  return apiRequest<{ items: V2CommandLogItem[] }>(`/api/v2/commands/recent?limit=${limit}`);
}

export async function listPendingPolicyV2() {
  return apiRequest<{ items: V2PolicyPendingItem[] }>("/api/v2/policy/pending");
}

export async function getTaskTimelineV2(ticketId: string) {
  return apiRequest<{ items: DomainEvent[] }>(`/api/v2/tasks/${ticketId}/timeline`);
}

export async function getRunReplayV2(runId: string) {
  return apiRequest<{ items: DomainEvent[] }>(`/api/v2/runs/${runId}/replay`);
}

export async function searchKnowledgeV2(query: string) {
  const encoded = encodeURIComponent(query);
  return apiRequest<{ items: KnowledgeHit[] }>(`/api/v2/knowledge/search?q=${encoded}`);
}

export async function openEventStreamV2() {
  return openApiEventStream("/api/v2/stream");
}

export async function listApprovals() {
  return apiRequest<{ items: ApprovalRequestDto[] }>("/api/v1/approvals");
}

export async function decideApproval(id: string, decision: "approved" | "rejected", reason?: string) {
  return apiRequest<{ ok: true }>(`/api/v1/approvals/${id}/decide`, {
    method: "POST",
    body: JSON.stringify({ decision, reason }),
  });
}

export async function listAuditEvents() {
  return apiRequest<{ items: AuditEventDto[] }>("/api/v1/audit/events");
}

export async function getSettings() {
  return apiRequest<{
    items: {
      safety: Record<string, unknown>;
      qwenCli: {
        command: string;
        args: string[];
        timeoutMs: number;
      };
      onPremQwen: {
        baseUrl: string;
        hasApiKey: boolean;
        apiKeySource: "stored" | "env" | "none";
        inferenceBackendId: string;
        pluginId: string;
        model: string;
        reasoningMode: "off" | "on" | "auto";
        timeoutMs: number;
        temperature: number;
        maxTokens: number;
      };
      onPremQwenRoleRuntimes: Record<string, {
        enabled?: boolean;
        baseUrl?: string;
        hasApiKey?: boolean;
        apiKeySource?: "stored" | "env" | "none";
        inferenceBackendId?: string;
        pluginId?: string;
        model?: string;
        reasoningMode?: "off" | "on" | "auto";
        timeoutMs?: number;
        temperature?: number;
        maxTokens?: number;
      }>;
      openAiCompatible: {
        baseUrl: string;
        hasApiKey: boolean;
        apiKeySource: "stored" | "env" | "none";
        model: string;
        timeoutMs: number;
        temperature: number;
        maxTokens: number;
      };
      openAiResponses: {
        baseUrl: string;
        hasApiKey: boolean;
        apiKeySource: "stored" | "env" | "none";
        model: string;
        timeoutMs: number;
        reasoningEffort: "low" | "medium" | "high";
        dailyBudgetUsd: number;
        perRunBudgetUsd: number;
        toolPolicy: {
          enableFileSearch: boolean;
          enableRemoteMcp: boolean;
        };
      };
      runtimeMode: "local_qwen" | "openai_api";
      modelRoles: Record<string, unknown>;
      executionProfiles: ExecutionProfileSettings;
      parallelRuntime: {
        maxLocalLanes: number;
        maxExpandedLanes: number;
        defaultLaneLeaseMinutes: number;
        heartbeatIntervalSeconds: number;
        staleAfterSeconds: number;
        reservationTtlSeconds: number;
      };
      distill: {
        teacherCommand: string;
        teacherModel: string;
        teacherTimeoutMs: number;
        privacyPolicyVersion: string;
        objectiveSplit: string;
        teacherRateLimit: DistillTeacherRateLimitConfig;
        trainer: {
          backend: string;
          pythonCommand: string;
          maxSteps: number;
          perDeviceBatchSize: number;
          gradientAccumulationSteps: number;
          learningRate: number;
          loraRank: number;
          loraAlpha: number;
          maxSeqLength: number;
          orpoBeta: number;
          toolRewardScale: number;
        };
      };
      experimentalChannels: ExperimentalChannelsConfig;
    };
  }>("/api/v1/settings");
}

export async function updateSettings(input: {
  safety?: Record<string, unknown>;
  qwenCli?: {
    command?: string;
    args?: string[];
    timeoutMs?: number;
  };
  onPremQwen?: {
    baseUrl?: string;
    apiKey?: string;
    clearApiKey?: boolean;
    inferenceBackendId?: string;
    pluginId?: string;
    model?: string;
    reasoningMode?: "off" | "on" | "auto";
    timeoutMs?: number;
    temperature?: number;
    maxTokens?: number;
  };
  onPremQwenRoleRuntimes?: Record<string, {
    enabled?: boolean;
    baseUrl?: string;
    apiKey?: string;
    clearApiKey?: boolean;
    inferenceBackendId?: string;
    pluginId?: string;
    model?: string;
    reasoningMode?: "off" | "on" | "auto";
    timeoutMs?: number;
    temperature?: number;
    maxTokens?: number;
  }>;
  openAiCompatible?: {
    baseUrl?: string;
    apiKey?: string;
    clearApiKey?: boolean;
    model?: string;
    timeoutMs?: number;
    temperature?: number;
    maxTokens?: number;
  };
  openAiResponses?: {
    baseUrl?: string;
    apiKey?: string;
    clearApiKey?: boolean;
    model?: string;
    timeoutMs?: number;
    reasoningEffort?: "low" | "medium" | "high";
    dailyBudgetUsd?: number;
    perRunBudgetUsd?: number;
    toolPolicy?: {
      enableFileSearch?: boolean;
      enableRemoteMcp?: boolean;
    };
  };
  modelRoles?: Record<string, unknown>;
  executionProfiles?: ExecutionProfileSettings;
  parallelRuntime?: {
    maxLocalLanes?: number;
    maxExpandedLanes?: number;
    defaultLaneLeaseMinutes?: number;
    heartbeatIntervalSeconds?: number;
    staleAfterSeconds?: number;
    reservationTtlSeconds?: number;
  };
  distill?: {
    teacherCommand?: string;
    teacherModel?: string;
    teacherTimeoutMs?: number;
    privacyPolicyVersion?: string;
    objectiveSplit?: string;
    teacherRateLimit?: Partial<DistillTeacherRateLimitConfig>;
    trainer?: {
      backend?: string;
      pythonCommand?: string;
      maxSteps?: number;
      perDeviceBatchSize?: number;
      gradientAccumulationSteps?: number;
      learningRate?: number;
      loraRank?: number;
      loraAlpha?: number;
      maxSeqLength?: number;
      orpoBeta?: number;
      toolRewardScale?: number;
    };
  };
  experimentalChannels?: Partial<Omit<ExperimentalChannelsConfig, "webhook" | "telegram" | "ciMonitoring">> & {
    webhook?: Partial<ExperimentalChannelsConfig["webhook"]> & { clearSigningSecret?: boolean };
    telegram?: Partial<ExperimentalChannelsConfig["telegram"]> & { clearSigningSecret?: boolean };
    ciMonitoring?: Partial<ExperimentalChannelsConfig["ciMonitoring"]> & { clearSigningSecret?: boolean };
  };
}) {
  return apiRequest<{ ok: true }>("/api/v1/settings", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function listExperimentalChannelActivity(projectId?: string | null) {
  const suffix = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  return apiRequest<{ items: { channels: ChannelEventRecord[]; subagents: SubagentActivityRecord[] } }>(
    `/api/v1/experimental/channels/activity${suffix}`
  );
}

export async function setRuntimeMode(input: {
  mode: "local_qwen" | "openai_api";
  openAiApiKey?: string;
  openAiModel?: string;
}) {
  return apiRequest<{ ok: true; mode: "local_qwen" | "openai_api" }>("/api/v1/settings/runtime-mode", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function listOpenAiModels() {
  return apiRequest<{
    items: Array<{
      id: string;
      created: number | null;
      ownedBy: string | null;
    }>;
    error?: string;
  }>("/api/v1/openai/models");
}

export async function planRouteV3(input: {
  actor: string;
  repo_id?: string;
  ticket_id?: string;
  run_id?: string;
  prompt: string;
  risk_level?: "low" | "medium" | "high";
  workspace_path?: string;
  retrieval_context_ids?: string[];
  active_files?: string[];
}) {
  return apiRequest<{ item: RoutingDecision }>("/api/v3/commands/router.plan", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function materializeContextV3(input: {
  actor: string;
  repo_id?: string;
  aggregate_id: string;
  aggregate_type: "ticket" | "run" | "lane";
  goal: string;
  query?: string;
  constraints?: string[];
  active_files?: string[];
  retrieval_ids?: string[];
  memory_refs?: string[];
  open_questions?: string[];
  verification_plan?: string[];
  rollback_plan?: string[];
  policy_scopes?: string[];
  metadata?: Record<string, unknown>;
}) {
  return apiRequest<{ context: ContextManifest; retrievalTrace: RetrievalTrace | null }>("/api/v3/commands/context.materialize", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function commitMemoryV3(input: {
  actor: string;
  repo_id?: string;
  aggregate_id: string;
  kind: MemoryRecord["kind"];
  content: string;
  citations?: string[];
  confidence?: number;
  stale_after?: string | null;
  metadata?: Record<string, unknown>;
}) {
  return apiRequest<{ item: MemoryRecord }>("/api/v3/commands/memory.commit", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function spawnAgentLaneV3(input: {
  actor: string;
  repo_id?: string;
  ticket_id: string;
  run_id?: string;
  role: AgentLane["role"];
  context_manifest_id?: string;
  lease_minutes?: number;
  summary?: string;
}) {
  return apiRequest<{ item: AgentLane }>("/api/v3/commands/agent.spawn", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function reclaimAgentLaneV3(input: { actor: string; lane_id?: string; reason?: string }) {
  return apiRequest<{ items: AgentLane[] }>("/api/v3/commands/agent.reclaim", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function prepareMergeV3(input: {
  actor: string;
  repo_id?: string;
  run_id: string;
  changed_files: string[];
  semantic_conflicts?: string[];
  required_checks?: string[];
  overlap_score?: number;
  metadata?: Record<string, unknown>;
}) {
  return apiRequest<{ item: MergeReport }>("/api/v3/commands/run.merge.prepare", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function registerChallengeV3(input: {
  actor: string;
  model_plugin_id: string;
  parent_model_plugin_id?: string | null;
  dataset_id: string;
  eval_run_id: string;
}) {
  return apiRequest<{ item: ChallengeCandidate }>("/api/v3/commands/model.challenge.register", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function reviewChallengeV3(input: {
  actor: string;
  candidate_id: string;
  status: "approved" | "rejected" | "promoted";
}) {
  return apiRequest<{ item: ChallengeCandidate }>("/api/v3/commands/model.challenge.review", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getTaskContextV3(id: string) {
  return apiRequest<{ item: ContextManifest | null; routing: RoutingDecision[] }>(`/api/v3/tasks/${id}/context`);
}

export async function getWorkflowStateV3(id: string) {
  return apiRequest<{ item: WorkflowStateRecord | null }>(`/api/v3/tasks/${id}/workflow-state`);
}

export async function searchMemoryV3(query: string) {
  return apiRequest<{ items: MemoryRecord[] }>(`/api/v3/memory/search?q=${encodeURIComponent(query)}`);
}

export async function listAgentLanesV3(filter?: { ticketId?: string; runId?: string }) {
  const params = new URLSearchParams();
  if (filter?.ticketId) params.set("ticketId", filter.ticketId);
  if (filter?.runId) params.set("runId", filter.runId);
  return apiRequest<{ items: AgentLane[] }>(`/api/v3/agents/lanes${params.toString() ? `?${params.toString()}` : ""}`);
}

export async function getMergeReportV3(runId: string) {
  return apiRequest<{ item: MergeReport | null }>(`/api/v3/runs/${runId}/merge-report`);
}

export async function getRunSummaryV3(runId: string) {
  return apiRequest<{ item: ExecutionRunSummary | null }>(`/api/v3/runs/${runId}/summary`);
}

export async function getRetrievalTraceV3(runId: string) {
  return apiRequest<{ items: RetrievalTrace[] }>(`/api/v3/runs/${runId}/retrieval-trace`);
}

export async function getOpenAiBudgetV3() {
  return apiRequest<{ item: ProviderBudgetState }>(`/api/v3/providers/openai/budget`);
}

export async function getChampionVsChallengerV3() {
  return apiRequest<{
    champions: Array<{
      pluginId: string;
      modelId: string;
      active: boolean;
      promoted: boolean;
      paramsB: number;
      updatedAt: string;
    }>;
    challengers: ChallengeCandidate[];
  }>(`/api/v3/evals/champion-vs-challenger`);
}

export async function listReposV4() {
  return apiRequest<{ items: RepoRegistration[] }>("/api/v4/repos");
}

export async function getActiveRepoV4() {
  return apiRequest<{ item: RepoRegistration | null }>("/api/v4/repos/active");
}

export async function attachLocalRepoV4(input: { actor: string; source_path: string; display_name?: string }) {
  return apiRequest<{
    repo: RepoRegistration;
    guidelines: RepoGuidelineProfile;
    snapshot: RepoIndexSnapshot;
  }>("/api/v4/commands/repo.attach-local", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function cloneRepoV4(input: { actor: string; url: string; display_name?: string; branch?: string }) {
  return apiRequest<{
    repo: RepoRegistration;
    guidelines: RepoGuidelineProfile;
    snapshot: RepoIndexSnapshot;
  }>("/api/v4/commands/repo.clone", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function importManagedPackV4(input: { actor: string; project_key: string; display_name?: string }) {
  return apiRequest<{
    repo: RepoRegistration;
    guidelines: RepoGuidelineProfile;
    snapshot: RepoIndexSnapshot;
  }>("/api/v4/commands/repo.register", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function activateRepoV4(input: {
  actor: string;
  repo_id: string;
  state?: {
    activeBranch?: string;
    activeWorktreePath?: string;
    selectedTicketId?: string | null;
    selectedRunId?: string | null;
    recentChatSessionIds?: string[];
    lastContextManifestId?: string | null;
    retrievalCacheKeys?: string[];
    providerSessions?: Array<Record<string, unknown>>;
    metadata?: Record<string, unknown>;
  };
}) {
  return apiRequest<{ repo: RepoRegistration; state: RepoStateCapsule }>("/api/v4/commands/repo.activate", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function prepareRepoSwitchV4(input: {
  actor: string;
  to_repo_id: string;
  state?: {
    activeBranch?: string;
    activeWorktreePath?: string;
    selectedTicketId?: string | null;
    selectedRunId?: string | null;
    recentChatSessionIds?: string[];
    lastContextManifestId?: string | null;
    retrievalCacheKeys?: string[];
    providerSessions?: Array<Record<string, unknown>>;
    metadata?: Record<string, unknown>;
  };
}) {
  return apiRequest<{ item: { id: string; toRepoId: string; fromRepoId: string | null; status: string } }>("/api/v4/commands/repo.switch-prepare", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function commitRepoSwitchV4(input: { actor: string; checkpoint_id: string }) {
  return apiRequest<{
    checkpoint: { id: string; status: string };
    activation: { repo: RepoRegistration; state: RepoStateCapsule };
  }>("/api/v4/commands/repo.switch-commit", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getRepoGuidelinesV4(repoId: string) {
  return apiRequest<{ item: RepoGuidelineProfile | null }>(`/api/v4/repos/${repoId}/guidelines`);
}

export async function getRepoStateV4(repoId: string) {
  return apiRequest<{ item: RepoStateCapsule | null }>(`/api/v4/repos/${repoId}/state`);
}

export async function getRepoContextV4(repoId: string) {
  return apiRequest<{ item: RepoIndexSnapshot | null }>(`/api/v4/repos/${repoId}/context`);
}

export async function listBenchmarkProjectsV4() {
  return apiRequest<{ items: BenchmarkProject[] }>("/api/v4/benchmarks/projects");
}

export async function getBenchmarkProjectV4(projectId: string) {
  return apiRequest<{ project: BenchmarkProject; tasks: BenchmarkTask[] }>(`/api/v4/benchmarks/projects/${projectId}`);
}

export async function startBenchmarkRunV4(input: {
  actor: string;
  project_id: string;
  task_id: string;
  mode?: BenchmarkRun["mode"];
  provider_role?: BenchmarkRun["providerRole"];
  repo_id?: string;
}) {
  return apiRequest<{
    run: BenchmarkRun;
    repo: RepoRegistration;
    project: BenchmarkProject;
    task: BenchmarkTask;
  }>("/api/v4/commands/benchmark.run.start", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function executeBenchmarkTaskV4(input: { actor: string; run_id: string }) {
  return apiRequest<{
    run: BenchmarkRun;
    chatSession: ChatSessionDto | null;
    routingDecision: RoutingDecision;
    context: ContextManifest;
    contextPack: ContextPack;
    executionAttempt: ExecutionAttempt;
    verification: VerificationBundle;
  }>("/api/v4/commands/benchmark.task.execute", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function recomputeBenchmarkScoreV4(input: { actor: string; run_id: string }) {
  return apiRequest<{
    run: BenchmarkRun;
    scorecard: BenchmarkScorecard;
    evidence: OutcomeEvidence[];
  }>("/api/v4/commands/benchmark.score.recompute", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getBenchmarkRunV4(runId: string) {
  return apiRequest<{
    run: BenchmarkRun;
    scorecard: BenchmarkScorecard | null;
    evidence: OutcomeEvidence[];
  }>(`/api/v4/benchmarks/runs/${runId}`);
}

export async function getBenchmarkScorecardV4(runId: string) {
  return apiRequest<{ item: BenchmarkScorecard | null }>(`/api/v4/benchmarks/runs/${runId}/scorecard`);
}

export async function getBenchmarkArtifactsV4(runId: string) {
  return apiRequest<{ items: OutcomeEvidence[] }>(`/api/v4/benchmarks/runs/${runId}/artifacts`);
}

export async function getBenchmarkLeaderboardV4() {
  return apiRequest<{ items: BenchmarkScorecard[] }>("/api/v4/benchmarks/leaderboard");
}

export async function getBenchmarkFailuresV4() {
  return apiRequest<{ items: BenchmarkScorecard[] }>("/api/v4/benchmarks/failures");
}

export async function listProjectsV5() {
  return apiRequest<{ items: ProjectBinding[] }>("/api/v5/projects");
}

export async function getProjectV5(projectId: string) {
  return apiRequest<{
    item: ProjectBinding | null;
    repo: RepoRegistration | null;
    github: GitHubRepoBinding | null;
  }>(`/api/v5/projects/${projectId}`);
}

export async function connectLocalProjectV5(input: { actor: string; source_path: string; display_name?: string }) {
  return apiRequest<{
    project: ProjectBinding;
    repo: RepoRegistration;
    guidelines: RepoGuidelineProfile;
    snapshot: RepoIndexSnapshot;
  }>("/api/v5/commands/project.connect.local", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function connectGithubProjectV5(input: {
  actor: string;
  owner: string;
  repo: string;
  clone_url?: string;
  display_name?: string;
  default_branch?: string;
  installation_id?: string;
  github_repo_id?: string;
}) {
  return apiRequest<{
    project: ProjectBinding;
    repo: RepoRegistration;
    guidelines: RepoGuidelineProfile;
    snapshot: RepoIndexSnapshot;
    github: GitHubRepoBinding;
  }>("/api/v5/commands/project.connect.github", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function activateProjectV5(input: {
  actor: string;
  repo_id: string;
  state?: {
    activeBranch?: string;
    activeWorktreePath?: string;
    selectedTicketId?: string | null;
    selectedRunId?: string | null;
    recentChatSessionIds?: string[];
    lastContextManifestId?: string | null;
    retrievalCacheKeys?: string[];
    providerSessions?: Array<Record<string, unknown>>;
    metadata?: Record<string, unknown>;
  };
}) {
  return apiRequest<{ project: ProjectBinding; repo: RepoRegistration; state: RepoStateCapsule }>("/api/v5/commands/project.activate", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function syncProjectV5(input: { actor: string; repo_id: string }) {
  return apiRequest<{ repo: Record<string, unknown>; syncedAt: string }>("/api/v5/commands/project.sync", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getProjectStateV5(projectId: string) {
  return apiRequest<{ item: RepoStateCapsule | null }>(`/api/v5/projects/${projectId}/state`);
}

export async function getProjectGuidelinesV5(projectId: string) {
  return apiRequest<{ item: RepoGuidelineProfile | null }>(`/api/v5/projects/${projectId}/guidelines`);
}

export async function getCodeGraphStatusV5(projectId: string) {
  return apiRequest<{ item: { repoId: string; status: string; nodeCount: number; edgeCount: number; updatedAt: string } | null }>(
    `/api/v5/projects/${projectId}/codegraph/status`
  );
}

export async function getLatestContextPackV5(projectId: string) {
  return apiRequest<{ item: ContextPack | null }>(`/api/v5/projects/${projectId}/context-pack`);
}

export async function queryCodeGraphV5(repoId: string, q: string, mode: ContextPack["queryMode"] = "basic") {
  const params = new URLSearchParams({ repoId, q, mode });
  return apiRequest<{
    pack: ContextPack;
    hits: KnowledgeHit[];
    nodes: CodeGraphNode[];
    edges: CodeGraphEdge[];
  }>(`/api/v5/codegraph/query?${params.toString()}`);
}

export async function buildContextPackV5(input: {
  actor: string;
  repo_id: string;
  objective: string;
  query_mode?: ContextPack["queryMode"];
  token_budget?: number;
  aggregate_id?: string;
}) {
  return apiRequest<{
    pack: ContextPack;
    retrievalTrace: RetrievalTrace;
    hits: KnowledgeHit[];
    graph: { nodes: CodeGraphNode[]; edges: CodeGraphEdge[] };
  }>("/api/v5/commands/context.pack.build", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function planExecutionV5(input: {
  actor: string;
  run_id: string;
  repo_id: string;
  objective: string;
  worktree_path: string;
  project_id?: string;
  ticket_id?: string;
  query_mode?: ContextPack["queryMode"];
  model_role?: "utility_fast" | "coder_default" | "review_deep" | "overseer_escalation";
  provider_id?: "qwen-cli" | "openai-compatible" | "onprem-qwen" | "openai-responses";
  routing_decision_id?: string;
  verification_plan?: string[];
  docs_required?: string[];
}) {
  return apiRequest<{
    attempt: ExecutionAttempt;
    contextPack: ContextPack;
    contextManifest: ContextManifest;
    routingDecision: RoutingDecision;
    retrievalTrace: RetrievalTrace;
  }>("/api/v5/commands/execution.plan", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function startExecutionV5(input: {
  actor: string;
  run_id: string;
  repo_id: string;
  worktree_path: string;
  objective: string;
  project_id?: string;
  project_key?: string;
  model_role: "utility_fast" | "coder_default" | "review_deep" | "overseer_escalation";
  provider_id: "qwen-cli" | "openai-compatible" | "onprem-qwen" | "openai-responses";
  routing_decision_id?: string;
  context_pack_id?: string;
}) {
  return apiRequest<{ item: ExecutionAttempt }>("/api/v5/commands/execution.start", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function verifyExecutionV5(input: {
  actor: string;
  run_id: string;
  repo_id: string;
  worktree_path: string;
  execution_attempt_id?: string;
  commands: string[];
  docs_required?: string[];
  full_suite_run?: boolean;
}) {
  return apiRequest<{ item: VerificationBundle }>("/api/v5/commands/execution.verify", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function executeBenchmarkRunV5(input: { actor: string; run_id: string }) {
  return apiRequest<{
    run: BenchmarkRun;
    routingDecision: RoutingDecision;
    context: ContextManifest;
    contextPack: ContextPack;
    executionAttempt: ExecutionAttempt;
    verification: VerificationBundle;
    scorecard: BenchmarkScorecard;
    evidence: OutcomeEvidence[];
  }>("/api/v5/commands/benchmark.run.execute", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function listRunAttemptsV5(runId: string) {
  return apiRequest<{ items: ExecutionAttempt[] }>(`/api/v5/runs/${runId}/attempts`);
}

export async function getVerificationV5(runId: string) {
  return apiRequest<{ item: VerificationBundle | null }>(`/api/v5/runs/${runId}/verification`);
}

export async function getShareReportV5(runId: string) {
  return apiRequest<{ item: ShareableRunReport | null }>(`/api/v5/runs/${runId}/share`);
}

export async function getMissionSnapshotV8(query?: {
  projectId?: string | null;
  ticketId?: string | null;
  runId?: string | null;
  sessionId?: string | null;
}) {
  const params = new URLSearchParams();
  if (query?.projectId) params.set("projectId", query.projectId);
  if (query?.ticketId) params.set("ticketId", query.ticketId);
  if (query?.runId) params.set("runId", query.runId);
  if (query?.sessionId) params.set("sessionId", query.sessionId);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiRequest<{ item: MissionControlSnapshot }>(`/api/v8/mission/snapshot${suffix}`);
}

export async function getMissionBacklogV8(query?: {
  projectId?: string | null;
  ticketId?: string | null;
  runId?: string | null;
  sessionId?: string | null;
}) {
  const params = new URLSearchParams();
  if (query?.projectId) params.set("projectId", query.projectId);
  if (query?.ticketId) params.set("ticketId", query.ticketId);
  if (query?.runId) params.set("runId", query.runId);
  if (query?.sessionId) params.set("sessionId", query.sessionId);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiRequest<{ pillars: WorkflowStatusPillar[]; items: WorkflowCardSummary[] }>(`/api/v8/mission/backlog${suffix}`);
}

export async function getMissionTaskDetailV8(query: { taskId: string; projectId?: string | null }) {
  const params = new URLSearchParams({ taskId: query.taskId });
  if (query.projectId) {
    params.set("projectId", query.projectId);
  }
  return apiRequest<{ item: WorkflowTaskDetail | null }>(`/api/v8/mission/task-detail?${params.toString()}`);
}

export async function moveMissionWorkflowV8(input: WorkflowMoveRequest) {
  return apiRequest<{ item: { moved: boolean; ticket: Ticket | null } }>("/api/v8/mission/workflow.move", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function setMissionWorkflowExecutionProfileV8(input: {
  workflowId: string;
  executionProfileId?: string | null;
  actor?: string;
}) {
  return apiRequest<{ item: { ticketId: string; executionProfileId: string | null } }>("/api/v8/mission/workflow.execution-profile", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getMissionTicketPermissionV9(ticketId: string) {
  const params = new URLSearchParams({ ticketId });
  return apiRequest<{ item: TicketExecutionPolicy }>(
    `/api/v9/mission/ticket.permission?${params.toString()}`
  );
}

export async function setMissionTicketPermissionV9(input: {
  ticket_id: string;
  mode: "balanced" | "strict";
  actor?: string;
  allow_install_commands?: boolean;
  allow_network_commands?: boolean;
  require_approval_for?: string[];
}) {
  return apiRequest<{ item: TicketExecutionPolicy }>("/api/v9/mission/ticket.permission", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function listRunToolEventsV9(runId: string) {
  return apiRequest<{ items: ToolInvocationEvent[] }>(
    `/api/v9/mission/run/${encodeURIComponent(runId)}/tool-events`
  );
}

export async function requestDependencyBootstrapV9(input: {
  actor: string;
  run_id: string;
  repo_id: string;
  ticket_id: string;
  stage: "scope" | "build" | "review" | "escalate";
}) {
  return apiRequest<{ item: { event: ToolInvocationEvent; result: Record<string, unknown> | null } }>(
    "/api/v9/mission/dependency.bootstrap",
    {
      method: "POST",
      body: JSON.stringify(input),
    }
  );
}

export async function getMissionCodebaseTreeV8(projectId: string) {
  return apiRequest<{ items: CodebaseTreeNode[] }>(`/api/v8/mission/codebase/tree?projectId=${encodeURIComponent(projectId)}`);
}

export async function getMissionCodeFileV8(projectId: string, filePath: string) {
  const params = new URLSearchParams({
    projectId,
    path: filePath,
  });
  return apiRequest<{ item: CodeFilePayload }>(`/api/v8/mission/codebase/file?${params.toString()}`);
}

export async function getMissionCodeFileDiffV8(projectId: string, filePath: string) {
  const params = new URLSearchParams({
    projectId,
    path: filePath,
  });
  return apiRequest<{ item: CodeFileDiffPayload }>(`/api/v8/mission/codebase/diff?${params.toString()}`);
}

export async function getMissionConsoleV8(projectId: string) {
  return apiRequest<{ items: ConsoleEvent[] }>(`/api/v8/mission/console?projectId=${encodeURIComponent(projectId)}`);
}

export async function openMissionConsoleStreamV8(projectId?: string | null) {
  return openApiEventStream("/api/v8/mission/console/stream", projectId ? { projectId } : undefined);
}

export async function getProjectBlueprintV8(projectId: string) {
  return apiRequest<{ item: ProjectBlueprint | null }>(`/api/v8/projects/${projectId}/blueprint`);
}

export async function getProjectBlueprintSourcesV8(projectId: string) {
  return apiRequest<{ items: string[] }>(`/api/v8/projects/${projectId}/blueprint/sources`);
}

export async function getProjectStartersV8() {
  return apiRequest<{ items: ProjectStarterDefinition[] }>("/api/v8/project-starters");
}

export async function generateProjectBlueprintV8(projectId: string) {
  return apiRequest<{ item: ProjectBlueprint }>(`/api/v8/projects/${projectId}/blueprint/generate`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function updateProjectBlueprintV8(projectId: string, patch: Partial<ProjectBlueprint>) {
  return apiRequest<{ item: ProjectBlueprint }>(`/api/v8/projects/${projectId}/blueprint/update`, {
    method: "POST",
    body: JSON.stringify(patch),
  });
}

export async function connectLocalProjectV8(input: { actor: string; source_path: string; display_name?: string }) {
  return apiRequest<
    | {
        bootstrapRequired: true;
        emptyFolder: true;
        folderPath: string;
        suggestedStarterId: ProjectStarterId | null;
        canStartBlank: true;
      }
    | {
        bootstrapRequired?: false;
        project: ProjectBinding;
        repo: RepoRegistration;
        guidelines: RepoGuidelineProfile | null;
        snapshot: RepoIndexSnapshot | null;
        codeGraph?: unknown;
        blueprint?: ProjectBlueprint | null;
      }
  >("/api/v8/projects/connect/local", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function connectGithubProjectV8(input: {
  actor: string;
  owner: string;
  repo: string;
  clone_url?: string;
  display_name?: string;
  default_branch?: string;
  installation_id?: string;
  github_repo_id?: string;
}) {
  return apiRequest<{
    project: ProjectBinding;
    repo: RepoRegistration;
    guidelines: RepoGuidelineProfile | null;
    snapshot: RepoIndexSnapshot | null;
    github: GitHubRepoBinding;
  }>("/api/v8/projects/connect/github", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function openRecentProjectV8(input: { actor: string; source_path: string; display_name?: string }) {
  return apiRequest<
    | {
        bootstrapRequired: true;
        emptyFolder: true;
        folderPath: string;
        suggestedStarterId: ProjectStarterId | null;
        canStartBlank: true;
      }
    | {
        bootstrapRequired?: false;
        project: ProjectBinding;
        repo: RepoRegistration;
        guidelines: RepoGuidelineProfile | null;
        snapshot: RepoIndexSnapshot | null;
        codeGraph?: unknown;
        blueprint?: ProjectBlueprint | null;
      }
  >("/api/v8/projects/open-recent", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function bootstrapEmptyProjectV8(input: {
  actor: string;
  folderPath: string;
  displayName?: string;
  starterId?: ProjectStarterId | null;
  initializeGit?: boolean;
}) {
  return apiRequest<{
    project: ProjectBinding;
    repo: RepoRegistration;
    blueprint: ProjectBlueprint | null;
    starterId: ProjectStarterId | null;
  }>("/api/v8/projects/bootstrap/empty", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getScaffoldPlanV8(projectId: string, input?: { starterId?: ProjectStarterId }) {
  return apiRequest<{ item: ScaffoldPlan }>(`/api/v8/projects/${projectId}/scaffold/plan`, {
    method: "POST",
    body: JSON.stringify(input || {}),
  });
}

export async function executeScaffoldV8(projectId: string, input: { actor: string; objective?: string; starterId?: ProjectStarterId }) {
  return apiRequest<{
    plan: ScaffoldPlan;
    result: ScaffoldExecutionResult;
    blueprint: ProjectBlueprint | null;
  }>(`/api/v8/projects/${projectId}/scaffold/execute`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getScaffoldStatusV8(projectId: string) {
  return apiRequest<{ item: ScaffoldExecutionResult | null }>(`/api/v8/projects/${projectId}/scaffold/status`);
}

export async function getLatestProjectReportV8(projectId: string) {
  return apiRequest<{ item: ShareableRunReport | null }>(`/api/v8/projects/${projectId}/report/latest`);
}

export async function sendOverseerMessageV8(input: {
  actor: string;
  project_id?: string;
  session_id?: string;
  content: string;
  model_role?: "utility_fast" | "coder_default" | "review_deep" | "overseer_escalation";
}) {
  return apiRequest<{ sessionId: string; item: ChatMessageDto }>("/api/v8/mission/overseer/chat", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function reviewOverseerRouteV8(input: {
  actor: string;
  project_id: string;
  ticket_id?: string;
  prompt: string;
  risk_level?: "low" | "medium" | "high";
  execution_profile_id?: string;
}) {
  return apiRequest<{
    ticket: Ticket;
    blueprint: ProjectBlueprint | null;
    route: RoutingDecision;
    contextPack: ContextPack;
    contextManifest: ContextManifest;
    retrievalTrace: RetrievalTrace;
  }>("/api/v8/mission/overseer/route.review", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function executeOverseerRouteV8(input: {
  actor: string;
  project_id: string;
  ticket_id?: string;
  prompt: string;
  model_role?: "utility_fast" | "coder_default" | "review_deep" | "overseer_escalation";
  provider_id?: "qwen-cli" | "openai-compatible" | "onprem-qwen" | "openai-responses";
  execution_profile_id?: string;
}) {
  return apiRequest<{
    runId: string;
    ticket: Ticket;
    blueprint: ProjectBlueprint | null;
    route: RoutingDecision;
    attempt: ExecutionAttempt;
    verification: VerificationBundle | null;
    lifecycle?: {
      autoReviewEnabled: boolean;
      maxRounds: number;
      roundsRun: number;
      completed: boolean;
      approvalRequired?: boolean;
      approvalId?: string | null;
      rejected?: boolean;
      transitions: Array<{
        from: Ticket["status"];
        to: Ticket["status"];
        reason: string;
        at: string;
      }>;
    };
    shareReport: ShareableRunReport | null;
  }>("/api/v9/mission/execute", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function decideMissionApprovalV8(input: {
  approval_id: string;
  decision: "approved" | "rejected";
  reason?: string;
  decided_by?: string;
  execute_approved_command?: boolean;
  requeue_blocked_stage?: boolean;
}) {
  return apiRequest<{
    item: ApprovalRequestDto;
    command_execution?: {
      toolEventId: string;
      policyDecision: "allowed" | "approval_required" | "denied";
      exitCode: number | null;
      summary: string;
    } | null;
    lifecycle_requeue?: {
      ticketId: string;
      from: string;
      to: string;
      reason: string;
    } | null;
  }>("/api/v8/mission/approval/decide", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
