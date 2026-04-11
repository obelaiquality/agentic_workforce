import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    appSetting: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
    secretRecord: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
    auditEvent: {
      create: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
  persistMcpServerConfigs: vi.fn(),
  setStoredSecret: vi.fn(),
  clearStoredSecret: vi.fn(),
  resolveSecretValue: vi.fn(),
}));

vi.mock("../db", () => ({
  prisma: mocks.prisma,
}));

vi.mock("../integrations/integrationSettings", () => ({
  persistMcpServerConfigs: mocks.persistMcpServerConfigs,
}));

vi.mock("../services/secretStore", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    setStoredSecret: mocks.setStoredSecret,
    clearStoredSecret: mocks.clearStoredSecret,
    resolveSecretValue: mocks.resolveSecretValue,
  };
});

import { registerSettingsRoutes } from "./settingsRoutes";

function createHarness() {
  const app = Fastify();
  const channelService = {
    getConfig: vi.fn().mockResolvedValue({
      enabled: false,
      senderAllowlist: [],
      defaultProjectId: null,
      defaultSessionId: null,
      allowRemoteApprovals: false,
      allowUnattendedReadOnly: false,
      webhook: {
        enabled: false,
        signingSecret: "",
        hasSigningSecret: false,
      },
      telegram: {
        enabled: false,
        signingSecret: "",
        hasSigningSecret: false,
      },
      ciMonitoring: {
        enabled: false,
        signingSecret: "",
        hasSigningSecret: false,
      },
    }),
  };
  const mcpClient = {
    getServerHealth: vi.fn().mockReturnValue(null),
  };
  const mcpRegistry = {
    getStatuses: vi.fn().mockReturnValue([]),
    getServers: vi.fn().mockReturnValue([]),
    replaceServers: vi.fn().mockResolvedValue(undefined),
    getServer: vi.fn(),
    getClient: vi.fn().mockReturnValue(mcpClient),
    connect: vi.fn().mockResolvedValue(undefined),
    reconnect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    listResources: vi.fn().mockResolvedValue([]),
    readResource: vi.fn().mockResolvedValue({ content: "example" }),
  };
  const toolRegistry = {
    unregisterAll: vi.fn(),
  };
  const lspClient = {
    getServerStatuses: vi.fn().mockResolvedValue([]),
  };

  registerSettingsRoutes({
    app,
    channelService: channelService as never,
    mcpRegistry: mcpRegistry as never,
    toolRegistry: toolRegistry as never,
    lspClient: lspClient as never,
  });

  return { app, channelService, mcpRegistry, toolRegistry, lspClient };
}

describe("settingsRoutes secret redaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.appSetting.upsert.mockResolvedValue(undefined);
    mocks.prisma.auditEvent.create.mockResolvedValue(undefined);

    mocks.prisma.appSetting.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => {
      switch (where.key) {
        case "active_provider":
          return { value: "openai-responses" };
        case "onprem_qwen_config":
          return {
            value: {
              baseUrl: "http://127.0.0.1:8000/v1",
              apiKey: "local-secret",
              inferenceBackendId: "mlx-lm",
              pluginId: "qwen3.5-4b",
              model: "mlx-community/Qwen3.5-4B-4bit",
              reasoningMode: "off",
              timeoutMs: 120000,
              temperature: 0.15,
              maxTokens: 1600,
            },
          };
        case "onprem_qwen_role_runtime_configs":
          return {
            value: {
              utility_fast: {
                enabled: true,
                baseUrl: "http://127.0.0.1:8001/v1",
                apiKey: "role-secret",
                model: "Qwen/Qwen3.5-0.8B",
              },
            },
          };
        case "openai_compatible_config":
          return {
            value: {
              baseUrl: "https://compat.example/v1",
              apiKey: "compat-secret",
              model: "compat-model",
              timeoutMs: 90000,
              temperature: 0.1,
              maxTokens: 2048,
            },
          };
        case "openai_responses_config":
          return {
            value: {
              baseUrl: "https://api.openai.com/v1",
              apiKey: "openai-secret",
              model: "gpt-5-nano",
              timeoutMs: 120000,
              reasoningEffort: "medium",
              dailyBudgetUsd: 25,
              perRunBudgetUsd: 5,
              toolPolicy: {
                enableFileSearch: false,
                enableRemoteMcp: false,
              },
            },
          };
        default:
          return null;
      }
    });

    mocks.prisma.secretRecord.findUnique.mockImplementation(async ({ where }: { where: { name: string } }) => {
      if (
        where.name === "provider:onprem-qwen:apiKey" ||
        where.name === "provider:openai-compatible:apiKey" ||
        where.name === "provider:openai-responses:apiKey" ||
        where.name === "provider:onprem-qwen:role-runtime:utility_fast:apiKey"
      ) {
        return { name: where.name };
      }
      return null;
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  it("redacts provider api keys from GET /api/v1/settings", async () => {
    const { app } = createHarness();

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/settings",
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json() as { items: Record<string, any> };

    expect(payload.items.onPremQwen).not.toHaveProperty("apiKey");
    expect(payload.items.onPremQwen).toMatchObject({
      hasApiKey: true,
      apiKeySource: "stored",
    });

    expect(payload.items.openAiCompatible).not.toHaveProperty("apiKey");
    expect(payload.items.openAiCompatible).toMatchObject({
      hasApiKey: true,
      apiKeySource: "stored",
    });

    expect(payload.items.openAiResponses).not.toHaveProperty("apiKey");
    expect(payload.items.openAiResponses).toMatchObject({
      hasApiKey: true,
      apiKeySource: "stored",
    });

    expect(payload.items.onPremQwenRoleRuntimes.utility_fast).not.toHaveProperty("apiKey");
    expect(payload.items.onPremQwenRoleRuntimes.utility_fast).toMatchObject({
      hasApiKey: true,
      apiKeySource: "stored",
    });

    await app.close();
  });

  it("returns MCP integration status from the shared registry", async () => {
    const { app, mcpRegistry } = createHarness();
    mcpRegistry.getServers.mockReturnValue([
      {
        id: "github",
        name: "GitHub",
        transport: "stdio",
        command: "npx",
        args: ["@modelcontextprotocol/server-github"],
        enabled: true,
        env: { GITHUB_TOKEN: "secret" },
      },
    ]);
    mcpRegistry.getStatuses.mockReturnValue([
      {
        id: "github",
        name: "GitHub",
        connected: true,
        toolCount: 8,
        resourceCount: 2,
        lastConnected: "2026-04-01T08:00:00.000Z",
      },
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/settings/integrations/mcp",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        expect.objectContaining({
          id: "github",
          connected: true,
          toolCount: 8,
          resourceCount: 2,
          envKeys: ["GITHUB_TOKEN"],
        }),
      ],
    });

    await app.close();
  });

  it("persists MCP integration changes and refreshes the registry", async () => {
    const { app, mcpRegistry } = createHarness();
    mcpRegistry.getServers.mockReturnValue([]);
    mcpRegistry.getStatuses.mockReturnValue([
      {
        id: "linear",
        name: "Linear",
        connected: true,
        toolCount: 3,
        resourceCount: 1,
      },
    ]);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/settings/integrations/mcp",
      payload: {
        server: {
          id: "linear",
          name: "Linear",
          transport: "stdio",
          command: "npx",
          args: ["@modelcontextprotocol/server-linear"],
          enabled: true,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.persistMcpServerConfigs).toHaveBeenCalled();
    expect(mcpRegistry.replaceServers).toHaveBeenCalled();
    expect(mcpRegistry.reconnect).toHaveBeenCalledWith("linear", expect.anything());

    await app.close();
  });

  it("returns LSP integration status from the shared client", async () => {
    const { app, lspClient } = createHarness();
    lspClient.getServerStatuses.mockResolvedValue([
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
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/settings/integrations/lsp",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        expect.objectContaining({
          language: "typescript",
          running: true,
          initialized: true,
        }),
      ],
    });

    await app.close();
  });
});

