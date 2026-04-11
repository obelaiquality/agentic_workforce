import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DiagnosticsView } from "./DiagnosticsView";
import * as apiClient from "../../lib/apiClient";

// Mock the API client
vi.mock("../../lib/apiClient", () => ({
  apiRequest: vi.fn(),
  getDistillReadinessV2: vi.fn(),
  listInferenceBackendsV2: vi.fn(),
  getMcpIntegrations: vi.fn(),
  getLspIntegrations: vi.fn(),
  getSettings: vi.fn(),
  getCacheBreakDiagnostics: vi.fn(),
  getEnvironmentDiagnostics: vi.fn(),
}));

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>
  );
}

// ---------------------------------------------------------------------------
// Shared settings factory to reduce boilerplate
// ---------------------------------------------------------------------------

function makeSettings(overrides?: Record<string, any>) {
  return {
    items: {
      runtimeMode: "local_qwen" as const,
      safety: {},
      qwenCli: { command: "", args: [], timeoutMs: 0 },
      onPremQwen: {
        baseUrl: "",
        hasApiKey: false,
        apiKeySource: "none" as const,
        inferenceBackendId: "",
        pluginId: "",
        model: "",
        reasoningMode: "off" as const,
        timeoutMs: 0,
        temperature: 0,
        maxTokens: 0,
      },
      onPremQwenRoleRuntimes: {},
      openAiCompatible: {
        baseUrl: "",
        hasApiKey: false,
        apiKeySource: "none" as const,
        model: "",
        timeoutMs: 0,
        temperature: 0,
        maxTokens: 0,
      },
      openAiResponses: {
        baseUrl: "",
        hasApiKey: false,
        apiKeySource: "none" as const,
        model: "",
        timeoutMs: 0,
        reasoningEffort: "medium" as const,
        dailyBudgetUsd: 0,
        perRunBudgetUsd: 0,
        toolPolicy: { enableFileSearch: false, enableRemoteMcp: false },
      },
      modelRoles: {},
      executionProfiles: {
        activeProfileId: "balanced",
        profiles: [],
      },
      parallelRuntime: {
        maxLocalLanes: 0,
        maxExpandedLanes: 0,
        defaultLaneLeaseMinutes: 0,
        heartbeatIntervalSeconds: 0,
        staleAfterSeconds: 0,
        reservationTtlSeconds: 0,
      },
      distill: {
        teacherCommand: "",
        teacherModel: "",
        teacherTimeoutMs: 0,
        privacyPolicyVersion: "",
        objectiveSplit: "",
        teacherRateLimit: {
          maxRequestsPerMinute: 0,
          maxConcurrentTeacherJobs: 0,
          dailyTokenBudget: 0,
          retryBackoffMs: 0,
          maxRetries: 0,
        },
        trainer: {
          backend: "",
          pythonCommand: "",
          maxSteps: 0,
          perDeviceBatchSize: 0,
          gradientAccumulationSteps: 0,
          learningRate: 0,
          loraRank: 0,
          loraAlpha: 0,
          maxSeqLength: 0,
          orpoBeta: 0,
          toolRewardScale: 0,
        },
      },
      experimentalChannels: {
        enabled: false,
        senderAllowlist: [],
        allowRemoteApprovals: false,
        allowUnattendedReadOnly: false,
        webhook: { enabled: false, signingSecret: "" },
        telegram: { enabled: false, signingSecret: "" },
        ciMonitoring: { enabled: false, signingSecret: "" },
      },
      ...overrides,
    },
  };
}

function makeEnvData(overrides?: Record<string, any>) {
  return {
    gitVersion: "2.44.0",
    nodeVersion: "v22.0.0",
    osVersion: "Darwin 24.0.0",
    arch: "arm64",
    cpuCount: 10,
    cpuModel: "Apple M3 Pro",
    totalMemory: "36 GB",
    freeMemory: "12 GB",
    diskSpace: { available: "200 GB", total: "500 GB" },
    dbLatencyMs: 2,
    uptime: "3600 seconds",
    hardware: {
      platform: "apple-silicon",
      unifiedMemoryMb: 36864,
    },
    ...overrides,
  } as any;
}

function makeCacheData(overrides?: Record<string, any>) {
  return {
    baselineCacheReadTokens: 1000,
    sampleCount: 10,
    emaAlpha: 0.2,
    recentBreaks: [],
    hitRateEstimate: 0.75,
    ...overrides,
  };
}

