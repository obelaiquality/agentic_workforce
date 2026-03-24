import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    appSetting: {
      findUnique: vi.fn(),
    },
    secretRecord: {
      findUnique: vi.fn(),
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

  registerSettingsRoutes({
    app,
    channelService: channelService as never,
  });

  return { app, channelService };
}

describe("settingsRoutes secret redaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();

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
});