describe("settingsRoutes PATCH /api/v1/settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.appSetting.upsert.mockResolvedValue(undefined);
    mocks.prisma.auditEvent.create.mockResolvedValue(undefined);
    mocks.prisma.appSetting.findUnique.mockResolvedValue(null);
    mocks.setStoredSecret.mockResolvedValue(undefined);
    mocks.clearStoredSecret.mockResolvedValue(undefined);
    mocks.prisma.secretRecord.findUnique.mockResolvedValue(null);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  it("patches safety settings", async () => {
    const { app } = createHarness();
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      payload: {
        safety: { requireApprovalForDestructiveOps: false },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(mocks.prisma.appSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: "safety_policy" } }),
    );
    await app.close();
  });

  it("patches qwenCli settings and merges with existing config", async () => {
    mocks.prisma.appSetting.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => {
      if (where.key === "qwen_cli_config") {
        return { value: { command: "old-qwen", args: ["--old"], timeoutMs: 60000 } };
      }
      return null;
    });
    const { app } = createHarness();
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      payload: {
        qwenCli: { command: "new-qwen" },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(mocks.prisma.appSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "qwen_cli_config" },
        update: {
          value: expect.objectContaining({ command: "new-qwen", args: ["--old"], timeoutMs: 60000 }),
        },
      }),
    );
    await app.close();
  });

  it("patches onPremQwen settings and calls applySecretPatch for api key", async () => {
    const { app } = createHarness();
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      payload: {
        onPremQwen: {
          baseUrl: "http://custom:9999/v1",
          apiKey: "new-secret-key",
        },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(mocks.prisma.appSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: "onprem_qwen_config" } }),
    );
    expect(mocks.setStoredSecret).toHaveBeenCalledWith(
      mocks.prisma,
      "provider:onprem-qwen:apiKey",
      "new-secret-key",
    );
    await app.close();
  });

  it("clears onPremQwen api key when clearApiKey is true", async () => {
    const { app } = createHarness();
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      payload: {
        onPremQwen: { clearApiKey: true },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(mocks.clearStoredSecret).toHaveBeenCalledWith(mocks.prisma, "provider:onprem-qwen:apiKey");
    await app.close();
  });

  it("patches onPremQwenRoleRuntimes and strips secrets from persisted data", async () => {
    mocks.prisma.appSetting.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => {
      if (where.key === "onprem_qwen_role_runtime_configs") {
        return {
          value: {
            utility_fast: { enabled: true, baseUrl: "http://old:8001/v1", apiKey: "old-key" },
          },
        };
      }
      return null;
    });
    const { app } = createHarness();
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      payload: {
        onPremQwenRoleRuntimes: {
          utility_fast: { baseUrl: "http://new:8001/v1", apiKey: "new-role-key" },
        },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(mocks.prisma.appSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "onprem_qwen_role_runtime_configs" },
        update: {
          value: expect.objectContaining({
            utility_fast: expect.objectContaining({ baseUrl: "http://new:8001/v1" }),
          }),
        },
      }),
    );
    expect(mocks.setStoredSecret).toHaveBeenCalledWith(
      mocks.prisma,
      "provider:onprem-qwen:role-runtime:utility_fast:apiKey",
      "new-role-key",
    );
    await app.close();
  });

  it("patches openAiCompatible settings and persists api key", async () => {
    const { app } = createHarness();
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      payload: {
        openAiCompatible: {
          baseUrl: "http://compat:11434/v1",
          model: "custom-model",
          apiKey: "compat-secret",
        },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(mocks.prisma.appSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: "openai_compatible_config" } }),
    );
    expect(mocks.setStoredSecret).toHaveBeenCalledWith(
      mocks.prisma,
      "provider:openai-compatible:apiKey",
      "compat-secret",
    );
    await app.close();
  });

  it("patches openAiResponses settings including toolPolicy", async () => {
    mocks.prisma.appSetting.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => {
      if (where.key === "openai_responses_config") {
        return {
          value: {
            baseUrl: "https://api.openai.com/v1",
            model: "gpt-5-nano",
            timeoutMs: 120000,
            reasoningEffort: "medium",
            dailyBudgetUsd: 25,
            perRunBudgetUsd: 5,
            toolPolicy: { enableFileSearch: false, enableRemoteMcp: false },
          },
        };
      }
      return null;
    });
    const { app } = createHarness();
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      payload: {
        openAiResponses: {
          model: "gpt-4o",
          apiKey: "openai-key",
          toolPolicy: { enableFileSearch: true },
        },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(mocks.prisma.appSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "openai_responses_config" },
        update: {
          value: expect.objectContaining({
            model: "gpt-4o",
            toolPolicy: expect.objectContaining({ enableFileSearch: true }),
          }),
        },
      }),
    );
    expect(mocks.setStoredSecret).toHaveBeenCalledWith(
      mocks.prisma,
      "provider:openai-responses:apiKey",
      "openai-key",
    );
    await app.close();
  });

  it("patches modelRoles directly", async () => {
    const { app } = createHarness();
    const roles = { coder_default: { providerId: "onprem-qwen" } };
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      payload: { modelRoles: roles },
    });
    expect(response.statusCode).toBe(200);
    expect(mocks.prisma.appSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "model_role_bindings" },
        update: { value: roles },
      }),
    );
    await app.close();
  });

  it("patches executionProfiles and normalizes them", async () => {
    const { app } = createHarness();
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      payload: {
        executionProfiles: {
          activeProfileId: "balanced",
          profiles: [
            {
              id: "balanced",
              name: "Balanced",
              description: "Default balanced profile",
              preset: "balanced",
              stages: {
                scope: "utility_fast",
                build: "coder_default",
                review: "review_deep",
                escalate: "overseer_escalation",
              },
            },
          ],
        },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(mocks.prisma.appSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: "execution_profiles" } }),
    );
    await app.close();
  });

  it("patches parallelRuntime settings and merges with previous", async () => {
    mocks.prisma.appSetting.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => {
      if (where.key === "parallel_runtime_config") {
        return { value: { maxLocalLanes: 2, maxExpandedLanes: 4 } };
      }
      return null;
    });
    const { app } = createHarness();
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      payload: {
        parallelRuntime: { maxLocalLanes: 8 },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(mocks.prisma.appSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "parallel_runtime_config" },
        update: {
          value: expect.objectContaining({ maxLocalLanes: 8, maxExpandedLanes: 4 }),
        },
      }),
    );
    await app.close();
  });

  it("patches distill settings including trainer and rate limit", async () => {
    const { app } = createHarness();
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      payload: {
        distill: {
          teacherCommand: "claude-custom",
          teacherRateLimit: { maxRequestsPerMinute: 10 },
          trainer: { backend: "custom-backend", maxSteps: 100 },
        },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(mocks.prisma.appSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "distill_config" },
        update: {
          value: expect.objectContaining({
            teacherCommand: "claude-custom",
            teacherRateLimit: expect.objectContaining({ maxRequestsPerMinute: 10 }),
            trainer: expect.objectContaining({ backend: "custom-backend", maxSteps: 100 }),
          }),
        },
      }),
    );
    await app.close();
  });

  it("patches experimentalChannels with sender allowlist filtering", async () => {
    const { app } = createHarness();
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      payload: {
        experimentalChannels: {
          enabled: true,
          senderAllowlist: ["user1@example.com", "", "  ", "user2@example.com"],
          webhook: { enabled: true, signingSecret: "new-webhook-secret" },
          telegram: { enabled: false },
          ciMonitoring: { enabled: false },
        },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(mocks.prisma.appSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "experimental_channels_config" },
        update: {
          value: expect.objectContaining({
            enabled: true,
            senderAllowlist: ["user1@example.com", "user2@example.com"],
          }),
        },
      }),
    );
    await app.close();
  });

  it("creates an audit event for every settings patch", async () => {
    const { app } = createHarness();
    await app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      payload: { safety: { requireApprovalForDestructiveOps: true } },
    });
    expect(mocks.prisma.auditEvent.create).toHaveBeenCalledWith({
      data: {
        actor: "user",
        eventType: "settings.updated",
        payload: expect.objectContaining({ safety: expect.any(Object) }),
      },
    });
    await app.close();
  });
});

