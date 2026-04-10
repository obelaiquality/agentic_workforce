import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OtlpExporter, type OtlpConfig } from "./otlpExporter";
import type { ExportedSpan } from "./jsonFileExporter";

describe("OtlpExporter", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function makeConfig(overrides?: Partial<OtlpConfig>): OtlpConfig {
    return {
      endpoint: "http://localhost:4318/v1/traces",
      enabled: true,
      ...overrides,
    };
  }

  function makeSpan(overrides?: Partial<ExportedSpan>): ExportedSpan {
    return {
      name: "test-span",
      startTime: 1700000000000,
      endTime: 1700000000100,
      durationMs: 100,
      attributes: { tool: "bash" },
      status: "ok",
      events: [{ name: "checkpoint", timestamp: 1700000000050 }],
      ...overrides,
    };
  }

  // ---------------------------------------------------------------------------
  // exportSpans
  // ---------------------------------------------------------------------------

  describe("exportSpans", () => {
    it("returns success when the endpoint responds with 200", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
      });

      const exporter = new OtlpExporter(makeConfig());
      const result = await exporter.exportSpans([makeSpan()]);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();

      expect(globalThis.fetch).toHaveBeenCalledOnce();
      const [url, options] = (globalThis.fetch as any).mock.calls[0];
      expect(url).toBe("http://localhost:4318/v1/traces");
      expect(options.method).toBe("POST");
      expect(options.headers["Content-Type"]).toBe("application/json");

      // Verify OTLP structure
      const body = JSON.parse(options.body);
      expect(body.resourceSpans).toBeDefined();
      expect(body.resourceSpans[0].scopeSpans[0].spans).toHaveLength(1);
      expect(body.resourceSpans[0].scopeSpans[0].spans[0].name).toBe(
        "test-span",
      );
    });

    it("returns failure on HTTP error response", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
      });

      const exporter = new OtlpExporter(makeConfig());
      const result = await exporter.exportSpans([makeSpan()]);

      expect(result.success).toBe(false);
      expect(result.error).toContain("503");
    });

    it("returns failure when fetch throws (network error)", async () => {
      globalThis.fetch = vi
        .fn()
        .mockRejectedValue(new Error("ECONNREFUSED"));

      const exporter = new OtlpExporter(makeConfig());
      const result = await exporter.exportSpans([makeSpan()]);

      expect(result.success).toBe(false);
      expect(result.error).toContain("ECONNREFUSED");
    });

    it("returns failure when exporter is disabled", async () => {
      const exporter = new OtlpExporter(makeConfig({ enabled: false }));
      const result = await exporter.exportSpans([makeSpan()]);

      expect(result.success).toBe(false);
      expect(result.error).toContain("disabled");
    });

    it("returns success for empty spans array", async () => {
      const exporter = new OtlpExporter(makeConfig());
      const result = await exporter.exportSpans([]);

      expect(result.success).toBe(true);
    });

    it("includes custom headers in the request", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
      });

      const exporter = new OtlpExporter(
        makeConfig({
          headers: { Authorization: "Bearer test-token" },
        }),
      );
      await exporter.exportSpans([makeSpan()]);

      const [, options] = (globalThis.fetch as any).mock.calls[0];
      expect(options.headers.Authorization).toBe("Bearer test-token");
    });

    it("maps span attributes correctly in OTLP format", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
      });

      const span = makeSpan({
        attributes: { strAttr: "hello", numAttr: 42, boolAttr: true },
        status: "error",
      });

      const exporter = new OtlpExporter(makeConfig());
      await exporter.exportSpans([span]);

      const [, options] = (globalThis.fetch as any).mock.calls[0];
      const body = JSON.parse(options.body);
      const otlpSpan = body.resourceSpans[0].scopeSpans[0].spans[0];

      const attrs = otlpSpan.attributes;
      expect(attrs).toContainEqual({
        key: "strAttr",
        value: { stringValue: "hello" },
      });
      expect(attrs).toContainEqual({
        key: "numAttr",
        value: { intValue: 42 },
      });
      expect(attrs).toContainEqual({
        key: "boolAttr",
        value: { boolValue: true },
      });

      expect(otlpSpan.status.code).toBe("STATUS_CODE_ERROR");
    });
  });

  // ---------------------------------------------------------------------------
  // healthCheck
  // ---------------------------------------------------------------------------

  describe("healthCheck", () => {
    it("returns true when endpoint responds with 2xx", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });

      const exporter = new OtlpExporter(makeConfig());
      const healthy = await exporter.healthCheck();
      expect(healthy).toBe(true);
    });

    it("returns true for 4xx responses (endpoint reachable)", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
      });

      const exporter = new OtlpExporter(makeConfig());
      const healthy = await exporter.healthCheck();
      expect(healthy).toBe(true);
    });

    it("returns false for 5xx responses", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      const exporter = new OtlpExporter(makeConfig());
      const healthy = await exporter.healthCheck();
      expect(healthy).toBe(false);
    });

    it("returns false when fetch throws", async () => {
      globalThis.fetch = vi
        .fn()
        .mockRejectedValue(new Error("ECONNREFUSED"));

      const exporter = new OtlpExporter(makeConfig());
      const healthy = await exporter.healthCheck();
      expect(healthy).toBe(false);
    });

    it("returns false when exporter is disabled", async () => {
      const exporter = new OtlpExporter(makeConfig({ enabled: false }));
      const healthy = await exporter.healthCheck();
      expect(healthy).toBe(false);
    });
  });
});
