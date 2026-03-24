#!/usr/bin/env node
import http from "node:http";
import path from "node:path";
import { randomUUID } from "node:crypto";
import prismaClientPkg from "@prisma/client";
import {
  createTempDir,
  ensureDir,
  getArgValue,
  hasArg,
  seedExistingRepoFixture,
  writeJson,
} from "./suite-utils.mjs";

const { PrismaClient } = prismaClientPkg;

const argv = process.argv.slice(2);
const command = argv[0];

function usage() {
  return `
settings_openai_helper.mjs <command> [options]

Commands:
  schema-url --schema <name>
  get-free-port
  capture-state --api-base-url <url> --api-token <token> [--output <file>]
  prime-openai --api-base-url <url> --api-token <token> [--daily-budget <usd>] [--per-run-budget <usd>] [--output <file>]
  restore --baseline <file> [--output <file>]
  seed-budget --mode <exhausted|clear> [--used-usd <usd>] [--output <file>]
  seed-approval-fixture [--repo-dir <dir>] [--output <file>]
  inspect-approval --approval-id <id> [--ticket-id <id>] [--run-id <id>] [--output <file>]
  wait-chat-failure --session-id <id> [--timeout-ms <ms>] [--output <file>]
  drop-schema --schema <name>
  mock-openai-compatible --port <port> [--host <host>]
`.trim();
}

function fail(message) {
  throw new Error(message);
}

function requireArg(flag) {
  const value = getArgValue(argv, flag);
  if (typeof value !== "string" || !value.trim()) {
    fail(`Missing required argument ${flag}`);
  }
  return value.trim();
}

function maybeArg(flag, fallback = null) {
  const value = getArgValue(argv, flag, fallback ?? undefined);
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : fallback;
}

function numberArg(flag, fallback) {
  const value = maybeArg(flag, null);
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    fail(`Argument ${flag} must be a finite number`);
  }
  return parsed;
}

function outputArg() {
  return maybeArg("--output", null);
}

function baseDatabaseUrl() {
  const candidate = process.env.BASE_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!candidate) {
    fail("BASE_DATABASE_URL or DATABASE_URL must be set.");
  }
  return candidate;
}

function schemaUrlFor(schemaName) {
  if (!/^[a-zA-Z0-9_]+$/.test(schemaName)) {
    fail(`Invalid schema name '${schemaName}'. Use only letters, digits, and underscores.`);
  }
  const url = new URL(baseDatabaseUrl());
  url.searchParams.set("schema", schemaName);
  return url.toString();
}

function prismaFor(url = process.env.DATABASE_URL) {
  if (!url?.trim()) {
    fail("DATABASE_URL must be set for Prisma-backed helper commands.");
  }
  return new PrismaClient({
    datasources: {
      db: {
        url,
      },
    },
    log: ["error"],
  });
}