describe("settingsRoutes POST /api/v1/settings/runtime-mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.appSetting.upsert.mockResolvedValue(undefined);
    mocks.prisma.appSetting.findUnique.mockResolvedValue(null);
    mocks.setStoredSecret.mockResolvedValue(undefined);
    mocks.prisma.secretRecord.findUnique.mockResolvedValue(null);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  it("switches to openai_api mode and persists all config and bindings", async () => {
    const { app } = createHarness();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/settings/runtime-mode",
      payload: {
        mode: "openai_api",
        openAiApiKey: "sk-test-key",
        openAiModel: "gpt-4o",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, mode: "openai_api" });
    expect(mocks.prisma.appSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "openai_responses_config" },
        update: { value: expect.objectContaining({ model: "gpt-4o" }) },
      }),
    );
    expect(mocks.setStoredSecret).toHaveBeenCalledWith(
      mocks.prisma,
      "provider:openai-responses:apiKey",
      "sk-test-key",
    );
    expect(mocks.prisma.appSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "model_role_bindings" },
      }),
    );
    expect(mocks.prisma.appSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "active_provider" },
        update: { value: "openai-responses" },
      }),
    );
    await app.close();
  });

  it("defaults to gpt-5-nano when no model is specified for openai_api", async () => {
    const { app } = createHarness();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/settings/runtime-mode",
      payload: { mode: "openai_api" },
    });
    expect(response.statusCode).toBe(200);
    expect(mocks.prisma.appSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "openai_responses_config" },
        update: { value: expect.objectContaining({ model: "gpt-5-nano" }) },
      }),
    );
    await app.close();
  });

  it("switches to local_qwen mode with default bindings", async () => {
    const { app } = createHarness();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/settings/runtime-mode",
      payload: { mode: "local_qwen" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, mode: "local_qwen" });
    expect(mocks.prisma.appSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "active_provider" },
        update: { value: "onprem-qwen" },
      }),
    );
    await app.close();
  });
});

