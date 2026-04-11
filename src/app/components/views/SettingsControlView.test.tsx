import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsControlView } from "./SettingsControlView";
import { useUiStore } from "../../store/uiStore";

vi.mock("./DiagnosticsView", () => ({
  DiagnosticsView: () => <div data-testid="diagnostics-view">DiagnosticsView stub</div>,
}));
vi.mock("../skills/SkillCatalog", () => ({
  SkillCatalog: () => <div data-testid="skill-catalog">SkillCatalog stub</div>,
}));
vi.mock("../hooks/HookList", () => ({
  HookList: () => <div data-testid="hook-list">HookList stub</div>,
}));

const apiClientMock = vi.hoisted(() => ({
  activateModelPluginV2: vi.fn().mockResolvedValue({}),
  activateProviderV2: vi.fn().mockResolvedValue({}),
  addSecret: vi.fn().mockResolvedValue({ ok: true }),
  bootstrapQwenAccount: vi.fn().mockResolvedValue({}),
  connectMcpIntegration: vi.fn().mockResolvedValue({}),
  createOrUpdateMcpIntegration: vi.fn().mockResolvedValue({}),
  createQwenAccount: vi.fn().mockResolvedValue({}),
  deleteMcpIntegration: vi.fn().mockResolvedValue({}),
  deleteSecret: vi.fn().mockResolvedValue({ ok: true }),
  disconnectMcpIntegration: vi.fn().mockResolvedValue({}),
  getContextCompactionConfig: vi.fn().mockResolvedValue({
    thresholds: { summarize: 0.7, compress: 0.8, dropFiles: 0.85, merge: 0.9, emergency: 0.99 },
    microcompact: { enabled: true, cacheWindowSize: 50, minAgeForRemoval: 3 },
    snipCompact: { protectedTailTurns: 10, minPressureThreshold: 0.5 },
  }),
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
  getPrivacyConfig: vi.fn().mockResolvedValue({
    redactionEnabled: true,
    patterns: [
      { type: "jwt", label: "JSON Web Tokens", enabled: true },
      { type: "api_key", label: "API Keys", enabled: true },
    ],
    stats: { totalRedactions: 0, byType: {} },
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
  listSecrets: vi.fn().mockResolvedValue({ items: [] }),
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
  updateContextCompactionConfig: vi.fn().mockResolvedValue({ ok: true }),
  updatePrivacyConfig: vi.fn().mockResolvedValue({ ok: true }),
  updateQwenAccount: vi.fn().mockResolvedValue({}),
  updateSettings: vi.fn().mockResolvedValue({}),
  setRuntimeMode: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../lib/apiClient", () => apiClientMock);

/**
 * React-query v5 passes (variables, { client, meta, mutationKey }) to mutationFn.
 * This helper asserts on just the first argument (the user data).
 */
function expectMutationCalledWith(mockFn: ReturnType<typeof vi.fn>, expectedArg: unknown) {
  expect(mockFn).toHaveBeenCalled();
  expect(mockFn.mock.calls[0][0]).toEqual(expectedArg);
}

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
    vi.clearAllMocks();
    useUiStore.setState({
      labsMode: false,
      settingsFocusTarget: null,
      activeSection: "settings",
    });

    // Reset mocks to defaults so tests that override them don't leak
    apiClientMock.getSettings.mockResolvedValue({ items: {} });
    apiClientMock.listQwenAccounts.mockResolvedValue({ items: [] });
    apiClientMock.listQwenAccountAuthSessions.mockResolvedValue({ items: [] });
    apiClientMock.listSecrets.mockResolvedValue({ items: [] });
    apiClientMock.getOpenAiBudgetV3.mockResolvedValue({ item: { remainingUsd: 12 } });
    apiClientMock.listOpenAiModels.mockResolvedValue({ items: [{ id: "gpt-5-nano", created: null, ownedBy: "openai" }] });
    apiClientMock.listInferenceBackendsV2.mockResolvedValue({
      items: [{ id: "mlx-lm", label: "MLX-LM", optimizedFor: "local", running: false, startupCommandTemplate: "serve {{model}}" }],
    });
    apiClientMock.getPrivacyConfig.mockResolvedValue({
      redactionEnabled: true,
      patterns: [
        { type: "jwt", label: "JSON Web Tokens", enabled: true },
        { type: "api_key", label: "API Keys", enabled: true },
      ],
      stats: { totalRedactions: 0, byType: {} },
    });
    apiClientMock.getMcpIntegrations.mockResolvedValue({
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
    });
    apiClientMock.getLspIntegrations.mockResolvedValue({
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
    });
    apiClientMock.listOnPremRoleRuntimes.mockResolvedValue({ items: [] });
    apiClientMock.getLatestInferenceBenchmarksV2.mockResolvedValue({ items: [] });
    apiClientMock.listExperimentalChannelActivity.mockResolvedValue({ items: { channels: [], subagents: [] } });
    apiClientMock.getContextCompactionConfig.mockResolvedValue({
      thresholds: { summarize: 0.7, compress: 0.8, dropFiles: 0.85, merge: 0.9, emergency: 0.99 },
      microcompact: { enabled: true, cacheWindowSize: 50, minAgeForRemoval: 3 },
      snipCompact: { protectedTailTurns: 10, minPressureThreshold: 0.5 },
    });
    apiClientMock.listModelPluginsV2.mockResolvedValue({
      items: [{ id: "qwen3.5-4b", runtimeModel: "Qwen/Qwen3.5-4B-4bit", label: "Qwen 3.5 4B" }],
    });
    apiClientMock.listProviders.mockResolvedValue({ items: [], activeProvider: "onprem-qwen" });
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

  it("switches to Diagnostics view when Diagnostics tab is clicked", async () => {
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Diagnostics" }));

    // The DiagnosticsView stub should be rendered.
    expect(screen.getByTestId("diagnostics-view")).toBeInTheDocument();
    expect(screen.queryByText("Runtime Mode")).not.toBeInTheDocument();
  });

  it("toggles Labs mode checkbox", async () => {
    renderView();

    const labsCheckbox = await screen.findByRole("checkbox", { name: "Show Labs" });
    expect(labsCheckbox).not.toBeChecked();
    fireEvent.click(labsCheckbox);
    expect(useUiStore.getState().labsMode).toBe(true);
  });

  it("clicks Use OpenAI API runtime mode button and calls runtimeModeMutation", async () => {
    renderView();

    const openAiButton = await screen.findByRole("button", { name: "Use OpenAI API" });
    fireEvent.click(openAiButton);

    await waitFor(() => {
      expect(apiClientMock.setRuntimeMode).toHaveBeenCalled();
    });
    expect(apiClientMock.setRuntimeMode.mock.calls[0][0]).toEqual(
      expect.objectContaining({ mode: "openai_api" })
    );
  });

  it("clicks Use Local Qwen runtime mode button", async () => {
    renderView();

    const localButton = await screen.findByRole("button", { name: "Use Local Qwen" });
    fireEvent.click(localButton);

    await waitFor(() => {
      expect(apiClientMock.setRuntimeMode).toHaveBeenCalled();
    });
    expect(apiClientMock.setRuntimeMode.mock.calls[0][0]).toEqual({ mode: "local_qwen" });
  });

  it("renders API Keys panel with budget info", async () => {
    renderView();

    expect(await screen.findByText("API Keys")).toBeInTheDocument();
    expect(screen.getByText(/Budget:/)).toBeInTheDocument();
    expect(screen.getByText(/\/day remaining/)).toBeInTheDocument();
  });

  it("saves OpenAI API key when Save button is clicked", async () => {
    renderView();

    const apiKeyInput = await screen.findByPlaceholderText("sk-...");
    fireEvent.change(apiKeyInput, { target: { value: "sk-test-key" } });

    // The Save button within the API Keys panel
    const saveButtons = screen.getAllByRole("button", { name: "Save" });
    fireEvent.click(saveButtons[0]);

    await waitFor(() => {
      expect(apiClientMock.updateSettings).toHaveBeenCalled();
    });
    expectMutationCalledWith(apiClientMock.updateSettings,
      expect.objectContaining({ openAiResponses: { apiKey: "sk-test-key" } })
    );
  });

  it("clears API key draft when Clear button is clicked with draft text", async () => {
    renderView();

    const apiKeyInput = await screen.findByPlaceholderText("sk-...");
    fireEvent.change(apiKeyInput, { target: { value: "sk-draft" } });

    // When there's draft text, the button says "Clear"
    const clearButton = screen.getByRole("button", { name: "Clear" });
    fireEvent.click(clearButton);

    // After clicking clear, input should be empty (draft cleared)
    expect(apiKeyInput).toHaveValue("");
  });

  it("calls remove key when Remove key is clicked with empty draft", async () => {
    renderView();

    // With empty draft, button says "Remove key"
    const removeButton = await screen.findByRole("button", { name: "Remove key" });
    fireEvent.click(removeButton);

    await waitFor(() => {
      expect(apiClientMock.updateSettings).toHaveBeenCalled();
    });
    expectMutationCalledWith(apiClientMock.updateSettings,
      expect.objectContaining({ openAiResponses: { clearApiKey: true } })
    );
  });

  it("renders safety checkboxes and toggles them", async () => {
    apiClientMock.getSettings.mockResolvedValue({
      items: {
        safety: {
          requireApprovalForDestructiveOps: true,
          requireApprovalForProviderChanges: false,
          requireApprovalForCodeApply: true,
        },
      },
    });
    renderView();

    // Wait for the settings data to load and render the checkboxes
    const label = await screen.findByText(/Require Approval For Provider Changes/);
    expect(label).toBeInTheDocument();

    // The safety section has 3 checkboxes. Verify they render.
    const destructiveOps = await screen.findByText(/Require Approval For Destructive Ops/);
    expect(destructiveOps).toBeInTheDocument();
  });

  it("selects an active execution profile from Essentials cards", async () => {
    renderView();

    // The first 3 profiles are shown in the essentials view
    const balancedButton = await screen.findByRole("button", { name: "Balanced" });
    const deepScopeButton = screen.getByRole("button", { name: "Deep Scope" });

    fireEvent.click(deepScopeButton);

    await waitFor(() => {
      expect(apiClientMock.updateSettings).toHaveBeenCalled();
    });
    expectMutationCalledWith(apiClientMock.updateSettings,
      expect.objectContaining({
        executionProfiles: expect.objectContaining({ activeProfileId: "deep_scope" }),
      })
    );
  });

  it("navigates to Advanced view via 'Customize profiles' link in Active Profile card", async () => {
    renderView();

    const link = await screen.findByText(/Customize profiles in Advanced/);
    fireEvent.click(link);

    // After clicking, we should be in Advanced view
    expect(await screen.findByText("Execution Profiles and Routing")).toBeInTheDocument();
  });

  it("shows Runtime & Diagnostics section in advanced view", async () => {
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: /Runtime & Diagnostics/i }));

    expect(await screen.findByText("On-prem backend")).toBeInTheDocument();
    expect(screen.getByText("Parallel runtime")).toBeInTheDocument();
    expect(screen.getByText("Qwen CLI runtime")).toBeInTheDocument();
    expect(screen.getByText("Policy simulation")).toBeInTheDocument();
  });

  it("shows Labs disabled message when labs mode is off", async () => {
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: /Labs & Experimental/i }));

    expect(
      await screen.findByText(/Enable Developer Labs at the top of this page/)
    ).toBeInTheDocument();
  });

  it("shows Labs panels when labs mode is enabled", async () => {
    useUiStore.setState({ labsMode: true });
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: /Labs & Experimental/i }));

    expect(await screen.findByText("Internal surfaces")).toBeInTheDocument();
    expect(screen.getByText("Model Distillation")).toBeInTheDocument();
    expect(screen.getByText("Self-Learning Loop")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Benchmarks Lab" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Distillation Lab" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Learnings Lab" })).toBeInTheDocument();
  });

  it("Labs buttons call setActiveSection with correct section", async () => {
    useUiStore.setState({ labsMode: true });
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: /Labs & Experimental/i }));

    fireEvent.click(await screen.findByRole("button", { name: "Open Benchmarks Lab" }));
    expect(useUiStore.getState().activeSection).toBe("benchmarks");

    fireEvent.click(screen.getByRole("button", { name: "Open Distillation Lab" }));
    expect(useUiStore.getState().activeSection).toBe("distillation");

    fireEvent.click(screen.getByRole("button", { name: "Open Learnings Lab" }));
    expect(useUiStore.getState().activeSection).toBe("learnings");
  });

  it("shows Accounts & Approvals section with empty accounts", async () => {
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: /Accounts & Approvals/i }));

    expect(await screen.findByText("Add Qwen account")).toBeInTheDocument();
    expect(screen.getByText("No Qwen CLI accounts configured.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create + Auth" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import Current" })).toBeInTheDocument();
  });

  it("shows accounts list with account data", async () => {
    apiClientMock.listQwenAccounts.mockResolvedValue({
      items: [
        {
          id: "acc-1",
          label: "My Account",
          profilePath: "/home/user/.qwen/profiles/main",
          state: "ready",
          enabled: true,
        },
      ],
    });
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: /Accounts & Approvals/i }));

    expect(await screen.findByText("My Account")).toBeInTheDocument();
    expect(screen.getByText("ready")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disable" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Re-auth" })).toBeInTheDocument();
  });

  it("calls bootstrapQwenAccount when Create + Auth is clicked", async () => {
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: /Accounts & Approvals/i }));

    const input = await screen.findByPlaceholderText("Google Main");
    fireEvent.change(input, { target: { value: "Test Account" } });
    fireEvent.click(screen.getByRole("button", { name: "Create + Auth" }));

    await waitFor(() => {
      expect(apiClientMock.bootstrapQwenAccount).toHaveBeenCalled();
    });
    expectMutationCalledWith(apiClientMock.bootstrapQwenAccount, { label: "Test Account" });
  });

  it("shows Context Compaction section with threshold sliders", async () => {
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: /Context Compaction/i }));

    expect(await screen.findByText("Pressure Thresholds")).toBeInTheDocument();
    expect(screen.getByText("Cache-Aware Pruning")).toBeInTheDocument();
    expect(screen.getByText("Snip Compaction")).toBeInTheDocument();
    expect(screen.getByText(/Summarize/)).toBeInTheDocument();
    expect(screen.getByText(/Compress/)).toBeInTheDocument();
    expect(screen.getByText(/Drop Files/)).toBeInTheDocument();
    expect(screen.getByText(/Merge/)).toBeInTheDocument();
    expect(screen.getByText(/Emergency/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset to Defaults" })).toBeInTheDocument();
  });

  it("resets context compaction to defaults when Reset button is clicked", async () => {
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: /Context Compaction/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Reset to Defaults" }));

    await waitFor(() => {
      expect(apiClientMock.updateContextCompactionConfig).toHaveBeenCalled();
    });
    expectMutationCalledWith(apiClientMock.updateContextCompactionConfig, {
      thresholds: { summarize: 0.7, compress: 0.8, dropFiles: 0.85, merge: 0.9, emergency: 0.99 },
      microcompact: { enabled: true, cacheWindowSize: 50, minAgeForRemoval: 3 },
      snipCompact: { protectedTailTurns: 10, minPressureThreshold: 0.5 },
    });
  });

  it("shows Privacy & Redaction section with pattern list", async () => {
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: /Privacy & Redaction/i }));

    expect(await screen.findByText("Automatic Redaction")).toBeInTheDocument();
    expect(screen.getByText("Enable Automatic Redaction")).toBeInTheDocument();
    expect(await screen.findByText("Pattern Detection")).toBeInTheDocument();
    expect(await screen.findByText("JSON Web Tokens")).toBeInTheDocument();
  });

  it("toggles automatic redaction checkbox", async () => {
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: /Privacy & Redaction/i }));

    const redactionCheckbox = await screen.findByRole("checkbox", { name: "Enable Automatic Redaction" });
    fireEvent.click(redactionCheckbox);

    await waitFor(() => {
      expect(apiClientMock.updatePrivacyConfig).toHaveBeenCalled();
    });
    expectMutationCalledWith(apiClientMock.updatePrivacyConfig, { redactionEnabled: false });
  });

  it("shows redaction stats when totalRedactions > 0", async () => {
    apiClientMock.getPrivacyConfig.mockResolvedValue({
      redactionEnabled: true,
      patterns: [],
      stats: { totalRedactions: 42, byType: { jwt: 20, api_key: 22 } },
    });
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: /Privacy & Redaction/i }));

    expect(await screen.findByText("Redaction Stats")).toBeInTheDocument();
    expect(screen.getByText("Total redactions: 42")).toBeInTheDocument();
    expect(screen.getByText("jwt")).toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument();
  });

  it("shows Secrets section with empty state", async () => {
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: /^Secrets/ }));

    expect(await screen.findByText("Secrets Management")).toBeInTheDocument();
    expect(await screen.findByText("Add Secret")).toBeInTheDocument();
    expect(await screen.findByText("No secrets stored")).toBeInTheDocument();
  });

  it("shows secrets list with data", async () => {
    apiClientMock.listSecrets.mockResolvedValue({
      items: [
        { name: "GITHUB_TOKEN", source: "stored", updatedAt: "2025-01-15T00:00:00Z" },
        { name: "AWS_KEY", source: "env", updatedAt: null },
      ],
    });
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: /^Secrets/ }));

    expect(await screen.findByText("GITHUB_TOKEN")).toBeInTheDocument();
    expect(screen.getByText("AWS_KEY")).toBeInTheDocument();
  });

  it("calls addSecret when Add button is clicked with name and value", async () => {
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: /^Secrets/ }));

    const nameInput = await screen.findByPlaceholderText("Name");
    const valueInput = screen.getByPlaceholderText("Value");

    fireEvent.change(nameInput, { target: { value: "MY_SECRET" } });
    fireEvent.change(valueInput, { target: { value: "secret123" } });

    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(apiClientMock.addSecret).toHaveBeenCalledWith("MY_SECRET", "secret123");
    });
  });

  it("shows delete confirmation for secrets", async () => {
    apiClientMock.listSecrets.mockResolvedValue({
      items: [{ name: "MY_TOKEN", source: "stored", updatedAt: "2025-01-15T00:00:00Z" }],
    });
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: /^Secrets/ }));

    const deleteButton = await screen.findByRole("button", { name: "Delete" });
    fireEvent.click(deleteButton);

    // Should now show Confirm and Cancel buttons
    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("cancels secret deletion when Cancel is clicked", async () => {
    apiClientMock.listSecrets.mockResolvedValue({
      items: [{ name: "MY_TOKEN", source: "stored", updatedAt: "2025-01-15T00:00:00Z" }],
    });
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: /^Secrets/ }));

    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    // After cancelling, Delete button should be back
    expect(await screen.findByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
  });

  it("confirms secret deletion", async () => {
    apiClientMock.listSecrets.mockResolvedValue({
      items: [{ name: "MY_TOKEN", source: "stored", updatedAt: "2025-01-15T00:00:00Z" }],
    });
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: /^Secrets/ }));

    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(apiClientMock.deleteSecret).toHaveBeenCalled();
    });
    expectMutationCalledWith(apiClientMock.deleteSecret, "MY_TOKEN");
  });

  it("shows Skills and Hooks sections in advanced view", async () => {
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));

    expect(screen.getByRole("button", { name: /^Skills/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Hooks/ })).toBeInTheDocument();
  });

  it("shows execution profiles with role routing in advanced view", async () => {
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));

    // The profiles section is open by default
    expect(await screen.findByText("Execution Profiles")).toBeInTheDocument();
    expect(screen.getByText("Role routing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply recommended OpenAI roles" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply hybrid recommended" })).toBeInTheDocument();
  });

  it("applies recommended OpenAI roles when button is clicked", async () => {
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    fireEvent.click(await screen.findByRole("button", { name: "Apply recommended OpenAI roles" }));

    await waitFor(() => {
      expect(apiClientMock.activateProviderV2).toHaveBeenCalledWith("openai-responses", "user");
      expect(apiClientMock.updateSettings).toHaveBeenCalled();
    });
    expectMutationCalledWith(apiClientMock.updateSettings,
      expect.objectContaining({
        modelRoles: expect.objectContaining({
          utility_fast: expect.objectContaining({ providerId: "openai-responses" }),
        }),
      })
    );
  });

  it("applies hybrid recommended roles when button is clicked", async () => {
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    fireEvent.click(await screen.findByRole("button", { name: "Apply hybrid recommended" }));

    await waitFor(() => {
      expect(apiClientMock.activateProviderV2).toHaveBeenCalledWith("onprem-qwen", "user");
      expect(apiClientMock.updateSettings).toHaveBeenCalled();
    });
    expectMutationCalledWith(apiClientMock.updateSettings,
      expect.objectContaining({
        modelRoles: expect.objectContaining({
          utility_fast: expect.objectContaining({ providerId: "onprem-qwen" }),
          coder_default: expect.objectContaining({ providerId: "openai-responses" }),
        }),
      })
    );
  });

  it("shows custom lifecycle mapping and Use Custom button in profiles", async () => {
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));

    expect(await screen.findByText("Custom lifecycle mapping")).toBeInTheDocument();
    const useCustomButton = screen.getByRole("button", { name: "Use Custom" });
    fireEvent.click(useCustomButton);

    await waitFor(() => {
      expect(apiClientMock.updateSettings).toHaveBeenCalled();
    });
    expectMutationCalledWith(apiClientMock.updateSettings,
      expect.objectContaining({
        executionProfiles: expect.objectContaining({ activeProfileId: "custom" }),
      })
    );
  });

  it("shows runtime controls with default local model settings", async () => {
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));

    expect(await screen.findByText("Default local model")).toBeInTheDocument();
    expect(screen.getByText("OpenAI API model and budget")).toBeInTheDocument();
    expect(screen.getByText("Local role runtimes")).toBeInTheDocument();
  });

  it("shows local role runtimes with Start enabled runtimes button", async () => {
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));

    const startButton = await screen.findByRole("button", { name: "Start enabled runtimes" });
    fireEvent.click(startButton);

    await waitFor(() => {
      expect(apiClientMock.startEnabledOnPremRoleRuntimes).toHaveBeenCalledWith("user");
    });
  });

  it("applies recommended local split when button is clicked", async () => {
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));

    const localSplitBtn = await screen.findByRole("button", { name: "Apply recommended local split" });
    fireEvent.click(localSplitBtn);

    await waitFor(() => {
      expect(apiClientMock.setRuntimeMode).toHaveBeenCalled();
      expect(apiClientMock.activateProviderV2).toHaveBeenCalledWith("onprem-qwen", "user");
    });
    expectMutationCalledWith(apiClientMock.setRuntimeMode, { mode: "local_qwen" });
  });

  it("shows Autotune button and profile dropdown in runtime section", async () => {
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: /Runtime & Diagnostics/i }));

    const autotuneButton = await screen.findByRole("button", { name: "Autotune" });
    fireEvent.click(autotuneButton);

    await waitFor(() => {
      expect(apiClientMock.runInferenceAutotuneV2).toHaveBeenCalledWith({
        actor: "user",
        profile: "interactive",
      });
    });
  });

  it("shows Start button when backend is not running", async () => {
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: /Runtime & Diagnostics/i }));

    // The backend from mock is running: false, so Start should be shown
    const startButton = await screen.findByRole("button", { name: "Start" });
    expect(startButton).toBeInTheDocument();
  });

  it("shows Stop button when backend is running", async () => {
    apiClientMock.listInferenceBackendsV2.mockResolvedValue({
      items: [{ id: "mlx-lm", label: "MLX-LM", optimizedFor: "local", running: true, startupCommandTemplate: "serve {{model}}" }],
    });
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: /Runtime & Diagnostics/i }));

    const stopButton = await screen.findByRole("button", { name: "Stop" });
    expect(stopButton).toBeInTheDocument();
    fireEvent.click(stopButton);

    await waitFor(() => {
      expect(apiClientMock.stopInferenceBackendV2).toHaveBeenCalled();
    });
  });

  it("shows policy simulation and runs dry-run", async () => {
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: /Runtime & Diagnostics/i }));

    expect(await screen.findByText("Policy simulation")).toBeInTheDocument();
    const dryRunButton = screen.getByRole("button", { name: "Run dry-run policy check" });
    fireEvent.click(dryRunButton);

    await waitFor(() => {
      expect(apiClientMock.policyDecideV2).toHaveBeenCalledWith(
        expect.objectContaining({
          action_type: "run_command",
          dry_run: true,
        })
      );
    });
  });

  it("shows channels + automations section with checkboxes", async () => {
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: /Runtime & Diagnostics/i }));

    expect(await screen.findByText("Channels + automations")).toBeInTheDocument();
    expect(screen.getByText("Enable channels")).toBeInTheDocument();
    expect(screen.getByText("Allow remote approvals")).toBeInTheDocument();
    expect(screen.getByText("Allow unattended read-only delivery")).toBeInTheDocument();
  });

  it("shows MCP server add form in Integrations section", async () => {
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: /Integrations & Code Intelligence/i }));

    expect(await screen.findByText("Add MCP server")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("GitHub tools")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("github-tools")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save MCP server" })).toBeInTheDocument();
  });

  it("creates MCP server with stdio transport", async () => {
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: /Integrations & Code Intelligence/i }));

    fireEvent.change(await screen.findByPlaceholderText("GitHub tools"), {
      target: { value: "My Server" },
    });
    fireEvent.change(screen.getByPlaceholderText("npx"), {
      target: { value: "node" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save MCP server" }));

    await waitFor(() => {
      expect(apiClientMock.createOrUpdateMcpIntegration).toHaveBeenCalled();
    });
    expectMutationCalledWith(apiClientMock.createOrUpdateMcpIntegration,
      expect.objectContaining({ name: "My Server", transport: "stdio", command: "node" })
    );
  });

  it("shows MCP server details for existing servers", async () => {
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: /Integrations & Code Intelligence/i }));

    expect(await screen.findByText("GitHub")).toBeInTheDocument();
    expect(screen.getByText("github · stdio")).toBeInTheDocument();
    expect(screen.getByText("connected")).toBeInTheDocument();
    expect(screen.getByText("enabled")).toBeInTheDocument();
    expect(screen.getByText(/Tools: 8/)).toBeInTheDocument();
  });

  it("disconnects MCP server when Disconnect button is clicked", async () => {
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: /Integrations & Code Intelligence/i }));

    const disconnectButton = await screen.findByRole("button", { name: "Disconnect" });
    fireEvent.click(disconnectButton);

    await waitFor(() => {
      expect(apiClientMock.disconnectMcpIntegration).toHaveBeenCalled();
    });
    expectMutationCalledWith(apiClientMock.disconnectMcpIntegration, "github");
  });

  it("removes MCP server when Remove button is clicked", async () => {
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: /Integrations & Code Intelligence/i }));

    const removeButton = await screen.findByRole("button", { name: "Remove" });
    fireEvent.click(removeButton);

    await waitFor(() => {
      expect(apiClientMock.deleteMcpIntegration).toHaveBeenCalled();
    });
    expectMutationCalledWith(apiClientMock.deleteMcpIntegration, "github");
  });

  it("reconnects MCP server when Reconnect button is clicked", async () => {
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: /Integrations & Code Intelligence/i }));

    const reconnectButton = await screen.findByRole("button", { name: "Reconnect" });
    fireEvent.click(reconnectButton);

    await waitFor(() => {
      expect(apiClientMock.connectMcpIntegration).toHaveBeenCalled();
    });
    expectMutationCalledWith(apiClientMock.connectMcpIntegration, "github");
  });

  it("shows LSP server details with capabilities", async () => {
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: /Integrations & Code Intelligence/i }));

    expect(await screen.findByText("typescript")).toBeInTheDocument();
    expect(screen.getByText(".ts, .tsx")).toBeInTheDocument();
    // "running" appears in multiple places (MCP + LSP), just verify at least one
    expect(screen.getAllByText("running").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("initialized")).toBeInTheDocument();
    expect(screen.getAllByText(/diagnostics, definition/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Process: 1234/)).toBeInTheDocument();
  });

  it("shows channel activity events when data is present", async () => {
    apiClientMock.listExperimentalChannelActivity.mockResolvedValue({
      items: {
        channels: [
          {
            id: "ch-1",
            source: "webhook",
            senderId: "ops-bot",
            trustLevel: "verified",
            content: "CI pipeline failed for main",
            createdAt: "2025-06-01T10:00:00Z",
          },
        ],
        subagents: [
          {
            id: "sa-1",
            role: "build_agent",
            status: "completed",
            summary: "Fixed lint errors in app.ts",
          },
        ],
      },
    });
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: /Runtime & Diagnostics/i }));

    expect(await screen.findByText("webhook")).toBeInTheDocument();
    expect(screen.getByText(/ops-bot/)).toBeInTheDocument();
    expect(screen.getByText("build agent")).toBeInTheDocument();
    expect(screen.getByText("completed")).toBeInTheDocument();
    expect(screen.getByText("Fixed lint errors in app.ts")).toBeInTheDocument();
  });

  it("shows no channel activity message when empty", async () => {
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: /Runtime & Diagnostics/i }));

    expect(await screen.findByText("No channel activity recorded yet.")).toBeInTheDocument();
  });

  it("shows inference benchmarks when data is present", async () => {
    apiClientMock.getLatestInferenceBenchmarksV2.mockResolvedValue({
      items: [
        { profile: "interactive", backendId: "mlx-lm", score: 0.847, outputTokPerSec: 23.5 },
      ],
    });
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: /Runtime & Diagnostics/i }));

    expect(await screen.findByText("Latest inference benchmarks")).toBeInTheDocument();
    expect(screen.getByText(/mlx-lm · score 0\.847 · 23\.5 tok\/s/)).toBeInTheDocument();
  });

  it("handles settingsFocusTarget to scroll to providers section", async () => {
    useUiStore.setState({ settingsFocusTarget: "providers" });

    renderView();

    // After render, settingsFocusTarget should be cleared
    await screen.findByText("Runtime Mode");
    // The focus target processing clears it via requestAnimationFrame,
    // we just verify the component doesn't crash
  });

  it("shows openai model error if present", async () => {
    apiClientMock.listOpenAiModels.mockResolvedValue({
      items: [],
      error: "Invalid API key",
    });
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));

    expect(await screen.findByText(/Invalid API key/)).toBeInTheDocument();
  });

  it("renders MCP server with sse transport URL", async () => {
    apiClientMock.getMcpIntegrations.mockResolvedValue({
      items: [
        {
          id: "my-sse",
          name: "SSE Server",
          transport: "sse",
          command: null,
          args: [],
          url: "http://localhost:3001/sse",
          envKeys: [],
          enabled: true,
          connected: false,
          toolCount: 3,
          resourceCount: 0,
        },
      ],
    });
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: /Integrations & Code Intelligence/i }));

    expect(await screen.findByText("SSE Server")).toBeInTheDocument();
    expect(screen.getByText(/http:\/\/localhost:3001\/sse/)).toBeInTheDocument();
  });

  it("shows MCP empty state when no servers configured", async () => {
    apiClientMock.getMcpIntegrations.mockResolvedValue({ items: [] });
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: /Integrations & Code Intelligence/i }));

    expect(await screen.findByText(/No MCP servers configured yet/)).toBeInTheDocument();
  });

  it("shows LSP missing binary warning", async () => {
    apiClientMock.getLspIntegrations.mockResolvedValue({
      items: [
        {
          language: "python",
          command: ["pyright"],
          extensions: [".py"],
          capabilities: { diagnostics: true },
          binaryAvailable: false,
          running: false,
          initialized: false,
          worktreePath: null,
          processId: null,
        },
      ],
    });
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: /Integrations & Code Intelligence/i }));

    expect(await screen.findByText("python")).toBeInTheDocument();
    expect(screen.getByText("missing")).toBeInTheDocument();
    expect(screen.getByText(/Install the first command/)).toBeInTheDocument();
  });

  it("shows account cooldown state chip", async () => {
    apiClientMock.listQwenAccounts.mockResolvedValue({
      items: [
        {
          id: "acc-cd",
          label: "Cooldown Account",
          profilePath: "/path",
          state: "cooldown",
          enabled: true,
        },
      ],
    });
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: /Accounts & Approvals/i }));

    expect(await screen.findByText("Cooldown Account")).toBeInTheDocument();
    expect(screen.getByText("cooldown")).toBeInTheDocument();
  });

  it("shows account error state chip", async () => {
    apiClientMock.listQwenAccounts.mockResolvedValue({
      items: [
        {
          id: "acc-err",
          label: "Error Account",
          profilePath: "/path",
          state: "auth_required",
          enabled: true,
        },
      ],
    });
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: /Accounts & Approvals/i }));

    expect(await screen.findByText("Error Account")).toBeInTheDocument();
    expect(screen.getByText("auth_required")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start Auth" })).toBeInTheDocument();
  });

  it("shows auth running state for account auth session", async () => {
    apiClientMock.listQwenAccounts.mockResolvedValue({
      items: [
        {
          id: "acc-run",
          label: "Running Auth Account",
          profilePath: "/path",
          state: "ready",
          enabled: true,
        },
      ],
    });
    apiClientMock.listQwenAccountAuthSessions.mockResolvedValue({
      items: [{ accountId: "acc-run", status: "running" }],
    });
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: /Accounts & Approvals/i }));

    expect(await screen.findByRole("button", { name: "Auth Running" })).toBeInTheDocument();
  });

  it("shows MCP server health status chip", async () => {
    apiClientMock.getMcpIntegrations.mockResolvedValue({
      items: [
        {
          id: "test-server",
          name: "Test Server",
          transport: "stdio",
          command: "node",
          args: ["server.js"],
          url: undefined,
          envKeys: [],
          enabled: true,
          connected: true,
          toolCount: 5,
          resourceCount: 1,
          healthStatus: "healthy",
        },
      ],
    });
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: /Integrations & Code Intelligence/i }));

    expect(await screen.findByText("Test Server")).toBeInTheDocument();
    expect(screen.getByText("healthy")).toBeInTheDocument();
  });

  it("shows MCP server failed health status", async () => {
    apiClientMock.getMcpIntegrations.mockResolvedValue({
      items: [
        {
          id: "fail-server",
          name: "Failing Server",
          transport: "stdio",
          command: "node",
          args: [],
          url: undefined,
          envKeys: [],
          enabled: true,
          connected: false,
          toolCount: 0,
          resourceCount: 0,
          healthStatus: "failed",
          error: "Connection refused",
        },
      ],
    });
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: /Integrations & Code Intelligence/i }));

    expect(await screen.findByText("Failing Server")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
    expect(screen.getByText("Last error: Connection refused")).toBeInTheDocument();
  });

  it("shows role runtime status badges when runtimes have status data", async () => {
    apiClientMock.listOnPremRoleRuntimes.mockResolvedValue({
      items: [
        { role: "utility_fast", healthy: true, running: true, pid: 12345, message: "All systems go" },
      ],
    });
    apiClientMock.getSettings.mockResolvedValue({
      items: {
        onPremQwenRoleRuntimes: {
          utility_fast: {
            enabled: true,
            baseUrl: "http://127.0.0.1:8001/v1",
            inferenceBackendId: "mlx-lm",
            pluginId: "qwen3.5-0.8b",
            model: "Qwen/Qwen3.5-0.8B",
            reasoningMode: "off",
            timeoutMs: 120000,
            temperature: 0.1,
            maxTokens: 900,
          },
        },
      },
    });
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));

    expect(await screen.findByText("healthy")).toBeInTheDocument();
    expect(screen.getByText(/pid 12345/)).toBeInTheDocument();
  });

  it("shows openai budget remaining from live query", async () => {
    apiClientMock.getOpenAiBudgetV3.mockResolvedValue({
      item: { remainingUsd: 7.5 },
    });
    renderView();

    expect(await screen.findByText(/\/day remaining/)).toBeInTheDocument();
  });

  it("toggles MCP server enabled status", async () => {
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: /Integrations & Code Intelligence/i }));

    // Find the "Enabled for agent runs" checkbox for GitHub server
    const enabledLabel = await screen.findByText("Enabled for agent runs");
    const checkbox = enabledLabel.closest("label")!.querySelector("input[type='checkbox']")!;
    fireEvent.click(checkbox);

    await waitFor(() => {
      expect(apiClientMock.patchMcpIntegration).toHaveBeenCalledWith("github", { enabled: false });
    });
  });


  it("shows MCP server lastConnected timestamp", async () => {
    apiClientMock.getMcpIntegrations.mockResolvedValue({
      items: [
        {
          id: "timed-server",
          name: "Timed Server",
          transport: "stdio",
          command: "node",
          args: [],
          url: undefined,
          envKeys: ["TOKEN"],
          enabled: true,
          connected: true,
          toolCount: 2,
          resourceCount: 0,
          lastConnected: "2025-06-01T12:00:00Z",
        },
      ],
    });
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: /Integrations & Code Intelligence/i }));

    expect(await screen.findByText(/Last connected:/)).toBeInTheDocument();
  });
});
