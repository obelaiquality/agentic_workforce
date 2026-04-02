import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsControlView } from "./SettingsControlView";
import { useUiStore } from "../../store/uiStore";

const apiClientMock = vi.hoisted(() => ({
  activateModelPluginV2: vi.fn().mockResolvedValue({}),
  activateProviderV2: vi.fn().mockResolvedValue({}),
  bootstrapQwenAccount: vi.fn().mockResolvedValue({}),
  connectMcpIntegration: vi.fn().mockResolvedValue({}),
  createOrUpdateMcpIntegration: vi.fn().mockResolvedValue({}),
  createQwenAccount: vi.fn().mockResolvedValue({}),
  deleteMcpIntegration: vi.fn().mockResolvedValue({}),
  disconnectMcpIntegration: vi.fn().mockResolvedValue({}),
  getLatestInferenceBenchmarksV2: vi.fn().mockResolvedValue({ items: [] }),
  getLspIntegrations: vi.fn().mockResolvedValue({
    items: [
      {
        language: "typescript",
        command: ["npx", "typescript-language-server", "--stdio"],
        extensions: [".ts", ".tsx"],
        capabilities: { diagnostics: true, definition: true },
        binaryAvailable: true,
        running: true,
        initialized: true,
        worktreePath: "/tmp/project",
        processId: 1234,
      },
    ],
  }),
  getMcpIntegrations: vi.fn().mockResolvedValue({
    items: [
      {
        id: "github",
        name: "GitHub",
        transport: "stdio",
        command: "npx",
        args: ["@modelcontextprotocol/server-github"],
        url: undefined,
        envKeys: ["GITHUB_TOKEN"],
        enabled: true,
        connected: true,
        toolCount: 8,
        resourceCount: 2,
      },
    ],
  }),
  listExperimentalChannelActivity: vi.fn().mockResolvedValue({ items: { channels: [], subagents: [] } }),
  listOnPremRoleRuntimes: vi.fn().mockResolvedValue({ items: [] }),
  getOpenAiBudgetV3: vi.fn().mockResolvedValue({ item: { remainingUsd: 12 } }),
  getSettings: vi.fn().mockResolvedValue({ items: {} }),
  listInferenceBackendsV2: vi.fn().mockResolvedValue({
    items: [{ id: "mlx-lm", label: "MLX-LM", optimizedFor: "local", running: false, startupCommandTemplate: "serve {{model}}" }],
  }),
  listOpenAiModels: vi.fn().mockResolvedValue({ items: [{ id: "gpt-5-nano", created: null, ownedBy: "openai" }] }),
  listModelPluginsV2: vi.fn().mockResolvedValue({
    items: [{ id: "qwen3.5-4b", runtimeModel: "Qwen/Qwen3.5-4B-4bit", label: "Qwen 3.5 4B" }],
  }),
  listProviders: vi.fn().mockResolvedValue({ items: [], activeProvider: "onprem-qwen" }),
  listQwenAccountAuthSessions: vi.fn().mockResolvedValue({ items: [] }),
  listQwenAccounts: vi.fn().mockResolvedValue({ items: [] }),
  policyDecideV2: vi.fn().mockResolvedValue({ decision: { decision: "allow", policy_version: "test" } }),
  reauthQwenAccount: vi.fn().mockResolvedValue({}),
  runInferenceAutotuneV2: vi.fn().mockResolvedValue({}),
  startEnabledOnPremRoleRuntimes: vi.fn().mockResolvedValue({}),
  startInferenceBackendV2: vi.fn().mockResolvedValue({}),
  startOnPremRoleRuntime: vi.fn().mockResolvedValue({}),
  startQwenAccountAuth: vi.fn().mockResolvedValue({}),
  stopInferenceBackendV2: vi.fn().mockResolvedValue({}),
  stopOnPremRoleRuntime: vi.fn().mockResolvedValue({}),
  switchInferenceBackendV2: vi.fn().mockResolvedValue({}),
  patchMcpIntegration: vi.fn().mockResolvedValue({}),
  testOnPremRoleRuntime: vi.fn().mockResolvedValue({}),
  updateQwenAccount: vi.fn().mockResolvedValue({}),
  updateSettings: vi.fn().mockResolvedValue({}),
  setRuntimeMode: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../lib/apiClient", () => apiClientMock);

function renderView() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <SettingsControlView />
    </QueryClientProvider>
  );
}

describe("SettingsControlView", () => {
  beforeEach(() => {
    useUiStore.setState({
      labsMode: false,
      settingsFocusTarget: null,
      activeSection: "settings",
    });
  });

  it("lands on Essentials by default with 3 card layout", async () => {
    renderView();

    expect(await screen.findByText("Runtime Mode")).toBeInTheDocument();
    expect(screen.getByText("API Keys")).toBeInTheDocument();
    expect(screen.getByText("Active Profile")).toBeInTheDocument();
    expect(screen.queryByText("Execution Profiles and Routing")).not.toBeInTheDocument();
  });

  it("reveals execution profiles when Advanced is opened", async () => {
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));

    expect(await screen.findByText("Execution Profiles & Routing")).toBeInTheDocument();
    expect(screen.getByText("Execution Profiles")).toBeInTheDocument();
  });

  it("shows integrations and code intelligence status in Advanced view", async () => {
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: /Integrations & Code Intelligence/i }));

    expect(await screen.findByText("Model Context Protocol")).toBeInTheDocument();
    expect(await screen.findByText("GitHub")).toBeInTheDocument();
    expect(screen.getByText("Language Server Protocol")).toBeInTheDocument();
    expect(await screen.findByText("typescript")).toBeInTheDocument();
    expect(await screen.findByText("installed")).toBeInTheDocument();
  });
});