describe("settingsRoutes MCP CRUD operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.appSetting.upsert.mockResolvedValue(undefined);
    mocks.persistMcpServerConfigs.mockResolvedValue(undefined);
    mocks.prisma.secretRecord.findUnique.mockResolvedValue(null);
    mocks.prisma.appSetting.findUnique.mockResolvedValue(null);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  it("patches an existing MCP server via PATCH", async () => {
    const { app, mcpRegistry } = createHarness();
    const existingServer = {
      id: "github",
      name: "GitHub",
      transport: "stdio" as const,
      command: "npx",
      args: ["@mcp/server-github"],
      enabled: true,
      env: { GITHUB_TOKEN: "tok" },
    };
    mcpRegistry.getServers.mockReturnValue([existingServer]);
    mcpRegistry.getStatuses.mockReturnValue([
      { id: "github", connected: true, toolCount: 5, resourceCount: 1 },
    ]);

    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings/integrations/mcp/github",
      payload: { name: "GitHub Updated" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().item).toMatchObject({ id: "github", name: "GitHub Updated" });
    expect(mocks.persistMcpServerConfigs).toHaveBeenCalled();
    expect(mcpRegistry.connect).toHaveBeenCalledWith("github", expect.anything());
    await app.close();
  });

  it("returns 404 when patching a non-existent MCP server", async () => {
    const { app, mcpRegistry } = createHarness();
    mcpRegistry.getServers.mockReturnValue([]);

    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings/integrations/mcp/nonexistent",
      payload: { name: "Nope" },
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("deletes an existing MCP server", async () => {
    const { app, mcpRegistry } = createHarness();
    mcpRegistry.getServers.mockReturnValue([
      {
        id: "linear",
        name: "Linear",
        transport: "stdio" as const,
        command: "npx",
        args: [],
        enabled: true,
      },
    ]);

    const response = await app.inject({
      method: "DELETE",
      url: "/api/v1/settings/integrations/mcp/linear",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(mocks.persistMcpServerConfigs).toHaveBeenCalled();
    await app.close();
  });

  it("returns 404 when deleting a non-existent MCP server", async () => {
    const { app, mcpRegistry } = createHarness();
    mcpRegistry.getServers.mockReturnValue([]);

    const response = await app.inject({
      method: "DELETE",
      url: "/api/v1/settings/integrations/mcp/nonexistent",
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("connects an MCP server via POST connect", async () => {
    const { app, mcpRegistry } = createHarness();
    const server = {
      id: "github",
      name: "GitHub",
      transport: "stdio" as const,
      command: "npx",
      args: [],
      enabled: true,
    };
    mcpRegistry.getServer.mockReturnValue(server);
    mcpRegistry.getStatuses.mockReturnValue([
      { id: "github", connected: true, toolCount: 3, resourceCount: 0 },
    ]);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/settings/integrations/mcp/github/connect",
    });
    expect(response.statusCode).toBe(200);
    expect(mcpRegistry.reconnect).toHaveBeenCalledWith("github", expect.anything());
    await app.close();
  });

  it("returns 404 when connecting a non-existent MCP server", async () => {
    const { app, mcpRegistry } = createHarness();
    mcpRegistry.getServer.mockReturnValue(null);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/settings/integrations/mcp/nonexistent/connect",
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("disconnects an MCP server via POST disconnect", async () => {
    const { app, mcpRegistry } = createHarness();
    const server = {
      id: "github",
      name: "GitHub",
      transport: "stdio" as const,
      command: "npx",
      args: [],
      enabled: true,
    };
    mcpRegistry.getServer.mockReturnValue(server);
    mcpRegistry.getStatuses.mockReturnValue([
      { id: "github", connected: false, toolCount: 0, resourceCount: 0 },
    ]);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/settings/integrations/mcp/github/disconnect",
    });
    expect(response.statusCode).toBe(200);
    expect(mcpRegistry.disconnect).toHaveBeenCalledWith("github");
    await app.close();
  });

  it("returns 404 when disconnecting a non-existent MCP server", async () => {
    const { app, mcpRegistry } = createHarness();
    mcpRegistry.getServer.mockReturnValue(null);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/settings/integrations/mcp/nonexistent/disconnect",
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("lists resources for an MCP server", async () => {
    const { app, mcpRegistry } = createHarness();
    mcpRegistry.getServer.mockReturnValue({
      id: "github",
      name: "GitHub",
      transport: "stdio" as const,
      command: "npx",
      args: [],
      enabled: true,
    });
    mcpRegistry.listResources.mockResolvedValue([
      { uri: "github://repos", name: "Repos" },
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/settings/integrations/mcp/github/resources",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [{ uri: "github://repos", name: "Repos" }],
    });
    await app.close();
  });

  it("returns 404 when listing resources for a non-existent MCP server", async () => {
    const { app, mcpRegistry } = createHarness();
    mcpRegistry.getServer.mockReturnValue(null);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/settings/integrations/mcp/nonexistent/resources",
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("reads a specific resource from an MCP server", async () => {
    const { app, mcpRegistry } = createHarness();
    mcpRegistry.getServer.mockReturnValue({
      id: "github",
      name: "GitHub",
      transport: "stdio" as const,
      command: "npx",
      args: [],
      enabled: true,
    });
    mcpRegistry.readResource.mockResolvedValue({ content: "repo-data" });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/settings/integrations/mcp/github/resources/read",
      payload: { uri: "github://repos/main" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ item: { content: "repo-data" } });
    await app.close();
  });

  it("returns 404 when reading resource from a non-existent MCP server", async () => {
    const { app, mcpRegistry } = createHarness();
    mcpRegistry.getServer.mockReturnValue(null);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/settings/integrations/mcp/nonexistent/resources/read",
      payload: { uri: "test://res" },
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("returns health data for an MCP server", async () => {
    const { app, mcpRegistry } = createHarness();
    const mcpClient = { getServerHealth: vi.fn().mockReturnValue("healthy") };
    mcpRegistry.getClient.mockReturnValue(mcpClient);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/settings/integrations/mcp/github/health",
    });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it("returns 404 when health data is unavailable for MCP server", async () => {
    const { app, mcpRegistry } = createHarness();
    const mcpClient = { getServerHealth: vi.fn().mockReturnValue(null) };
    mcpRegistry.getClient.mockReturnValue(mcpClient);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/settings/integrations/mcp/nonexistent/health",
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("handles POST creating an MCP server that reconnect fails but is already connected", async () => {
    const { app, mcpRegistry } = createHarness();
    mcpRegistry.getServers.mockReturnValue([]);
    mcpRegistry.reconnect.mockRejectedValue(new Error("connect failed"));
    mcpRegistry.getStatuses.mockReturnValue([
      { id: "test-srv", connected: true, toolCount: 1, resourceCount: 0 },
    ]);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/settings/integrations/mcp",
      payload: {
        server: {
          id: "test-srv",
          name: "Test Server",
          transport: "stdio",
          command: "test-cmd",
          enabled: true,
        },
      },
    });
    // Should succeed because server is connected even though reconnect threw
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it("propagates reconnect error when MCP server is not connected after failure", async () => {
    const { app, mcpRegistry } = createHarness();
    mcpRegistry.getServers.mockReturnValue([]);
    mcpRegistry.reconnect.mockRejectedValue(new Error("connect failed"));
    mcpRegistry.getStatuses.mockReturnValue([
      { id: "test-srv", connected: false, toolCount: 0, resourceCount: 0 },
    ]);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/settings/integrations/mcp",
      payload: {
        server: {
          id: "test-srv",
          name: "Test Server",
          transport: "stdio",
          command: "test-cmd",
          enabled: true,
        },
      },
    });
    expect(response.statusCode).toBe(500);
    await app.close();
  });
});

describe("settingsRoutes OpenAI models endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.appSetting.findUnique.mockResolvedValue(null);
    mocks.prisma.secretRecord.findUnique.mockResolvedValue(null);
    mocks.resolveSecretValue.mockResolvedValue({ value: "", source: "none" });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  it("returns empty items with error when api key is not configured", async () => {
    const { app } = createHarness();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/openai/models",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [],
      error: "OpenAI API key is not configured",
    });
    await app.close();
  });
});

describe("settingsRoutes context compaction config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.appSetting.findUnique.mockResolvedValue(null);
    mocks.prisma.appSetting.upsert.mockResolvedValue(undefined);
    mocks.prisma.secretRecord.findUnique.mockResolvedValue(null);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  it("returns default compaction config when no row exists", async () => {
    const { app } = createHarness();
    const response = await app.inject({
      method: "GET",
      url: "/api/settings/context-compaction",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      thresholds: expect.objectContaining({ summarize: 0.7 }),
      microcompact: expect.objectContaining({ enabled: true }),
      snipCompact: expect.objectContaining({ protectedTailTurns: 10 }),
    });
    await app.close();
  });

  it("returns merged config when a row exists", async () => {
    mocks.prisma.appSetting.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => {
      if (where.key === "context.compaction.config.v1") {
        return { value: JSON.stringify({ thresholds: { summarize: 0.5 } }) };
      }
      return null;
    });
    const { app } = createHarness();
    const response = await app.inject({
      method: "GET",
      url: "/api/settings/context-compaction",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().thresholds.summarize).toBe(0.5);
    await app.close();
  });

  it("patches compaction config and merges with existing", async () => {
    mocks.prisma.appSetting.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => {
      if (where.key === "context.compaction.config.v1") {
        return { value: JSON.stringify({ microcompact: { enabled: false } }) };
      }
      return null;
    });
    const { app } = createHarness();
    const response = await app.inject({
      method: "PATCH",
      url: "/api/settings/context-compaction",
      payload: { snipCompact: { protectedTailTurns: 20 } },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(mocks.prisma.appSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: "context.compaction.config.v1" } }),
    );
    await app.close();
  });
});

describe("settingsRoutes privacy & redaction config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.appSetting.findUnique.mockResolvedValue(null);
    mocks.prisma.appSetting.upsert.mockResolvedValue(undefined);
    mocks.prisma.secretRecord.findUnique.mockResolvedValue(null);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  it("returns default privacy config when no row exists", async () => {
    const { app } = createHarness();
    const response = await app.inject({
      method: "GET",
      url: "/api/settings/privacy",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.redactionEnabled).toBe(true);
    expect(body.patterns).toHaveLength(8);
    await app.close();
  });

  it("returns merged privacy config when a row exists", async () => {
    mocks.prisma.appSetting.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => {
      if (where.key === "privacy.scanner.config.v1") {
        return { value: JSON.stringify({ redactionEnabled: false }) };
      }
      return null;
    });
    const { app } = createHarness();
    const response = await app.inject({
      method: "GET",
      url: "/api/settings/privacy",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().redactionEnabled).toBe(false);
    await app.close();
  });

  it("patches privacy config", async () => {
    const { app } = createHarness();
    const response = await app.inject({
      method: "PATCH",
      url: "/api/settings/privacy",
      payload: { redactionEnabled: false },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(mocks.prisma.appSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: "privacy.scanner.config.v1" } }),
    );
    await app.close();
  });
});

describe("settingsRoutes secrets management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.appSetting.findMany.mockResolvedValue([]);
    mocks.prisma.appSetting.upsert.mockResolvedValue(undefined);
    mocks.prisma.appSetting.deleteMany.mockResolvedValue({ count: 1 });
    mocks.prisma.appSetting.findUnique.mockResolvedValue(null);
    mocks.prisma.secretRecord.findUnique.mockResolvedValue(null);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  it("lists stored secrets", async () => {
    mocks.prisma.appSetting.findMany.mockResolvedValue([
      { key: "secret.my-api-key", updatedAt: new Date("2026-01-01T00:00:00Z") },
    ]);
    const { app } = createHarness();
    const response = await app.inject({
      method: "GET",
      url: "/api/settings/secrets",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        {
          name: "my-api-key",
          source: "stored",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    await app.close();
  });

  it("creates a new secret", async () => {
    const { app } = createHarness();
    const response = await app.inject({
      method: "POST",
      url: "/api/settings/secrets",
      payload: { name: "my-secret", value: "secret-value" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(mocks.prisma.appSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: "secret.my-secret" } }),
    );
    await app.close();
  });

  it("returns error when creating a secret without name or value", async () => {
    const { app } = createHarness();
    const response = await app.inject({
      method: "POST",
      url: "/api/settings/secrets",
      payload: { name: "", value: "" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: false, error: "Name and value required" });
    await app.close();
  });

  it("deletes a secret by name", async () => {
    const { app } = createHarness();
    const response = await app.inject({
      method: "DELETE",
      url: "/api/settings/secrets/my-secret",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(mocks.prisma.appSetting.deleteMany).toHaveBeenCalledWith({
      where: { key: "secret.my-secret" },
    });
    await app.close();
  });
});

describe("settingsRoutes cache break diagnostics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.appSetting.findUnique.mockResolvedValue(null);
    mocks.prisma.secretRecord.findUnique.mockResolvedValue(null);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  it("returns default cache break diagnostics when no row exists", async () => {
    const { app } = createHarness();
    const response = await app.inject({
      method: "GET",
      url: "/api/diagnostics/cache-breaks",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      baselineCacheReadTokens: 0,
      sampleCount: 0,
      emaAlpha: 0.2,
      recentBreaks: [],
      hitRateEstimate: 0,
    });
    await app.close();
  });

  it("returns merged cache break diagnostics when a row exists", async () => {
    mocks.prisma.appSetting.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => {
      if (where.key === "diagnostics.cache.summary.v1") {
        return { value: JSON.stringify({ sampleCount: 50, hitRateEstimate: 0.85 }) };
      }
      return null;
    });
    const { app } = createHarness();
    const response = await app.inject({
      method: "GET",
      url: "/api/diagnostics/cache-breaks",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.sampleCount).toBe(50);
    expect(body.hitRateEstimate).toBe(0.85);
    await app.close();
  });
});

describe("settingsRoutes environment diagnostics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.$queryRaw.mockResolvedValue([{ 1: 1 }]);
    mocks.prisma.appSetting.findUnique.mockResolvedValue(null);
    mocks.prisma.secretRecord.findUnique.mockResolvedValue(null);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  it("returns environment diagnostics with hardware profile", async () => {
    const { app } = createHarness();
    const response = await app.inject({
      method: "GET",
      url: "/api/diagnostics/environment",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      nodeVersion: expect.any(String),
      osVersion: expect.any(String),
      arch: expect.any(String),
      cpuCount: expect.any(Number),
      cpuModel: expect.any(String),
      totalMemory: expect.any(String),
      freeMemory: expect.any(String),
      diskSpace: expect.any(Object),
      dbLatencyMs: expect.any(Number),
      uptime: expect.any(String),
      hardware: expect.objectContaining({
        platform: expect.any(String),
      }),
    });
    await app.close();
  });
});

describe("settingsRoutes GET /api/v1/settings defaults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.appSetting.upsert.mockResolvedValue(undefined);
    mocks.prisma.auditEvent.create.mockResolvedValue(undefined);
    // Return null for ALL settings to exercise default fallback paths
    mocks.prisma.appSetting.findUnique.mockResolvedValue(null);
    mocks.prisma.secretRecord.findUnique.mockResolvedValue(null);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  it("returns complete defaults when no settings are stored", async () => {
    const { app } = createHarness();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/settings",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();

    // Verify default safety policy
    expect(body.items.safety).toMatchObject({
      requireApprovalForDestructiveOps: true,
    });

    // Verify onPremQwen defaults
    expect(body.items.onPremQwen.hasApiKey).toBe(false);
    expect(body.items.onPremQwen.apiKeySource).toBe("none");

    // Verify default runtime mode
    expect(body.items.runtimeMode).toBe("local_qwen");

    // Verify default parallel runtime
    expect(body.items.parallelRuntime).toMatchObject({
      maxLocalLanes: 4,
      maxExpandedLanes: 6,
    });

    // Verify default distill settings
    expect(body.items.distill.trainer).toMatchObject({
      backend: "hf-lora-local",
      pythonCommand: "python3",
    });

    // Verify execution profiles has defaults
    expect(body.items.executionProfiles.profiles.length).toBeGreaterThan(0);

    await app.close();
  });

  it("returns defaults for distill trainer with stored distill config that has trainer object", async () => {
    mocks.prisma.appSetting.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => {
      if (where.key === "distill_config") {
        return {
          value: {
            teacherCommand: "custom-claude",
            trainer: {
              backend: "custom-backend",
              maxSteps: 200,
            },
          },
        };
      }
      return null;
    });
    const { app } = createHarness();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/settings",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items.distill.teacherCommand).toBe("custom-claude");
    expect(body.items.distill.trainer.backend).toBe("custom-backend");
    expect(body.items.distill.trainer.maxSteps).toBe(200);
    // Defaults for fields not in stored trainer object
    expect(body.items.distill.trainer.pythonCommand).toBe("python3");
    await app.close();
  });

  it("returns default qwen args when stored args are empty", async () => {
    mocks.prisma.appSetting.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => {
      if (where.key === "qwen_cli_config") {
        return { value: { args: [] } };
      }
      return null;
    });
    const { app } = createHarness();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/settings",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items.qwenCli.args).toContain("--auth-type");
    await app.close();
  });

  it("returns default qwen args when stored args are 'chat --prompt'", async () => {
    mocks.prisma.appSetting.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => {
      if (where.key === "qwen_cli_config") {
        return { value: { args: ["chat", "--prompt"] } };
      }
      return null;
    });
    const { app } = createHarness();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/settings",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items.qwenCli.args).toContain("--auth-type");
    await app.close();
  });

  it("returns non-empty active provider value when stored provider is blank", async () => {
    mocks.prisma.appSetting.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => {
      if (where.key === "active_provider") {
        return { value: "  " };
      }
      return null;
    });
    const { app } = createHarness();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/settings",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    // Falls back to "onprem-qwen" when empty string
    expect(body.items.runtimeMode).toBe("local_qwen");
    await app.close();
  });

  it("returns stored values for qwenCli, parallelRuntime, and distill when fully populated", async () => {
    mocks.prisma.appSetting.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => {
      switch (where.key) {
        case "qwen_cli_config":
          return {
            value: {
              command: "custom-qwen",
              args: ["--custom-arg", "--verbose"],
              timeoutMs: 60000,
            },
          };
        case "parallel_runtime_config":
          return {
            value: {
              maxLocalLanes: 8,
              maxExpandedLanes: 12,
              defaultLaneLeaseMinutes: 30,
              heartbeatIntervalSeconds: 5,
              staleAfterSeconds: 120,
              reservationTtlSeconds: 28800,
            },
          };
        case "distill_config":
          return {
            value: {
              teacherCommand: "custom-teacher",
              teacherModel: "sonnet",
              teacherTimeoutMs: 60000,
              privacyPolicyVersion: "custom-v2",
              objectiveSplit: "50-50",
              teacherRateLimit: {
                maxRequestsPerMinute: 10,
                maxConcurrentTeacherJobs: 2,
                dailyTokenBudget: 200000,
                retryBackoffMs: 5000,
                maxRetries: 5,
              },
              trainer: {
                backend: "custom-backend",
                pythonCommand: "python3.11",
                maxSteps: 200,
                perDeviceBatchSize: 4,
                gradientAccumulationSteps: 16,
                learningRate: 0.001,
                loraRank: 16,
                loraAlpha: 32,
                maxSeqLength: 2048,
                orpoBeta: 0.2,
                toolRewardScale: 0.8,
              },
            },
          };
        case "openai_responses_config":
          return {
            value: {
              baseUrl: "https://custom-openai.example/v1",
              model: "custom-model",
              timeoutMs: 90000,
              reasoningEffort: "high",
              dailyBudgetUsd: 50,
              perRunBudgetUsd: 10,
              toolPolicy: { enableFileSearch: true, enableRemoteMcp: true },
            },
          };
        default:
          return null;
      }
    });
    const { app } = createHarness();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/settings",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();

    // qwenCli stored values
    expect(body.items.qwenCli.command).toBe("custom-qwen");
    expect(body.items.qwenCli.args).toEqual(["--custom-arg", "--verbose"]);
    expect(body.items.qwenCli.timeoutMs).toBe(60000);

    // parallelRuntime stored values
    expect(body.items.parallelRuntime).toEqual({
      maxLocalLanes: 8,
      maxExpandedLanes: 12,
      defaultLaneLeaseMinutes: 30,
      heartbeatIntervalSeconds: 5,
      staleAfterSeconds: 120,
      reservationTtlSeconds: 28800,
    });

    // distill stored values
    expect(body.items.distill.teacherCommand).toBe("custom-teacher");
    expect(body.items.distill.teacherModel).toBe("sonnet");
    expect(body.items.distill.teacherTimeoutMs).toBe(60000);
    expect(body.items.distill.privacyPolicyVersion).toBe("custom-v2");
    expect(body.items.distill.objectiveSplit).toBe("50-50");
    expect(body.items.distill.teacherRateLimit.maxRequestsPerMinute).toBe(10);
    expect(body.items.distill.trainer.backend).toBe("custom-backend");
    expect(body.items.distill.trainer.pythonCommand).toBe("python3.11");
    expect(body.items.distill.trainer.maxSteps).toBe(200);
    expect(body.items.distill.trainer.perDeviceBatchSize).toBe(4);
    expect(body.items.distill.trainer.gradientAccumulationSteps).toBe(16);
    expect(body.items.distill.trainer.learningRate).toBe(0.001);
    expect(body.items.distill.trainer.loraRank).toBe(16);
    expect(body.items.distill.trainer.loraAlpha).toBe(32);
    expect(body.items.distill.trainer.maxSeqLength).toBe(2048);
    expect(body.items.distill.trainer.orpoBeta).toBe(0.2);
    expect(body.items.distill.trainer.toolRewardScale).toBe(0.8);

    // openAiResponses stored values
    expect(body.items.openAiResponses.baseUrl).toBe("https://custom-openai.example/v1");
    expect(body.items.openAiResponses.reasoningEffort).toBe("high");
    expect(body.items.openAiResponses.dailyBudgetUsd).toBe(50);
    expect(body.items.openAiResponses.toolPolicy).toEqual({ enableFileSearch: true, enableRemoteMcp: true });

    await app.close();
  });
});