async function withPrisma(fn, url = process.env.DATABASE_URL) {
  const prisma = prismaFor(url);
  try {
    return await fn(prisma);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

function normalizeBaseUrl(url) {
  return url.replace(/\/+$/, "");
}

async function apiJson({ apiBaseUrl, apiToken, method = "GET", route, body }) {
  const response = await fetch(`${normalizeBaseUrl(apiBaseUrl)}${route}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-local-api-token": apiToken,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { response, text, json };
}

function serialize(value) {
  return JSON.parse(JSON.stringify(value));
}

function dedupe(items) {
  return [...new Set(items.filter((item) => typeof item === "string" && item.trim()))];
}

function pickByPreference(ids, preferred, fallbackMatchers = []) {
  for (const modelId of preferred) {
    if (ids.includes(modelId)) {
      return modelId;
    }
  }
  for (const matcher of fallbackMatchers) {
    const match = ids.find((item) => matcher.test(item));
    if (match) {
      return match;
    }
  }
  return ids[0] || "gpt-5-nano";
}

function chooseOpenAiModels(items) {
  const ids = dedupe((items || []).map((item) => item.id));
  if (ids.length === 0) {
    fail("OpenAI model discovery returned zero models. Ensure OPENAI_API_KEY is valid before running this suite.");
  }

  const fastModel = pickByPreference(ids, ["gpt-5-nano", "gpt-4.1-mini", "gpt-4o-mini"], [
    /^gpt-5-nano$/i,
    /^gpt-.*mini$/i,
    /^gpt-.*nano$/i,
  ]);
  const buildModel = pickByPreference(ids, ["gpt-5.3-codex", "gpt-5-codex", "gpt-5.4", "gpt-5"], [
    /codex/i,
    /^gpt-5/i,
  ]);
  const reviewModel = pickByPreference(ids, ["gpt-5.4", "gpt-5.3-codex", "gpt-5", "gpt-4.1"], [
    /^gpt-5\.4$/i,
    /^gpt-5/i,
    /^gpt-4\.1/i,
  ]);
  const escalationModel = pickByPreference(ids, [reviewModel, buildModel, fastModel], [/^gpt-/i]);

  return {
    globalModel: fastModel,
    fastModel,
    buildModel,
    reviewModel,
    escalationModel,
  };
}

function buildOpenAiRoleBindings(selection) {
  return {
    utility_fast: {
      role: "utility_fast",
      providerId: "openai-responses",
      pluginId: null,
      model: selection.fastModel,
      temperature: 0.1,
      maxTokens: 900,
      reasoningMode: "off",
    },
    coder_default: {
      role: "coder_default",
      providerId: "openai-responses",
      pluginId: null,
      model: selection.buildModel,
      temperature: 0.12,
      maxTokens: 1800,
      reasoningMode: "auto",
    },
    review_deep: {
      role: "review_deep",
      providerId: "openai-responses",
      pluginId: null,
      model: selection.reviewModel,
      temperature: 0.08,
      maxTokens: 2200,
      reasoningMode: "on",
    },
    overseer_escalation: {
      role: "overseer_escalation",
      providerId: "openai-responses",
      pluginId: null,
      model: selection.escalationModel,
      temperature: 0.05,
      maxTokens: 2600,
      reasoningMode: "on",
    },
  };
}

async function writeOutput(value) {
  const outputPath = outputArg();
  if (!outputPath) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  await writeJson(outputPath, value);
}

async function captureRawDatabase(prisma) {
  const [appSettings, secretRecords, providerBudgetProjection, modelPluginRegistry] = await Promise.all([
    prisma.appSetting.findMany({ orderBy: { key: "asc" } }),
    prisma.secretRecord.findMany({ orderBy: { name: "asc" } }),
    prisma.providerBudgetProjection.findMany({ orderBy: [{ providerId: "asc" }, { id: "asc" }] }),
    prisma.modelPluginRegistry.findMany({ orderBy: { pluginId: "asc" } }),
  ]);
  return serialize({
    appSettings,
    secretRecords,
    providerBudgetProjection,
    modelPluginRegistry,
  });
}

async function captureStateCommand() {
  const apiBaseUrl = requireArg("--api-base-url");
  const apiToken = requireArg("--api-token");

  const [settings, budget, models, providers] = await Promise.all([
    apiJson({ apiBaseUrl, apiToken, route: "/api/v1/settings" }),
    apiJson({ apiBaseUrl, apiToken, route: "/api/v3/providers/openai/budget" }),
    apiJson({ apiBaseUrl, apiToken, route: "/api/v1/openai/models" }),
    apiJson({ apiBaseUrl, apiToken, route: "/api/v1/providers" }),
  ]);

  const db = await withPrisma((prisma) => captureRawDatabase(prisma));
  await writeOutput({
    capturedAt: new Date().toISOString(),
    apiBaseUrl,
    settings: settings.json?.items ?? null,
    budget: budget.json?.item ?? null,
    models: models.json ?? null,
    providers: providers.json ?? null,
    db,
  });
}

async function primeOpenAiCommand() {
  const apiBaseUrl = requireArg("--api-base-url");
  const apiToken = requireArg("--api-token");
  const dailyBudgetUsd = numberArg("--daily-budget", 0.6);
  const perRunBudgetUsd = numberArg("--per-run-budget", 0.2);

  const modelResponse = await apiJson({ apiBaseUrl, apiToken, route: "/api/v1/openai/models" });
  if (!modelResponse.response.ok) {
    fail(`OpenAI model discovery failed with HTTP ${modelResponse.response.status}: ${modelResponse.text}`);
  }
  if (modelResponse.json?.error) {
    fail(`OpenAI model discovery returned an error: ${modelResponse.json.error}`);
  }

  const selection = chooseOpenAiModels(modelResponse.json?.items ?? []);

  const runtimeModeResponse = await apiJson({
    apiBaseUrl,
    apiToken,
    method: "POST",
    route: "/api/v1/settings/runtime-mode",
    body: {
      mode: "openai_api",
      openAiModel: selection.globalModel,
    },
  });
  if (!runtimeModeResponse.response.ok) {
    fail(`Failed to switch runtime mode to openai_api: ${runtimeModeResponse.text}`);
  }

  const patchResponse = await apiJson({
    apiBaseUrl,
    apiToken,
    method: "PATCH",
    route: "/api/v1/settings",
    body: {
      openAiResponses: {
        model: selection.globalModel,
        dailyBudgetUsd,
        perRunBudgetUsd,
      },
      modelRoles: buildOpenAiRoleBindings(selection),
    },
  });
  if (!patchResponse.response.ok) {
    fail(`Failed to patch OpenAI settings: ${patchResponse.text}`);
  }

  const [settingsAfter, budgetAfter] = await Promise.all([
    apiJson({ apiBaseUrl, apiToken, route: "/api/v1/settings" }),
    apiJson({ apiBaseUrl, apiToken, route: "/api/v3/providers/openai/budget" }),
  ]);

  await writeOutput({
    primedAt: new Date().toISOString(),
    chosenModels: selection,
    modelCount: modelResponse.json?.items?.length ?? 0,
    settings: settingsAfter.json?.items ?? null,
    budget: budgetAfter.json?.item ?? null,
  });
}

async function restoreCommand() {
  const baselinePath = requireArg("--baseline");
  const baseline = JSON.parse(await (await import("node:fs/promises")).readFile(baselinePath, "utf8"));

  await withPrisma(async (prisma) => {
    await prisma.$transaction(async (tx) => {
      await tx.modelPluginRegistry.deleteMany({});
      await tx.providerBudgetProjection.deleteMany({});
      await tx.secretRecord.deleteMany({});
      await tx.appSetting.deleteMany({});

      if (Array.isArray(baseline.db?.appSettings) && baseline.db.appSettings.length > 0) {
        await tx.appSetting.createMany({
          data: baseline.db.appSettings.map((row) => ({
            key: row.key,
            value: row.value,
          })),
        });
      }

      if (Array.isArray(baseline.db?.secretRecords) && baseline.db.secretRecords.length > 0) {
        await tx.secretRecord.createMany({
          data: baseline.db.secretRecords.map((row) => ({
            name: row.name,
            ciphertext: row.ciphertext,
          })),
        });
      }

      if (Array.isArray(baseline.db?.providerBudgetProjection) && baseline.db.providerBudgetProjection.length > 0) {
        await tx.providerBudgetProjection.createMany({
          data: baseline.db.providerBudgetProjection.map((row) => ({
            id: row.id,
            providerId: row.providerId,
            dailyBudgetUsd: row.dailyBudgetUsd,
            usedUsd: row.usedUsd,
            requestCount: row.requestCount,
            cooldownUntil: row.cooldownUntil ? new Date(row.cooldownUntil) : null,
            metadata: row.metadata ?? {},
            createdAt: row.createdAt ? new Date(row.createdAt) : undefined,
          })),
        });
      }

      if (Array.isArray(baseline.db?.modelPluginRegistry) && baseline.db.modelPluginRegistry.length > 0) {
        await tx.modelPluginRegistry.createMany({
          data: baseline.db.modelPluginRegistry.map((row) => ({
            pluginId: row.pluginId,
            providerId: row.providerId,
            modelId: row.modelId,
            paramsB: row.paramsB ?? null,
            active: Boolean(row.active),
            capabilities: row.capabilities ?? {},
          })),
        });
      }
    });
  });

  await writeOutput({
    restoredAt: new Date().toISOString(),
    baseline: baselinePath,
    ok: true,
  });
}

async function seedBudgetCommand() {
  const mode = requireArg("--mode");
  const usedUsd = numberArg("--used-usd", 0.6);

  if (mode !== "exhausted" && mode !== "clear") {
    fail("seed-budget --mode must be exhausted or clear");
  }

  const result = await withPrisma(async (prisma) => {
    if (mode === "clear") {
      await prisma.providerBudgetProjection.deleteMany({
        where: { providerId: "openai-responses" },
      });
      return { mode, cleared: true };
    }

    const configRow = await prisma.appSetting.findUnique({ where: { key: "openai_responses_config" } });
    const config = (configRow?.value ?? {}) || {};
    const dailyBudgetUsd =
      typeof config.dailyBudgetUsd === "number"
        ? Math.max(config.dailyBudgetUsd, usedUsd)
        : Math.max(usedUsd, 1);

    const row = await prisma.providerBudgetProjection.upsert({
      where: { providerId: "openai-responses" },
      update: {
        dailyBudgetUsd,
        usedUsd,
        requestCount: 999,
        cooldownUntil: null,
        metadata: {
          seededBy: "settings-openai-helper",
          seededAt: new Date().toISOString(),
        },
      },
      create: {
        providerId: "openai-responses",
        dailyBudgetUsd,
        usedUsd,
        requestCount: 999,
        cooldownUntil: null,
        metadata: {
          seededBy: "settings-openai-helper",
          seededAt: new Date().toISOString(),
        },
      },
    });
    return serialize(row);
  });

  await writeOutput({
    seededAt: new Date().toISOString(),
    mode,
    item: result,
  });
}

async function ensureRepoFixture(repoDir) {
  const fs = await import("node:fs/promises");
  const absoluteRepoDir = path.resolve(repoDir || (await createTempDir("settings-openai-approval-")));
  try {
    await fs.access(path.join(absoluteRepoDir, ".git"));
    return absoluteRepoDir;
  } catch {
    await seedExistingRepoFixture(absoluteRepoDir);
    return absoluteRepoDir;
  }
}

async function seedApprovalFixtureCommand() {
  const requestedRepoDir = maybeArg("--repo-dir", null);
  const worktreePath = await ensureRepoFixture(requestedRepoDir ?? undefined);

  const fixture = await withPrisma(async (prisma) => {
    const repo = await prisma.repoRegistry.create({
      data: {
        displayName: path.basename(worktreePath) || "settings-openai-approval",
        sourceKind: "local",
        sourceUri: worktreePath,
        canonicalRoot: worktreePath,
        managedWorktreeRoot: worktreePath,
        defaultBranch: "main",
        active: false,
        metadata: {
          seededBy: "settings-openai-helper",
        },
      },
    });

    const ticket = await prisma.ticket.create({
      data: {
        repoId: repo.id,
        title: "Settings OpenAI approval relay fixture",
        description: "Disposable approval relay fixture for settings E2E.",
        status: "review",
        risk: "low",
      },
    });

    const runId = randomUUID();
    const run = await prisma.runProjection.create({
      data: {
        runId,
        ticketId: ticket.id,
        status: "review",
        providerId: "openai-responses",
        metadata: {
          repo_id: repo.id,
          ticket_id: ticket.id,
          worktree_path: worktreePath,
          workspace_path: worktreePath,
          provider_id: "openai-responses",
          model_role: "coder_default",
        },
      },
    });

    const approval = await prisma.approvalRequest.create({
      data: {
        actionType: "command_tool_invocation",
        payload: {
          run_id: run.runId,
          ticket_id: ticket.id,
          repo_id: repo.id,
          project_id: repo.id,
          stage: "build",
          tool_type: "repo.read",
          display_command: "ls",
          worktree_path: worktreePath,
          risk_level: "low",
        },
      },
    });

    return serialize({
      repoId: repo.id,
      ticketId: ticket.id,
      runId: run.runId,
      approvalId: approval.id,
      worktreePath,
    });
  });

  await writeOutput({
    seededAt: new Date().toISOString(),
    fixture,
  });
}

async function inspectApprovalCommand() {
  const approvalId = requireArg("--approval-id");
  const ticketId = maybeArg("--ticket-id", null);
  const runId = maybeArg("--run-id", null);

  const result = await withPrisma(async (prisma) => {
    const [approval, ticket, runProjection] = await Promise.all([
      prisma.approvalRequest.findUnique({ where: { id: approvalId } }),
      ticketId ? prisma.ticket.findUnique({ where: { id: ticketId } }) : Promise.resolve(null),
      runId ? prisma.runProjection.findUnique({ where: { runId } }) : Promise.resolve(null),
    ]);
    return serialize({
      approval,
      ticket,
      runProjection,
    });
  });

  await writeOutput(result);
}

async function waitChatFailureCommand() {
  const sessionId = requireArg("--session-id");
  const timeoutMs = numberArg("--timeout-ms", 60000);
  const deadline = Date.now() + timeoutMs;

  const result = await withPrisma(async (prisma) => {
    while (Date.now() < deadline) {
      const row = await prisma.auditEvent.findFirst({
        where: {
          eventType: "chat.turn_failed",
          payload: {
            path: ["sessionId"],
            equals: sessionId,
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      if (row) {
        return serialize({
          found: true,
          event: row,
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    fail(`Timed out waiting for chat.turn_failed audit event for session ${sessionId}`);
  });

  await writeOutput(result);
}

async function dropSchemaCommand() {
  const schemaName = requireArg("--schema");
  const publicUrl = schemaUrlFor("public");

  await withPrisma(
    async (prisma) => {
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    },
    publicUrl,
  );

  process.stdout.write(`dropped:${schemaName}\n`);
}

async function mockOpenAiCompatibleCommand() {
  const host = maybeArg("--host", "127.0.0.1");
  const port = numberArg("--port", NaN);
  if (!Number.isInteger(port) || port <= 0) {
    fail("--port must be a positive integer");
  }

  const models = [
    {
      id: "mock-openai-compatible-small",
      created: 1,
      owned_by: "settings-openai-helper",
    },
    {
      id: "mock-openai-compatible-large",
      created: 2,
      owned_by: "settings-openai-helper",
    },
  ];

  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url || "/", `http://${host}:${port}`);
    const reply = (status, payload) => {
      response.writeHead(status, {
        "content-type": "application/json",
      });
      response.end(JSON.stringify(payload));
    };

    if (request.method === "GET" && requestUrl.pathname === "/health") {
      reply(200, { ok: true });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/v1/models") {
      reply(200, { object: "list", data: models });
      return;
    }

    if (request.method === "POST" && (requestUrl.pathname === "/v1/chat/completions" || requestUrl.pathname === "/v1/responses")) {
      const chunks = [];
      for await (const chunk of request) {
        chunks.push(chunk);
      }
      reply(200, {
        id: `mock-${Date.now()}`,
        object: "response",
        model: "mock-openai-compatible-small",
        input: Buffer.concat(chunks).toString("utf8"),
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "mock openai-compatible response" }],
          },
        ],
      });
      return;
    }

    reply(404, {
      error: {
        message: `Unhandled ${request.method} ${requestUrl.pathname}`,
      },
    });
  });

  server.listen(port, host, () => {
    process.stdout.write(`mock-openai-compatible listening on http://${host}:${port}\n`);
  });

  const shutdown = () =>
    new Promise((resolve) => {
      server.close(() => resolve());
    });

  process.on("SIGINT", async () => {
    await shutdown();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await shutdown();
    process.exit(0);
  });
}

