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
        id: "test-sse",
        name: "Test SSE Server",
        transport: "sse",
        url: "http://localhost:3000",
        enabled: true,
      };

      await expect(client.connect(config)).rejects.toThrow(
        "Unsupported transport: sse. Only stdio is currently supported."
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
});