describe("settingsRoutes MCP validation errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.appSetting.upsert.mockResolvedValue(undefined);
    mocks.persistMcpServerConfigs.mockResolvedValue(undefined);
    mocks.prisma.secretRecord.findUnique.mockResolvedValue(null);
    mocks.prisma.appSetting.findUnique.mockResolvedValue(null);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  it("rejects stdio server without command via POST", async () => {
    const { app } = createHarness();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/settings/integrations/mcp",
      payload: {
        server: {
          id: "bad-stdio",
          name: "Bad Stdio",
          transport: "stdio",
          enabled: true,
        },
      },
    });
    // Zod validation fails
    expect(response.statusCode).toBe(500);
    await app.close();
  });

  it("rejects sse server without url via POST", async () => {
    const { app } = createHarness();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/settings/integrations/mcp",
      payload: {
        server: {
          id: "bad-sse",
          name: "Bad SSE",
          transport: "sse",
          enabled: true,
        },
      },
    });
    expect(response.statusCode).toBe(500);
    await app.close();
  });

  it("rejects PATCH with empty command for stdio transport", async () => {
    const { app, mcpRegistry } = createHarness();
    mcpRegistry.getServers.mockReturnValue([
      {
        id: "srv1",
        name: "Server 1",
        transport: "stdio" as const,
        command: "npx",
        args: [],
        enabled: true,
      },
    ]);

    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings/integrations/mcp/srv1",
      payload: { transport: "stdio", command: "" },
    });
    expect(response.statusCode).toBe(500);
    await app.close();
  });

  it("rejects PATCH with empty url for sse transport", async () => {
    const { app, mcpRegistry } = createHarness();
    mcpRegistry.getServers.mockReturnValue([
      {
        id: "srv2",
        name: "Server 2",
        transport: "sse" as const,
        url: "http://example.com",
        args: [],
        enabled: true,
      },
    ]);

    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings/integrations/mcp/srv2",
      payload: { transport: "sse", url: "" },
    });
    expect(response.statusCode).toBe(500);
    await app.close();
  });
});

