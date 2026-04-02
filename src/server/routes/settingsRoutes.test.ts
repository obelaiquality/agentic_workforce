import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    appSetting: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    secretRecord: {
      findUnique: vi.fn(),
    },
    auditEvent: {
      create: vi.fn(),
    },
  },
}));

vi.mock("../db", () => ({
  prisma: mocks.prisma,
}));

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
    expect(mocks.prisma.appSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "mcp_server_configs" },
      })
    );
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
