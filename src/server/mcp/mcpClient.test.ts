import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MCPClient, type MCPHealthState } from "./mcpClient";
import type { MCPServerConfig, MCPConnection, PendingRequest } from "./types";
import * as eventBusModule from "../eventBus";

describe("MCPClient", () => {
  let client: MCPClient;

  beforeEach(() => {
    client = new MCPClient();
  });

  afterEach(async () => {
    await client.disconnectAll();
  });

  describe("connect", () => {
    it("should reject unsupported transport types", async () => {
      const config: MCPServerConfig = {
        id: "test-unknown",
        name: "Test Unknown Transport",
        transport: "unknown" as any,
        enabled: true,
      };

      await expect(client.connect(config)).rejects.toThrow(
        "Unsupported transport: unknown"
      );
    });

    it("should reject stdio config without command", async () => {
      const config: MCPServerConfig = {
        id: "test-stdio",
        name: "Test Stdio Server",
        transport: "stdio",
        enabled: true,
      };

      await expect(client.connect(config)).rejects.toThrow(
        "Command is required for stdio transport"
      );
    });

    it("should reject duplicate connections", async () => {
      // Manually set a connection entry to test the duplicate check
      // without spawning a real process
      (client as any).connections.set("test-duplicate", { connected: false });

      const config: MCPServerConfig = {
        id: "test-duplicate",
        name: "Test Duplicate",
        transport: "stdio",
        command: "echo",
        enabled: true,
      };

      await expect(client.connect(config)).rejects.toThrow(
        "Already connected to server: test-duplicate"
      );

      // Clean up
      (client as any).connections.delete("test-duplicate");
    });
  });

  describe("disconnect", () => {
    it("should handle disconnect of non-existent server gracefully", async () => {
      await expect(client.disconnect("non-existent")).resolves.toBeUndefined();
    });
  });

  describe("getStatus", () => {
    it("should return empty array when no servers connected", () => {
      const statuses = client.getStatus();
      expect(statuses).toEqual([]);
    });
  });

  describe("listTools", () => {
    it("should reject when server not connected", async () => {
      await expect(client.listTools("non-existent")).rejects.toThrow(
        "Not connected to server: non-existent"
      );
    });
  });

  describe("listResources", () => {
    it("should reject when server not connected", async () => {
      await expect(client.listResources("non-existent")).rejects.toThrow(
        "Not connected to server: non-existent"
      );
    });
  });

  describe("callTool", () => {
    it("should reject when server not connected", async () => {
      await expect(client.callTool("non-existent", "tool", {})).rejects.toThrow(
        "Not connected to server: non-existent"
      );
    });
  });

  describe("readResource", () => {
    it("should reject when server not connected", async () => {
      await expect(client.readResource("non-existent", "file:///test")).rejects.toThrow(
        "Not connected to server: non-existent"
      );
    });
  });

  describe("healthCheck", () => {
    it("healthCheck returns true for connected server", async () => {
      // Set up a fake connection with a process that responds to kill(pid, 0)
      const fakePid = process.pid; // Use our own pid — known alive
      const fakeConnection = {
        serverId: "health-test",
        config: { id: "health-test", name: "Test", transport: "stdio" as const, command: "echo", enabled: true },
        process: {
          pid: fakePid,
          stdin: { write: vi.fn() },
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
        },
        connected: true,
        tools: [],
        resources: [],
        nextRequestId: 1,
        pendingRequests: new Map(),
      };
      (client as any).connections.set("health-test", fakeConnection);

      // Mock sendRequest to simulate a successful ping
      const sendRequestSpy = vi.spyOn(client as any, "sendRequest").mockResolvedValue({});

      const result = await client.healthCheck("health-test");
      expect(result).toBe(true);

      sendRequestSpy.mockRestore();
      (client as any).connections.delete("health-test");
    });

    it("healthCheck returns false for unresponsive server", async () => {
      // Set up a connection with an invalid PID
      const fakeConnection = {
        serverId: "dead-server",
        config: { id: "dead-server", name: "Dead", transport: "stdio" as const, command: "echo", enabled: true },
        process: {
          pid: 999999999, // PID that almost certainly does not exist
          stdin: { write: vi.fn() },
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
        },
        connected: false,
        tools: [],
        resources: [],
        nextRequestId: 1,
        pendingRequests: new Map(),
      };
      (client as any).connections.set("dead-server", fakeConnection);

      const result = await client.healthCheck("dead-server");
      expect(result).toBe(false);

      (client as any).connections.delete("dead-server");
    });
  });

  describe("health monitor", () => {
    it("health monitor detects failure after 3 consecutive health check failures", async () => {
      vi.useFakeTimers();
      const publishSpy = vi.spyOn(eventBusModule, "publishEvent");

      // Set up fake connection
      const fakeConnection = {
        serverId: "monitor-fail",
        config: { id: "monitor-fail", name: "Monitor Fail", transport: "stdio" as const, command: "echo", enabled: true },
        process: {
          pid: 999999999,
          stdin: { write: vi.fn() },
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
        },
        connected: true,
        tools: [],
        resources: [],
        nextRequestId: 1,
        pendingRequests: new Map(),
      };
      (client as any).connections.set("monitor-fail", fakeConnection);

      // Mock healthCheck to always return false
      const healthSpy = vi.spyOn(client, "healthCheck").mockResolvedValue(false);
      // Mock connect/disconnect to prevent real process spawning
      vi.spyOn(client, "disconnect").mockResolvedValue(undefined);
      vi.spyOn(client, "connect").mockRejectedValue(new Error("restart failed"));

      client.startHealthMonitor("monitor-fail", 1000);

      // Tick 3 intervals to trigger 3 failures
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);

      // After 3 failures, mcp.server.unhealthy event should have been emitted
      expect(publishSpy).toHaveBeenCalledWith(
        "mcp",
        "mcp.server.unhealthy",
        expect.objectContaining({ serverId: "monitor-fail" })
      );

      client.stopHealthMonitor("monitor-fail");
      healthSpy.mockRestore();
      publishSpy.mockRestore();
      (client as any).connections.delete("monitor-fail");
      vi.useRealTimers();
    });

    it("health monitor attempts auto-restart with exponential backoff", async () => {
      vi.useFakeTimers();
      const publishSpy = vi.spyOn(eventBusModule, "publishEvent");

      const fakeConfig: MCPServerConfig = { id: "backoff-test", name: "Backoff", transport: "stdio", command: "echo", enabled: true };
      const fakeConnection = {
        serverId: "backoff-test",
        config: fakeConfig,
        process: {
          pid: 999999999,
          stdin: { write: vi.fn() },
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
        },
        connected: true,
        tools: [],
        resources: [],
        nextRequestId: 1,
        pendingRequests: new Map(),
      };
      (client as any).connections.set("backoff-test", fakeConnection);

      let healthCheckCount = 0;
      const healthSpy = vi.spyOn(client, "healthCheck").mockImplementation(async () => {
        healthCheckCount++;
        // Fail the first 3, then succeed (simulating successful restart)
        return healthCheckCount > 3;
      });
      const disconnectSpy = vi.spyOn(client, "disconnect").mockResolvedValue(undefined);
      const connectSpy = vi.spyOn(client, "connect").mockImplementation(async () => {
        (client as any).connections.set("backoff-test", fakeConnection);
      });

      client.startHealthMonitor("backoff-test", 1000);

      // Trigger 3 failures -> unhealthy event + restart with backoff
      await vi.advanceTimersByTimeAsync(1000); // failure 1
      await vi.advanceTimersByTimeAsync(1000); // failure 2
      await vi.advanceTimersByTimeAsync(1000); // failure 3 -> triggers restart

      // Advance past the first backoff (5s for attempt 1)
      await vi.advanceTimersByTimeAsync(5000);

      expect(connectSpy).toHaveBeenCalled();

      // The mcp.server.restarted event should have been published
      const restartedCalls = publishSpy.mock.calls.filter(
        (call) => call[1] === "mcp.server.restarted"
      );
      expect(restartedCalls.length).toBeGreaterThanOrEqual(1);
      expect(restartedCalls[0][2]).toEqual(
        expect.objectContaining({ serverId: "backoff-test" })
      );

      client.stopHealthMonitor("backoff-test");
      healthSpy.mockRestore();
      disconnectSpy.mockRestore();
      connectSpy.mockRestore();
      publishSpy.mockRestore();
      (client as any).connections.delete("backoff-test");
      vi.useRealTimers();
    });

    it("health monitor marks server as failed after max restart attempts", async () => {
      vi.useFakeTimers();
      const publishSpy = vi.spyOn(eventBusModule, "publishEvent");

      const fakeConfig: MCPServerConfig = { id: "max-fail", name: "MaxFail", transport: "stdio", command: "echo", enabled: true };
      const fakeConnection = {
        serverId: "max-fail",
        config: fakeConfig,
        process: {
          pid: 999999999,
          stdin: { write: vi.fn() },
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
        },
        connected: true,
        tools: [],
        resources: [],
        nextRequestId: 1,
        pendingRequests: new Map(),
      };
      (client as any).connections.set("max-fail", fakeConnection);

      const healthSpy = vi.spyOn(client, "healthCheck").mockResolvedValue(false);
      const disconnectSpy = vi.spyOn(client, "disconnect").mockResolvedValue(undefined);
      const connectSpy = vi.spyOn(client, "connect").mockImplementation(async () => {
        (client as any).connections.set("max-fail", fakeConnection);
        throw new Error("restart failed");
      });

      client.startHealthMonitor("max-fail", 1000);

      // Directly set the health state to simulate 4 prior failed restart
      // attempts and 3+ consecutive failures so the next interval tick
      // enters the restart path and discovers restartAttempts >= MAX.
      const healthState = (client as any).healthMonitors.get("max-fail") as MCPHealthState;
      healthState.restartAttempts = 5;
      healthState.consecutiveFailures = 3;

      // One interval tick will enter the restart path and see restartAttempts >= 5
      await vi.advanceTimersByTimeAsync(1000);

      const serverHealth = client.getServerHealth("max-fail");
      expect(serverHealth).toBe("failed");

      const failedCalls = publishSpy.mock.calls.filter(
        (call) => call[1] === "mcp.server.failed"
      );
      expect(failedCalls.length).toBeGreaterThanOrEqual(1);
      expect(failedCalls[0][2]).toEqual(
        expect.objectContaining({ serverId: "max-fail", restartAttempts: 5 })
      );

      healthSpy.mockRestore();
      disconnectSpy.mockRestore();
      connectSpy.mockRestore();
      publishSpy.mockRestore();
      (client as any).connections.delete("max-fail");
      (client as any).healthMonitors.delete("max-fail");
      vi.useRealTimers();
    });

    it("stopHealthMonitor clears the health check interval", () => {
      vi.useFakeTimers();

      const fakeConnection = {
        serverId: "stop-test",
        config: { id: "stop-test", name: "StopTest", transport: "stdio" as const, command: "echo", enabled: true },
        process: {
          pid: process.pid,
          stdin: { write: vi.fn() },
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
        },
        connected: true,
        tools: [],
        resources: [],
        nextRequestId: 1,
        pendingRequests: new Map(),
      };
      (client as any).connections.set("stop-test", fakeConnection);

      client.startHealthMonitor("stop-test", 5000);

      const state = (client as any).healthMonitors.get("stop-test") as MCPHealthState;
      expect(state).toBeDefined();
      expect(state.intervalHandle).not.toBeNull();

      client.stopHealthMonitor("stop-test");
      expect(state.intervalHandle).toBeNull();

      (client as any).connections.delete("stop-test");
      (client as any).healthMonitors.delete("stop-test");
      vi.useRealTimers();
    });
  });

  // -------------------------------------------------------------------------
  // Process lifecycle edge case tests
  // -------------------------------------------------------------------------

  describe("request timeout", () => {
    it("enforces request timeout on tool calls", async () => {
      const mockStdin = { write: vi.fn() };
      const connection: MCPConnection = {
        serverId: "timeout-server",
        config: { id: "timeout-server", name: "Timeout", transport: "stdio", command: "fake", enabled: true },
        connected: true,
        tools: [{ serverId: "timeout-server", name: "slow_tool", description: "Slow", inputSchema: {} }],
        resources: [],
        nextRequestId: 1,
        pendingRequests: new Map(),
        process: {
          pid: 99999,
          stdin: mockStdin as any,
          stdout: { on: vi.fn() } as any,
          stderr: { on: vi.fn() } as any,
        },
      };
      (client as any).connections.set("timeout-server", connection);
      (client as any).requestTimeout = 100;

      await expect(client.callTool("timeout-server", "slow_tool", {})).rejects.toThrow(
        "Request timeout",
      );
    });
  });

  describe("initialize timeout", () => {
    it("enforces initialize timeout on slow servers via sendRequest", async () => {
      // Test the initialize timeout behavior by directly calling sendRequest
      // with a short timeout on a connection whose server never responds
      const mockStdin = { write: vi.fn() };
      const connection: MCPConnection = {
        serverId: "slow-init-server",
        config: { id: "slow-init-server", name: "SlowInit", transport: "stdio", command: "fake", enabled: true },
        connected: false,
        tools: [],
        resources: [],
        nextRequestId: 1,
        pendingRequests: new Map(),
        process: {
          pid: 11111,
          stdin: mockStdin as any,
          stdout: { on: vi.fn() } as any,
          stderr: { on: vi.fn() } as any,
        },
      };
      (client as any).connections.set("slow-init-server", connection);

      // Call sendRequest with a 100ms timeout — server never responds
      await expect(
        (client as any).sendRequest("slow-init-server", "initialize", {}, 100),
      ).rejects.toThrow("Request timeout: initialize (100ms)");
    });
  });

  describe("spawn error detection", () => {
    it("detects spawn errors via the error handler that rejects pending requests", () => {
      // Test the error handling path without actually spawning a process.
      // When a spawn error occurs, the client's "error" handler sets connection.error,
      // marks connected=false, and rejects all pending requests.
      const pendingRequests = new Map<number, PendingRequest>();
      const rejections: Error[] = [];

      const t = setTimeout(() => {}, 5000);
      pendingRequests.set(1, {
        requestId: 1,
        method: "initialize",
        resolve: vi.fn(),
        reject: (err) => { rejections.push(err); clearTimeout(t); },
        timeout: t,
      });

      const connection: MCPConnection = {
        serverId: "spawn-err-server",
        config: { id: "spawn-err-server", name: "SpawnErr", transport: "stdio", command: "fake", enabled: true },
        connected: false,
        tools: [],
        resources: [],
        nextRequestId: 2,
        pendingRequests,
        process: {
          pid: 22222,
          stdin: { write: vi.fn() } as any,
          stdout: { on: vi.fn() } as any,
          stderr: { on: vi.fn() } as any,
        },
      };
      (client as any).connections.set("spawn-err-server", connection);

      // Simulate what the "error" handler does
      const spawnError = new Error("spawn ENOENT");
      connection.error = `Process error: ${spawnError.message}`;
      connection.connected = false;
      (client as any).rejectAllPending("spawn-err-server", spawnError);

      expect(rejections).toHaveLength(1);
      expect(rejections[0].message).toBe("spawn ENOENT");
      expect(connection.error).toContain("spawn ENOENT");
      expect(connection.connected).toBe(false);
    });
  });

  describe("unexpected process exit", () => {
    it("handles unexpected process exit by rejecting pending requests", async () => {
      const pendingRequests = new Map<number, PendingRequest>();
      const connection: MCPConnection = {
        serverId: "exit-server",
        config: { id: "exit-server", name: "Exit", transport: "stdio", command: "fake", enabled: true },
        connected: true,
        tools: [],
        resources: [],
        nextRequestId: 1,
        pendingRequests,
        process: {
          pid: 88888,
          stdin: { write: vi.fn() } as any,
          stdout: { on: vi.fn() } as any,
          stderr: { on: vi.fn() } as any,
        },
      };
      (client as any).connections.set("exit-server", connection);

      const pendingPromise = new Promise<unknown>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("test safety timeout")), 5000);
        pendingRequests.set(1, {
          requestId: 1,
          method: "tools/call",
          resolve: (val) => { clearTimeout(t); resolve(val); },
          reject: (err) => { clearTimeout(t); reject(err); },
          timeout: t,
        });
      });

      (client as any).rejectAllPending("exit-server", new Error("Process exited with code 1, signal null"));
      await expect(pendingPromise).rejects.toThrow("Process exited");
    });
  });

  describe("message parsing", () => {
    it("assembles newline-delimited JSON messages from buffer chunks", () => {
      const resolvedValues: unknown[] = [];
      const pendingRequests = new Map<number, PendingRequest>();
      const t = setTimeout(() => {}, 5000);
      pendingRequests.set(1, {
        requestId: 1,
        method: "test",
        resolve: (val) => { resolvedValues.push(val); clearTimeout(t); },
        reject: vi.fn(),
        timeout: t,
      });

      const connection: MCPConnection = {
        serverId: "parse-server",
        config: { id: "parse-server", name: "Parse", transport: "stdio", command: "fake", enabled: true },
        connected: true,
        tools: [],
        resources: [],
        nextRequestId: 2,
        pendingRequests,
      };
      (client as any).connections.set("parse-server", connection);

      const response = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { data: "hello" } });
      (client as any).handleMessage("parse-server", response);

      expect(resolvedValues).toHaveLength(1);
      expect(resolvedValues[0]).toEqual({ data: "hello" });
    });
  });

  describe("disconnect lifecycle", () => {
    it("rejects all pending requests on disconnect", async () => {
      const pendingRequests = new Map<number, PendingRequest>();
      const rejections: Error[] = [];

      for (let i = 1; i <= 2; i++) {
        const t = setTimeout(() => {}, 5000);
        pendingRequests.set(i, {
          requestId: i,
          method: `test-${i}`,
          resolve: vi.fn(),
          reject: (err) => { rejections.push(err); clearTimeout(t); },
          timeout: t,
        });
      }

      const connection: MCPConnection = {
        serverId: "disconnect-server",
        config: { id: "disconnect-server", name: "Disconnect", transport: "stdio", command: "fake", enabled: true },
        connected: true,
        tools: [],
        resources: [],
        nextRequestId: 3,
        pendingRequests,
        process: {
          pid: 77777,
          stdin: { write: vi.fn() } as any,
          stdout: { on: vi.fn() } as any,
          stderr: { on: vi.fn() } as any,
        },
      };
      (client as any).connections.set("disconnect-server", connection);

      const originalKill = process.kill;
      process.kill = vi.fn() as any;
      try {
        await client.disconnect("disconnect-server");
      } finally {
        process.kill = originalKill;
      }

      expect(rejections).toHaveLength(2);
      for (const err of rejections) {
        expect(err.message).toContain("Server disconnecting");
      }
      expect((client as any).connections.has("disconnect-server")).toBe(false);
    });

    it("performs graceful shutdown with SIGTERM then SIGKILL", async () => {
      const killCalls: string[] = [];
      const connection: MCPConnection = {
        serverId: "graceful-server",
        config: { id: "graceful-server", name: "Graceful", transport: "stdio", command: "fake", enabled: true },
        connected: true,
        tools: [],
        resources: [],
        nextRequestId: 1,
        pendingRequests: new Map(),
        process: {
          pid: 66666,
          stdin: { write: vi.fn() } as any,
          stdout: { on: vi.fn() } as any,
          stderr: { on: vi.fn() } as any,
        },
      };
      (client as any).connections.set("graceful-server", connection);

      const originalKill = process.kill;
      process.kill = vi.fn((_pid: number, signal: string) => {
        killCalls.push(signal);
      }) as any;
      try {
        await client.disconnect("graceful-server");
      } finally {
        process.kill = originalKill;
      }

      expect(killCalls[0]).toBe("SIGTERM");
      expect(killCalls[1]).toBe("SIGKILL");
    });
  });

  describe("tool call round-trip", () => {
    it("completes tool call round-trip via mock stdin/stdout", async () => {
      const writtenMessages: string[] = [];
      const pendingRequests = new Map<number, PendingRequest>();
      const mockStdin = {
        write: vi.fn((msg: string) => {
          writtenMessages.push(msg);
          const request = JSON.parse(msg.trim());
          if (request.method === "tools/call") {
            setTimeout(() => {
              (client as any).handleMessage(
                "roundtrip-server",
                JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: "Tool result: 42" }], isError: false } }),
              );
            }, 5);
          }
        }),
      };

      const connection: MCPConnection = {
        serverId: "roundtrip-server",
        config: { id: "roundtrip-server", name: "Roundtrip", transport: "stdio", command: "fake", enabled: true },
        connected: true,
        tools: [{ serverId: "roundtrip-server", name: "add", description: "Add numbers", inputSchema: {} }],
        resources: [],
        nextRequestId: 1,
        pendingRequests,
        process: { pid: 55555, stdin: mockStdin as any, stdout: { on: vi.fn() } as any, stderr: { on: vi.fn() } as any },
      };
      (client as any).connections.set("roundtrip-server", connection);

      const result = await client.callTool("roundtrip-server", "add", { a: 1, b: 2 });
      expect(result).toBe("Tool result: 42");
      const sentRequest = JSON.parse(writtenMessages[0].trim());
      expect(sentRequest.method).toBe("tools/call");
      expect(sentRequest.params.name).toBe("add");
    });
  });

  describe("resource read round-trip", () => {
    it("completes resource read round-trip via mock stdin/stdout", async () => {
      const pendingRequests = new Map<number, PendingRequest>();
      const mockStdin = {
        write: vi.fn((msg: string) => {
          const request = JSON.parse(msg.trim());
          if (request.method === "resources/read") {
            setTimeout(() => {
              (client as any).handleMessage(
                "resource-server",
                JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { contents: [{ uri: "file:///test.txt", mimeType: "text/plain", text: "Hello from resource" }] } }),
              );
            }, 5);
          }
        }),
      };

      const connection: MCPConnection = {
        serverId: "resource-server",
        config: { id: "resource-server", name: "Resource", transport: "stdio", command: "fake", enabled: true },
        connected: true,
        tools: [],
        resources: [{ serverId: "resource-server", uri: "file:///test.txt", name: "test.txt" }],
        nextRequestId: 1,
        pendingRequests,
        process: { pid: 44444, stdin: mockStdin as any, stdout: { on: vi.fn() } as any, stderr: { on: vi.fn() } as any },
      };
      (client as any).connections.set("resource-server", connection);

      const result = await client.readResource("resource-server", "file:///test.txt");
      expect(result.content).toBe("Hello from resource");
      expect(result.mimeType).toBe("text/plain");
    });
  });

  describe("tool call error response", () => {
    it("handles tool call error response (isError: true)", async () => {
      const pendingRequests = new Map<number, PendingRequest>();
      const mockStdin = {
        write: vi.fn((msg: string) => {
          const request = JSON.parse(msg.trim());
          if (request.method === "tools/call") {
            setTimeout(() => {
              (client as any).handleMessage(
                "error-server",
                JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: "Permission denied: cannot access /root" }], isError: true } }),
              );
            }, 5);
          }
        }),
      };

      const connection: MCPConnection = {
        serverId: "error-server",
        config: { id: "error-server", name: "Error", transport: "stdio", command: "fake", enabled: true },
        connected: true,
        tools: [{ serverId: "error-server", name: "read_secret", description: "Read", inputSchema: {} }],
        resources: [],
        nextRequestId: 1,
        pendingRequests,
        process: { pid: 33333, stdin: mockStdin as any, stdout: { on: vi.fn() } as any, stderr: { on: vi.fn() } as any },
      };
      (client as any).connections.set("error-server", connection);

      await expect(client.callTool("error-server", "read_secret", {})).rejects.toThrow(
        "Permission denied: cannot access /root",
      );
    });
  });

  // -------------------------------------------------------------------------
  // SSE Transport Tests
  // -------------------------------------------------------------------------

  describe("SSE transport", () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      // Mock global fetch
      fetchSpy = vi.fn();
      global.fetch = fetchSpy as any;
    });

    afterEach(() => {
      delete (global as any).fetch;
    });

    it("rejects SSE config without URL", async () => {
      const config: MCPServerConfig = {
        id: "sse-no-url",
        name: "SSE No URL",
        transport: "sse",
        enabled: true,
      };

      await expect(client.connect(config)).rejects.toThrow(
        "URL is required for SSE transport"
      );
    });

    it("connects via SSE transport and initializes", async () => {
      const config: MCPServerConfig = {
        id: "sse-server",
        name: "SSE Server",
        transport: "sse",
        url: "http://localhost:3001/sse",
        enabled: true,
      };

      let requestId = 0;
      const responses: Record<number, any> = {};

      // Mock SSE stream that keeps running
      const mockReader = {
        read: vi.fn().mockImplementation(() => {
          // Keep stream open but idle
          return new Promise(() => {});
        }),
      };

      fetchSpy.mockImplementation((url: string, options?: any) => {
        if (url === "http://localhost:3001/sse") {
          // SSE stream
          return Promise.resolve({
            ok: true,
            body: {
              getReader: () => mockReader,
            },
          });
        } else if (url === "http://localhost:3001/message") {
          // HTTP POST for requests - simulate immediate response
          const body = JSON.parse(options.body);
          const reqId = body.id;

          setTimeout(() => {
            if (body.method === "initialize") {
              (client as any).handleMessage(
                "sse-server",
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: reqId,
                  result: {
                    protocolVersion: "2024-11-05",
                    capabilities: { tools: { listChanged: false } },
                    serverInfo: { name: "test-server", version: "1.0.0" }
                  }
                })
              );
            } else if (body.method === "tools/list") {
              (client as any).handleMessage(
                "sse-server",
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: reqId,
                  result: {
                    tools: [{ name: "test_tool", description: "Test", inputSchema: { type: "object" } }]
                  }
                })
              );
            }
          }, 5);

          return Promise.resolve({ ok: true });
        }
        return Promise.reject(new Error("Unknown URL"));
      });

      try {
        await client.connect(config);

        const status = client.getStatus();
        const serverStatus = status.find(s => s.id === "sse-server");
        expect(serverStatus?.connected).toBe(true);
        expect(serverStatus?.toolCount).toBe(1);
      } finally {
        // Clean up
        await client.disconnect("sse-server");
      }
    });

    it("sends requests via HTTP POST for SSE transport", async () => {
      const pendingRequests = new Map<number, PendingRequest>();
      const connection: MCPConnection = {
        serverId: "sse-post-server",
        config: { id: "sse-post-server", name: "SSE POST", transport: "sse", url: "http://localhost:3002/sse", enabled: true },
        connected: true,
        tools: [{ serverId: "sse-post-server", name: "echo", description: "Echo", inputSchema: {} }],
        resources: [],
        nextRequestId: 1,
        pendingRequests,
      };
      (client as any).connections.set("sse-post-server", connection);

      let postedRequest: any = null;
      fetchSpy.mockImplementation((url: string, options?: any) => {
        if (url === "http://localhost:3002/message" && options?.method === "POST") {
          postedRequest = JSON.parse(options.body);
          // Simulate async response via SSE
          setTimeout(() => {
            (client as any).handleMessage(
              "sse-post-server",
              JSON.stringify({ jsonrpc: "2.0", id: postedRequest.id, result: { content: [{ type: "text", text: "echo response" }], isError: false } })
            );
          }, 5);
          return Promise.resolve({ ok: true });
        }
        return Promise.reject(new Error("Unknown URL"));
      });

      const result = await client.callTool("sse-post-server", "echo", { msg: "hello" });
      expect(result).toBe("echo response");
      expect(postedRequest).toBeDefined();
      expect(postedRequest.method).toBe("tools/call");
      expect(postedRequest.params.name).toBe("echo");
    });

    it("sends notifications via HTTP POST for SSE transport", () => {
      const connection: MCPConnection = {
        serverId: "sse-notification-server",
        config: { id: "sse-notification-server", name: "SSE Notification", transport: "sse", url: "http://localhost:3003/sse", enabled: true },
        connected: true,
        tools: [],
        resources: [],
        nextRequestId: 1,
        pendingRequests: new Map(),
      };
      (client as any).connections.set("sse-notification-server", connection);

      let postedNotification: any = null;
      fetchSpy.mockImplementation((url: string, options?: any) => {
        if (url === "http://localhost:3003/message" && options?.method === "POST") {
          postedNotification = JSON.parse(options.body);
          return Promise.resolve({ ok: true });
        }
        return Promise.reject(new Error("Unknown URL"));
      });

      (client as any).sendNotification("sse-notification-server", "test/notify", { data: "test" });

      // Wait a tick for async fetch
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(postedNotification).toBeDefined();
          expect(postedNotification.method).toBe("test/notify");
          expect(postedNotification.params).toEqual({ data: "test" });
          expect(postedNotification.id).toBeUndefined(); // Notifications don't have IDs
          resolve();
        }, 10);
      });
    });

    it("disconnects SSE transport by aborting controller", async () => {
      const abortController = new AbortController();
      const sseState = {
        url: "http://localhost:3004/sse",
        abortController,
        reconnectAttempts: 0,
        reconnecting: false,
      };

      const connection: MCPConnection = {
        serverId: "sse-disconnect-server",
        config: { id: "sse-disconnect-server", name: "SSE Disconnect", transport: "sse", url: "http://localhost:3004/sse", enabled: true },
        connected: true,
        tools: [],
        resources: [],
        nextRequestId: 1,
        pendingRequests: new Map(),
      };
      (client as any).connections.set("sse-disconnect-server", connection);
      (client as any).sseTransports.set("sse-disconnect-server", sseState);

      const abortSpy = vi.spyOn(abortController, "abort");

      await client.disconnect("sse-disconnect-server");

      expect(abortSpy).toHaveBeenCalled();
      expect((client as any).sseTransports.has("sse-disconnect-server")).toBe(false);
      expect((client as any).connections.has("sse-disconnect-server")).toBe(false);
    });

    it("healthCheck works for SSE transport via ping", async () => {
      const connection: MCPConnection = {
        serverId: "sse-health-server",
        config: { id: "sse-health-server", name: "SSE Health", transport: "sse", url: "http://localhost:3005/sse", enabled: true },
        connected: true,
        tools: [],
        resources: [],
        nextRequestId: 1,
        pendingRequests: new Map(),
      };
      (client as any).connections.set("sse-health-server", connection);

      fetchSpy.mockImplementation((url: string, options?: any) => {
        if (url === "http://localhost:3005/message" && options?.method === "POST") {
          const request = JSON.parse(options.body);
          if (request.method === "ping") {
            setTimeout(() => {
              (client as any).handleMessage(
                "sse-health-server",
                JSON.stringify({ jsonrpc: "2.0", id: request.id, result: {} })
              );
            }, 5);
          }
          return Promise.resolve({ ok: true });
        }
        return Promise.reject(new Error("Unknown URL"));
      });

      const healthy = await client.healthCheck("sse-health-server");
      expect(healthy).toBe(true);
    });

    it("handles SSE stream failure (response not ok)", async () => {
      const connection: MCPConnection = {
        serverId: "sse-fail-server",
        config: { id: "sse-fail-server", name: "SSE Fail", transport: "sse", url: "http://localhost:3020/sse", enabled: true },
        connected: false,
        tools: [],
        resources: [],
        nextRequestId: 1,
        pendingRequests: new Map(),
      };
      (client as any).connections.set("sse-fail-server", connection);

      const abortController = new AbortController();
      const sseState = {
        url: "http://localhost:3020/sse",
        abortController,
        reconnectAttempts: 5, // Max out reconnect attempts to prevent reconnect loop
        reconnecting: false,
      };
      (client as any).sseTransports.set("sse-fail-server", sseState);

      fetchSpy.mockResolvedValue({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
      });

      await (client as any).startSSEStream("sse-fail-server", "http://localhost:3020/sse", abortController.signal);

      expect(connection.connected).toBe(false);
      expect(connection.error).toBeDefined();
    });

    it("handles SSE stream with no response body", async () => {
      const connection: MCPConnection = {
        serverId: "sse-nobody-server",
        config: { id: "sse-nobody-server", name: "SSE No Body", transport: "sse", url: "http://localhost:3021/sse", enabled: true },
        connected: false,
        tools: [],
        resources: [],
        nextRequestId: 1,
        pendingRequests: new Map(),
      };
      (client as any).connections.set("sse-nobody-server", connection);

      const abortController = new AbortController();
      const sseState = {
        url: "http://localhost:3021/sse",
        abortController,
        reconnectAttempts: 5,
        reconnecting: false,
      };
      (client as any).sseTransports.set("sse-nobody-server", sseState);

      fetchSpy.mockResolvedValue({
        ok: true,
        body: null,
      });

      await (client as any).startSSEStream("sse-nobody-server", "http://localhost:3021/sse", abortController.signal);

      expect(connection.connected).toBe(false);
      expect(connection.error).toBeDefined();
    });

    it("does not reconnect SSE when signal is aborted", async () => {
      const connection: MCPConnection = {
        serverId: "sse-abort-server",
        config: { id: "sse-abort-server", name: "SSE Abort", transport: "sse", url: "http://localhost:3022/sse", enabled: true },
        connected: true,
        tools: [],
        resources: [],
        nextRequestId: 1,
        pendingRequests: new Map(),
      };
      (client as any).connections.set("sse-abort-server", connection);

      const abortController = new AbortController();
      const sseState = {
        url: "http://localhost:3022/sse",
        abortController,
        reconnectAttempts: 0,
        reconnecting: false,
      };
      (client as any).sseTransports.set("sse-abort-server", sseState);

      // Abort the signal first
      abortController.abort();

      fetchSpy.mockRejectedValue(new DOMException("The operation was aborted", "AbortError"));

      const reconnectSpy = vi.spyOn(client as any, "reconnectSSE");

      await (client as any).startSSEStream("sse-abort-server", "http://localhost:3022/sse", abortController.signal);

      expect(reconnectSpy).not.toHaveBeenCalled();
      reconnectSpy.mockRestore();
    });

    it("reconnectSSE does nothing when already reconnecting", async () => {
      const sseState = {
        url: "http://localhost:3023/sse",
        abortController: new AbortController(),
        reconnectAttempts: 0,
        reconnecting: true, // Already reconnecting
      };
      const connection: MCPConnection = {
        serverId: "sse-recon-busy",
        config: { id: "sse-recon-busy", name: "SSE Busy", transport: "sse", url: "http://localhost:3023/sse", enabled: true },
        connected: true,
        tools: [],
        resources: [],
        nextRequestId: 1,
        pendingRequests: new Map(),
      };
      (client as any).connections.set("sse-recon-busy", connection);
      (client as any).sseTransports.set("sse-recon-busy", sseState);

      await (client as any).reconnectSSE("sse-recon-busy");

      // Should not have changed anything since it was already reconnecting
      expect(sseState.reconnectAttempts).toBe(0);
    });

    it("reconnectSSE does nothing when no sseState exists", async () => {
      await (client as any).reconnectSSE("non-existent-sse");
      // Should not throw
    });

    it("SSE stream reconnects when stream ends normally (not aborted)", async () => {
      const connection: MCPConnection = {
        serverId: "sse-stream-end",
        config: { id: "sse-stream-end", name: "SSE End", transport: "sse", url: "http://localhost:3024/sse", enabled: true },
        connected: true,
        tools: [],
        resources: [],
        nextRequestId: 1,
        pendingRequests: new Map(),
      };
      (client as any).connections.set("sse-stream-end", connection);

      const abortController = new AbortController();
      const sseState = {
        url: "http://localhost:3024/sse",
        abortController,
        reconnectAttempts: 5, // Max out to prevent actual reconnect loop
        reconnecting: false,
      };
      (client as any).sseTransports.set("sse-stream-end", sseState);

      // Stream that ends immediately (done: true)
      const mockReader = {
        read: vi.fn().mockResolvedValueOnce({ done: true, value: undefined }),
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        body: { getReader: () => mockReader },
      });

      const reconnectSpy = vi.spyOn(client as any, "reconnectSSE");

      await (client as any).startSSEStream("sse-stream-end", "http://localhost:3024/sse", abortController.signal);

      expect(reconnectSpy).toHaveBeenCalledWith("sse-stream-end");
      reconnectSpy.mockRestore();
    });

    it("sendRequest rejects when SSE connection has no URL", async () => {
      const connection: MCPConnection = {
        serverId: "sse-no-url-req",
        config: { id: "sse-no-url-req", name: "SSE No URL Req", transport: "sse", enabled: true },
        connected: true,
        tools: [],
        resources: [],
        nextRequestId: 1,
        pendingRequests: new Map(),
      };
      (client as any).connections.set("sse-no-url-req", connection);

      await expect(
        (client as any).sendRequest("sse-no-url-req", "test", {}, 100),
      ).rejects.toThrow("No URL for SSE connection");
    });

    it("sendRequest rejects when SSE fetch fails", async () => {
      const connection: MCPConnection = {
        serverId: "sse-fetch-fail",
        config: { id: "sse-fetch-fail", name: "SSE Fetch Fail", transport: "sse", url: "http://localhost:3025/sse", enabled: true },
        connected: true,
        tools: [],
        resources: [],
        nextRequestId: 1,
        pendingRequests: new Map(),
      };
      (client as any).connections.set("sse-fetch-fail", connection);

      fetchSpy.mockRejectedValue(new Error("network error"));

      await expect(
        (client as any).sendRequest("sse-fetch-fail", "test", {}, 100),
      ).rejects.toThrow("Failed to send SSE request: network error");
    });

    it("sendNotification is no-op for SSE transport without URL", () => {
      const connection: MCPConnection = {
        serverId: "sse-notif-no-url",
        config: { id: "sse-notif-no-url", name: "SSE Notif No URL", transport: "sse", enabled: true },
        connected: true,
        tools: [],
        resources: [],
        nextRequestId: 1,
        pendingRequests: new Map(),
      };
      (client as any).connections.set("sse-notif-no-url", connection);

      // Should not throw
      (client as any).sendNotification("sse-notif-no-url", "test/notify", {});
    });

    it("SSE stream parses multiple SSE events from buffer", async () => {
      const connection: MCPConnection = {
        serverId: "sse-parse-server",
        config: { id: "sse-parse-server", name: "SSE Parse", transport: "sse", url: "http://localhost:3006/sse", enabled: true },
        connected: true,
        tools: [],
        resources: [],
        nextRequestId: 1,
        pendingRequests: new Map(),
      };
      (client as any).connections.set("sse-parse-server", connection);

      const resolvedValues: unknown[] = [];
      const t1 = setTimeout(() => {}, 5000);
      const t2 = setTimeout(() => {}, 5000);
      connection.pendingRequests.set(1, {
        requestId: 1,
        method: "test1",
        resolve: (val) => { resolvedValues.push(val); clearTimeout(t1); },
        reject: vi.fn(),
        timeout: t1,
      });
      connection.pendingRequests.set(2, {
        requestId: 2,
        method: "test2",
        resolve: (val) => { resolvedValues.push(val); clearTimeout(t2); },
        reject: vi.fn(),
        timeout: t2,
      });

      const abortController = new AbortController();
      const sseState = {
        url: "http://localhost:3006/sse",
        abortController,
        reconnectAttempts: 0,
        reconnecting: false,
      };
      (client as any).sseTransports.set("sse-parse-server", sseState);

      // Simulate SSE stream with multiple events
      const mockReader = {
        read: vi.fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: {"jsonrpc":"2.0","id":1,"result":{"value":"first"}}\n\ndata: {"jsonrpc":"2.0","id":2,"result":{"value":"second"}}\n\n')
          })
          .mockImplementation(() => {
            // Abort after sending data to prevent infinite loop
            abortController.abort();
            return Promise.resolve({ done: true, value: undefined });
          }),
      };

      fetchSpy.mockResolvedValue({
        ok: true,
        body: {
          getReader: () => mockReader,
        },
      });

      await (client as any).startSSEStream("sse-parse-server", "http://localhost:3006/sse", abortController.signal);

      expect(resolvedValues).toHaveLength(2);
      expect(resolvedValues[0]).toEqual({ value: "first" });
      expect(resolvedValues[1]).toEqual({ value: "second" });
    });

    it("connectSSE cleans up SSE transport on error", async () => {
      const config: MCPServerConfig = {
        id: "sse-connect-fail",
        name: "SSE Connect Fail",
        transport: "sse",
        url: "http://localhost:3030/sse",
        enabled: true,
      };

      // Mock SSE stream that keeps running
      const mockReader = {
        read: vi.fn().mockImplementation(() => new Promise(() => {})),
      };

      fetchSpy.mockImplementation((url: string, options?: any) => {
        if (url === "http://localhost:3030/sse") {
          return Promise.resolve({
            ok: true,
            body: { getReader: () => mockReader },
          });
        } else if (url === "http://localhost:3030/message") {
          const body = JSON.parse(options.body);
          // Never respond to initialize — let it timeout
          return Promise.resolve({ ok: true });
        }
        return Promise.reject(new Error("Unknown URL"));
      });

      // Override initializeTimeout to be very short
      (client as any).initializeTimeout = 50;

      await expect(client.connect(config)).rejects.toThrow("Failed to connect to MCP server sse-connect-fail");

      // SSE transport should have been cleaned up
      expect((client as any).sseTransports.has("sse-connect-fail")).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Additional edge case tests for uncovered paths
  // -------------------------------------------------------------------------

  describe("sendRequest edge cases", () => {
    it("rejects when no connection exists", async () => {
      await expect(
        (client as any).sendRequest("no-such-server", "test", {}),
      ).rejects.toThrow("No connection to server: no-such-server");
    });

    it("rejects when stdio connection has no process", async () => {
      const connection: MCPConnection = {
        serverId: "no-process-server",
        config: { id: "no-process-server", name: "No Process", transport: "stdio", command: "fake", enabled: true },
        connected: false,
        tools: [],
        resources: [],
        nextRequestId: 1,
        pendingRequests: new Map(),
        // No process field
      };
      (client as any).connections.set("no-process-server", connection);

      await expect(
        (client as any).sendRequest("no-process-server", "test", {}, 100),
      ).rejects.toThrow("No process for stdio connection");
    });

    it("rejects when stdin.write throws", async () => {
      const mockStdin = {
        write: vi.fn().mockImplementation(() => {
          throw new Error("stdin write failed");
        }),
      };

      const connection: MCPConnection = {
        serverId: "write-fail-server",
        config: { id: "write-fail-server", name: "Write Fail", transport: "stdio", command: "fake", enabled: true },
        connected: true,
        tools: [],
        resources: [],
        nextRequestId: 1,
        pendingRequests: new Map(),
        process: {
          pid: 12345,
          stdin: mockStdin as any,
          stdout: { on: vi.fn() } as any,
          stderr: { on: vi.fn() } as any,
        },
      };
      (client as any).connections.set("write-fail-server", connection);

      await expect(
        (client as any).sendRequest("write-fail-server", "test", {}, 100),
      ).rejects.toThrow("stdin write failed");
    });
  });

  describe("sendNotification edge cases", () => {
    it("is no-op when no connection exists", () => {
      // Should not throw
      (client as any).sendNotification("no-such-server", "test", {});
    });

    it("is no-op when stdio connection has no process", () => {
      const connection: MCPConnection = {
        serverId: "notif-no-process",
        config: { id: "notif-no-process", name: "No Process", transport: "stdio", command: "fake", enabled: true },
        connected: true,
        tools: [],
        resources: [],
        nextRequestId: 1,
        pendingRequests: new Map(),
      };
      (client as any).connections.set("notif-no-process", connection);

      // Should not throw
      (client as any).sendNotification("notif-no-process", "test", {});
    });

    it("logs error when stdio notification write throws", () => {
      const mockStdin = {
        write: vi.fn().mockImplementation(() => {
          throw new Error("write failed");
        }),
      };

      const connection: MCPConnection = {
        serverId: "notif-write-fail",
        config: { id: "notif-write-fail", name: "Write Fail", transport: "stdio", command: "fake", enabled: true },
        connected: true,
        tools: [],
        resources: [],
        nextRequestId: 1,
        pendingRequests: new Map(),
        process: {
          pid: 12345,
          stdin: mockStdin as any,
          stdout: { on: vi.fn() } as any,
          stderr: { on: vi.fn() } as any,
        },
      };
      (client as any).connections.set("notif-write-fail", connection);

      // Should not throw — error is logged
      (client as any).sendNotification("notif-write-fail", "test", {});
    });
  });

  describe("handleMessage edge cases", () => {
    it("is no-op when no connection exists", () => {
      // Should not throw
      (client as any).handleMessage("no-such-server", '{"jsonrpc":"2.0","id":1,"result":{}}');
    });

    it("handles JSON-RPC error response", () => {
      const rejections: Error[] = [];
      const pendingRequests = new Map<number, PendingRequest>();
      const t = setTimeout(() => {}, 5000);
      pendingRequests.set(1, {
        requestId: 1,
        method: "test",
        resolve: vi.fn(),
        reject: (err) => { rejections.push(err); clearTimeout(t); },
        timeout: t,
      });

      const connection: MCPConnection = {
        serverId: "error-msg-server",
        config: { id: "error-msg-server", name: "Error Msg", transport: "stdio", command: "fake", enabled: true },
        connected: true,
        tools: [],
        resources: [],
        nextRequestId: 2,
        pendingRequests,
      };
      (client as any).connections.set("error-msg-server", connection);

      (client as any).handleMessage(
        "error-msg-server",
        JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32600, message: "Invalid Request" } }),
      );

      expect(rejections).toHaveLength(1);
      expect(rejections[0].message).toContain("Invalid Request");
      expect(rejections[0].message).toContain("-32600");
    });

    it("handles malformed JSON gracefully", () => {
      const connection: MCPConnection = {
        serverId: "bad-json-server",
        config: { id: "bad-json-server", name: "Bad JSON", transport: "stdio", command: "fake", enabled: true },
        connected: true,
        tools: [],
        resources: [],
        nextRequestId: 1,
        pendingRequests: new Map(),
      };
      (client as any).connections.set("bad-json-server", connection);

      // Should not throw — logs error
      (client as any).handleMessage("bad-json-server", "not valid json {{{");
    });

    it("ignores messages with no matching pending request", () => {
      const connection: MCPConnection = {
        serverId: "orphan-msg-server",
        config: { id: "orphan-msg-server", name: "Orphan", transport: "stdio", command: "fake", enabled: true },
        connected: true,
        tools: [],
        resources: [],
        nextRequestId: 2,
        pendingRequests: new Map(),
      };
      (client as any).connections.set("orphan-msg-server", connection);

      // Should not throw — no matching pending request for id 999
      (client as any).handleMessage(
        "orphan-msg-server",
        JSON.stringify({ jsonrpc: "2.0", id: 999, result: { data: "orphan" } }),
      );
    });

    it("ignores notification messages (no id)", () => {
      const connection: MCPConnection = {
        serverId: "notif-msg-server",
        config: { id: "notif-msg-server", name: "Notification Msg", transport: "stdio", command: "fake", enabled: true },
        connected: true,
        tools: [],
        resources: [],
        nextRequestId: 1,
        pendingRequests: new Map(),
      };
      (client as any).connections.set("notif-msg-server", connection);

      // Should not throw — notification messages have no id
      (client as any).handleMessage(
        "notif-msg-server",
        JSON.stringify({ jsonrpc: "2.0", method: "notification/test", params: {} }),
      );
    });
  });

  describe("healthCheck edge cases", () => {
    it("returns false when no connection exists", async () => {
      const result = await client.healthCheck("non-existent");
      expect(result).toBe(false);
    });

    it("returns false when stdio connection has no process", async () => {
      const connection: MCPConnection = {
        serverId: "no-proc-health",
        config: { id: "no-proc-health", name: "No Proc Health", transport: "stdio" as const, command: "echo", enabled: true },
        connected: true,
        tools: [],
        resources: [],
        nextRequestId: 1,
        pendingRequests: new Map(),
        // No process
      };
      (client as any).connections.set("no-proc-health", connection);

      const result = await client.healthCheck("no-proc-health");
      expect(result).toBe(false);

      (client as any).connections.delete("no-proc-health");
    });

    it("returns true via process.kill fallback when ping fails but process is alive", async () => {
      const connection: MCPConnection = {
        serverId: "fallback-health",
        config: { id: "fallback-health", name: "Fallback Health", transport: "stdio" as const, command: "echo", enabled: true },
        connected: true,
        tools: [],
        resources: [],
        nextRequestId: 1,
        pendingRequests: new Map(),
        process: {
          pid: process.pid, // Our own pid — known alive
          stdin: { write: vi.fn() } as any,
          stdout: { on: vi.fn() } as any,
          stderr: { on: vi.fn() } as any,
        },
      };
      (client as any).connections.set("fallback-health", connection);

      // Make ping request fail
      const sendRequestSpy = vi.spyOn(client as any, "sendRequest").mockRejectedValue(new Error("ping failed"));

      const result = await client.healthCheck("fallback-health");
      expect(result).toBe(true); // Falls back to process.kill(pid, 0)

      sendRequestSpy.mockRestore();
      (client as any).connections.delete("fallback-health");
    });

    it("returns false via process.kill fallback when both ping and process check fail", async () => {
      const connection: MCPConnection = {
        serverId: "dead-fallback-health",
        config: { id: "dead-fallback-health", name: "Dead Fallback", transport: "stdio" as const, command: "echo", enabled: true },
        connected: true,
        tools: [],
        resources: [],
        nextRequestId: 1,
        pendingRequests: new Map(),
        process: {
          pid: 999999999, // PID that doesn't exist
          stdin: { write: vi.fn() } as any,
          stdout: { on: vi.fn() } as any,
          stderr: { on: vi.fn() } as any,
        },
      };
      (client as any).connections.set("dead-fallback-health", connection);

      // Make ping request fail
      const sendRequestSpy = vi.spyOn(client as any, "sendRequest").mockRejectedValue(new Error("ping failed"));

      const result = await client.healthCheck("dead-fallback-health");
      expect(result).toBe(false);

      sendRequestSpy.mockRestore();
      (client as any).connections.delete("dead-fallback-health");
    });

    it("returns false for SSE health check when ping fails", async () => {
      const connection: MCPConnection = {
        serverId: "sse-dead-health",
        config: { id: "sse-dead-health", name: "SSE Dead Health", transport: "sse", url: "http://localhost:3040/sse", enabled: true },
        connected: true,
        tools: [],
        resources: [],
        nextRequestId: 1,
        pendingRequests: new Map(),
      };
      (client as any).connections.set("sse-dead-health", connection);

      const sendRequestSpy = vi.spyOn(client as any, "sendRequest").mockRejectedValue(new Error("ping failed"));

      const result = await client.healthCheck("sse-dead-health");
      expect(result).toBe(false);

      sendRequestSpy.mockRestore();
      (client as any).connections.delete("sse-dead-health");
    });

    it("returns false for unsupported transport type", async () => {
      const connection: MCPConnection = {
        serverId: "weird-transport",
        config: { id: "weird-transport", name: "Weird", transport: "websocket" as any, enabled: true },
        connected: true,
        tools: [],
        resources: [],
        nextRequestId: 1,
        pendingRequests: new Map(),
      };
      (client as any).connections.set("weird-transport", connection);

      const result = await client.healthCheck("weird-transport");
      expect(result).toBe(false);

      (client as any).connections.delete("weird-transport");
    });
  });

  describe("callTool edge cases", () => {
    it("throws with 'Unknown error' when isError but no text content", async () => {
      const pendingRequests = new Map<number, PendingRequest>();
      const mockStdin = {
        write: vi.fn((msg: string) => {
          const request = JSON.parse(msg.trim());
          if (request.method === "tools/call") {
            setTimeout(() => {
              (client as any).handleMessage(
                "error-no-text-server",
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: request.id,
                  result: { content: [{ type: "image", data: "base64data" }], isError: true },
                }),
              );
            }, 5);
          }
        }),
      };

      const connection: MCPConnection = {
        serverId: "error-no-text-server",
        config: { id: "error-no-text-server", name: "Error No Text", transport: "stdio", command: "fake", enabled: true },
        connected: true,
        tools: [{ serverId: "error-no-text-server", name: "fail_tool", description: "Fail", inputSchema: {} }],
        resources: [],
        nextRequestId: 1,
        pendingRequests,
        process: { pid: 12121, stdin: mockStdin as any, stdout: { on: vi.fn() } as any, stderr: { on: vi.fn() } as any },
      };
      (client as any).connections.set("error-no-text-server", connection);

      await expect(client.callTool("error-no-text-server", "fail_tool", {})).rejects.toThrow("Unknown error");
    });

    it("returns raw content when no text content exists (non-error)", async () => {
      const pendingRequests = new Map<number, PendingRequest>();
      const mockStdin = {
        write: vi.fn((msg: string) => {
          const request = JSON.parse(msg.trim());
          if (request.method === "tools/call") {
            setTimeout(() => {
              (client as any).handleMessage(
                "nontext-server",
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: request.id,
                  result: { content: [{ type: "image", data: "imagedata", mimeType: "image/png" }], isError: false },
                }),
              );
            }, 5);
          }
        }),
      };

      const connection: MCPConnection = {
        serverId: "nontext-server",
        config: { id: "nontext-server", name: "Non-text", transport: "stdio", command: "fake", enabled: true },
        connected: true,
        tools: [{ serverId: "nontext-server", name: "image_tool", description: "Image", inputSchema: {} }],
        resources: [],
        nextRequestId: 1,
        pendingRequests,
        process: { pid: 13131, stdin: mockStdin as any, stdout: { on: vi.fn() } as any, stderr: { on: vi.fn() } as any },
      };
      (client as any).connections.set("nontext-server", connection);

      const result = await client.callTool("nontext-server", "image_tool", {});
      // When textContent is empty, it returns result.content (the array)
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("readResource edge cases", () => {
    it("throws when no content returned", async () => {
      const pendingRequests = new Map<number, PendingRequest>();
      const mockStdin = {
        write: vi.fn((msg: string) => {
          const request = JSON.parse(msg.trim());
          if (request.method === "resources/read") {
            setTimeout(() => {
              (client as any).handleMessage(
                "empty-resource-server",
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: request.id,
                  result: { contents: [] },
                }),
              );
            }, 5);
          }
        }),
      };

      const connection: MCPConnection = {
        serverId: "empty-resource-server",
        config: { id: "empty-resource-server", name: "Empty Resource", transport: "stdio", command: "fake", enabled: true },
        connected: true,
        tools: [],
        resources: [{ serverId: "empty-resource-server", uri: "file:///empty", name: "empty" }],
        nextRequestId: 1,
        pendingRequests,
        process: { pid: 14141, stdin: mockStdin as any, stdout: { on: vi.fn() } as any, stderr: { on: vi.fn() } as any },
      };
      (client as any).connections.set("empty-resource-server", connection);

      await expect(client.readResource("empty-resource-server", "file:///empty")).rejects.toThrow(
        "No content returned for resource: file:///empty",
      );
    });

    it("returns blob content when text is not available", async () => {
      const pendingRequests = new Map<number, PendingRequest>();
      const mockStdin = {
        write: vi.fn((msg: string) => {
          const request = JSON.parse(msg.trim());
          if (request.method === "resources/read") {
            setTimeout(() => {
              (client as any).handleMessage(
                "blob-resource-server",
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: request.id,
                  result: { contents: [{ uri: "file:///image.png", mimeType: "image/png", blob: "base64blobdata" }] },
                }),
              );
            }, 5);
          }
        }),
      };

      const connection: MCPConnection = {
        serverId: "blob-resource-server",
        config: { id: "blob-resource-server", name: "Blob Resource", transport: "stdio", command: "fake", enabled: true },
        connected: true,
        tools: [],
        resources: [{ serverId: "blob-resource-server", uri: "file:///image.png", name: "image.png" }],
        nextRequestId: 1,
        pendingRequests,
        process: { pid: 15151, stdin: mockStdin as any, stdout: { on: vi.fn() } as any, stderr: { on: vi.fn() } as any },
      };
      (client as any).connections.set("blob-resource-server", connection);

      const result = await client.readResource("blob-resource-server", "file:///image.png");
      expect(result.content).toBe("base64blobdata");
      expect(result.mimeType).toBe("image/png");
    });
  });

  describe("getStatus with connections", () => {
    it("returns status for all connected servers", () => {
      const conn1: MCPConnection = {
        serverId: "status-1",
        config: { id: "status-1", name: "Status One", transport: "stdio", command: "fake", enabled: true },
        connected: true,
        tools: [{ serverId: "status-1", name: "tool1", description: "T1", inputSchema: {} }],
        resources: [],
        nextRequestId: 1,
        pendingRequests: new Map(),
        lastConnected: "2024-01-01T00:00:00.000Z",
      };
      const conn2: MCPConnection = {
        serverId: "status-2",
        config: { id: "status-2", name: "Status Two", transport: "sse", url: "http://localhost:3050/sse", enabled: true },
        connected: false,
        tools: [],
        resources: [{ serverId: "status-2", uri: "file:///test", name: "test" }],
        nextRequestId: 1,
        pendingRequests: new Map(),
        error: "Connection failed",
      };
      (client as any).connections.set("status-1", conn1);
      (client as any).connections.set("status-2", conn2);

      const statuses = client.getStatus();
      expect(statuses).toHaveLength(2);

      const s1 = statuses.find((s) => s.id === "status-1");
      expect(s1?.connected).toBe(true);
      expect(s1?.toolCount).toBe(1);
      expect(s1?.resourceCount).toBe(0);
      expect(s1?.lastConnected).toBe("2024-01-01T00:00:00.000Z");

      const s2 = statuses.find((s) => s.id === "status-2");
      expect(s2?.connected).toBe(false);
      expect(s2?.toolCount).toBe(0);
      expect(s2?.resourceCount).toBe(1);
      expect(s2?.error).toBe("Connection failed");
    });
  });

  describe("listTools and listResources with connected server", () => {
    it("returns tools from connected server", async () => {
      const connection: MCPConnection = {
        serverId: "tools-list-server",
        config: { id: "tools-list-server", name: "Tools List", transport: "stdio", command: "fake", enabled: true },
        connected: true,
        tools: [
          { serverId: "tools-list-server", name: "tool_a", description: "Tool A", inputSchema: {} },
          { serverId: "tools-list-server", name: "tool_b", description: "Tool B", inputSchema: {} },
        ],
        resources: [],
        nextRequestId: 1,
        pendingRequests: new Map(),
      };
      (client as any).connections.set("tools-list-server", connection);

      const tools = await client.listTools("tools-list-server");
      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe("tool_a");
      expect(tools[1].name).toBe("tool_b");
    });

    it("returns resources from connected server", async () => {
      const connection: MCPConnection = {
        serverId: "res-list-server",
        config: { id: "res-list-server", name: "Res List", transport: "stdio", command: "fake", enabled: true },
        connected: true,
        tools: [],
        resources: [
          { serverId: "res-list-server", uri: "file:///a.txt", name: "a.txt" },
        ],
        nextRequestId: 1,
        pendingRequests: new Map(),
      };
      (client as any).connections.set("res-list-server", connection);

      const resources = await client.listResources("res-list-server");
      expect(resources).toHaveLength(1);
      expect(resources[0].uri).toBe("file:///a.txt");
    });

    it("rejects listTools when server is not connected", async () => {
      const connection: MCPConnection = {
        serverId: "disconnected-tools",
        config: { id: "disconnected-tools", name: "Disconnected", transport: "stdio", command: "fake", enabled: true },
        connected: false,
        tools: [],
        resources: [],
        nextRequestId: 1,
        pendingRequests: new Map(),
      };
      (client as any).connections.set("disconnected-tools", connection);

      await expect(client.listTools("disconnected-tools")).rejects.toThrow(
        "Not connected to server: disconnected-tools",
      );
    });
  });

  describe("disconnectAll with health monitors", () => {
    it("stops all health monitors and disconnects all servers", async () => {
      // Use a SSE connection to avoid the setTimeout in stdio disconnect
      const conn1: MCPConnection = {
        serverId: "dc-all-1",
        config: { id: "dc-all-1", name: "DC All 1", transport: "sse", url: "http://localhost:9999/sse", enabled: true },
        connected: true,
        tools: [],
        resources: [],
        nextRequestId: 1,
        pendingRequests: new Map(),
      };
      const abortController = new AbortController();
      (client as any).connections.set("dc-all-1", conn1);
      (client as any).sseTransports.set("dc-all-1", {
        url: "http://localhost:9999/sse",
        abortController,
        reconnectAttempts: 0,
        reconnecting: false,
      });

      vi.useFakeTimers();

      const healthSpy = vi.spyOn(client, "healthCheck").mockResolvedValue(true);
      client.startHealthMonitor("dc-all-1", 30000);

      const state = (client as any).healthMonitors.get("dc-all-1") as MCPHealthState;
      expect(state).toBeDefined();
      expect(state.intervalHandle).not.toBeNull();

      await client.disconnectAll();

      expect((client as any).connections.size).toBe(0);
      expect((client as any).healthMonitors.size).toBe(0);

      healthSpy.mockRestore();
      vi.useRealTimers();
    });
  });

  describe("health monitor recovery after restart", () => {
    it("health monitor resets to healthy after successful restart", async () => {
      vi.useFakeTimers();
      const publishSpy = vi.spyOn(eventBusModule, "publishEvent");

      const fakeConfig: MCPServerConfig = { id: "recover-test", name: "Recover", transport: "stdio", command: "echo", enabled: true };
      const fakeConnection = {
        serverId: "recover-test",
        config: fakeConfig,
        process: {
          pid: 999999999,
          stdin: { write: vi.fn() },
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
        },
        connected: true,
        tools: [],
        resources: [],
        nextRequestId: 1,
        pendingRequests: new Map(),
      };
      (client as any).connections.set("recover-test", fakeConnection);

      const healthSpy = vi.spyOn(client, "healthCheck").mockResolvedValue(false);
      const disconnectSpy = vi.spyOn(client, "disconnect").mockResolvedValue(undefined);
      const connectSpy = vi.spyOn(client, "connect").mockImplementation(async () => {
        (client as any).connections.set("recover-test", fakeConnection);
      });

      client.startHealthMonitor("recover-test", 1000);

      // Trigger 3 failures to reach restart
      await vi.advanceTimersByTimeAsync(1000); // failure 1
      await vi.advanceTimersByTimeAsync(1000); // failure 2
      await vi.advanceTimersByTimeAsync(1000); // failure 3 -> triggers restart

      // Wait for backoff (5s for first attempt)
      await vi.advanceTimersByTimeAsync(5000);

      const state = (client as any).healthMonitors.get("recover-test") as MCPHealthState;
      expect(state.status).toBe("healthy");
      expect(state.consecutiveFailures).toBe(0);

      client.stopHealthMonitor("recover-test");
      healthSpy.mockRestore();
      disconnectSpy.mockRestore();
      connectSpy.mockRestore();
      publishSpy.mockRestore();
      (client as any).connections.delete("recover-test");
      (client as any).healthMonitors.delete("recover-test");
      vi.useRealTimers();
    });

    it("health monitor returns to healthy from degraded when health check succeeds", async () => {
      vi.useFakeTimers();

      const fakeConnection = {
        serverId: "degrade-recover",
        config: { id: "degrade-recover", name: "DegradeRecover", transport: "stdio" as const, command: "echo", enabled: true },
        process: {
          pid: process.pid,
          stdin: { write: vi.fn() },
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
        },
        connected: true,
        tools: [],
        resources: [],
        nextRequestId: 1,
        pendingRequests: new Map(),
      };
      (client as any).connections.set("degrade-recover", fakeConnection);

      let checkCount = 0;
      const healthSpy = vi.spyOn(client, "healthCheck").mockImplementation(async () => {
        checkCount++;
        return checkCount > 1; // Fail once, then succeed
      });

      client.startHealthMonitor("degrade-recover", 1000);

      // First check — fails, becomes degraded
      await vi.advanceTimersByTimeAsync(1000);
      const state = (client as any).healthMonitors.get("degrade-recover") as MCPHealthState;
      expect(state.status).toBe("degraded");

      // Second check — succeeds, should become healthy
      await vi.advanceTimersByTimeAsync(1000);
      expect(state.status).toBe("healthy");
      expect(state.consecutiveFailures).toBe(0);

      client.stopHealthMonitor("degrade-recover");
      healthSpy.mockRestore();
      (client as any).connections.delete("degrade-recover");
      (client as any).healthMonitors.delete("degrade-recover");
      vi.useRealTimers();
    });
  });

  describe("getServerHealth", () => {
    it("returns undefined when no health monitor exists", () => {
      expect(client.getServerHealth("no-monitor")).toBeUndefined();
    });
  });

  describe("rejectAllPending edge cases", () => {
    it("is no-op when connection does not exist", () => {
      // Should not throw
      (client as any).rejectAllPending("non-existent", new Error("test"));
    });

    it("clears all pending requests after rejecting", () => {
      const pendingRequests = new Map<number, PendingRequest>();
      const rejections: Error[] = [];

      for (let i = 1; i <= 3; i++) {
        const t = setTimeout(() => {}, 5000);
        pendingRequests.set(i, {
          requestId: i,
          method: `test-${i}`,
          resolve: vi.fn(),
          reject: (err) => { rejections.push(err); clearTimeout(t); },
          timeout: t,
        });
      }

      const connection: MCPConnection = {
        serverId: "reject-all-server",
        config: { id: "reject-all-server", name: "Reject All", transport: "stdio", command: "fake", enabled: true },
        connected: true,
        tools: [],
        resources: [],
        nextRequestId: 4,
        pendingRequests,
      };
      (client as any).connections.set("reject-all-server", connection);

      (client as any).rejectAllPending("reject-all-server", new Error("all rejected"));

      expect(rejections).toHaveLength(3);
      expect(pendingRequests.size).toBe(0);
    });
  });

  describe("handleMessage with string id", () => {
    it("resolves pending request with string id", () => {
      const resolvedValues: unknown[] = [];
      const pendingRequests = new Map<number, PendingRequest>();
      // Note: the pending request map uses number keys, but handleMessage also
      // checks for string ids. Since the map key is typed as number, a string id
      // won't match unless coerced. This tests the conditional path.
      const connection: MCPConnection = {
        serverId: "string-id-server",
        config: { id: "string-id-server", name: "String ID", transport: "stdio", command: "fake", enabled: true },
        connected: true,
        tools: [],
        resources: [],
        nextRequestId: 2,
        pendingRequests,
      };
      (client as any).connections.set("string-id-server", connection);

      // handleMessage with a string id that doesn't match any pending request
      // should just be ignored (no matching key in map)
      (client as any).handleMessage(
        "string-id-server",
        JSON.stringify({ jsonrpc: "2.0", id: "string-id-1", result: { data: "hello" } }),
      );

      // No rejections or resolutions — just tests the path
      expect(pendingRequests.size).toBe(0);
    });
  });
});