describe("settingsRoutes POST runtime-mode with existing config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.appSetting.upsert.mockResolvedValue(undefined);
    mocks.setStoredSecret.mockResolvedValue(undefined);
    mocks.prisma.secretRecord.findUnique.mockResolvedValue(null);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  it("preserves existing openai_responses_config when switching to openai_api", async () => {
    mocks.prisma.appSetting.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => {
      if (where.key === "openai_responses_config") {
        return {
          value: {
            baseUrl: "https://custom.api/v1",
            timeoutMs: 90000,
            reasoningEffort: "high",
            dailyBudgetUsd: 50,
            perRunBudgetUsd: 10,
            toolPolicy: { enableFileSearch: true, enableRemoteMcp: true },
          },
        };
      }
      return null;
    });
    const { app } = createHarness();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/settings/runtime-mode",
      payload: { mode: "openai_api", openAiModel: "gpt-4o" },
    });
    expect(response.statusCode).toBe(200);
    expect(mocks.prisma.appSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "openai_responses_config" },
        update: {
          value: expect.objectContaining({
            baseUrl: "https://custom.api/v1",
            model: "gpt-4o",
            timeoutMs: 90000,
            reasoningEffort: "high",
            dailyBudgetUsd: 50,
            perRunBudgetUsd: 10,
            toolPolicy: { enableFileSearch: true, enableRemoteMcp: true },
          }),
        },
      }),
    );
    await app.close();
  });
});

