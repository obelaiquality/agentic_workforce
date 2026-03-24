import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import os from "node:os";
import { prisma } from "../db";
import { publishEvent } from "../eventBus";
import {
  buildStartupCommandForBaseUrl,
  listOnPremInferenceBackends,
  resolveOnPremInferenceBackend,
} from "../providers/inferenceBackends";
import { resolveOnPremQwenModelPlugin } from "../providers/modelPlugins";
import type {
  BackendBenchmarkResult,
  BackendHealthStatus,
  HardwareProfile,
  InferenceAutotuneResult,
  InferenceBenchmarkProfile,
  LocalRuntimeRole,
  OnPremRoleRuntimeStatus,
  OnPremRoleRuntimeTestResult,
  OnPremInferenceBackendDescriptor,
  OnPremInferenceBackendId,
  PromptCacheMetrics,
} from "../../shared/contracts";
import { getCandidateOrderForHardware, scoreBenchmark } from "./inferenceScoring";
import { PROVIDER_SECRET_NAMES, resolveSecretValue } from "./secretStore";
import { V2EventService } from "./v2EventService";

const runtimeProcesses = new Map<OnPremInferenceBackendId, ChildProcessWithoutNullStreams>();
const roleRuntimeProcesses = new Map<LocalRuntimeRole, ChildProcessWithoutNullStreams>();

type RoleRuntimeConfig = {
  role: LocalRuntimeRole;
  enabled: boolean;
  configured: boolean;
  baseUrl: string;
  model: string;
  backendId: OnPremInferenceBackendId;
};

function p95(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));
  return sorted[index];
}