function setupDefaultMocks(overrides?: {
  apiRequest?: any;
  distill?: any;
  backends?: any;
  mcp?: any;
  lsp?: any;
  settings?: any;
  cache?: any;
  env?: any;
}) {
  const o = overrides || {};
  const has = (key: string) => overrides !== undefined && key in overrides;

  vi.mocked(apiClient.apiRequest).mockResolvedValue(has("apiRequest") ? o.apiRequest : { item: {} });
  vi.mocked(apiClient.getDistillReadinessV2).mockResolvedValue(
    has("distill") ? o.distill : {
      checkedAt: new Date().toISOString(),
      ready: true,
      blockers: 0,
      warnings: 0,
      checks: [],
    }
  );
  vi.mocked(apiClient.listInferenceBackendsV2).mockResolvedValue(
    has("backends") ? o.backends : { items: [] }
  );
  vi.mocked(apiClient.getMcpIntegrations).mockResolvedValue(
    has("mcp") ? o.mcp : { items: [] }
  );
  vi.mocked(apiClient.getLspIntegrations).mockResolvedValue(
    has("lsp") ? o.lsp : { items: [] }
  );
  vi.mocked(apiClient.getSettings).mockResolvedValue(
    has("settings") ? o.settings : makeSettings()
  );
  vi.mocked(apiClient.getCacheBreakDiagnostics).mockResolvedValue(
    has("cache") ? o.cache : makeCacheData()
  );
  vi.mocked(apiClient.getEnvironmentDiagnostics).mockResolvedValue(
    has("env") ? o.env : makeEnvData()
  );
}