describe("settingsRoutes PATCH distill with existing config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.appSetting.upsert.mockResolvedValue(undefined);
    mocks.prisma.auditEvent.create.mockResolvedValue(undefined);
    mocks.prisma.secretRecord.findUnique.mockResolvedValue(null);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  it("merges distill settings with existing stored values", async () => {
    mocks.prisma.appSetting.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => {
      if (where.key === "distill_config") {
        return {
          value: {
            teacherCommand: "existing-teacher",
            teacherModel: "haiku",
            teacherTimeoutMs: 90000,
            privacyPolicyVersion: "existing-policy",
            objectiveSplit: "80-20",
            teacherRateLimit: {
              maxRequestsPerMinute: 12,
              maxConcurrentTeacherJobs: 3,
              dailyTokenBudget: 300000,
              retryBackoffMs: 1000,
              maxRetries: 2,
            },
            trainer: {
              backend: "existing-backend",
              pythonCommand: "python3.10",
              maxSteps: 80,
              perDeviceBatchSize: 2,
              gradientAccumulationSteps: 4,
              learningRate: 0.0005,
              loraRank: 4,
              loraAlpha: 8,
              maxSeqLength: 512,
              orpoBeta: 0.05,
              toolRewardScale: 0.3,
            },
          },
        };
      }
      return null;
    });
    const { app } = createHarness();
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      payload: {
        distill: {
          teacherModel: "opus-3",
        },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(mocks.prisma.appSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "distill_config" },
        update: {
          value: expect.objectContaining({
            teacherCommand: "existing-teacher",
            teacherModel: "opus-3",
            teacherTimeoutMs: 90000,
            privacyPolicyVersion: "existing-policy",
            objectiveSplit: "80-20",
            teacherRateLimit: expect.objectContaining({
              maxRequestsPerMinute: 12,
              maxConcurrentTeacherJobs: 3,
              dailyTokenBudget: 300000,
              retryBackoffMs: 1000,
              maxRetries: 2,
            }),
            trainer: expect.objectContaining({
              backend: "existing-backend",
              pythonCommand: "python3.10",
              maxSteps: 80,
              perDeviceBatchSize: 2,
              gradientAccumulationSteps: 4,
              learningRate: 0.0005,
              loraRank: 4,
              loraAlpha: 8,
              maxSeqLength: 512,
              orpoBeta: 0.05,
              toolRewardScale: 0.3,
            }),
          }),
        },
      }),
    );
    await app.close();
  });
});

