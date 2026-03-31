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
  spawnSync: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock("../db", () => ({ prisma: mocks.prisma }));
vi.mock("../eventBus", () => ({ publishEvent: mocks.publishEvent }));
vi.mock("./v2EventService", () => ({ V2EventService: vi.fn(() => mocks.v2EventService) }));
vi.mock("../providers/inferenceBackends", () => ({
  buildStartupCommandForBaseUrl: vi.fn(() => "mock-command"),
  listOnPremInferenceBackends: vi.fn(() => []),
  resolveOnPremInferenceBackend: vi.fn((id: string) => ({
    id,
    label: "Test Backend",
    baseUrlDefault: "http://localhost:8080",
    startupCommandTemplate: "mock-server --model {{model}}",
    notes: "Test notes",
    optimizedFor: "test",
  })),
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
  getCandidateOrderForHardware: vi.fn(() => []),
  scoreBenchmark: vi.fn(() => 0.75),
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
});