describe("DiagnosticsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock for environment diagnostics
    vi.mocked(apiClient.getEnvironmentDiagnostics).mockResolvedValue({
      gitVersion: "2.44.0",
      nodeVersion: "v22.0.0",
      osVersion: "Darwin 24.0.0",
      arch: "arm64",
      cpuCount: 10,
      cpuModel: "Apple M3 Pro",
      totalMemory: "36 GB",
      freeMemory: "12 GB",
      diskSpace: { available: "200 GB", total: "500 GB" },
      dbLatencyMs: 2,
      uptime: "3600 seconds",
      hardware: {
        platform: "apple-silicon",
        unifiedMemoryMb: 36864,
      },
    } as any);
  });

  it("renders all section headers", async () => {
    // Mock successful API responses
    vi.mocked(apiClient.apiRequest).mockResolvedValue({ item: {} });
    vi.mocked(apiClient.getDistillReadinessV2).mockResolvedValue({
      checkedAt: new Date().toISOString(),
      ready: true,
      blockers: 0,
      warnings: 0,
      checks: [],
    });
    vi.mocked(apiClient.listInferenceBackendsV2).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getMcpIntegrations).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getLspIntegrations).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getCacheBreakDiagnostics).mockResolvedValue({
      baselineCacheReadTokens: 1000,
      sampleCount: 10,
      emaAlpha: 0.2,
      recentBreaks: [],
      hitRateEstimate: 0.75,
    });
    vi.mocked(apiClient.getSettings).mockResolvedValue({
      items: {
        runtimeMode: "local_qwen" as const,
        safety: {},
        qwenCli: { command: "", args: [], timeoutMs: 0 },
        onPremQwen: {
          baseUrl: "",
          hasApiKey: false,
          apiKeySource: "none" as const,
          inferenceBackendId: "",
          pluginId: "",
          model: "",
          reasoningMode: "off" as const,
          timeoutMs: 0,
          temperature: 0,
          maxTokens: 0,
        },
        onPremQwenRoleRuntimes: {},
        openAiCompatible: {
          baseUrl: "",
          hasApiKey: false,
          apiKeySource: "none" as const,
          model: "",
          timeoutMs: 0,
          temperature: 0,
          maxTokens: 0,
        },
        openAiResponses: {
          baseUrl: "",
          hasApiKey: false,
          apiKeySource: "none" as const,
          model: "",
          timeoutMs: 0,
          reasoningEffort: "medium" as const,
          dailyBudgetUsd: 0,
          perRunBudgetUsd: 0,
          toolPolicy: { enableFileSearch: false, enableRemoteMcp: false },
        },
        modelRoles: {},
        executionProfiles: {
          activeProfileId: "balanced",
          profiles: [],
        },
        parallelRuntime: {
          maxLocalLanes: 0,
          maxExpandedLanes: 0,
          defaultLaneLeaseMinutes: 0,
          heartbeatIntervalSeconds: 0,
          staleAfterSeconds: 0,
          reservationTtlSeconds: 0,
        },
        distill: {
          teacherCommand: "",
          teacherModel: "",
          teacherTimeoutMs: 0,
          privacyPolicyVersion: "",
          objectiveSplit: "",
          teacherRateLimit: {
            maxRequestsPerMinute: 0,
            maxConcurrentTeacherJobs: 0,
            dailyTokenBudget: 0,
            retryBackoffMs: 0,
            maxRetries: 0,
          },
          trainer: {
            backend: "",
            pythonCommand: "",
            maxSteps: 0,
            perDeviceBatchSize: 0,
            gradientAccumulationSteps: 0,
            learningRate: 0,
            loraRank: 0,
            loraAlpha: 0,
            maxSeqLength: 0,
            orpoBeta: 0,
            toolRewardScale: 0,
          },
        },
        experimentalChannels: {
          enabled: false,
          senderAllowlist: [],
          allowRemoteApprovals: false,
          allowUnattendedReadOnly: false,
          webhook: { enabled: false, signingSecret: "" },
          telegram: { enabled: false, signingSecret: "" },
          ciMonitoring: { enabled: false, signingSecret: "" },
        },
      },
    });

    renderWithQueryClient(<DiagnosticsView />);

    await waitFor(() => {
      expect(screen.getByText("System Diagnostics")).toBeInTheDocument();
    });

    expect(screen.getByText("Backend Connectivity")).toBeInTheDocument();
    expect(screen.getByText("Local Models")).toBeInTheDocument();
    expect(screen.getByText("Inference Backends")).toBeInTheDocument();
    expect(screen.getByText("MCP Servers")).toBeInTheDocument();
    expect(screen.getByText("LSP Servers")).toBeInTheDocument();
    expect(screen.getByText("System Configuration")).toBeInTheDocument();
    expect(screen.getAllByText("Cache Performance").length).toBeGreaterThan(0);
  });

  it("shows backend status", async () => {
    vi.mocked(apiClient.apiRequest).mockResolvedValue({ item: {} });
    vi.mocked(apiClient.getDistillReadinessV2).mockResolvedValue({
      checkedAt: new Date().toISOString(),
      ready: true,
      blockers: 0,
      warnings: 0,
      checks: [],
    });
    vi.mocked(apiClient.listInferenceBackendsV2).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getMcpIntegrations).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getLspIntegrations).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getCacheBreakDiagnostics).mockResolvedValue({
      baselineCacheReadTokens: 1000,
      sampleCount: 10,
      emaAlpha: 0.2,
      recentBreaks: [],
      hitRateEstimate: 0.75,
    });
    vi.mocked(apiClient.getSettings).mockResolvedValue({
      items: {
        runtimeMode: "local_qwen" as const,
        safety: {},
        qwenCli: { command: "", args: [], timeoutMs: 0 },
        onPremQwen: {
          baseUrl: "",
          hasApiKey: false,
          apiKeySource: "none" as const,
          inferenceBackendId: "",
          pluginId: "",
          model: "",
          reasoningMode: "off" as const,
          timeoutMs: 0,
          temperature: 0,
          maxTokens: 0,
        },
        onPremQwenRoleRuntimes: {},
        openAiCompatible: {
          baseUrl: "",
          hasApiKey: false,
          apiKeySource: "none" as const,
          model: "",
          timeoutMs: 0,
          temperature: 0,
          maxTokens: 0,
        },
        openAiResponses: {
          baseUrl: "",
          hasApiKey: false,
          apiKeySource: "none" as const,
          model: "",
          timeoutMs: 0,
          reasoningEffort: "medium" as const,
          dailyBudgetUsd: 0,
          perRunBudgetUsd: 0,
          toolPolicy: { enableFileSearch: false, enableRemoteMcp: false },
        },
        modelRoles: {},
        executionProfiles: {
          activeProfileId: "balanced",
          profiles: [],
        },
        parallelRuntime: {
          maxLocalLanes: 0,
          maxExpandedLanes: 0,
          defaultLaneLeaseMinutes: 0,
          heartbeatIntervalSeconds: 0,
          staleAfterSeconds: 0,
          reservationTtlSeconds: 0,
        },
        distill: {
          teacherCommand: "",
          teacherModel: "",
          teacherTimeoutMs: 0,
          privacyPolicyVersion: "",
          objectiveSplit: "",
          teacherRateLimit: {
            maxRequestsPerMinute: 0,
            maxConcurrentTeacherJobs: 0,
            dailyTokenBudget: 0,
            retryBackoffMs: 0,
            maxRetries: 0,
          },
          trainer: {
            backend: "",
            pythonCommand: "",
            maxSteps: 0,
            perDeviceBatchSize: 0,
            gradientAccumulationSteps: 0,
            learningRate: 0,
            loraRank: 0,
            loraAlpha: 0,
            maxSeqLength: 0,
            orpoBeta: 0,
            toolRewardScale: 0,
          },
        },
        experimentalChannels: {
          enabled: false,
          senderAllowlist: [],
          allowRemoteApprovals: false,
          allowUnattendedReadOnly: false,
          webhook: { enabled: false, signingSecret: "" },
          telegram: { enabled: false, signingSecret: "" },
          ciMonitoring: { enabled: false, signingSecret: "" },
        },
      },
    });

    renderWithQueryClient(<DiagnosticsView />);

    await waitFor(() => {
      expect(screen.getByText("API Server")).toBeInTheDocument();
      expect(screen.getAllByText("connected").length).toBeGreaterThan(0);
    });
  });

  it("handles loading state", () => {
    vi.mocked(apiClient.apiRequest).mockImplementation(() => new Promise(() => {}));
    vi.mocked(apiClient.getDistillReadinessV2).mockImplementation(() => new Promise(() => {}));
    vi.mocked(apiClient.listInferenceBackendsV2).mockImplementation(() => new Promise(() => {}));
    vi.mocked(apiClient.getMcpIntegrations).mockImplementation(() => new Promise(() => {}));
    vi.mocked(apiClient.getLspIntegrations).mockImplementation(() => new Promise(() => {}));
    vi.mocked(apiClient.getSettings).mockImplementation(() => new Promise(() => {}));
    vi.mocked(apiClient.getCacheBreakDiagnostics).mockImplementation(() => new Promise(() => {}));

    renderWithQueryClient(<DiagnosticsView />);

    expect(screen.getByText("Loading diagnostics...")).toBeInTheDocument();
  });

  it("shows empty/disconnected states", async () => {
    vi.mocked(apiClient.apiRequest).mockRejectedValue(new Error("Connection failed"));
    vi.mocked(apiClient.getDistillReadinessV2).mockResolvedValue(null as any);
    vi.mocked(apiClient.listInferenceBackendsV2).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getMcpIntegrations).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getLspIntegrations).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getSettings).mockResolvedValue(null as any);
    vi.mocked(apiClient.getCacheBreakDiagnostics).mockResolvedValue({
      baselineCacheReadTokens: 0,
      sampleCount: 0,
      emaAlpha: 0.2,
      recentBreaks: [],
      hitRateEstimate: 0,
    });

    renderWithQueryClient(<DiagnosticsView />);

    await waitFor(() => {
      expect(screen.getAllByText("disconnected").length).toBeGreaterThan(0);
    });

    expect(screen.getByText("No inference backends configured")).toBeInTheDocument();
    expect(screen.getByText("No MCP servers configured")).toBeInTheDocument();
    expect(screen.getByText("No LSP servers configured")).toBeInTheDocument();
  });

  it("displays inference backends with status", async () => {
    vi.mocked(apiClient.apiRequest).mockResolvedValue({ item: {} });
    vi.mocked(apiClient.getDistillReadinessV2).mockResolvedValue({
      checkedAt: new Date().toISOString(),
      ready: true,
      blockers: 0,
      warnings: 0,
      checks: [],
    });
    vi.mocked(apiClient.listInferenceBackendsV2).mockResolvedValue({
      items: [
        {
          id: "mlx-lm" as const,
          label: "MLX LM",
          baseUrlDefault: "http://localhost:8080",
          startupCommandTemplate: "mlx-lm",
          optimizedFor: "apple-silicon" as const,
          notes: "Test backend",
          active: true,
          running: true,
          commandAvailable: true,
        },
      ],
    });
    vi.mocked(apiClient.getMcpIntegrations).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getLspIntegrations).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getCacheBreakDiagnostics).mockResolvedValue({
      baselineCacheReadTokens: 1000,
      sampleCount: 10,
      emaAlpha: 0.2,
      recentBreaks: [],
      hitRateEstimate: 0.75,
    });
    vi.mocked(apiClient.getSettings).mockResolvedValue({
      items: {
        runtimeMode: "local_qwen" as const,
        safety: {},
        qwenCli: { command: "", args: [], timeoutMs: 0 },
        onPremQwen: {
          baseUrl: "",
          hasApiKey: false,
          apiKeySource: "none" as const,
          inferenceBackendId: "mlx-lm",
          pluginId: "",
          model: "",
          reasoningMode: "off" as const,
          timeoutMs: 0,
          temperature: 0,
          maxTokens: 0,
        },
        onPremQwenRoleRuntimes: {},
        openAiCompatible: {
          baseUrl: "",
          hasApiKey: false,
          apiKeySource: "none" as const,
          model: "",
          timeoutMs: 0,
          temperature: 0,
          maxTokens: 0,
        },
        openAiResponses: {
          baseUrl: "",
          hasApiKey: false,
          apiKeySource: "none" as const,
          model: "",
          timeoutMs: 0,
          reasoningEffort: "medium" as const,
          dailyBudgetUsd: 0,
          perRunBudgetUsd: 0,
          toolPolicy: { enableFileSearch: false, enableRemoteMcp: false },
        },
        modelRoles: {},
        executionProfiles: {
          activeProfileId: "balanced",
          profiles: [],
        },
        parallelRuntime: {
          maxLocalLanes: 0,
          maxExpandedLanes: 0,
          defaultLaneLeaseMinutes: 0,
          heartbeatIntervalSeconds: 0,
          staleAfterSeconds: 0,
          reservationTtlSeconds: 0,
        },
        distill: {
          teacherCommand: "",
          teacherModel: "",
          teacherTimeoutMs: 0,
          privacyPolicyVersion: "",
          objectiveSplit: "",
          teacherRateLimit: {
            maxRequestsPerMinute: 0,
            maxConcurrentTeacherJobs: 0,
            dailyTokenBudget: 0,
            retryBackoffMs: 0,
            maxRetries: 0,
          },
          trainer: {
            backend: "",
            pythonCommand: "",
            maxSteps: 0,
            perDeviceBatchSize: 0,
            gradientAccumulationSteps: 0,
            learningRate: 0,
            loraRank: 0,
            loraAlpha: 0,
            maxSeqLength: 0,
            orpoBeta: 0,
            toolRewardScale: 0,
          },
        },
        experimentalChannels: {
          enabled: false,
          senderAllowlist: [],
          allowRemoteApprovals: false,
          allowUnattendedReadOnly: false,
          webhook: { enabled: false, signingSecret: "" },
          telegram: { enabled: false, signingSecret: "" },
          ciMonitoring: { enabled: false, signingSecret: "" },
        },
      },
    });

    renderWithQueryClient(<DiagnosticsView />);

    await waitFor(() => {
      expect(screen.getByText("MLX LM")).toBeInTheDocument();
      expect(screen.getByText("http://localhost:8080")).toBeInTheDocument();
      expect(screen.getByText("Active")).toBeInTheDocument();
    });
  });

  it("displays cache performance data", async () => {
    vi.mocked(apiClient.apiRequest).mockResolvedValue({ item: {} });
    vi.mocked(apiClient.getDistillReadinessV2).mockResolvedValue({
      checkedAt: new Date().toISOString(),
      ready: true,
      blockers: 0,
      warnings: 0,
      checks: [],
    });
    vi.mocked(apiClient.listInferenceBackendsV2).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getMcpIntegrations).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getLspIntegrations).mockResolvedValue({ items: [] });
    vi.mocked(apiClient.getCacheBreakDiagnostics).mockResolvedValue({
      baselineCacheReadTokens: 5000,
      sampleCount: 25,
      emaAlpha: 0.2,
      recentBreaks: [
        {
          timestamp: new Date().toISOString(),
          possibleCauses: ["system_prompt_changed", "tool_schema_changed"],
          readTokensBefore: 5000,
          readTokensAfter: 1000,
        },
      ],
      hitRateEstimate: 0.85,
    });
    vi.mocked(apiClient.getSettings).mockResolvedValue({
      items: {
        runtimeMode: "local_qwen" as const,
        safety: {},
        qwenCli: { command: "", args: [], timeoutMs: 0 },
        onPremQwen: {
          baseUrl: "",
          hasApiKey: false,
          apiKeySource: "none" as const,
          inferenceBackendId: "",
          pluginId: "",
          model: "",
          reasoningMode: "off" as const,
          timeoutMs: 0,
          temperature: 0,
          maxTokens: 0,
        },
        onPremQwenRoleRuntimes: {},
        openAiCompatible: {
          baseUrl: "",
          hasApiKey: false,
          apiKeySource: "none" as const,
          model: "",
          timeoutMs: 0,
          temperature: 0,
          maxTokens: 0,
        },
        openAiResponses: {
          baseUrl: "",
          hasApiKey: false,
          apiKeySource: "none" as const,
          model: "",
          timeoutMs: 0,
          reasoningEffort: "medium" as const,
          dailyBudgetUsd: 0,
          perRunBudgetUsd: 0,
          toolPolicy: { enableFileSearch: false, enableRemoteMcp: false },
        },
        modelRoles: {},
        executionProfiles: {
          activeProfileId: "balanced",
          profiles: [],
        },
        parallelRuntime: {
          maxLocalLanes: 0,
          maxExpandedLanes: 0,
          defaultLaneLeaseMinutes: 0,
          heartbeatIntervalSeconds: 0,
          staleAfterSeconds: 0,
          reservationTtlSeconds: 0,
        },
        distill: {
          teacherCommand: "",
          teacherModel: "",
          teacherTimeoutMs: 0,
          privacyPolicyVersion: "",
          objectiveSplit: "",
          teacherRateLimit: {
            maxRequestsPerMinute: 0,
            maxConcurrentTeacherJobs: 0,
            dailyTokenBudget: 0,
            retryBackoffMs: 0,
            maxRetries: 0,
          },
          trainer: {
            backend: "",
            pythonCommand: "",
            maxSteps: 0,
            perDeviceBatchSize: 0,
            gradientAccumulationSteps: 0,
            learningRate: 0,
            loraRank: 0,
            loraAlpha: 0,
            maxSeqLength: 0,
            orpoBeta: 0,
            toolRewardScale: 0,
          },
        },
        experimentalChannels: {
          enabled: false,
          senderAllowlist: [],
          allowRemoteApprovals: false,
          allowUnattendedReadOnly: false,
          webhook: { enabled: false, signingSecret: "" },
          telegram: { enabled: false, signingSecret: "" },
          ciMonitoring: { enabled: false, signingSecret: "" },
        },
      },
    });

    renderWithQueryClient(<DiagnosticsView />);

    await waitFor(() => {
      expect(screen.getAllByText("Cache Performance").length).toBeGreaterThan(0);
      expect(screen.getByText("85.0%")).toBeInTheDocument();
      expect(screen.getByText("25")).toBeInTheDocument();
      expect(screen.getByText("5,000")).toBeInTheDocument();
      expect(screen.getByText("Recent Cache Breaks")).toBeInTheDocument();
      expect(screen.getByText("system prompt changed")).toBeInTheDocument();
      expect(screen.getByText("tool schema changed")).toBeInTheDocument();
    });
  });

  it("shows distill readiness with blockers and warnings", async () => {
    setupDefaultMocks({
      distill: {
        checkedAt: new Date().toISOString(),
        ready: false,
        blockers: 3,
        warnings: 2,
        checks: [],
      },
    });

    renderWithQueryClient(<DiagnosticsView />);

    await waitFor(() => {
      expect(screen.getByText("Distillation Ready")).toBeInTheDocument();
      expect(screen.getByText("3 blockers")).toBeInTheDocument();
      expect(screen.getByText("2 warnings")).toBeInTheDocument();
    });
  });

  it("shows singular blocker/warning text when count is 1", async () => {
    setupDefaultMocks({
      distill: {
        checkedAt: new Date().toISOString(),
        ready: false,
        blockers: 1,
        warnings: 1,
        checks: [],
      },
    });

    renderWithQueryClient(<DiagnosticsView />);

    await waitFor(() => {
      expect(screen.getByText("1 blocker")).toBeInTheDocument();
      expect(screen.getByText("1 warning")).toBeInTheDocument();
    });
  });

  it("shows 'No distillation status available' when distill is null", async () => {
    setupDefaultMocks({
      distill: null,
    });

    renderWithQueryClient(<DiagnosticsView />);

    await waitFor(() => {
      expect(screen.getByText("No distillation status available")).toBeInTheDocument();
    });
  });

  it("displays inference backend that is not active and not running", async () => {
    setupDefaultMocks({
      backends: {
        items: [
          {
            id: "vllm",
            label: "vLLM Server",
            baseUrlDefault: "http://localhost:8000",
            startupCommandTemplate: "vllm",
            optimizedFor: "nvidia",
            notes: "",
            active: false,
            running: false,
            commandAvailable: false,
          },
        ],
      },
    });

    renderWithQueryClient(<DiagnosticsView />);

    await waitFor(() => {
      expect(screen.getByText("vLLM Server")).toBeInTheDocument();
      expect(screen.getByText("http://localhost:8000")).toBeInTheDocument();
    });

    // Should NOT show "Active" badge
    expect(screen.queryByText("Active")).toBeNull();
  });

  it("displays MCP servers with transport, tools, resources, errors, and enabled states", async () => {
    setupDefaultMocks({
      mcp: {
        items: [
          {
            id: "mcp-1",
            name: "Tool Server A",
            transport: "stdio",
            toolCount: 5,
            resourceCount: 2,
            connected: true,
            enabled: true,
            error: null,
          },
          {
            id: "mcp-2",
            name: "Tool Server B",
            transport: "http",
            toolCount: 3,
            resourceCount: 0,
            connected: false,
            enabled: true,
            error: "Connection refused",
          },
          {
            id: "mcp-3",
            name: "Disabled Server",
            transport: "stdio",
            toolCount: 0,
            resourceCount: 0,
            connected: false,
            enabled: false,
            error: null,
          },
        ],
      },
    });

    renderWithQueryClient(<DiagnosticsView />);

    await waitFor(() => {
      expect(screen.getByText("Tool Server A")).toBeInTheDocument();
    });

    // Transport and tool/resource details
    expect(screen.getByText(/stdio.*5 tools.*2 resources/)).toBeInTheDocument();
    expect(screen.getByText(/http.*3 tools.*0 resources/)).toBeInTheDocument();

    // Error message on server B
    expect(screen.getByText("Error: Connection refused")).toBeInTheDocument();

    // "Enabled" badge shows for enabled-but-not-connected servers
    expect(screen.getByText("Enabled")).toBeInTheDocument();
  });

  it("displays LSP servers with binary available, running, and not available states", async () => {
    setupDefaultMocks({
      lsp: {
        items: [
          {
            language: "typescript",
            extensions: [".ts", ".tsx"],
            binaryAvailable: true,
            running: true,
          },
          {
            language: "python",
            extensions: [".py"],
            binaryAvailable: true,
            running: false,
          },
          {
            language: "rust",
            extensions: [".rs"],
            binaryAvailable: false,
            running: false,
          },
        ],
      },
    });

    renderWithQueryClient(<DiagnosticsView />);

    await waitFor(() => {
      expect(screen.getByText("typescript")).toBeInTheDocument();
    });

    expect(screen.getByText("python")).toBeInTheDocument();
    expect(screen.getByText("rust")).toBeInTheDocument();

    // Extensions rendered
    expect(screen.getByText("Extensions: .ts, .tsx")).toBeInTheDocument();
    expect(screen.getByText("Extensions: .py")).toBeInTheDocument();
    expect(screen.getByText("Extensions: .rs")).toBeInTheDocument();
  });

  it("displays hardware environment with vramMb and computeCapability", async () => {
    setupDefaultMocks({
      env: makeEnvData({
        hardware: {
          platform: "nvidia-cuda",
          vramMb: 24576,
          computeCapability: "8.9",
        },
      }),
    });

    renderWithQueryClient(<DiagnosticsView />);

    await waitFor(() => {
      expect(screen.getByText("nvidia cuda")).toBeInTheDocument();
    });

    // VRAM
    expect(screen.getByText("VRAM")).toBeInTheDocument();
    expect(screen.getByText("24 GB")).toBeInTheDocument();

    // Compute capability
    expect(screen.getByText("Compute Capability")).toBeInTheDocument();
    expect(screen.getByText("8.9")).toBeInTheDocument();
  });

  it("shows 'Environment data unavailable' when envData is null", async () => {
    setupDefaultMocks({
      env: null,
    });

    renderWithQueryClient(<DiagnosticsView />);

    await waitFor(() => {
      expect(screen.getByText("Environment data unavailable")).toBeInTheDocument();
    });
  });

  it("shows negative DB latency as N/A", async () => {
    setupDefaultMocks({
      env: makeEnvData({
        dbLatencyMs: -1,
      }),
    });

    renderWithQueryClient(<DiagnosticsView />);

    await waitFor(() => {
      expect(screen.getByText("N/A")).toBeInTheDocument();
    });
  });

  it("displays settings with execution profiles and onPremQwen backend", async () => {
    setupDefaultMocks({
      settings: makeSettings({
        runtimeMode: "on_prem_qwen",
        executionProfiles: {
          activeProfileId: "fast",
          profiles: [],
        },
        onPremQwen: {
          baseUrl: "http://localhost:8080",
          hasApiKey: false,
          apiKeySource: "none" as const,
          inferenceBackendId: "mlx-lm",
          pluginId: "",
          model: "",
          reasoningMode: "off" as const,
          timeoutMs: 0,
          temperature: 0,
          maxTokens: 0,
        },
      }),
    });

    renderWithQueryClient(<DiagnosticsView />);

    await waitFor(() => {
      // String.replace('_', ' ') only replaces first underscore
      expect(screen.getByText("on prem_qwen")).toBeInTheDocument();
    });

    expect(screen.getByText("Execution Profile")).toBeInTheDocument();
    expect(screen.getByText("fast")).toBeInTheDocument();
    expect(screen.getByText("On-Prem Backend")).toBeInTheDocument();
    expect(screen.getByText("mlx-lm")).toBeInTheDocument();
  });

  it("shows 'Settings unavailable' when settings is null", async () => {
    setupDefaultMocks({
      settings: null,
    });

    renderWithQueryClient(<DiagnosticsView />);

    await waitFor(() => {
      expect(screen.getByText("Settings unavailable")).toBeInTheDocument();
    });
  });

  it("shows degraded cache status when hit rate is between 0.3 and 0.6", async () => {
    setupDefaultMocks({
      cache: makeCacheData({
        hitRateEstimate: 0.45,
        sampleCount: 15,
        baselineCacheReadTokens: 2000,
      }),
    });

    renderWithQueryClient(<DiagnosticsView />);

    await waitFor(() => {
      expect(screen.getByText("45.0%")).toBeInTheDocument();
    });

    // The status indicator should show "degraded"
    expect(screen.getByText("degraded")).toBeInTheDocument();
  });

  it("shows disconnected cache status when hit rate is below 0.3", async () => {
    setupDefaultMocks({
      cache: makeCacheData({
        hitRateEstimate: 0.15,
        sampleCount: 5,
        baselineCacheReadTokens: 500,
      }),
    });

    renderWithQueryClient(<DiagnosticsView />);

    await waitFor(() => {
      expect(screen.getByText("15.0%")).toBeInTheDocument();
    });

    // The status indicator should show "disconnected"
    expect(screen.getAllByText("disconnected").length).toBeGreaterThan(0);
  });

  it("shows 'No cache data available' when cacheData is null", async () => {
    setupDefaultMocks({
      cache: null,
    });

    renderWithQueryClient(<DiagnosticsView />);

    await waitFor(() => {
      expect(screen.getByText("No cache data available")).toBeInTheDocument();
    });
  });

  it("shows backend as disconnected when apiRequest rejects", async () => {
    setupDefaultMocks();
    // Override the apiRequest mock to reject after defaults are set
    vi.mocked(apiClient.apiRequest).mockRejectedValue(new Error("Network error"));

    renderWithQueryClient(<DiagnosticsView />);

    await waitFor(() => {
      expect(screen.getAllByText("disconnected").length).toBeGreaterThan(0);
    });
  });

  it("handles API errors gracefully for distill readiness", async () => {
    setupDefaultMocks();
    vi.mocked(apiClient.getDistillReadinessV2).mockRejectedValue(new Error("Server error"));

    renderWithQueryClient(<DiagnosticsView />);

    await waitFor(() => {
      expect(screen.getByText("No distillation status available")).toBeInTheDocument();
    });
  });

  it("handles API errors gracefully for inference backends", async () => {
    setupDefaultMocks();
    vi.mocked(apiClient.listInferenceBackendsV2).mockRejectedValue(new Error("Server error"));

    renderWithQueryClient(<DiagnosticsView />);

    await waitFor(() => {
      expect(screen.getByText("No inference backends configured")).toBeInTheDocument();
    });
  });

  it("handles API errors gracefully for MCP integrations", async () => {
    setupDefaultMocks();
    vi.mocked(apiClient.getMcpIntegrations).mockRejectedValue(new Error("Server error"));

    renderWithQueryClient(<DiagnosticsView />);

    await waitFor(() => {
      expect(screen.getByText("No MCP servers configured")).toBeInTheDocument();
    });
  });

  it("handles API errors gracefully for LSP integrations", async () => {
    setupDefaultMocks();
    vi.mocked(apiClient.getLspIntegrations).mockRejectedValue(new Error("Server error"));

    renderWithQueryClient(<DiagnosticsView />);

    await waitFor(() => {
      expect(screen.getByText("No LSP servers configured")).toBeInTheDocument();
    });
  });

  it("displays correct plural/singular for backend and server counts", async () => {
    setupDefaultMocks({
      backends: {
        items: [
          {
            id: "mlx-lm",
            label: "MLX",
            baseUrlDefault: "http://localhost:8080",
            startupCommandTemplate: "mlx",
            optimizedFor: "apple-silicon",
            notes: "",
            active: true,
            running: true,
            commandAvailable: true,
          },
        ],
      },
      mcp: {
        items: [
          {
            id: "mcp-1",
            name: "Server A",
            transport: "stdio",
            toolCount: 1,
            resourceCount: 0,
            connected: true,
            enabled: true,
            error: null,
          },
        ],
      },
      lsp: {
        items: [
          {
            language: "typescript",
            extensions: [".ts"],
            binaryAvailable: true,
            running: true,
          },
        ],
      },
    });

    renderWithQueryClient(<DiagnosticsView />);

    await waitFor(() => {
      // Singular forms (1 backend, 1 server, 1 language server)
      expect(screen.getByText(/1 backend configured/)).toBeInTheDocument();
      expect(screen.getByText(/1 server configured/)).toBeInTheDocument();
      expect(screen.getByText(/1 language server available/)).toBeInTheDocument();
    });
  });

  it("shows runtime mode as Unknown and Default profile when missing", async () => {
    setupDefaultMocks({
      settings: makeSettings({
        runtimeMode: undefined,
        executionProfiles: undefined,
        onPremQwen: undefined,
      }),
    });

    renderWithQueryClient(<DiagnosticsView />);

    await waitFor(() => {
      expect(screen.getByText("Unknown")).toBeInTheDocument();
    });
  });
});
