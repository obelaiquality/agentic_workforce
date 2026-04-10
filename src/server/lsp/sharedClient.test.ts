/**
 * Unit tests for sharedClient.ts
 * Tests singleton LSPClient lifecycle (create, reuse, shutdown).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockStopAll = vi.fn().mockResolvedValue(undefined);

vi.mock("./lspClient", () => ({
  LSPClient: vi.fn().mockImplementation(() => ({ stopAll: mockStopAll })),
}));

import { getSharedLspClient, shutdownSharedLspClient } from "./sharedClient";
import { LSPClient } from "./lspClient";

const MockedLSPClient = vi.mocked(LSPClient);

describe("sharedClient", () => {
  beforeEach(async () => {
    // Reset module-level singleton by shutting down any existing client
    await shutdownSharedLspClient();
    MockedLSPClient.mockClear();
    mockStopAll.mockClear();
  });

  it("getSharedLspClient returns an LSPClient instance", () => {
    const client = getSharedLspClient();

    expect(client).toBeDefined();
    expect(client.stopAll).toBe(mockStopAll);
    expect(MockedLSPClient).toHaveBeenCalledTimes(1);
  });

  it("calling getSharedLspClient twice returns same instance (singleton)", () => {
    const first = getSharedLspClient();
    const second = getSharedLspClient();

    expect(first).toBe(second);
    expect(MockedLSPClient).toHaveBeenCalledTimes(1);
  });

  it("shutdownSharedLspClient calls stopAll on client", async () => {
    getSharedLspClient();

    await shutdownSharedLspClient();

    expect(mockStopAll).toHaveBeenCalledOnce();
  });

  it("after shutdown, next getSharedLspClient creates new instance", async () => {
    const first = getSharedLspClient();
    await shutdownSharedLspClient();

    const second = getSharedLspClient();

    expect(second).not.toBe(first);
    expect(MockedLSPClient).toHaveBeenCalledTimes(2);
  });

  it("shutdownSharedLspClient is no-op when no client exists", async () => {
    // No client has been created (beforeEach already shut down)
    await shutdownSharedLspClient();

    expect(mockStopAll).not.toHaveBeenCalled();
  });
});