async function getFreePortCommand() {
  const net = await import("node:net");
  const port = await new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      const selectedPort = typeof address === "object" && address ? address.port : null;
      listener.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(selectedPort);
      });
    });
  });
  process.stdout.write(`${String(port)}\n`);
}

async function main() {
  if (!command || hasArg(argv, "--help")) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  switch (command) {
    case "schema-url": {
      const schemaName = requireArg("--schema");
      process.stdout.write(`${schemaUrlFor(schemaName)}\n`);
      return;
    }
    case "get-free-port":
      await getFreePortCommand();
      return;
    case "capture-state":
      await captureStateCommand();
      return;
    case "prime-openai":
      await primeOpenAiCommand();
      return;
    case "restore":
      await restoreCommand();
      return;
    case "seed-budget":
      await seedBudgetCommand();
      return;
    case "seed-approval-fixture":
      await seedApprovalFixtureCommand();
      return;
    case "inspect-approval":
      await inspectApprovalCommand();
      return;
    case "wait-chat-failure":
      await waitChatFailureCommand();
      return;
    case "drop-schema":
      await dropSchemaCommand();
      return;
    case "mock-openai-compatible":
      await mockOpenAiCompatibleCommand();
      return;
    default:
      fail(`Unknown command '${command}'.\n\n${usage()}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
