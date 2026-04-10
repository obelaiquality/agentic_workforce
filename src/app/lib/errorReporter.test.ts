// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockGetDesktopBridge = vi.hoisted(() => vi.fn());

vi.mock("./desktopBridge", () => ({
  getDesktopBridge: mockGetDesktopBridge,
}));

import { reportClientError, type ClientErrorReport } from "./errorReporter";

function makeReport(overrides: Partial<ClientErrorReport> = {}): ClientErrorReport {
  return {
    message: "Test error",
    source: "error_boundary",
    timestamp: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  mockGetDesktopBridge.mockReset();
  vi.restoreAllMocks();
});

describe("reportClientError", () => {
  it("uses bridge.apiRequest when bridge exists", () => {
    const mockApiRequest = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    mockGetDesktopBridge.mockReturnValue({ apiRequest: mockApiRequest });

    reportClientError(makeReport());

    expect(mockApiRequest).toHaveBeenCalledWith({
      method: "POST",
      path: "/api/telemetry/client-error",
      body: expect.objectContaining({ message: "Test error" }),
    });
  });

  it("uses fetch when no bridge", () => {
    mockGetDesktopBridge.mockReturnValue(undefined);
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);

    reportClientError(makeReport());

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/telemetry/client-error"),
      expect.objectContaining({ method: "POST" })
    );
    vi.unstubAllGlobals();
  });

  it("never throws when bridge.apiRequest rejects", () => {
    const mockApiRequest = vi.fn().mockRejectedValue(new Error("bridge down"));
    mockGetDesktopBridge.mockReturnValue({ apiRequest: mockApiRequest });

    expect(() => reportClientError(makeReport())).not.toThrow();
  });

  it("never throws when fetch rejects", () => {
    mockGetDesktopBridge.mockReturnValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));

    expect(() => reportClientError(makeReport())).not.toThrow();
    vi.unstubAllGlobals();
  });

  it("sends correct endpoint path via bridge", () => {
    const mockApiRequest = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    mockGetDesktopBridge.mockReturnValue({ apiRequest: mockApiRequest });

    reportClientError(makeReport());

    expect(mockApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/api/telemetry/client-error" })
    );
  });

  it("sends correct endpoint path via fetch", () => {
    mockGetDesktopBridge.mockReturnValue(undefined);
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);

    reportClientError(makeReport());

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/api/telemetry/client-error");
    vi.unstubAllGlobals();
  });
});
