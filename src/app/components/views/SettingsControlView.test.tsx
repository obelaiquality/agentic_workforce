import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsControlView } from "./SettingsControlView";
import { useUiStore } from "../../store/uiStore";

const apiClientMock = vi.hoisted(() => ({
  activateModelPluginV2: vi.fn().mockResolvedValue({}),
  activateProviderV2: vi.fn().mockResolvedValue({}),
  bootstrapQwenAccount: vi.fn().mockResolvedValue({}),
  createQwenAccount: vi.fn().mockResolvedValue({}),
  getLatestInferenceBenchmarksV2: vi.fn().mockResolvedValue({ items: [] }),
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

  it("lands on Essentials by default and hides advanced routing controls", async () => {
    renderView();

    expect(await screen.findByText("OpenAI connection")).toBeInTheDocument();
    expect(screen.getByText("Local runtime summary")).toBeInTheDocument();
    expect(screen.queryByText("Execution Profiles")).not.toBeInTheDocument();
    expect(screen.queryByText("Role routing")).not.toBeInTheDocument();
  });

  it("reveals execution profiles and routing when Advanced is opened", async () => {
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));

    expect(await screen.findByText("Execution Profiles")).toBeInTheDocument();
    expect(screen.getByText("Role routing")).toBeInTheDocument();
    expect(screen.getByText("OpenAI API model and budget")).toBeInTheDocument();
  });
});

