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
});
