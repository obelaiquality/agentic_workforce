import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────────
const mockListen = vi.fn().mockResolvedValue(undefined);
const mockClose = vi.fn().mockResolvedValue(undefined);
const mockApp = {
  listen: mockListen,
  close: mockClose,
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
};

vi.mock("dotenv/config", () => ({}));

vi.mock("./logger", () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("./app", () => ({
  createServer: vi.fn().mockImplementation(() => Promise.resolve(mockApp)),
}));

vi.mock("./db", () => ({
  prisma: { $disconnect: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("./sidecar/manager", () => ({
  stopSidecarProcess: vi.fn(),
}));

import { requireConfiguredApiToken, bootstrap } from "./index";

describe("standalone API token startup", () => {
  it("rejects empty tokens", () => {
    expect(() => requireConfiguredApiToken("")).toThrow("API_TOKEN is required for standalone API startup");
  });

  it("accepts non-empty trimmed tokens", () => {
    expect(requireConfiguredApiToken("  local-dev-token  ")).toBe("local-dev-token");
  });

  it("rejects undefined/missing tokens", () => {
    expect(() => requireConfiguredApiToken(undefined)).toThrow("API_TOKEN is required");
  });

  it("rejects whitespace-only tokens", () => {
    expect(() => requireConfiguredApiToken("   ")).toThrow("API_TOKEN is required");
  });
});

describe("bootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.API_TOKEN = "test-token";
  });

  it("creates server and starts listening", async () => {
    await bootstrap();
    expect(mockListen).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "127.0.0.1",
        port: expect.any(Number),
      })
    );
    expect(mockApp.log.info).toHaveBeenCalled();
  });

  it("throws when API_TOKEN is not set", async () => {
    delete process.env.API_TOKEN;
    await expect(bootstrap()).rejects.toThrow("API_TOKEN is required");
  });
});
