import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  BackendHealthStatus,
  HardwareProfile,
  OnPremInferenceBackendId,
  PromptCacheMetrics,
} from "../../shared/contracts";

const mocks = vi.hoisted(() => ({
  prisma: {
    appSetting: { findUnique: vi.fn(), upsert: vi.fn() },
    commandLog: { create: vi.fn(), update: vi.fn() },
    inferenceBenchmarkRun: { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
    inferenceBackendProfile: { upsert: vi.fn() },
  },
  publishEvent: vi.fn(),
  v2EventService: { appendEvent: vi.fn() },
  spawnSync: vi.fn().mockReturnValue({ status: 1, stdout: "", stderr: "" }),
  spawn: vi.fn().mockReturnValue({
    pid: 12345,
    on: vi.fn(),
    kill: vi.fn(),
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
  }),
  listOnPremInferenceBackends: vi.fn(() => []),
  resolveOnPremInferenceBackend: vi.fn((id: string) => ({
    id,
    label: "Test Backend",
    baseUrlDefault: "http://localhost:8080",
    startupCommandTemplate: "mock-server --model {{model}}",
    notes: "Test notes",
    optimizedFor: "test",
  })),
  buildStartupCommandForBaseUrl: vi.fn(() => "mock-command"),
  getCandidateOrderForHardware: vi.fn(() => []),
  scoreBenchmark: vi.fn(() => 0.75),
}));

vi.mock("node:child_process", () => ({
  spawn: mocks.spawn,
  spawnSync: mocks.spawnSync,
}));
vi.mock("../db", () => ({ prisma: mocks.prisma }));
vi.mock("../eventBus", () => ({ publishEvent: mocks.publishEvent }));
vi.mock("./v2EventService", () => ({ V2EventService: vi.fn(() => mocks.v2EventService) }));
vi.mock("../providers/inferenceBackends", () => ({
  buildStartupCommandForBaseUrl: mocks.buildStartupCommandForBaseUrl,
  listOnPremInferenceBackends: mocks.listOnPremInferenceBackends,
  resolveOnPremInferenceBackend: mocks.resolveOnPremInferenceBackend,
}));
vi.mock("../providers/modelPlugins", () => ({
  resolveOnPremQwenModelPlugin: vi.fn(() => ({
    id: "test-plugin",
    model: "test-model",
    runtimeModel: "test-runtime-model",
    recommendedBackend: "mlx-lm",
  })),
}));
vi.mock("./inferenceScoring", () => ({
  getCandidateOrderForHardware: mocks.getCandidateOrderForHardware,
  scoreBenchmark: mocks.scoreBenchmark,
}));
vi.mock("./secretStore", () => ({
  PROVIDER_SECRET_NAMES: {
    onPremQwenApiKey: "onprem_qwen_api_key",
  },
  resolveSecretValue: vi.fn(() => Promise.resolve({ value: "test-api-key" })),
}));

import { p95, InferenceTuningService } from "./inferenceTuningService";
import { V2EventService } from "./v2EventService";

// ---------------------------------------------------------------------------
// p95 function tests
// ---------------------------------------------------------------------------

describe("p95", () => {
  it("returns 0 for empty array", () => {
    expect(p95([])).toBe(0);
  });

  it("returns single value for single-element array", () => {
    expect(p95([5])).toBe(5);
  });

  it("returns 95th percentile for 20-element array", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
    expect(p95(values)).toBe(19);
  });

  it("handles unsorted input", () => {
    const values = [20, 1, 15, 3, 8, 12, 5];
    const result = p95(values);
    expect(result).toBeGreaterThanOrEqual(15);
  });

  it("returns largest value for small arrays", () => {
    expect(p95([10, 20])).toBe(20);
    expect(p95([5, 10, 15])).toBe(15);
  });

  it("calculates correct percentile for 100-element array", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(p95(values)).toBe(95);
  });

  it("does not mutate original array", () => {
    const values = [5, 2, 8, 1, 9];
    const original = [...values];
    p95(values);
    expect(values).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// InferenceTuningService class tests
// ---------------------------------------------------------------------------

describe("InferenceTuningService", () => {
  let service: InferenceTuningService;
  let eventService: V2EventService;

  beforeEach(() => {
    vi.clearAllMocks();
    eventService = new V2EventService();
    service = new InferenceTuningService(eventService);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe("getHardwareProfile", () => {
    it("returns hardware profile", () => {
      const profile = service.getHardwareProfile();
      expect(profile).toBeDefined();
      expect(profile.platform).toMatch(/^(apple-silicon|nvidia-cuda|generic-cpu)$/);
    });

    it("caches hardware profile on subsequent calls", () => {
      const profile1 = service.getHardwareProfile();
      const profile2 = service.getHardwareProfile();
      expect(profile1).toBe(profile2);
    });

    it("returns consistent structure", () => {
      const profile = service.getHardwareProfile();
      expect(profile).toHaveProperty("platform");
      if (profile.platform === "apple-silicon") {
        expect(profile).toHaveProperty("unifiedMemoryMb");
      }
      if (profile.platform === "nvidia-cuda") {
        expect(profile).toHaveProperty("vramMb");
        expect(profile).toHaveProperty("computeCapability");
      }
    });
  });

  describe("canLoadModel", () => {
    it("returns false when insufficient memory on apple-silicon", () => {
      const profile: HardwareProfile = { platform: "apple-silicon", unifiedMemoryMb: 8000 };
      vi.spyOn(service, "getHardwareProfile").mockReturnValue(profile);
      expect(service.canLoadModel(16)).toBe(false);
    });

    it("returns true when sufficient memory on apple-silicon", () => {
      const profile: HardwareProfile = { platform: "apple-silicon", unifiedMemoryMb: 32000 };
      vi.spyOn(service, "getHardwareProfile").mockReturnValue(profile);
      expect(service.canLoadModel(16)).toBe(true);
    });

    it("returns false when insufficient VRAM on nvidia-cuda", () => {
      const profile: HardwareProfile = { platform: "nvidia-cuda", vramMb: 4000 };
      vi.spyOn(service, "getHardwareProfile").mockReturnValue(profile);
      expect(service.canLoadModel(8)).toBe(false);
    });

    it("returns true when sufficient VRAM on nvidia-cuda", () => {
      const profile: HardwareProfile = { platform: "nvidia-cuda", vramMb: 16000, computeCapability: "8.6" };
      vi.spyOn(service, "getHardwareProfile").mockReturnValue(profile);
      expect(service.canLoadModel(8)).toBe(true);
    });

    it("returns false for generic-cpu platform", () => {
      const profile: HardwareProfile = { platform: "generic-cpu" };
      vi.spyOn(service, "getHardwareProfile").mockReturnValue(profile);
      expect(service.canLoadModel(4)).toBe(false);
    });

    it("handles missing memory values gracefully", () => {
      const profile: HardwareProfile = { platform: "apple-silicon" };
      vi.spyOn(service, "getHardwareProfile").mockReturnValue(profile);
      expect(service.canLoadModel(4)).toBe(false);
    });
  });

  describe("cache metrics", () => {
    it("recordCacheResult adds hit to window", () => {
      service.recordCacheResult(true);
      const metrics = service.getCacheMetrics();
      expect(metrics.totalRequests).toBe(1);
      expect(metrics.cacheHits).toBe(1);
      expect(metrics.hitRate).toBe(1);
    });

    it("recordCacheResult adds miss to window", () => {
      service.recordCacheResult(false);
      const metrics = service.getCacheMetrics();
      expect(metrics.totalRequests).toBe(1);
      expect(metrics.cacheHits).toBe(0);
      expect(metrics.hitRate).toBe(0);
    });

    it("calculates correct hit rate with mixed results", () => {
      service.recordCacheResult(true);
      service.recordCacheResult(true);
      service.recordCacheResult(false);
      service.recordCacheResult(true);
      const metrics = service.getCacheMetrics();
      expect(metrics.totalRequests).toBe(4);
      expect(metrics.cacheHits).toBe(3);
      expect(metrics.hitRate).toBe(0.75);
    });

    it("maintains window size of 100", () => {
      for (let i = 0; i < 150; i += 1) {
        service.recordCacheResult(i % 2 === 0);
      }
      const metrics = service.getCacheMetrics();
      expect(metrics.totalRequests).toBe(100);
      expect(metrics.windowSize).toBeUndefined();
    });

    it("getCacheMetrics includes lastUpdated timestamp", () => {
      service.recordCacheResult(true);
      const metrics = service.getCacheMetrics();
      expect(metrics.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("resetCacheMetrics clears the window", () => {
      service.recordCacheResult(true);
      service.recordCacheResult(true);
      service.resetCacheMetrics();
      const metrics = service.getCacheMetrics();
      expect(metrics.totalRequests).toBe(0);
      expect(metrics.cacheHits).toBe(0);
      expect(metrics.hitRate).toBe(0);
    });

    it("returns zero hit rate when window is empty", () => {
      const metrics = service.getCacheMetrics();
      expect(metrics.hitRate).toBe(0);
      expect(metrics.totalRequests).toBe(0);
    });
  });

  describe("health monitoring", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("startHealthMonitoring initializes health state", () => {
      const backendId: OnPremInferenceBackendId = "mlx-lm";
      service.startHealthMonitoring(backendId, "http://localhost:8080");
      const status = service.getHealthStatus(backendId);
      expect(status).not.toBeNull();
      expect(status!.status).toBe("healthy");
      expect(status!.consecutiveFailures).toBe(0);
      expect(status!.restartCount).toBe(0);
    });

    it("does not start duplicate monitoring for same backend", () => {
      const backendId: OnPremInferenceBackendId = "mlx-lm";
      service.startHealthMonitoring(backendId, "http://localhost:8080");
      service.startHealthMonitoring(backendId, "http://localhost:8080");
      const status = service.getHealthStatus(backendId);
      expect(status).not.toBeNull();
    });

    it("stopHealthMonitoring clears timer but preserves state", () => {
      const backendId: OnPremInferenceBackendId = "mlx-lm";
      service.startHealthMonitoring(backendId, "http://localhost:8080");
      service.stopHealthMonitoring(backendId);
      const status = service.getHealthStatus(backendId);
      expect(status).not.toBeNull();
      expect(status!.status).toBe("healthy");
    });

    it("getHealthStatus returns null for unknown backend", () => {
      const status = service.getHealthStatus("ollama-openai" as OnPremInferenceBackendId);
      expect(status).toBeNull();
    });

    it("getAllHealthStatuses returns all monitored backends", () => {
      service.startHealthMonitoring("mlx-lm", "http://localhost:8080");
      service.startHealthMonitoring("transformers-openai" as OnPremInferenceBackendId, "http://localhost:8081");
      const statuses = service.getAllHealthStatuses();
      expect(statuses.size).toBeGreaterThanOrEqual(2);
      expect(statuses.has("mlx-lm")).toBe(true);
    });

    it("getAllHealthStatuses returns empty map when no backends monitored", () => {
      const statuses = service.getAllHealthStatuses();
      expect(statuses).toBeInstanceOf(Map);
    });
  });

  describe("resetCacheMetrics", () => {
    it("resets after recording multiple values", () => {
      service.recordCacheResult(true);
      service.recordCacheResult(false);
      service.recordCacheResult(true);
      service.resetCacheMetrics();
      const metrics = service.getCacheMetrics();
      expect(metrics.totalRequests).toBe(0);
    });
  });

  describe("getCacheMetrics structure", () => {
    it("returns correct PromptCacheMetrics shape", () => {
      service.recordCacheResult(true);
      const metrics: PromptCacheMetrics = service.getCacheMetrics();
      expect(metrics).toHaveProperty("hitRate");
      expect(metrics).toHaveProperty("totalRequests");
      expect(metrics).toHaveProperty("cacheHits");
      expect(metrics).toHaveProperty("lastUpdated");
      expect(typeof metrics.hitRate).toBe("number");
      expect(typeof metrics.totalRequests).toBe("number");
      expect(typeof metrics.cacheHits).toBe("number");
      expect(typeof metrics.lastUpdated).toBe("string");
    });
  });

  // -------------------------------------------------------------------------
  // listBackends
  // -------------------------------------------------------------------------
  describe("listBackends", () => {
    it("returns enriched backend list with active/running/commandAvailable flags", async () => {
      mocks.prisma.appSetting.findUnique.mockResolvedValue({
        key: "onprem_qwen_config",
        value: { inferenceBackendId: "mlx-lm", baseUrl: "http://localhost:8080/v1" },
      });
      mocks.listOnPremInferenceBackends.mockReturnValue([
        {
          id: "mlx-lm",
          label: "MLX-LM",
          baseUrlDefault: "http://localhost:8080/v1",
          startupCommandTemplate: "python3 -m mlx_lm.server --model {{model}}",
          optimizedFor: "apple-silicon",
          notes: "test",
        },
        {
          id: "vllm-openai",
          label: "vLLM",
          baseUrlDefault: "http://localhost:8000/v1",
          startupCommandTemplate: "vllm serve {{model}}",
          optimizedFor: "nvidia-cuda",
          notes: "test2",
        },
      ]);
      // spawnSync returning status=1 means command not found
      mocks.spawnSync.mockReturnValue({ status: 1, stdout: "", stderr: "" });

      const result = await service.listBackends();
      expect(result).toHaveLength(2);
      expect(result[0].active).toBe(true);
      expect(result[1].active).toBe(false);
      expect(result[0]).toHaveProperty("running");
      expect(result[0]).toHaveProperty("commandAvailable");
    });

    it("marks commandAvailable true when spawnSync returns status 0", async () => {
      mocks.prisma.appSetting.findUnique.mockResolvedValue({
        key: "onprem_qwen_config",
        value: { inferenceBackendId: "mlx-lm" },
      });
      mocks.listOnPremInferenceBackends.mockReturnValue([
        {
          id: "mlx-lm",
          label: "MLX-LM",
          baseUrlDefault: "http://localhost:8080/v1",
          startupCommandTemplate: "python3 -m mlx_lm.server --model {{model}}",
          optimizedFor: "apple-silicon",
          notes: "test",
        },
      ]);
      mocks.spawnSync.mockReturnValue({ status: 0, stdout: "/usr/bin/python3\n", stderr: "" });

      const result = await service.listBackends();
      expect(result[0].commandAvailable).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // switchBackend
  // -------------------------------------------------------------------------
  describe("switchBackend", () => {
    it("switches backend and persists config", async () => {
      mocks.prisma.appSetting.findUnique.mockResolvedValue({
        key: "onprem_qwen_config",
        value: { inferenceBackendId: "mlx-lm", model: "test-model" },
      });
      mocks.prisma.commandLog.create.mockResolvedValue({ id: "cmd-1" });
      mocks.prisma.commandLog.update.mockResolvedValue({});
      mocks.prisma.appSetting.upsert.mockResolvedValue({});
      mocks.v2EventService.appendEvent.mockResolvedValue(undefined);

      const result = await service.switchBackend({ actor: "test-user", backendId: "vllm-openai" });
      expect(result.ok).toBe(true);
      expect(result.backendId).toBe("vllm-openai");
      expect(result.baseUrl).toBe("http://localhost:8080");
      expect(mocks.prisma.appSetting.upsert).toHaveBeenCalled();
      expect(mocks.publishEvent).toHaveBeenCalledWith("global", "inference.backend.switched", expect.any(Object));
      expect(mocks.v2EventService.appendEvent).toHaveBeenCalled();
      expect(mocks.prisma.commandLog.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "cmd-1" }, data: expect.objectContaining({ status: "executed" }) })
      );
    });
  });

  // -------------------------------------------------------------------------
  // startBackend
  // -------------------------------------------------------------------------
  describe("startBackend", () => {
    it("spawns a new process when backend is not running", async () => {
      mocks.prisma.appSetting.findUnique.mockResolvedValue({
        key: "onprem_qwen_config",
        value: { inferenceBackendId: "mlx-lm", model: "test-model" },
      });
      mocks.prisma.commandLog.create.mockResolvedValue({ id: "cmd-start-1" });
      mocks.prisma.commandLog.update.mockResolvedValue({});
      const exitHandler = vi.fn();
      const mockChild = {
        pid: 99999,
        on: vi.fn((event: string, cb: () => void) => {
          if (event === "exit") exitHandler.mockImplementation(cb);
        }),
        kill: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
      };
      mocks.spawn.mockReturnValue(mockChild);

      const result = await service.startBackend({ actor: "test-user", backendId: "mlx-lm" });
      expect(result.ok).toBe(true);
      expect(result.pid).toBe(99999);
      expect(result.command).toContain("mock-server --model test-model");
      expect(mocks.publishEvent).toHaveBeenCalledWith("global", "inference.backend.started", expect.any(Object));
    });

    it("returns alreadyRunning when backend process already exists", async () => {
      // First start
      mocks.prisma.appSetting.findUnique.mockResolvedValue({
        key: "onprem_qwen_config",
        value: { inferenceBackendId: "mlx-lm", model: "test-model" },
      });
      mocks.prisma.commandLog.create.mockResolvedValue({ id: "cmd-start-2" });
      mocks.prisma.commandLog.update.mockResolvedValue({});
      const mockChild = {
        pid: 88888,
        on: vi.fn(),
        kill: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
      };
      mocks.spawn.mockReturnValue(mockChild);

      await service.startBackend({ actor: "test-user", backendId: "mlx-lm" });

      // Second start should detect already running
      mocks.prisma.commandLog.create.mockResolvedValue({ id: "cmd-start-3" });
      const result2 = await service.startBackend({ actor: "test-user", backendId: "mlx-lm" });
      expect(result2.ok).toBe(true);
      expect(result2.alreadyRunning).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // stopBackend
  // -------------------------------------------------------------------------
  describe("stopBackend", () => {
    it("stops a running backend and returns stopped=true", async () => {
      // Start first
      mocks.prisma.appSetting.findUnique.mockResolvedValue({
        key: "onprem_qwen_config",
        value: { inferenceBackendId: "vllm-openai", model: "test-model" },
      });
      mocks.prisma.commandLog.create.mockResolvedValue({ id: "cmd-stop-1" });
      mocks.prisma.commandLog.update.mockResolvedValue({});
      const mockChild = {
        pid: 77777,
        on: vi.fn(),
        kill: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
      };
      mocks.spawn.mockReturnValue(mockChild);
      await service.startBackend({ actor: "test-user", backendId: "vllm-openai" });

      // Now stop
      mocks.prisma.commandLog.create.mockResolvedValue({ id: "cmd-stop-2" });
      const result = await service.stopBackend({ actor: "test-user", backendId: "vllm-openai" });
      expect(result.ok).toBe(true);
      expect(result.stopped).toBe(true);
      expect(mockChild.kill).toHaveBeenCalledWith("SIGTERM");
      expect(mocks.publishEvent).toHaveBeenCalledWith("global", "inference.backend.stopped", expect.any(Object));
    });

    it("returns stopped=false when backend is not running", async () => {
      mocks.prisma.commandLog.create.mockResolvedValue({ id: "cmd-stop-3" });
      mocks.prisma.commandLog.update.mockResolvedValue({});

      const result = await service.stopBackend({ actor: "test-user", backendId: "sglang" as OnPremInferenceBackendId });
      expect(result.ok).toBe(true);
      expect(result.stopped).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // getLatestBenchmarks
  // -------------------------------------------------------------------------
  describe("getLatestBenchmarks", () => {
    it("returns deduplicated latest benchmarks", async () => {
      const now = new Date();
      mocks.prisma.inferenceBenchmarkRun.findMany.mockResolvedValue([
        {
          backendId: "mlx-lm",
          profile: "interactive",
          ttftMsP95: 100,
          outputTokPerSec: 30,
          latencyMsP95: 200,
          errorRate: 0,
          memoryHeadroomPct: 50,
          score: 0.8,
          createdAt: now,
          selected: true,
          metadata: {},
        },
        {
          backendId: "mlx-lm",
          profile: "interactive",
          ttftMsP95: 120,
          outputTokPerSec: 28,
          latencyMsP95: 220,
          errorRate: 0.1,
          memoryHeadroomPct: 48,
          score: 0.7,
          createdAt: new Date(now.getTime() - 10000),
          selected: false,
          metadata: {},
        },
        {
          backendId: "vllm-openai",
          profile: "interactive",
          ttftMsP95: 80,
          outputTokPerSec: 40,
          latencyMsP95: 150,
          errorRate: 0,
          memoryHeadroomPct: 60,
          score: 0.9,
          createdAt: now,
          selected: false,
          metadata: {},
        },
      ]);

      const result = await service.getLatestBenchmarks("interactive" as any);
      expect(result).toHaveLength(2);
      expect(result[0].backendId).toBe("mlx-lm");
      expect(result[1].backendId).toBe("vllm-openai");
      expect(result[0].createdAt).toBe(now.toISOString());
    });

    it("returns all benchmarks when no profile filter", async () => {
      mocks.prisma.inferenceBenchmarkRun.findMany.mockResolvedValue([]);
      const result = await service.getLatestBenchmarks();
      expect(result).toEqual([]);
      expect(mocks.prisma.inferenceBenchmarkRun.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: undefined })
      );
    });
  });

  // -------------------------------------------------------------------------
  // getBenchmarkHistory
  // -------------------------------------------------------------------------
  describe("getBenchmarkHistory", () => {
    it("returns benchmark history with default limit", async () => {
      const now = new Date();
      mocks.prisma.inferenceBenchmarkRun.findMany.mockResolvedValue([
        {
          backendId: "mlx-lm",
          profile: "batch",
          ttftMsP95: 100,
          outputTokPerSec: 30,
          latencyMsP95: 200,
          errorRate: 0,
          memoryHeadroomPct: 50,
          score: 0.8,
          createdAt: now,
          selected: false,
          metadata: { attempts: 3, failures: 0 },
        },
      ]);

      const result = await service.getBenchmarkHistory("batch" as any);
      expect(result).toHaveLength(1);
      expect(result[0].backendId).toBe("mlx-lm");
      expect(result[0].metadata).toEqual({ attempts: 3, failures: 0 });
    });

    it("clamps limit to range [1, 2000]", async () => {
      mocks.prisma.inferenceBenchmarkRun.findMany.mockResolvedValue([]);

      await service.getBenchmarkHistory(undefined, 5000);
      expect(mocks.prisma.inferenceBenchmarkRun.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 2000 })
      );

      await service.getBenchmarkHistory(undefined, -10);
      expect(mocks.prisma.inferenceBenchmarkRun.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 1 })
      );
    });
  });

  // -------------------------------------------------------------------------
  // listRoleRuntimeStatuses
  // -------------------------------------------------------------------------
  describe("listRoleRuntimeStatuses", () => {
    it("returns statuses for all roles with disabled message", async () => {
      mocks.prisma.appSetting.findUnique.mockResolvedValue(null);

      const result = await service.listRoleRuntimeStatuses();
      expect(result).toHaveLength(3);
      const roles = result.map((r: any) => r.role);
      expect(roles).toContain("utility_fast");
      expect(roles).toContain("coder_default");
      expect(roles).toContain("review_deep");
      // With no config, enabled=false, so message is "dedicated runtime disabled"
      for (const status of result) {
        expect(status.enabled).toBe(false);
        expect(status.message).toBe("dedicated runtime disabled");
      }
    });
  });

  // -------------------------------------------------------------------------
  // testRoleRuntime
  // -------------------------------------------------------------------------
  describe("testRoleRuntime", () => {
    it("returns test result for a role with no config", async () => {
      mocks.prisma.appSetting.findUnique.mockResolvedValue(null);

      const result = await service.testRoleRuntime({ role: "utility_fast" });
      expect(result.role).toBe("utility_fast");
      expect(result.enabled).toBe(false);
      expect(result.healthy).toBe(false);
      expect(result.message).toBe("runtime not configured");
    });
  });

  // -------------------------------------------------------------------------
  // startRoleRuntime
  // -------------------------------------------------------------------------
  describe("startRoleRuntime", () => {
    it("returns error when role is disabled or not configured", async () => {
      mocks.prisma.appSetting.findUnique.mockResolvedValue(null);

      const result = await service.startRoleRuntime({ actor: "test-user", role: "utility_fast" });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("dedicated runtime is disabled or incomplete");
    });

    it("starts a role runtime when enabled and configured", async () => {
      mocks.prisma.appSetting.findUnique.mockImplementation(async (args: any) => {
        if (args.where.key === "onprem_qwen_config") {
          return { key: "onprem_qwen_config", value: { inferenceBackendId: "mlx-lm", model: "qwen-0.8b" } };
        }
        if (args.where.key === "onprem_qwen_role_runtime_configs") {
          return {
            key: "onprem_qwen_role_runtime_configs",
            value: {
              utility_fast: {
                enabled: true,
                model: "qwen-0.8b",
                baseUrl: "http://localhost:9000/v1",
                inferenceBackendId: "mlx-lm",
              },
            },
          };
        }
        return null;
      });

      const exitHandlers: Array<() => void> = [];
      const mockChild = {
        pid: 55555,
        on: vi.fn((event: string, cb: () => void) => {
          if (event === "exit") exitHandlers.push(cb);
        }),
        kill: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
      };
      mocks.spawn.mockReturnValue(mockChild);

      const result = await service.startRoleRuntime({ actor: "test-user", role: "utility_fast" });
      expect(result.ok).toBe(true);
      expect(result.started).toBe(true);
      expect(result.pid).toBe(55555);
      expect(mocks.publishEvent).toHaveBeenCalledWith("global", "inference.role_runtime.started", expect.any(Object));
    });

    it("returns alreadyRunning when role runtime is already started", async () => {
      // Stop any leftover role runtime from previous tests
      await service.stopRoleRuntime({ actor: "cleanup", role: "utility_fast" });

      mocks.prisma.appSetting.findUnique.mockImplementation(async (args: any) => {
        if (args.where.key === "onprem_qwen_config") {
          return { key: "onprem_qwen_config", value: { inferenceBackendId: "mlx-lm", model: "qwen-0.8b" } };
        }
        if (args.where.key === "onprem_qwen_role_runtime_configs") {
          return {
            key: "onprem_qwen_role_runtime_configs",
            value: {
              utility_fast: {
                enabled: true,
                model: "qwen-0.8b",
                baseUrl: "http://localhost:9000/v1",
                inferenceBackendId: "mlx-lm",
              },
            },
          };
        }
        return null;
      });

      const mockChild = {
        pid: 44444,
        on: vi.fn(),
        kill: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
      };
      mocks.spawn.mockReturnValue(mockChild);

      await service.startRoleRuntime({ actor: "test-user", role: "utility_fast" });
      const result2 = await service.startRoleRuntime({ actor: "test-user", role: "utility_fast" });
      expect(result2.ok).toBe(true);
      expect(result2.alreadyRunning).toBe(true);
      expect(result2.pid).toBe(44444);
    });
  });

  // -------------------------------------------------------------------------
  // stopRoleRuntime
  // -------------------------------------------------------------------------
  describe("stopRoleRuntime", () => {
    it("returns stopped=false when no role runtime is running", async () => {
      const result = await service.stopRoleRuntime({ actor: "test-user", role: "review_deep" });
      expect(result.ok).toBe(true);
      expect(result.stopped).toBe(false);
    });

    it("stops a running role runtime and publishes event", async () => {
      // Start a role runtime first
      mocks.prisma.appSetting.findUnique.mockImplementation(async (args: any) => {
        if (args.where.key === "onprem_qwen_config") {
          return { key: "onprem_qwen_config", value: { inferenceBackendId: "mlx-lm", model: "qwen" } };
        }
        if (args.where.key === "onprem_qwen_role_runtime_configs") {
          return {
            key: "onprem_qwen_role_runtime_configs",
            value: {
              coder_default: {
                enabled: true,
                model: "qwen",
                baseUrl: "http://localhost:9001/v1",
                inferenceBackendId: "mlx-lm",
              },
            },
          };
        }
        return null;
      });

      const mockChild = {
        pid: 33333,
        on: vi.fn(),
        kill: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
      };
      mocks.spawn.mockReturnValue(mockChild);

      await service.startRoleRuntime({ actor: "test-user", role: "coder_default" });
      mocks.publishEvent.mockClear();

      const result = await service.stopRoleRuntime({ actor: "test-user", role: "coder_default" });
      expect(result.ok).toBe(true);
      expect(result.stopped).toBe(true);
      expect(mockChild.kill).toHaveBeenCalledWith("SIGTERM");
      expect(mocks.publishEvent).toHaveBeenCalledWith("global", "inference.role_runtime.stopped", expect.any(Object));
    });
  });

  // -------------------------------------------------------------------------
  // startEnabledRoleRuntimes
  // -------------------------------------------------------------------------
  describe("startEnabledRoleRuntimes", () => {
    it("starts only enabled and configured roles", async () => {
      mocks.prisma.appSetting.findUnique.mockImplementation(async (args: any) => {
        if (args.where.key === "onprem_qwen_config") {
          return { key: "onprem_qwen_config", value: { inferenceBackendId: "mlx-lm", model: "qwen" } };
        }
        if (args.where.key === "onprem_qwen_role_runtime_configs") {
          return {
            key: "onprem_qwen_role_runtime_configs",
            value: {
              utility_fast: {
                enabled: true,
                model: "qwen-fast",
                baseUrl: "http://localhost:9000/v1",
                inferenceBackendId: "mlx-lm",
              },
              coder_default: {
                enabled: false,
                model: "qwen-coder",
                baseUrl: "http://localhost:9001/v1",
                inferenceBackendId: "mlx-lm",
              },
              review_deep: {
                enabled: false,
              },
            },
          };
        }
        return null;
      });

      const mockChild = {
        pid: 22222,
        on: vi.fn(),
        kill: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
      };
      mocks.spawn.mockReturnValue(mockChild);

      const result = await service.startEnabledRoleRuntimes({ actor: "test-user" });
      expect(result.ok).toBe(true);
      // Only utility_fast is enabled + configured
      expect(result.started).toHaveLength(1);
    });

    it("returns empty started array when nothing is enabled", async () => {
      mocks.prisma.appSetting.findUnique.mockResolvedValue(null);

      const result = await service.startEnabledRoleRuntimes({ actor: "test-user" });
      expect(result.ok).toBe(true);
      expect(result.started).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // runAutotune
  // -------------------------------------------------------------------------
  describe("runAutotune", () => {
    it("runs autotune with no candidates and selects nothing", async () => {
      mocks.prisma.appSetting.findUnique.mockResolvedValue({
        key: "onprem_qwen_config",
        value: { inferenceBackendId: "mlx-lm", model: "test-model", baseUrl: "http://localhost:8080/v1" },
      });
      mocks.prisma.commandLog.create.mockResolvedValue({ id: "cmd-autotune-1" });
      mocks.prisma.commandLog.update.mockResolvedValue({});
      mocks.prisma.inferenceBenchmarkRun.updateMany.mockResolvedValue({ count: 0 });
      mocks.v2EventService.appendEvent.mockResolvedValue(undefined);
      mocks.getCandidateOrderForHardware.mockReturnValue([]);
      mocks.listOnPremInferenceBackends.mockReturnValue([]);

      vi.spyOn(service, "getHardwareProfile").mockReturnValue({ platform: "apple-silicon", unifiedMemoryMb: 32000 });

      const result = await service.runAutotune({ actor: "test-user", profile: "interactive" as any, dryRun: true });
      expect(result.strategy).toBe("hardware-aware");
      expect(result.hardware).toBe("apple-silicon");
      expect(result.selectedBackendId).toBeNull();
      expect(result.benchmarkResults).toHaveLength(0);
      expect(mocks.publishEvent).toHaveBeenCalledWith("global", "inference.autotune.started", expect.any(Object));
      expect(mocks.publishEvent).toHaveBeenCalledWith("global", "inference.autotune.completed", expect.any(Object));
    });

    it("runs autotune with candidates and selects best viable backend", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      // First call: models endpoint, second+: chat/completions
      fetchSpy.mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes("/models")) {
          return new Response(JSON.stringify({ data: [{ id: "test-model" }] }), { status: 200 });
        }
        if (urlStr.includes("/chat/completions")) {
          return new Response(
            JSON.stringify({
              choices: [{ message: { content: "Hello" } }],
              usage: { completion_tokens: 10 },
            }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/health")) {
          return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
        }
        return new Response("not found", { status: 404 });
      });

      mocks.prisma.appSetting.findUnique.mockResolvedValue({
        key: "onprem_qwen_config",
        value: { inferenceBackendId: "mlx-lm", model: "test-model", baseUrl: "http://localhost:8080/v1" },
      });
      mocks.prisma.commandLog.create.mockResolvedValue({ id: "cmd-autotune-2" });
      mocks.prisma.commandLog.update.mockResolvedValue({});
      mocks.prisma.inferenceBenchmarkRun.create.mockResolvedValue({
        id: "bench-1",
        createdAt: new Date(),
      });
      mocks.prisma.inferenceBenchmarkRun.updateMany.mockResolvedValue({ count: 0 });
      mocks.prisma.inferenceBenchmarkRun.findFirst.mockResolvedValue({ id: "bench-1" });
      mocks.prisma.inferenceBenchmarkRun.update.mockResolvedValue({});
      mocks.prisma.appSetting.upsert.mockResolvedValue({});
      mocks.prisma.inferenceBackendProfile.upsert.mockResolvedValue({});
      mocks.v2EventService.appendEvent.mockResolvedValue(undefined);
      mocks.scoreBenchmark.mockReturnValue(0.85);

      mocks.getCandidateOrderForHardware.mockReturnValue(["mlx-lm"]);
      mocks.listOnPremInferenceBackends.mockReturnValue([
        {
          id: "mlx-lm",
          label: "MLX-LM",
          baseUrlDefault: "http://localhost:8080/v1",
          startupCommandTemplate: "python3 -m mlx_lm.server --model {{model}}",
          optimizedFor: "apple-silicon",
          notes: "test",
        },
      ]);

      vi.spyOn(service, "getHardwareProfile").mockReturnValue({ platform: "apple-silicon", unifiedMemoryMb: 32000 });

      const result = await service.runAutotune({ actor: "test-user", profile: "interactive" as any, dryRun: false });
      expect(result.selectedBackendId).toBe("mlx-lm");
      expect(result.benchmarkResults).toHaveLength(1);
      expect(result.benchmarkResults[0].selected).toBe(true);
      expect(mocks.prisma.appSetting.upsert).toHaveBeenCalled();

      fetchSpy.mockRestore();
    });

    it("runs autotune with dryRun=true and does not persist config", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      fetchSpy.mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes("/models")) {
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        }
        if (urlStr.includes("/chat/completions")) {
          return new Response(
            JSON.stringify({ choices: [{ message: { content: "Hi" } }], usage: { completion_tokens: 5 } }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/health")) {
          return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
        }
        return new Response("nope", { status: 404 });
      });

      mocks.prisma.appSetting.findUnique.mockResolvedValue({
        key: "onprem_qwen_config",
        value: { inferenceBackendId: "mlx-lm", model: "test-model", baseUrl: "http://localhost:8080/v1" },
      });
      mocks.prisma.commandLog.create.mockResolvedValue({ id: "cmd-dry" });
      mocks.prisma.commandLog.update.mockResolvedValue({});
      mocks.prisma.inferenceBenchmarkRun.create.mockResolvedValue({ id: "bench-dry", createdAt: new Date() });
      mocks.prisma.inferenceBenchmarkRun.updateMany.mockResolvedValue({ count: 0 });
      mocks.prisma.inferenceBenchmarkRun.findFirst.mockResolvedValue({ id: "bench-dry" });
      mocks.prisma.inferenceBenchmarkRun.update.mockResolvedValue({});
      mocks.prisma.inferenceBackendProfile.upsert.mockResolvedValue({});
      mocks.v2EventService.appendEvent.mockResolvedValue(undefined);
      mocks.scoreBenchmark.mockReturnValue(0.85);

      mocks.getCandidateOrderForHardware.mockReturnValue(["mlx-lm"]);
      mocks.listOnPremInferenceBackends.mockReturnValue([
        {
          id: "mlx-lm",
          label: "MLX-LM",
          baseUrlDefault: "http://localhost:8080/v1",
          startupCommandTemplate: "python3 -m mlx_lm.server --model {{model}}",
          optimizedFor: "apple-silicon",
          notes: "test",
        },
      ]);
      vi.spyOn(service, "getHardwareProfile").mockReturnValue({ platform: "apple-silicon", unifiedMemoryMb: 32000 });

      // Clear mock so we can assert it was NOT called for config persistence
      mocks.prisma.appSetting.upsert.mockClear();

      const result = await service.runAutotune({ actor: "test-user", profile: "interactive" as any, dryRun: true });
      expect(result.selectedBackendId).toBe("mlx-lm");
      // appSetting.upsert should NOT be called for config persistence in dryRun mode
      // but it may be called for inferenceBackendProfile.upsert — that's different
      // The config upsert uses key "onprem_qwen_config"
      const configUpsertCalls = mocks.prisma.appSetting.upsert.mock.calls.filter(
        (call: any) => call[0]?.where?.key === "onprem_qwen_config"
      );
      expect(configUpsertCalls).toHaveLength(0);

      fetchSpy.mockRestore();
    });

    it("skips candidates with duplicate probe URLs", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      fetchSpy.mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes("/health")) {
          return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
        }
        if (urlStr.includes("/models")) {
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        }
        if (urlStr.includes("/chat/completions")) {
          return new Response(
            JSON.stringify({ choices: [{ message: { content: "A" } }], usage: { completion_tokens: 2 } }),
            { status: 200 }
          );
        }
        return new Response("", { status: 404 });
      });

      mocks.prisma.appSetting.findUnique.mockResolvedValue({
        key: "onprem_qwen_config",
        value: { inferenceBackendId: "mlx-lm", model: "test-model", baseUrl: "http://localhost:8080/v1" },
      });
      mocks.prisma.commandLog.create.mockResolvedValue({ id: "cmd-dup" });
      mocks.prisma.commandLog.update.mockResolvedValue({});
      mocks.prisma.inferenceBenchmarkRun.create.mockResolvedValue({ id: "bench-dup", createdAt: new Date() });
      mocks.prisma.inferenceBenchmarkRun.updateMany.mockResolvedValue({ count: 0 });
      mocks.prisma.inferenceBenchmarkRun.findFirst.mockResolvedValue({ id: "bench-dup" });
      mocks.prisma.inferenceBenchmarkRun.update.mockResolvedValue({});
      mocks.prisma.inferenceBackendProfile.upsert.mockResolvedValue({});
      mocks.v2EventService.appendEvent.mockResolvedValue(undefined);
      mocks.scoreBenchmark.mockReturnValue(0.5);

      // Two backends with same base URL but different IDs
      mocks.getCandidateOrderForHardware.mockReturnValue(["mlx-lm", "vllm-openai"]);
      mocks.listOnPremInferenceBackends.mockReturnValue([
        {
          id: "mlx-lm",
          label: "MLX-LM",
          baseUrlDefault: "http://localhost:8080/v1",
          startupCommandTemplate: "mlx-server {{model}}",
          optimizedFor: "apple-silicon",
          notes: "n1",
        },
        {
          id: "vllm-openai",
          label: "vLLM",
          baseUrlDefault: "http://localhost:8080/v1",
          startupCommandTemplate: "vllm {{model}}",
          optimizedFor: "nvidia-cuda",
          notes: "n2",
        },
      ]);
      vi.spyOn(service, "getHardwareProfile").mockReturnValue({ platform: "apple-silicon", unifiedMemoryMb: 32000 });

      const result = await service.runAutotune({ actor: "user", profile: "interactive" as any });
      // Only one should be probed since both resolve to same URL
      expect(result.benchmarkResults).toHaveLength(1);

      fetchSpy.mockRestore();
    });

    it("handles all probes failing (errorRate >= 1) and selects nothing", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      fetchSpy.mockImplementation(async () => {
        throw new Error("connection refused");
      });

      mocks.prisma.appSetting.findUnique.mockResolvedValue({
        key: "onprem_qwen_config",
        value: { inferenceBackendId: "mlx-lm", model: "test-model", baseUrl: "http://localhost:8080/v1" },
      });
      mocks.prisma.commandLog.create.mockResolvedValue({ id: "cmd-fail" });
      mocks.prisma.commandLog.update.mockResolvedValue({});
      mocks.prisma.inferenceBenchmarkRun.create.mockResolvedValue({ id: "bench-fail", createdAt: new Date() });
      mocks.prisma.inferenceBenchmarkRun.updateMany.mockResolvedValue({ count: 0 });
      mocks.prisma.inferenceBackendProfile.upsert.mockResolvedValue({});
      mocks.v2EventService.appendEvent.mockResolvedValue(undefined);
      mocks.scoreBenchmark.mockReturnValue(0);

      mocks.getCandidateOrderForHardware.mockReturnValue(["mlx-lm"]);
      mocks.listOnPremInferenceBackends.mockReturnValue([
        {
          id: "mlx-lm",
          label: "MLX-LM",
          baseUrlDefault: "http://localhost:8080/v1",
          startupCommandTemplate: "mlx {{model}}",
          optimizedFor: "apple-silicon",
          notes: "n",
        },
      ]);
      vi.spyOn(service, "getHardwareProfile").mockReturnValue({ platform: "apple-silicon", unifiedMemoryMb: 32000 });

      const result = await service.runAutotune({ actor: "user", profile: "interactive" as any });
      expect(result.selectedBackendId).toBeNull();
      expect(result.benchmarkResults).toHaveLength(1);

      fetchSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // checkHealth (private, tested via timer)
  // -------------------------------------------------------------------------
  describe("checkHealth via health monitoring", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      service.stopHealthMonitoring("mlx-lm");
      service.stopHealthMonitoring("test-backend" as OnPremInferenceBackendId);
      vi.useRealTimers();
    });

    it("transitions to healthy when health endpoint succeeds", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      fetchSpy.mockResolvedValue(new Response("ok", { status: 200 }));

      service.startHealthMonitoring("mlx-lm", "http://localhost:8080/v1");

      // Advance past the 30s interval
      await vi.advanceTimersByTimeAsync(30001);

      const status = service.getHealthStatus("mlx-lm");
      expect(status).not.toBeNull();
      expect(status!.status).toBe("healthy");
      expect(status!.consecutiveFailures).toBe(0);

      fetchSpy.mockRestore();
    });

    it("transitions to degraded after one failure", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      fetchSpy.mockRejectedValue(new Error("connection refused"));

      service.startHealthMonitoring("test-backend" as OnPremInferenceBackendId, "http://localhost:9999/v1");

      await vi.advanceTimersByTimeAsync(30001);

      const status = service.getHealthStatus("test-backend" as OnPremInferenceBackendId);
      expect(status).not.toBeNull();
      expect(status!.status).toBe("degraded");
      expect(status!.consecutiveFailures).toBe(1);

      fetchSpy.mockRestore();
    });

    it("transitions to down after 3 consecutive failures and attempts restart", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      fetchSpy.mockRejectedValue(new Error("connection refused"));

      // Mock startBackend dependencies
      mocks.prisma.appSetting.findUnique.mockResolvedValue({
        key: "onprem_qwen_config",
        value: { inferenceBackendId: "mlx-lm", model: "test-model" },
      });
      mocks.prisma.commandLog.create.mockResolvedValue({ id: "cmd-restart" });
      mocks.prisma.commandLog.update.mockResolvedValue({});
      const mockChild = {
        pid: 11111,
        on: vi.fn(),
        kill: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
      };
      mocks.spawn.mockReturnValue(mockChild);

      service.startHealthMonitoring("mlx-lm", "http://localhost:8080/v1");

      // Need 3 failures for "down"
      await vi.advanceTimersByTimeAsync(30001);
      await vi.advanceTimersByTimeAsync(30001);
      await vi.advanceTimersByTimeAsync(30001);

      const status = service.getHealthStatus("mlx-lm");
      expect(status).not.toBeNull();
      // After restart attempt the state should be updated
      expect(status!.restartCount).toBeGreaterThanOrEqual(1);
      expect(mocks.publishEvent).toHaveBeenCalledWith("global", "inference.backend.health.down", expect.any(Object));

      fetchSpy.mockRestore();
    });

    it("falls back to models endpoint when health endpoint fails", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      let callCount = 0;
      fetchSpy.mockImplementation(async (url: any) => {
        callCount++;
        const urlStr = String(url);
        if (urlStr.includes("/health")) {
          throw new Error("health failed");
        }
        if (urlStr.includes("/models")) {
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        }
        throw new Error("unexpected url");
      });

      service.startHealthMonitoring("mlx-lm", "http://localhost:8080/v1");

      await vi.advanceTimersByTimeAsync(30001);

      const status = service.getHealthStatus("mlx-lm");
      expect(status!.status).toBe("healthy");
      expect(status!.consecutiveFailures).toBe(0);

      fetchSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // stopHealthMonitoring with no timer
  // -------------------------------------------------------------------------
  describe("stopHealthMonitoring edge cases", () => {
    it("is a no-op when called for non-monitored backend", () => {
      // Should not throw
      service.stopHealthMonitoring("nonexistent" as OnPremInferenceBackendId);
      expect(service.getHealthStatus("nonexistent" as OnPremInferenceBackendId)).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // runProbe (tested indirectly via runAutotune)
  // -------------------------------------------------------------------------
  describe("runProbe scenarios via runAutotune", () => {
    it("handles non-ok chat completion responses", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      fetchSpy.mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes("/health")) {
          return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
        }
        if (urlStr.includes("/models")) {
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        }
        if (urlStr.includes("/chat/completions")) {
          return new Response("error", { status: 500 });
        }
        return new Response("", { status: 404 });
      });

      mocks.prisma.appSetting.findUnique.mockResolvedValue({
        key: "onprem_qwen_config",
        value: { inferenceBackendId: "mlx-lm", model: "test-model", baseUrl: "http://localhost:8080/v1" },
      });
      mocks.prisma.commandLog.create.mockResolvedValue({ id: "cmd-probe" });
      mocks.prisma.commandLog.update.mockResolvedValue({});
      mocks.prisma.inferenceBenchmarkRun.create.mockResolvedValue({ id: "bench-probe", createdAt: new Date() });
      mocks.prisma.inferenceBenchmarkRun.updateMany.mockResolvedValue({ count: 0 });
      mocks.prisma.inferenceBackendProfile.upsert.mockResolvedValue({});
      mocks.v2EventService.appendEvent.mockResolvedValue(undefined);
      mocks.scoreBenchmark.mockReturnValue(0.1);

      mocks.getCandidateOrderForHardware.mockReturnValue(["mlx-lm"]);
      mocks.listOnPremInferenceBackends.mockReturnValue([
        {
          id: "mlx-lm",
          label: "MLX-LM",
          baseUrlDefault: "http://localhost:8080/v1",
          startupCommandTemplate: "mlx {{model}}",
          optimizedFor: "apple-silicon",
          notes: "n",
        },
      ]);
      vi.spyOn(service, "getHardwareProfile").mockReturnValue({ platform: "apple-silicon", unifiedMemoryMb: 32000 });

      const result = await service.runAutotune({ actor: "user", profile: "batch" as any });
      // All 3 samples fail + models endpoint succeeds = errorRate = 3/4
      expect(result.benchmarkResults).toHaveLength(1);
      expect(result.benchmarkResults[0].metadata).toHaveProperty("failures");

      fetchSpy.mockRestore();
    });

    it("handles models endpoint failure", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      fetchSpy.mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes("/health")) {
          return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
        }
        if (urlStr.includes("/models")) {
          return new Response("error", { status: 500 });
        }
        if (urlStr.includes("/chat/completions")) {
          return new Response(
            JSON.stringify({ choices: [{ message: { content: "Test" } }], usage: { completion_tokens: 5 } }),
            { status: 200 }
          );
        }
        return new Response("", { status: 404 });
      });

      mocks.prisma.appSetting.findUnique.mockResolvedValue({
        key: "onprem_qwen_config",
        value: { inferenceBackendId: "mlx-lm", model: "test-model", baseUrl: "http://localhost:8080/v1" },
      });
      mocks.prisma.commandLog.create.mockResolvedValue({ id: "cmd-mf" });
      mocks.prisma.commandLog.update.mockResolvedValue({});
      mocks.prisma.inferenceBenchmarkRun.create.mockResolvedValue({ id: "bench-mf", createdAt: new Date() });
      mocks.prisma.inferenceBenchmarkRun.updateMany.mockResolvedValue({ count: 0 });
      mocks.prisma.inferenceBenchmarkRun.findFirst.mockResolvedValue({ id: "bench-mf" });
      mocks.prisma.inferenceBenchmarkRun.update.mockResolvedValue({});
      mocks.prisma.inferenceBackendProfile.upsert.mockResolvedValue({});
      mocks.v2EventService.appendEvent.mockResolvedValue(undefined);
      mocks.scoreBenchmark.mockReturnValue(0.6);

      mocks.getCandidateOrderForHardware.mockReturnValue(["mlx-lm"]);
      mocks.listOnPremInferenceBackends.mockReturnValue([
        {
          id: "mlx-lm",
          label: "MLX-LM",
          baseUrlDefault: "http://localhost:8080/v1",
          startupCommandTemplate: "mlx {{model}}",
          optimizedFor: "apple-silicon",
          notes: "n",
        },
      ]);
      vi.spyOn(service, "getHardwareProfile").mockReturnValue({ platform: "apple-silicon", unifiedMemoryMb: 32000 });

      const result = await service.runAutotune({ actor: "user", profile: "tool_heavy" as any });
      expect(result.benchmarkResults).toHaveLength(1);
      // Models endpoint failed so failures should be at least 1
      expect(result.benchmarkResults[0].metadata).toHaveProperty("failures");

      fetchSpy.mockRestore();
    });

    it("handles completion with no usage.completion_tokens (falls back to content length)", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      fetchSpy.mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes("/models")) {
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        }
        if (urlStr.includes("/chat/completions")) {
          return new Response(
            JSON.stringify({ choices: [{ message: { content: "A short response here" } }] }),
            { status: 200 }
          );
        }
        if (urlStr.includes("/health")) {
          return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
        }
        return new Response("", { status: 404 });
      });

      mocks.prisma.appSetting.findUnique.mockResolvedValue({
        key: "onprem_qwen_config",
        value: { inferenceBackendId: "mlx-lm", model: "test-model", baseUrl: "http://localhost:8080/v1" },
      });
      mocks.prisma.commandLog.create.mockResolvedValue({ id: "cmd-nousage" });
      mocks.prisma.commandLog.update.mockResolvedValue({});
      mocks.prisma.inferenceBenchmarkRun.create.mockResolvedValue({ id: "bench-nousage", createdAt: new Date() });
      mocks.prisma.inferenceBenchmarkRun.updateMany.mockResolvedValue({ count: 0 });
      mocks.prisma.inferenceBenchmarkRun.findFirst.mockResolvedValue({ id: "bench-nousage" });
      mocks.prisma.inferenceBenchmarkRun.update.mockResolvedValue({});
      mocks.prisma.inferenceBackendProfile.upsert.mockResolvedValue({});
      mocks.v2EventService.appendEvent.mockResolvedValue(undefined);
      mocks.scoreBenchmark.mockReturnValue(0.7);

      mocks.getCandidateOrderForHardware.mockReturnValue(["mlx-lm"]);
      mocks.listOnPremInferenceBackends.mockReturnValue([
        {
          id: "mlx-lm",
          label: "MLX-LM",
          baseUrlDefault: "http://localhost:8080/v1",
          startupCommandTemplate: "mlx {{model}}",
          optimizedFor: "apple-silicon",
          notes: "n",
        },
      ]);
      vi.spyOn(service, "getHardwareProfile").mockReturnValue({ platform: "apple-silicon", unifiedMemoryMb: 32000 });

      const result = await service.runAutotune({ actor: "user", profile: "interactive" as any });
      expect(result.benchmarkResults).toHaveLength(1);
      expect(result.selectedBackendId).toBe("mlx-lm");

      fetchSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // detectRunningBackendId (private, tested via runAutotune)
  // -------------------------------------------------------------------------
  describe("detectRunningBackendId scenarios via runAutotune", () => {
    it("detects mlx-lm backend from health response", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      fetchSpy.mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes("/health")) {
          return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
        }
        if (urlStr.includes("/models")) {
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        }
        if (urlStr.includes("/chat/completions")) {
          return new Response(
            JSON.stringify({ choices: [{ message: { content: "Hi" } }], usage: { completion_tokens: 3 } }),
            { status: 200 }
          );
        }
        return new Response("", { status: 404 });
      });

      mocks.prisma.appSetting.findUnique.mockResolvedValue({
        key: "onprem_qwen_config",
        value: { inferenceBackendId: "mlx-lm", model: "test-model", baseUrl: "http://localhost:8080/v1" },
      });
      mocks.prisma.commandLog.create.mockResolvedValue({ id: "cmd-detect" });
      mocks.prisma.commandLog.update.mockResolvedValue({});
      mocks.prisma.inferenceBenchmarkRun.create.mockResolvedValue({ id: "bench-detect", createdAt: new Date() });
      mocks.prisma.inferenceBenchmarkRun.updateMany.mockResolvedValue({ count: 0 });
      mocks.prisma.inferenceBenchmarkRun.findFirst.mockResolvedValue({ id: "bench-detect" });
      mocks.prisma.inferenceBenchmarkRun.update.mockResolvedValue({});
      mocks.prisma.inferenceBackendProfile.upsert.mockResolvedValue({});
      mocks.v2EventService.appendEvent.mockResolvedValue(undefined);
      mocks.scoreBenchmark.mockReturnValue(0.8);

      mocks.getCandidateOrderForHardware.mockReturnValue(["mlx-lm"]);
      mocks.listOnPremInferenceBackends.mockReturnValue([
        {
          id: "mlx-lm",
          label: "MLX-LM",
          baseUrlDefault: "http://localhost:8080/v1",
          startupCommandTemplate: "mlx {{model}}",
          optimizedFor: "apple-silicon",
          notes: "n",
        },
      ]);
      vi.spyOn(service, "getHardwareProfile").mockReturnValue({ platform: "apple-silicon", unifiedMemoryMb: 32000 });

      const result = await service.runAutotune({ actor: "user", profile: "interactive" as any });
      expect(result.benchmarkResults.length).toBeGreaterThanOrEqual(1);

      fetchSpy.mockRestore();
    });

    it("detects transformers-openai backend from health response", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      fetchSpy.mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes("/health")) {
          return new Response(JSON.stringify({ ok: true, model: "Qwen/Qwen3-0.8B" }), { status: 200 });
        }
        if (urlStr.includes("/models")) {
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        }
        if (urlStr.includes("/chat/completions")) {
          return new Response(
            JSON.stringify({ choices: [{ message: { content: "Hi" } }], usage: { completion_tokens: 3 } }),
            { status: 200 }
          );
        }
        return new Response("", { status: 404 });
      });

      mocks.prisma.appSetting.findUnique.mockResolvedValue({
        key: "onprem_qwen_config",
        value: { inferenceBackendId: "transformers-openai", model: "test-model", baseUrl: "http://localhost:8080/v1" },
      });
      mocks.prisma.commandLog.create.mockResolvedValue({ id: "cmd-detect2" });
      mocks.prisma.commandLog.update.mockResolvedValue({});
      mocks.prisma.inferenceBenchmarkRun.create.mockResolvedValue({ id: "bench-detect2", createdAt: new Date() });
      mocks.prisma.inferenceBenchmarkRun.updateMany.mockResolvedValue({ count: 0 });
      mocks.prisma.inferenceBenchmarkRun.findFirst.mockResolvedValue({ id: "bench-detect2" });
      mocks.prisma.inferenceBenchmarkRun.update.mockResolvedValue({});
      mocks.prisma.inferenceBackendProfile.upsert.mockResolvedValue({});
      mocks.v2EventService.appendEvent.mockResolvedValue(undefined);
      mocks.scoreBenchmark.mockReturnValue(0.8);

      mocks.getCandidateOrderForHardware.mockReturnValue(["transformers-openai"]);
      mocks.listOnPremInferenceBackends.mockReturnValue([
        {
          id: "transformers-openai",
          label: "Transformers",
          baseUrlDefault: "http://localhost:8080/v1",
          startupCommandTemplate: "trans {{model}}",
          optimizedFor: "generic",
          notes: "n",
        },
      ]);
      vi.spyOn(service, "getHardwareProfile").mockReturnValue({ platform: "generic-cpu" });

      const result = await service.runAutotune({ actor: "user", profile: "interactive" as any });
      expect(result.benchmarkResults.length).toBeGreaterThanOrEqual(1);

      fetchSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // probeRuntime (tested via listRoleRuntimeStatuses with enabled config)
  // -------------------------------------------------------------------------
  describe("probeRuntime via listRoleRuntimeStatuses", () => {
    it("returns healthy when health endpoint responds ok", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      fetchSpy.mockResolvedValue(new Response("ok", { status: 200 }));

      mocks.prisma.appSetting.findUnique.mockImplementation(async (args: any) => {
        if (args.where.key === "onprem_qwen_config") {
          return { key: "onprem_qwen_config", value: { inferenceBackendId: "mlx-lm", model: "qwen" } };
        }
        if (args.where.key === "onprem_qwen_role_runtime_configs") {
          return {
            key: "onprem_qwen_role_runtime_configs",
            value: {
              utility_fast: {
                enabled: true,
                model: "qwen",
                baseUrl: "http://localhost:9000/v1",
                inferenceBackendId: "mlx-lm",
              },
            },
          };
        }
        return null;
      });

      const result = await service.listRoleRuntimeStatuses();
      const utilityStatus = result.find((r: any) => r.role === "utility_fast");
      expect(utilityStatus).toBeDefined();
      expect(utilityStatus!.healthy).toBe(true);
      expect(utilityStatus!.message).toBe("health endpoint reachable");

      fetchSpy.mockRestore();
    });

    it("falls back to models endpoint when health fails", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      fetchSpy.mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes("/health")) {
          throw new Error("connection refused");
        }
        if (urlStr.includes("/models")) {
          return new Response(JSON.stringify({ data: [{ id: "m1" }] }), { status: 200 });
        }
        throw new Error("unknown");
      });

      mocks.prisma.appSetting.findUnique.mockImplementation(async (args: any) => {
        if (args.where.key === "onprem_qwen_config") {
          return { key: "onprem_qwen_config", value: { inferenceBackendId: "mlx-lm", model: "qwen" } };
        }
        if (args.where.key === "onprem_qwen_role_runtime_configs") {
          return {
            key: "onprem_qwen_role_runtime_configs",
            value: {
              utility_fast: {
                enabled: true,
                model: "qwen",
                baseUrl: "http://localhost:9000/v1",
                inferenceBackendId: "mlx-lm",
              },
            },
          };
        }
        return null;
      });

      const result = await service.listRoleRuntimeStatuses();
      const utilityStatus = result.find((r: any) => r.role === "utility_fast");
      expect(utilityStatus!.healthy).toBe(true);
      expect(utilityStatus!.message).toBe("models endpoint reachable");

      fetchSpy.mockRestore();
    });

    it("returns unhealthy when both endpoints fail", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      fetchSpy.mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes("/health")) {
          throw new Error("refused");
        }
        if (urlStr.includes("/models")) {
          throw new Error("also refused");
        }
        throw new Error("unknown");
      });

      mocks.prisma.appSetting.findUnique.mockImplementation(async (args: any) => {
        if (args.where.key === "onprem_qwen_config") {
          return { key: "onprem_qwen_config", value: { inferenceBackendId: "mlx-lm", model: "qwen" } };
        }
        if (args.where.key === "onprem_qwen_role_runtime_configs") {
          return {
            key: "onprem_qwen_role_runtime_configs",
            value: {
              utility_fast: {
                enabled: true,
                model: "qwen",
                baseUrl: "http://localhost:9000/v1",
                inferenceBackendId: "mlx-lm",
              },
            },
          };
        }
        return null;
      });

      const result = await service.listRoleRuntimeStatuses();
      const utilityStatus = result.find((r: any) => r.role === "utility_fast");
      expect(utilityStatus!.healthy).toBe(false);
      expect(utilityStatus!.message).toBe("also refused");

      fetchSpy.mockRestore();
    });

    it("returns models endpoint status code when response is not ok", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      fetchSpy.mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes("/health")) {
          throw new Error("refused");
        }
        if (urlStr.includes("/models")) {
          return new Response("bad", { status: 503 });
        }
        throw new Error("unknown");
      });

      mocks.prisma.appSetting.findUnique.mockImplementation(async (args: any) => {
        if (args.where.key === "onprem_qwen_config") {
          return { key: "onprem_qwen_config", value: { inferenceBackendId: "mlx-lm", model: "qwen" } };
        }
        if (args.where.key === "onprem_qwen_role_runtime_configs") {
          return {
            key: "onprem_qwen_role_runtime_configs",
            value: {
              utility_fast: {
                enabled: true,
                model: "qwen",
                baseUrl: "http://localhost:9000/v1",
                inferenceBackendId: "mlx-lm",
              },
            },
          };
        }
        return null;
      });

      const result = await service.listRoleRuntimeStatuses();
      const utilityStatus = result.find((r: any) => r.role === "utility_fast");
      expect(utilityStatus!.healthy).toBe(false);
      expect(utilityStatus!.message).toContain("503");

      fetchSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // getOnPremConfig parsing edge cases (tested indirectly)
  // -------------------------------------------------------------------------
  describe("getOnPremConfig edge cases via listBackends", () => {
    it("uses defaults when appSetting has no value", async () => {
      mocks.prisma.appSetting.findUnique.mockResolvedValue(null);
      mocks.listOnPremInferenceBackends.mockReturnValue([]);

      const result = await service.listBackends();
      expect(result).toEqual([]);
    });

    it("uses custom timeoutMs/temperature/maxTokens from config", async () => {
      mocks.prisma.appSetting.findUnique.mockResolvedValue({
        key: "onprem_qwen_config",
        value: {
          inferenceBackendId: "mlx-lm",
          model: "custom-model",
          timeoutMs: 60000,
          temperature: 0.3,
          maxTokens: 2000,
          baseUrl: "http://custom:8080/v1",
        },
      });
      mocks.listOnPremInferenceBackends.mockReturnValue([
        {
          id: "mlx-lm",
          label: "MLX-LM",
          baseUrlDefault: "http://localhost:8080/v1",
          startupCommandTemplate: "mlx {{model}}",
          optimizedFor: "apple-silicon",
          notes: "n",
        },
      ]);
      mocks.spawnSync.mockReturnValue({ status: 1 });

      const result = await service.listBackends();
      expect(result).toHaveLength(1);
      expect(result[0].active).toBe(true);
    });

    it("clamps timeoutMs to minimum 5000", async () => {
      mocks.prisma.appSetting.findUnique.mockResolvedValue({
        key: "onprem_qwen_config",
        value: {
          inferenceBackendId: "mlx-lm",
          model: "m",
          timeoutMs: 100, // below 5000
        },
      });
      mocks.listOnPremInferenceBackends.mockReturnValue([]);

      // This exercises the Math.max(5000, ...) path
      const result = await service.listBackends();
      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // parseRoleRuntimeConfig edge cases (tested via getRoleRuntimeConfigs)
  // -------------------------------------------------------------------------
  describe("parseRoleRuntimeConfig edge cases", () => {
    it("uses plugin runtimeModel when model is empty string", async () => {
      mocks.prisma.appSetting.findUnique.mockImplementation(async (args: any) => {
        if (args.where.key === "onprem_qwen_config") {
          return { key: "onprem_qwen_config", value: { inferenceBackendId: "mlx-lm", model: "qwen" } };
        }
        if (args.where.key === "onprem_qwen_role_runtime_configs") {
          return {
            key: "onprem_qwen_role_runtime_configs",
            value: {
              utility_fast: {
                enabled: true,
                model: "  ", // whitespace only
                baseUrl: "http://localhost:9000/v1",
              },
            },
          };
        }
        return null;
      });

      const result = await service.testRoleRuntime({ role: "utility_fast" });
      // model falls back to plugin.runtimeModel = "test-runtime-model"
      expect(result.model).toBe("test-runtime-model");
    });

    it("uses fallback model when plugin runtimeModel is 'custom'", async () => {
      const { resolveOnPremQwenModelPlugin } = await import("../providers/modelPlugins");
      // First call: getOnPremConfig also calls resolveOnPremQwenModelPlugin
      // Second call: parseRoleRuntimeConfig for utility_fast
      // Third call: parseRoleRuntimeConfig for coder_default
      // Fourth call: parseRoleRuntimeConfig for review_deep
      (resolveOnPremQwenModelPlugin as any)
        .mockReturnValueOnce({
          id: "default-plugin",
          model: "default-model",
          runtimeModel: "default-runtime-model",
          recommendedBackend: "mlx-lm",
        })
        .mockReturnValueOnce({
          id: "custom-plugin",
          model: "custom",
          runtimeModel: "custom",
          recommendedBackend: "",
        });

      mocks.prisma.appSetting.findUnique.mockImplementation(async (args: any) => {
        if (args.where.key === "onprem_qwen_config") {
          return { key: "onprem_qwen_config", value: { inferenceBackendId: "mlx-lm", model: "fallback-model" } };
        }
        if (args.where.key === "onprem_qwen_role_runtime_configs") {
          return {
            key: "onprem_qwen_role_runtime_configs",
            value: {
              utility_fast: {
                enabled: true,
                pluginId: "custom-plugin",
              },
            },
          };
        }
        return null;
      });

      const result = await service.testRoleRuntime({ role: "utility_fast" });
      expect(result.model).toBe("fallback-model");
    });

    it("uses raw value when it's not an object", async () => {
      mocks.prisma.appSetting.findUnique.mockImplementation(async (args: any) => {
        if (args.where.key === "onprem_qwen_config") {
          return { key: "onprem_qwen_config", value: { inferenceBackendId: "mlx-lm", model: "qwen" } };
        }
        if (args.where.key === "onprem_qwen_role_runtime_configs") {
          return {
            key: "onprem_qwen_role_runtime_configs",
            value: {
              utility_fast: "not-an-object",
            },
          };
        }
        return null;
      });

      const result = await service.testRoleRuntime({ role: "utility_fast" });
      // Should use defaults from plugin since the raw value is not an object
      expect(result.model).toBe("test-runtime-model");
      expect(result.enabled).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // canLoadModel with undefined VRAM
  // -------------------------------------------------------------------------
  describe("canLoadModel edge cases", () => {
    it("handles nvidia-cuda with undefined vramMb", () => {
      const profile: HardwareProfile = { platform: "nvidia-cuda" };
      vi.spyOn(service, "getHardwareProfile").mockReturnValue(profile);
      expect(service.canLoadModel(4)).toBe(false);
    });

    it("handles apple-silicon with zero unifiedMemoryMb", () => {
      const profile: HardwareProfile = { platform: "apple-silicon", unifiedMemoryMb: 0 };
      vi.spyOn(service, "getHardwareProfile").mockReturnValue(profile);
      expect(service.canLoadModel(1)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Health monitoring — max restart limit
  // -------------------------------------------------------------------------
  describe("health monitoring — restart limit", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      service.stopHealthMonitoring("test-restart-limit" as OnPremInferenceBackendId);
      vi.useRealTimers();
    });

    it("stops restarting after 3 restart attempts", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      fetchSpy.mockRejectedValue(new Error("connection refused"));

      // Mock startBackend dependencies
      mocks.prisma.appSetting.findUnique.mockResolvedValue({
        key: "onprem_qwen_config",
        value: { inferenceBackendId: "test-restart-limit", model: "test-model" },
      });
      mocks.prisma.commandLog.create.mockResolvedValue({ id: "cmd-restart-limit" });
      mocks.prisma.commandLog.update.mockResolvedValue({});
      const mockChild = {
        pid: 99991,
        on: vi.fn(),
        kill: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
      };
      mocks.spawn.mockReturnValue(mockChild);

      service.startHealthMonitoring("test-restart-limit" as OnPremInferenceBackendId, "http://localhost:7777/v1");

      // Trigger enough health checks to cause 3+ down transitions
      // Each down triggers a restart with backoff, need > 3 full cycles
      for (let i = 0; i < 15; i++) {
        await vi.advanceTimersByTimeAsync(30001);
      }

      const status = service.getHealthStatus("test-restart-limit" as OnPremInferenceBackendId);
      expect(status).not.toBeNull();
      // After max restarts, publishEvent should have been called with restart_limit
      expect(mocks.publishEvent).toHaveBeenCalledWith(
        "global",
        "inference.backend.health.restart_limit",
        expect.any(Object),
      );

      fetchSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // testRoleRuntime with enabled and configured role
  // -------------------------------------------------------------------------
  describe("testRoleRuntime with enabled config", () => {
    it("probes runtime and returns full result", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      fetchSpy.mockResolvedValue(new Response("ok", { status: 200 }));

      mocks.prisma.appSetting.findUnique.mockImplementation(async (args: any) => {
        if (args.where.key === "onprem_qwen_config") {
          return { key: "onprem_qwen_config", value: { inferenceBackendId: "mlx-lm", model: "qwen" } };
        }
        if (args.where.key === "onprem_qwen_role_runtime_configs") {
          return {
            key: "onprem_qwen_role_runtime_configs",
            value: {
              coder_default: {
                enabled: true,
                model: "qwen-coder",
                baseUrl: "http://localhost:9001/v1",
                inferenceBackendId: "mlx-lm",
              },
            },
          };
        }
        return null;
      });

      const result = await service.testRoleRuntime({ role: "coder_default" });
      expect(result.role).toBe("coder_default");
      expect(result.enabled).toBe(true);
      expect(result.configured).toBe(true);
      expect(result.healthy).toBe(true);
      expect(result.modelCount).toBe(0);
      expect(result.model).toBe("qwen-coder");

      fetchSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // listRoleRuntimeStatuses with running process
  // -------------------------------------------------------------------------
  describe("listRoleRuntimeStatuses with running runtime", () => {
    it("shows running=true for a started role runtime", async () => {
      // Start a role runtime first
      mocks.prisma.appSetting.findUnique.mockImplementation(async (args: any) => {
        if (args.where.key === "onprem_qwen_config") {
          return { key: "onprem_qwen_config", value: { inferenceBackendId: "mlx-lm", model: "qwen" } };
        }
        if (args.where.key === "onprem_qwen_role_runtime_configs") {
          return {
            key: "onprem_qwen_role_runtime_configs",
            value: {
              review_deep: {
                enabled: true,
                model: "qwen-deep",
                baseUrl: "http://localhost:9002/v1",
                inferenceBackendId: "mlx-lm",
              },
            },
          };
        }
        return null;
      });

      const mockChild = {
        pid: 11111,
        on: vi.fn(),
        kill: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
      };
      mocks.spawn.mockReturnValue(mockChild);

      await service.startRoleRuntime({ actor: "user", role: "review_deep" });

      // Mock fetch for probe
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      fetchSpy.mockResolvedValue(new Response("ok", { status: 200 }));

      const statuses = await service.listRoleRuntimeStatuses();
      const reviewStatus = statuses.find((r: any) => r.role === "review_deep");
      expect(reviewStatus!.running).toBe(true);
      expect(reviewStatus!.pid).toBe(11111);

      fetchSpy.mockRestore();

      // Cleanup
      await service.stopRoleRuntime({ actor: "user", role: "review_deep" });
    });
  });

  // -------------------------------------------------------------------------
  // listRoleRuntimeStatuses with enabled but not probed message
  // -------------------------------------------------------------------------
  describe("listRoleRuntimeStatuses message variations", () => {
    it("shows 'runtime not tested yet' when enabled but not configured", async () => {
      // To make configured=false, we need both model and baseUrl to resolve to empty.
      // This requires the backend's baseUrlDefault to be empty.
      mocks.resolveOnPremInferenceBackend.mockReturnValueOnce({
        id: "mlx-lm",
        label: "Test",
        baseUrlDefault: "",
        startupCommandTemplate: "cmd {{model}}",
        notes: "",
        optimizedFor: "test",
      });
      // getOnPremConfig also calls resolveOnPremInferenceBackend
      // and parseRoleRuntimeConfig calls it for each role
      // We need to cover the 3 parseRoleRuntimeConfig calls plus the getOnPremConfig call
      mocks.resolveOnPremInferenceBackend.mockReturnValue({
        id: "mlx-lm",
        label: "Test",
        baseUrlDefault: "",
        startupCommandTemplate: "cmd {{model}}",
        notes: "",
        optimizedFor: "test",
      });

      const { resolveOnPremQwenModelPlugin } = await import("../providers/modelPlugins");
      // Mock plugin with empty runtimeModel and recommendedBackend
      (resolveOnPremQwenModelPlugin as any).mockReturnValue({
        id: "test-plugin",
        model: "test-model",
        runtimeModel: "",
        recommendedBackend: "mlx-lm",
      });

      mocks.prisma.appSetting.findUnique.mockImplementation(async (args: any) => {
        if (args.where.key === "onprem_qwen_config") {
          return { key: "onprem_qwen_config", value: { inferenceBackendId: "mlx-lm" } };
        }
        if (args.where.key === "onprem_qwen_role_runtime_configs") {
          return {
            key: "onprem_qwen_role_runtime_configs",
            value: {
              utility_fast: {
                enabled: true,
              },
            },
          };
        }
        return null;
      });

      const result = await service.listRoleRuntimeStatuses();
      const utilStatus = result.find((r: any) => r.role === "utility_fast");
      expect(utilStatus!.enabled).toBe(true);
      expect(utilStatus!.configured).toBe(false);
      expect(utilStatus!.message).toBe("runtime not tested yet");

      // Restore the default mock
      (resolveOnPremQwenModelPlugin as any).mockReturnValue({
        id: "test-plugin",
        model: "test-model",
        runtimeModel: "test-runtime-model",
        recommendedBackend: "mlx-lm",
      });
      mocks.resolveOnPremInferenceBackend.mockImplementation((id: string) => ({
        id,
        label: "Test Backend",
        baseUrlDefault: "http://localhost:8080",
        startupCommandTemplate: "mock-server --model {{model}}",
        notes: "Test notes",
        optimizedFor: "test",
      }));
    });
  });
});