describe("settingsRoutes PATCH openAiCompatible and openAiResponses with existing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.appSetting.upsert.mockResolvedValue(undefined);
    mocks.prisma.auditEvent.create.mockResolvedValue(undefined);
    mocks.setStoredSecret.mockResolvedValue(undefined);
    mocks.clearStoredSecret.mockResolvedValue(undefined);
    mocks.prisma.secretRecord.findUnique.mockResolvedValue(null);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  it("merges openAiCompatible with existing stored config", async () => {
    mocks.prisma.appSetting.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => {
      if (where.key === "openai_compatible_config") {
        return {
          value: {
            baseUrl: "http://existing:11434/v1",
            model: "existing-model",
            timeoutMs: 60000,
            temperature: 0.3,
            maxTokens: 2000,
          },
        };
      }
      return null;
    });
    const { app } = createHarness();
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      payload: {
        openAiCompatible: { model: "new-model" },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(mocks.prisma.appSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "openai_compatible_config" },
        update: {
          value: expect.objectContaining({
            baseUrl: "http://existing:11434/v1",
            model: "new-model",
            timeoutMs: 60000,
            temperature: 0.3,
            maxTokens: 2000,
          }),
        },
      }),
    );
    await app.close();
  });

  it("clears openAiCompatible api key when clearApiKey is set", async () => {
    mocks.prisma.appSetting.findUnique.mockResolvedValue(null);
    const { app } = createHarness();
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      payload: {
        openAiCompatible: { clearApiKey: true },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(mocks.clearStoredSecret).toHaveBeenCalledWith(
      mocks.prisma,
      "provider:openai-compatible:apiKey",
    );
    await app.close();
  });

  it("clears openAiResponses api key when clearApiKey is set", async () => {
    mocks.prisma.appSetting.findUnique.mockResolvedValue(null);
    const { app } = createHarness();
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      payload: {
        openAiResponses: { clearApiKey: true },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(mocks.clearStoredSecret).toHaveBeenCalledWith(
      mocks.prisma,
      "provider:openai-responses:apiKey",
    );
    await app.close();
  });

  it("merges openAiResponses with existing stored config including toolPolicy", async () => {
    mocks.prisma.appSetting.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => {
      if (where.key === "openai_responses_config") {
        return {
          value: {
            baseUrl: "https://existing.api/v1",
            model: "existing-model",
            timeoutMs: 60000,
            reasoningEffort: "low",
            dailyBudgetUsd: 10,
            perRunBudgetUsd: 2,
            toolPolicy: { enableFileSearch: true, enableRemoteMcp: false },
          },
        };
      }
      return null;
    });
    const { app } = createHarness();
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      payload: {
        openAiResponses: { reasoningEffort: "high" },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(mocks.prisma.appSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "openai_responses_config" },
        update: {
          value: expect.objectContaining({
            baseUrl: "https://existing.api/v1",
            model: "existing-model",
            timeoutMs: 60000,
            reasoningEffort: "high",
            dailyBudgetUsd: 10,
            perRunBudgetUsd: 2,
            toolPolicy: expect.objectContaining({ enableFileSearch: true, enableRemoteMcp: false }),
          }),
        },
      }),
    );
    await app.close();
  });
});

describe("settingsRoutes PATCH onPremQwen with existing stored config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.appSetting.upsert.mockResolvedValue(undefined);
    mocks.prisma.auditEvent.create.mockResolvedValue(undefined);
    mocks.setStoredSecret.mockResolvedValue(undefined);
    mocks.clearStoredSecret.mockResolvedValue(undefined);
    mocks.prisma.secretRecord.findUnique.mockResolvedValue(null);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  it("merges onPremQwen with existing stored config preserving typed fields", async () => {
    mocks.prisma.appSetting.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => {
      if (where.key === "onprem_qwen_config") {
        return {
          value: {
            baseUrl: "http://existing:8000/v1",
            inferenceBackendId: "vllm-openai",
            pluginId: "qwen2.5-coder-3b",
            model: "Qwen/Qwen2.5-Coder-3B-Instruct",
            reasoningMode: "on",
            timeoutMs: 90000,
            temperature: 0.2,
            maxTokens: 2000,
          },
        };
      }
      return null;
    });
    const { app } = createHarness();
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      payload: {
        onPremQwen: { model: "new-model" },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(mocks.prisma.appSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "onprem_qwen_config" },
        update: {
          value: expect.objectContaining({
            baseUrl: "http://existing:8000/v1",
            inferenceBackendId: "vllm-openai",
            pluginId: "qwen2.5-coder-3b",
            model: "new-model",
            reasoningMode: "on",
            timeoutMs: 90000,
            temperature: 0.2,
            maxTokens: 2000,
          }),
        },
      }),
    );
    await app.close();
  });
});

describe("settingsRoutes OpenAI models fetch with configured key", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.appSetting.findUnique.mockResolvedValue(null);
    mocks.prisma.secretRecord.findUnique.mockResolvedValue(null);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  it("fetches and returns model list when API key is configured", async () => {
    mocks.resolveSecretValue.mockResolvedValue({ value: "sk-test-key", source: "stored" });
    const mockModelsResponse = {
      data: [
        { id: "gpt-5-nano", created: 1700000000, owned_by: "openai" },
        { id: "gpt-4o", created: 1690000000, owned_by: "openai" },
        { id: "", created: null, owned_by: null }, // filtered out
      ],
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(mockModelsResponse),
    } as Response);

    const { app } = createHarness();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/openai/models",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items).toHaveLength(2);
    expect(body.items[0].id).toBe("gpt-4o");
    expect(body.items[1].id).toBe("gpt-5-nano");
    fetchSpy.mockRestore();
    await app.close();
  });

  it("returns error when API call fails with non-ok response", async () => {
    mocks.resolveSecretValue.mockResolvedValue({ value: "sk-test-key", source: "stored" });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      text: async () => "Unauthorized",
    } as Response);

    const { app } = createHarness();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/openai/models",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items).toEqual([]);
    expect(body.error).toBe("Unauthorized");
    fetchSpy.mockRestore();
    await app.close();
  });

  it("returns empty items when response has no data array", async () => {
    mocks.resolveSecretValue.mockResolvedValue({ value: "sk-test-key", source: "stored" });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ object: "list" }),
    } as Response);

    const { app } = createHarness();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/openai/models",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items).toEqual([]);
    fetchSpy.mockRestore();
    await app.close();
  });
});