function commandAvailable(command: string) {
  const probeArg = process.platform === "win32" ? "/c" : "-lc";
  const probeCmd = process.platform === "win32" ? "where" : "command -v";
  const result = spawnSync(process.platform === "win32" ? "cmd" : "bash", [probeArg, `${probeCmd} ${command}`], {
    encoding: "utf-8",
    timeout: 4000,
  });
  return result.status === 0;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function stripV1Suffix(baseUrl: string) {
  return baseUrl.replace(/\/v1\/?$/, "").replace(/\/+$/, "");
}

function parseRoleRuntimeConfig(
  raw: unknown,
  fallback: {
    baseUrl: string;
    model: string;
    inferenceBackendId: OnPremInferenceBackendId;
  },
  role: LocalRuntimeRole
): RoleRuntimeConfig {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const plugin = resolveOnPremQwenModelPlugin(typeof value.pluginId === "string" ? value.pluginId : undefined);
  const model =
    typeof value.model === "string" && value.model.trim().length > 0
      ? value.model
      : plugin.runtimeModel !== "custom"
        ? plugin.runtimeModel
        : fallback.model;
  const backendId =
    typeof value.inferenceBackendId === "string"
      ? (value.inferenceBackendId as OnPremInferenceBackendId)
      : (plugin.recommendedBackend as OnPremInferenceBackendId) || fallback.inferenceBackendId;
  const baseUrl =
    typeof value.baseUrl === "string" && value.baseUrl.trim().length > 0
      ? value.baseUrl.trim()
      : resolveOnPremInferenceBackend(backendId).baseUrlDefault;
  const enabled = value.enabled === true;
  return {
    role,
    enabled,
    configured: baseUrl.length > 0 && model.length > 0,
    baseUrl,
    model,
    backendId,
  };
}

export class InferenceTuningService {
  constructor(private readonly events: V2EventService) {}

  private async detectRunningBackendId(baseUrl: string): Promise<OnPremInferenceBackendId | null> {
    const healthUrl = `${stripV1Suffix(baseUrl)}/health`;
    try {
      const response = await fetchWithTimeout(healthUrl, { method: "GET" }, 3000);
      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as Record<string, unknown>;
      if (payload.status === "ok" && typeof payload.model !== "string") {
        return "mlx-lm";
      }

      if (payload.ok === true && typeof payload.model === "string") {
        return "transformers-openai";
      }
    } catch {
      return null;
    }

    return null;
  }

  private async logCommand(commandType: string, actor: string, aggregateId: string | null, payload: Record<string, unknown>) {
    return prisma.commandLog.create({
      data: {
        commandType,
        actor,
        aggregateId,
        payload,
        status: "queued",
      },
    });
  }

  private async completeCommand(
    id: string,
    status: "executed" | "approved" | "rejected" | "failed",
    result: Record<string, unknown>
  ) {
    return prisma.commandLog.update({
      where: { id },
      data: {
        status,
        result,
      },
    });
  }

  private cachedHardwareProfile: HardwareProfile | null = null;

  getHardwareProfile(): HardwareProfile {
    if (this.cachedHardwareProfile) {
      return this.cachedHardwareProfile;
    }

    const profile = this.detectHardwareProfile();
    this.cachedHardwareProfile = profile;
    return profile;
  }

  private detectHardwareProfile(): HardwareProfile {
    if (process.platform === "darwin" && process.arch === "arm64") {
      let unifiedMemoryMb: number | undefined;
      try {
        const result = spawnSync("sysctl", ["-n", "hw.memsize"], {
          encoding: "utf-8",
          timeout: 3000,
          stdio: ["ignore", "pipe", "pipe"],
        });
        if (result.status === 0 && result.stdout) {
          const bytes = parseInt(result.stdout.trim(), 10);
          if (Number.isFinite(bytes) && bytes > 0) {
            unifiedMemoryMb = Math.round(bytes / (1024 * 1024));
          }
        }
      } catch {
        // sysctl unavailable
      }
      return { platform: "apple-silicon", unifiedMemoryMb };
    }

    if (process.env.CUDA_VISIBLE_DEVICES || process.env.NVIDIA_VISIBLE_DEVICES) {
      return { platform: "nvidia-cuda", ...this.probeNvidiaGpu() };
    }

    const nvidia = spawnSync("nvidia-smi", [], { stdio: "ignore", timeout: 2500, shell: process.platform === "win32" });
    if (nvidia.status === 0) {
      return { platform: "nvidia-cuda", ...this.probeNvidiaGpu() };
    }

    return { platform: "generic-cpu" };
  }

  private probeNvidiaGpu(): { vramMb?: number; computeCapability?: string } {
    try {
      const result = spawnSync(
        "nvidia-smi",
        ["--query-gpu=memory.total,compute_cap", "--format=csv,noheader,nounits"],
        { encoding: "utf-8", timeout: 4000, stdio: ["ignore", "pipe", "pipe"] }
      );
      if (result.status === 0 && result.stdout) {
        const line = result.stdout.trim().split("\n")[0];
        const parts = line.split(",").map((s) => s.trim());
        const vramMb = parseInt(parts[0], 10);
        const computeCapability = parts[1] || undefined;
        return {
          vramMb: Number.isFinite(vramMb) && vramMb > 0 ? vramMb : undefined,
          computeCapability,
        };
      }
    } catch {
      // nvidia-smi query failed
    }
    return {};
  }

  canLoadModel(minVramGb: number): boolean {
    const profile = this.getHardwareProfile();
    if (profile.platform === "apple-silicon") {
      const availableMb = profile.unifiedMemoryMb ?? 0;
      return availableMb >= minVramGb * 1024;
    }
    if (profile.platform === "nvidia-cuda") {
      const availableMb = profile.vramMb ?? 0;
      return availableMb >= minVramGb * 1024;
    }
    return false;
  }

  private async getOnPremConfig() {
    const row = await prisma.appSetting.findUnique({ where: { key: "onprem_qwen_config" } });
    const value = (row?.value as Record<string, unknown> | null) || {};
    const resolvedApiKey = await resolveSecretValue(
      prisma,
      PROVIDER_SECRET_NAMES.onPremQwenApiKey,
      process.env.ONPREM_QWEN_API_KEY || "",
    );
    const plugin = resolveOnPremQwenModelPlugin(typeof value.pluginId === "string" ? value.pluginId : undefined);
    const model =
      typeof value.model === "string" && value.model.trim().length > 0
        ? value.model
        : plugin.runtimeModel;
    const timeoutMs = typeof value.timeoutMs === "number" ? Math.max(5000, value.timeoutMs) : 120000;
    const temperature = typeof value.temperature === "number" ? value.temperature : 0.15;
    const maxTokens = typeof value.maxTokens === "number" ? value.maxTokens : 1600;
    const inferenceBackendId =
      typeof value.inferenceBackendId === "string" ? (value.inferenceBackendId as OnPremInferenceBackendId) : "mlx-lm";
    const baseUrl =
      typeof value.baseUrl === "string" && value.baseUrl.trim().length > 0
        ? value.baseUrl
        : resolveOnPremInferenceBackend(inferenceBackendId).baseUrlDefault;

    return {
      raw: value,
      model,
      timeoutMs,
      temperature,
      maxTokens,
      apiKey: resolvedApiKey.value,
      inferenceBackendId,
      baseUrl,
    };
  }

  private async getRoleRuntimeConfigs(): Promise<Record<LocalRuntimeRole, RoleRuntimeConfig>> {
    const [baseConfig, row] = await Promise.all([
      this.getOnPremConfig(),
      prisma.appSetting.findUnique({ where: { key: "onprem_qwen_role_runtime_configs" } }),
    ]);
    const raw = (row?.value as Record<string, unknown> | null) || {};
    return {
      utility_fast: parseRoleRuntimeConfig(raw.utility_fast, baseConfig, "utility_fast"),
      coder_default: parseRoleRuntimeConfig(raw.coder_default, baseConfig, "coder_default"),
      review_deep: parseRoleRuntimeConfig(raw.review_deep, baseConfig, "review_deep"),
    };
  }

  private async probeRuntime(baseUrl: string) {
    const healthUrl = `${stripV1Suffix(baseUrl)}/health`;
    const modelsUrl = `${baseUrl.replace(/\/+$/, "")}/models`;
    try {
      const response = await fetchWithTimeout(healthUrl, { method: "GET" }, 5000);
      if (response.ok) {
        return { healthy: true, modelCount: 0, message: "health endpoint reachable" };
      }
    } catch {
      // fall through
    }
    try {
      const response = await fetchWithTimeout(modelsUrl, { method: "GET" }, 5000);
      if (response.ok) {
        const payload = (await response.json()) as { data?: unknown[] };
        return {
          healthy: true,
          modelCount: Array.isArray(payload.data) ? payload.data.length : 0,
          message: "models endpoint reachable",
        };
      }
      return {
        healthy: false,
        modelCount: 0,
        message: `models endpoint returned ${response.status}`,
      };
    } catch (error) {
      return {
        healthy: false,
        modelCount: 0,
        message: error instanceof Error ? error.message : "runtime unavailable",
      };
    }
  }

  async listRoleRuntimeStatuses(): Promise<OnPremRoleRuntimeStatus[]> {
    const configs = await this.getRoleRuntimeConfigs();
    const roles = Object.keys(configs) as LocalRuntimeRole[];
    return Promise.all(
      roles.map(async (role) => {
        const config = configs[role];
        const process = roleRuntimeProcesses.get(role);
        const probe = config.enabled && config.configured ? await this.probeRuntime(config.baseUrl) : null;
        return {
          role,
          enabled: config.enabled,
          configured: config.configured,
          baseUrl: config.baseUrl,
          model: config.model,
          backendId: config.backendId,
          running: Boolean(process),
          pid: process?.pid ?? null,
          healthy: probe?.healthy ?? null,
          message: probe?.message ?? (config.enabled ? "runtime not tested yet" : "dedicated runtime disabled"),
        };
      })
    );
  }

  async testRoleRuntime(input: { role: LocalRuntimeRole }): Promise<OnPremRoleRuntimeTestResult> {
    const configs = await this.getRoleRuntimeConfigs();
    const config = configs[input.role];
    const process = roleRuntimeProcesses.get(input.role);
    const probe = config.enabled && config.configured ? await this.probeRuntime(config.baseUrl) : null;
    return {
      role: input.role,
      enabled: config.enabled,
      configured: config.configured,
      baseUrl: config.baseUrl,
      model: config.model,
      backendId: config.backendId,
      running: Boolean(process),
      pid: process?.pid ?? null,
      healthy: probe?.healthy ?? false,
      modelCount: probe?.modelCount ?? 0,
      message: probe?.message ?? "runtime not configured",
    };
  }

  async listBackends() {
    const config = await this.getOnPremConfig();
    const descriptors = listOnPremInferenceBackends();

    return descriptors.map((backend) => {
      const primaryCommand = backend.startupCommandTemplate.trim().split(/\s+/)[0] || "";
      return {
        ...backend,
        active: backend.id === config.inferenceBackendId,
        running: runtimeProcesses.has(backend.id),
        commandAvailable: primaryCommand ? commandAvailable(primaryCommand) : false,
      };
    });
  }

  private async runProbe(
    backend: OnPremInferenceBackendDescriptor,
    config: Awaited<ReturnType<InferenceTuningService["getOnPremConfig"]>>,
    profile: InferenceBenchmarkProfile
  ): Promise<BackendBenchmarkResult> {
    const samples = 3;
    const latencies: number[] = [];
    const ttfts: number[] = [];
    const tokPerSec: number[] = [];
    let failures = 0;
    const model = config.model;
    const baseUrl = backend.id === config.inferenceBackendId ? config.baseUrl : backend.baseUrlDefault;
    const endpoint = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const modelsEndpoint = `${baseUrl.replace(/\/+$/, "")}/models`;

    const memHeadroom = Number(((os.freemem() / Math.max(1, os.totalmem())) * 100).toFixed(2));

    try {
      const modelsResponse = await fetchWithTimeout(
        modelsEndpoint,
        {
          method: "GET",
          headers: config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {},
        },
        5000
      );
      if (!modelsResponse.ok) {
        failures += 1;
      }
    } catch {
      failures += 1;
    }

    for (let i = 0; i < samples; i += 1) {
      const startedAt = Date.now();
      try {
        const response = await fetchWithTimeout(
          endpoint,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
            },
            body: JSON.stringify({
              model,
              messages: [
                {
                  role: "user",
                  content:
                    profile === "tool_heavy"
                      ? "Respond with a short JSON object describing a safe coding action."
                      : "Respond with one concise sentence.",
                },
              ],
              temperature: profile === "batch" ? 0 : config.temperature,
              max_tokens: Math.min(config.maxTokens, profile === "batch" ? 120 : 200),
            }),
          },
          Math.min(config.timeoutMs, 15000)
        );

        const elapsedMs = Date.now() - startedAt;
        if (!response.ok) {
          failures += 1;
          continue;
        }

        const body = (await response.json()) as {
          usage?: { completion_tokens?: number };
          choices?: Array<{ message?: { content?: string } }>;
        };
        const completionTokens =
          typeof body.usage?.completion_tokens === "number"
            ? body.usage.completion_tokens
            : Math.max(1, Math.ceil((body.choices?.[0]?.message?.content?.length || 0) / 4));
        const tps = completionTokens / Math.max(0.001, elapsedMs / 1000);

        latencies.push(elapsedMs);
        ttfts.push(Math.max(1, Math.round(elapsedMs * 0.6)));
        tokPerSec.push(Number(tps.toFixed(2)));
      } catch {
        failures += 1;
      }
    }

    const errorRate = failures / Math.max(1, samples + 1);
    const sample = {
      backendId: backend.id,
      profile,
      ttftMsP95: p95(ttfts),
      outputTokPerSec: tokPerSec.length ? Number((tokPerSec.reduce((acc, v) => acc + v, 0) / tokPerSec.length).toFixed(2)) : 0,
      latencyMsP95: p95(latencies),
      errorRate,
      memoryHeadroomPct: memHeadroom,
    };

    return {
      ...sample,
      score: scoreBenchmark(sample),
      selected: false,
      createdAt: new Date().toISOString(),
      metadata: {
        attempts: samples,
        failures,
        baseUrl,
      },
    };
  }

  async runAutotune(input: { actor: string; profile: InferenceBenchmarkProfile; dryRun?: boolean }): Promise<InferenceAutotuneResult> {
    const command = await this.logCommand("inference.autotune", input.actor, null, {
      profile: input.profile,
      dry_run: Boolean(input.dryRun),
    });
    const profile = input.profile;
    const config = await this.getOnPremConfig();
    const hwProfile = this.getHardwareProfile();
    const hardware = hwProfile.platform;
    const candidateOrder = getCandidateOrderForHardware(hardware);
    const descriptorMap = new Map(listOnPremInferenceBackends().map((item) => [item.id, item]));
    const activeProbeUrl = config.baseUrl.replace(/\/+$/, "");
    const detectedActiveBackendId = await this.detectRunningBackendId(config.baseUrl);
    const activeBackendId = detectedActiveBackendId ?? config.inferenceBackendId;
    const seenProbeUrls = new Set<string>();

    publishEvent("global", "inference.autotune.started", {
      actor: input.actor,
      profile,
      hardware,
    });

    await this.events.appendEvent({
      type: "inference.autotune.started",
      aggregateId: `autotune:${Date.now()}`,
      actor: input.actor,
      payload: {
        profile,
        hardware,
      },
    });

    const results: BackendBenchmarkResult[] = [];
    for (const id of candidateOrder) {
      const descriptor = descriptorMap.get(id);
      if (!descriptor) continue;
      const probeUrl =
        (descriptor.id === config.inferenceBackendId ? config.baseUrl : descriptor.baseUrlDefault).replace(/\/+$/, "");

      if (probeUrl === activeProbeUrl && descriptor.id !== activeBackendId) {
        continue;
      }

      if (seenProbeUrls.has(probeUrl)) {
        continue;
      }
      seenProbeUrls.add(probeUrl);

      const result = await this.runProbe(descriptor, config, profile);
      const inserted = await prisma.inferenceBenchmarkRun.create({
        data: {
          backendId: result.backendId,
          profile: result.profile,
          ttftMsP95: result.ttftMsP95,
          outputTokPerSec: result.outputTokPerSec,
          latencyMsP95: result.latencyMsP95,
          errorRate: result.errorRate,
          memoryHeadroomPct: result.memoryHeadroomPct,
          score: result.score,
          selected: false,
          metadata: result.metadata || {},
        },
      });
      results.push({
        ...result,
        createdAt: inserted.createdAt.toISOString(),
      });
    }

    const viable = results.filter((row) => row.errorRate < 1);
    const selected = viable.sort((a, b) => b.score - a.score)[0] ?? null;

    await prisma.inferenceBenchmarkRun.updateMany({
      where: { profile },
      data: { selected: false },
    });

    if (selected) {
      const latest = await prisma.inferenceBenchmarkRun.findFirst({
        where: {
          profile,
          backendId: selected.backendId,
        },
        orderBy: { createdAt: "desc" },
      });
      if (latest) {
        await prisma.inferenceBenchmarkRun.update({
          where: { id: latest.id },
          data: { selected: true },
        });
      }

      if (!input.dryRun) {
        const defaultBaseUrl =
          selected.backendId === activeBackendId
            ? config.baseUrl
            : resolveOnPremInferenceBackend(selected.backendId).baseUrlDefault;
        await prisma.appSetting.upsert({
          where: { key: "onprem_qwen_config" },
          update: {
            value: {
              ...config.raw,
              inferenceBackendId: selected.backendId,
              baseUrl: defaultBaseUrl,
            },
          },
          create: {
            key: "onprem_qwen_config",
            value: {
              ...config.raw,
              inferenceBackendId: selected.backendId,
              baseUrl: defaultBaseUrl,
            },
          },
        });
      }
    }

    for (const backend of listOnPremInferenceBackends()) {
      await prisma.inferenceBackendProfile.upsert({
        where: { backendId: backend.id },
        update: {
          label: backend.label,
          optimizedFor: backend.optimizedFor,
          capability: {
            notes: backend.notes,
            startupCommandTemplate: backend.startupCommandTemplate,
          },
          hardwareAffinity: hardware,
        },
        create: {
          backendId: backend.id,
          label: backend.label,
          optimizedFor: backend.optimizedFor,
          capability: {
            notes: backend.notes,
            startupCommandTemplate: backend.startupCommandTemplate,
          },
          hardwareAffinity: hardware,
        },
      });
    }

    publishEvent("global", "inference.autotune.completed", {
      actor: input.actor,
      profile,
      hardware,
      selectedBackendId: selected?.backendId ?? null,
    });

    await this.events.appendEvent({
      type: "inference.autotune.completed",
      aggregateId: `autotune:${Date.now()}`,
      actor: input.actor,
      payload: {
        profile,
        hardware,
        selected_backend_id: selected?.backendId ?? null,
        dry_run: Boolean(input.dryRun),
      },
    });

    await this.completeCommand(command.id, "executed", {
      profile,
      hardware,
      selected_backend_id: selected?.backendId ?? null,
      result_count: results.length,
    });

    return {
      profile,
      strategy: "hardware-aware",
      hardware,
      selectedBackendId: selected?.backendId ?? null,
      benchmarkResults: results.map((row) => ({
        ...row,
        selected: row.backendId === selected?.backendId,
      })),
    };
  }

  async switchBackend(input: { actor: string; backendId: OnPremInferenceBackendId }) {
    const command = await this.logCommand("inference.backend.switch", input.actor, input.backendId, {
      backend_id: input.backendId,
    });
    const config = await this.getOnPremConfig();
    const backend = resolveOnPremInferenceBackend(input.backendId);
    const nextValue = {
      ...config.raw,
      inferenceBackendId: backend.id,
      baseUrl: backend.baseUrlDefault,
    };

    await prisma.appSetting.upsert({
      where: { key: "onprem_qwen_config" },
      update: { value: nextValue },
      create: { key: "onprem_qwen_config", value: nextValue },
    });

    publishEvent("global", "inference.backend.switched", {
      actor: input.actor,
      backendId: backend.id,
    });

    await this.events.appendEvent({
      type: "inference.backend.switched",
      aggregateId: backend.id,
      actor: input.actor,
      payload: {
        backend_id: backend.id,
      },
    });

    await this.completeCommand(command.id, "executed", {
      backend_id: backend.id,
      base_url: backend.baseUrlDefault,
    });

    return {
      ok: true,
      backendId: backend.id,
      baseUrl: backend.baseUrlDefault,
    };
  }

  async startBackend(input: { actor: string; backendId: OnPremInferenceBackendId }) {
    const command = await this.logCommand("inference.backend.start", input.actor, input.backendId, {
      backend_id: input.backendId,
    });
    if (runtimeProcesses.has(input.backendId)) {
      const existing = runtimeProcesses.get(input.backendId);
      await this.completeCommand(command.id, "executed", {
        already_running: true,
        pid: existing?.pid ?? null,
      });
      return {
        ok: true,
        alreadyRunning: true,
        backendId: input.backendId,
        pid: existing?.pid ?? null,
      };
    }

    const config = await this.getOnPremConfig();
    const backend = resolveOnPremInferenceBackend(input.backendId);
    const launchCommand = backend.startupCommandTemplate.replaceAll("{{model}}", config.model);
    const child = spawn(launchCommand, {
      cwd: process.cwd(),
      env: process.env,
      shell: true,
      stdio: "pipe",
    });

    const typedChild = child as ChildProcessWithoutNullStreams;
    runtimeProcesses.set(input.backendId, typedChild);

    child.on("exit", () => runtimeProcesses.delete(input.backendId));

    publishEvent("global", "inference.backend.started", {
      actor: input.actor,
      backendId: input.backendId,
      pid: child.pid || null,
    });

    await this.completeCommand(command.id, "executed", {
      backend_id: input.backendId,
      command: launchCommand,
      pid: child.pid || null,
    });

    return {
      ok: true,
      backendId: input.backendId,
      command: launchCommand,
      pid: child.pid || null,
    };
  }

  async stopBackend(input: { actor: string; backendId: OnPremInferenceBackendId }) {
    const command = await this.logCommand("inference.backend.stop", input.actor, input.backendId, {
      backend_id: input.backendId,
    });
    const child = runtimeProcesses.get(input.backendId);
    if (!child) {
      await this.completeCommand(command.id, "executed", {
        backend_id: input.backendId,
        stopped: false,
      });
      return {
        ok: true,
        backendId: input.backendId,
        stopped: false,
      };
    }
    child.kill("SIGTERM");
    runtimeProcesses.delete(input.backendId);

    publishEvent("global", "inference.backend.stopped", {
      actor: input.actor,
      backendId: input.backendId,
    });

    await this.completeCommand(command.id, "executed", {
      backend_id: input.backendId,
      stopped: true,
    });

    return {
      ok: true,
      backendId: input.backendId,
      stopped: true,
    };
  }

  async startRoleRuntime(input: { actor: string; role: LocalRuntimeRole }) {
    const configs = await this.getRoleRuntimeConfigs();
    const config = configs[input.role];
    if (!config.enabled || !config.configured) {
      return {
        ok: false,
        role: input.role,
        started: false,
        reason: "dedicated runtime is disabled or incomplete",
      };
    }

    const existing = roleRuntimeProcesses.get(input.role);
    if (existing) {
      return {
        ok: true,
        role: input.role,
        started: false,
        alreadyRunning: true,
        pid: existing.pid ?? null,
      };
    }

    const backend = resolveOnPremInferenceBackend(config.backendId);
    const launchCommand = buildStartupCommandForBaseUrl(backend, config.model, config.baseUrl);
    const child = spawn(launchCommand, {
      cwd: process.cwd(),
      env: process.env,
      shell: true,
      stdio: "pipe",
    }) as ChildProcessWithoutNullStreams;

    roleRuntimeProcesses.set(input.role, child);
    child.on("exit", () => roleRuntimeProcesses.delete(input.role));

    publishEvent("global", "inference.role_runtime.started", {
      actor: input.actor,
      role: input.role,
      backendId: config.backendId,
      baseUrl: config.baseUrl,
      pid: child.pid ?? null,
    });

    return {
      ok: true,
      role: input.role,
      started: true,
      command: launchCommand,
      pid: child.pid ?? null,
    };
  }

  async stopRoleRuntime(input: { actor: string; role: LocalRuntimeRole }) {
    const child = roleRuntimeProcesses.get(input.role);
    if (!child) {
      return {
        ok: true,
        role: input.role,
        stopped: false,
      };
    }
    child.kill("SIGTERM");
    roleRuntimeProcesses.delete(input.role);

    publishEvent("global", "inference.role_runtime.stopped", {
      actor: input.actor,
      role: input.role,
    });

    return {
      ok: true,
      role: input.role,
      stopped: true,
    };
  }

  async startEnabledRoleRuntimes(input: { actor: string }) {
    const configs = await this.getRoleRuntimeConfigs();
    const roles = (Object.keys(configs) as LocalRuntimeRole[]).filter((role) => configs[role].enabled && configs[role].configured);
    const results = [];
    for (const role of roles) {
      results.push(await this.startRoleRuntime({ actor: input.actor, role }));
    }
    return {
      ok: true,
      started: results,
    };
  }

  async getLatestBenchmarks(profile?: InferenceBenchmarkProfile) {
    const rows = await prisma.inferenceBenchmarkRun.findMany({
      where: profile ? { profile } : undefined,
      orderBy: [{ createdAt: "desc" }],
      take: 50,
    });

    const dedup = new Map<string, typeof rows[number]>();
    for (const row of rows) {
      const key = `${row.profile}:${row.backendId}`;
      if (!dedup.has(key)) {
        dedup.set(key, row);
      }
    }

    return Array.from(dedup.values()).map((row) => ({
      backendId: row.backendId as OnPremInferenceBackendId,
      profile: row.profile as InferenceBenchmarkProfile,
      ttftMsP95: row.ttftMsP95,
      outputTokPerSec: row.outputTokPerSec,
      latencyMsP95: row.latencyMsP95,
      errorRate: row.errorRate,
      memoryHeadroomPct: row.memoryHeadroomPct,
      score: row.score,
      createdAt: row.createdAt.toISOString(),
      selected: row.selected,
      metadata: row.metadata as Record<string, unknown>,
    }));
  }

  async getBenchmarkHistory(profile?: InferenceBenchmarkProfile, limit = 200) {
    const rows = await prisma.inferenceBenchmarkRun.findMany({
      where: profile ? { profile } : undefined,
      orderBy: [{ createdAt: "desc" }],
      take: Math.min(Math.max(limit, 1), 2000),
    });

    return rows.map((row) => ({
      backendId: row.backendId as OnPremInferenceBackendId,
      profile: row.profile as InferenceBenchmarkProfile,
      ttftMsP95: row.ttftMsP95,
      outputTokPerSec: row.outputTokPerSec,
      latencyMsP95: row.latencyMsP95,
      errorRate: row.errorRate,
      memoryHeadroomPct: row.memoryHeadroomPct,
      score: row.score,
      createdAt: row.createdAt.toISOString(),
      selected: row.selected,
      metadata: row.metadata as Record<string, unknown>,
    }));
  }

  // --- Phase 2: Backend Health Monitoring ---

  private healthTimers = new Map<OnPremInferenceBackendId, NodeJS.Timeout>();
  private healthState = new Map<OnPremInferenceBackendId, BackendHealthStatus>();
  private readonly HEALTH_INTERVAL_MS = 30000;
  private readonly HEALTH_FAILURE_THRESHOLD = 3;
  private readonly BACKOFF_BASE_MS = 5000;

  startHealthMonitoring(backendId: OnPremInferenceBackendId, baseUrl: string) {
    if (this.healthTimers.has(backendId)) return;

    this.healthState.set(backendId, {
      status: "healthy",
      lastCheck: new Date().toISOString(),
      restartCount: 0,
      consecutiveFailures: 0,
    });

    const timer = setInterval(() => {
      void this.checkHealth(backendId, baseUrl);
    }, this.HEALTH_INTERVAL_MS);

    this.healthTimers.set(backendId, timer);
  }

  stopHealthMonitoring(backendId: OnPremInferenceBackendId) {
    const timer = this.healthTimers.get(backendId);
    if (timer) {
      clearInterval(timer);
      this.healthTimers.delete(backendId);
    }
  }

  getHealthStatus(backendId: OnPremInferenceBackendId): BackendHealthStatus | null {
    return this.healthState.get(backendId) ?? null;
  }

  getAllHealthStatuses(): Map<OnPremInferenceBackendId, BackendHealthStatus> {
    return new Map(this.healthState);
  }

  private async checkHealth(backendId: OnPremInferenceBackendId, baseUrl: string) {
    const state = this.healthState.get(backendId);
    if (!state) return;

    const healthUrl = `${stripV1Suffix(baseUrl)}/health`;
    const modelsUrl = `${baseUrl.replace(/\/+$/, "")}/models`;

    let healthy = false;
    try {
      const response = await fetchWithTimeout(healthUrl, { method: "GET" }, 5000);
      healthy = response.ok;
    } catch {
      try {
        const response = await fetchWithTimeout(modelsUrl, { method: "GET" }, 5000);
        healthy = response.ok;
      } catch {
        healthy = false;
      }
    }

    state.lastCheck = new Date().toISOString();

    if (healthy) {
      state.consecutiveFailures = 0;
      state.status = "healthy";
    } else {
      state.consecutiveFailures += 1;
      if (state.consecutiveFailures >= this.HEALTH_FAILURE_THRESHOLD) {
        state.status = "down";
        publishEvent("global", "inference.backend.health.down", {
          backendId,
          consecutiveFailures: state.consecutiveFailures,
          restartCount: state.restartCount,
        });
        await this.attemptRestart(backendId, state);
      } else {
        state.status = "degraded";
        publishEvent("global", "inference.backend.health.degraded", {
          backendId,
          consecutiveFailures: state.consecutiveFailures,
        });
      }
    }

    this.healthState.set(backendId, state);
  }

  private async attemptRestart(backendId: OnPremInferenceBackendId, state: BackendHealthStatus) {
    const maxRestarts = 3;
    if (state.restartCount >= maxRestarts) {
      publishEvent("global", "inference.backend.health.restart_limit", {
        backendId,
        restartCount: state.restartCount,
      });
      return;
    }

    const backoffMs = this.BACKOFF_BASE_MS * Math.pow(3, state.restartCount);
    state.restartCount += 1;

    publishEvent("global", "inference.backend.health.restarting", {
      backendId,
      restartCount: state.restartCount,
      backoffMs,
    });

    await new Promise((resolve) => setTimeout(resolve, backoffMs));

    const existing = runtimeProcesses.get(backendId);
    if (existing) {
      existing.kill("SIGTERM");
      runtimeProcesses.delete(backendId);
    }

    try {
      await this.startBackend({ actor: "health_monitor", backendId });
      state.consecutiveFailures = 0;
      state.status = "healthy";
    } catch {
      state.status = "down";
    }
  }

  // --- Phase 10: Prompt Cache Metrics ---

  private cacheHitWindow: boolean[] = [];
  private readonly CACHE_WINDOW_SIZE = 100;

  recordCacheResult(hit: boolean) {
    this.cacheHitWindow.push(hit);
    if (this.cacheHitWindow.length > this.CACHE_WINDOW_SIZE) {
      this.cacheHitWindow.shift();
    }
  }

  getCacheMetrics(): PromptCacheMetrics {
    const total = this.cacheHitWindow.length;
    const hits = this.cacheHitWindow.filter(Boolean).length;
    return {
      hitRate: total > 0 ? hits / total : 0,
      totalRequests: total,
      cacheHits: hits,
      lastUpdated: new Date().toISOString(),
    };
  }

  resetCacheMetrics() {
    this.cacheHitWindow = [];
  }
}
