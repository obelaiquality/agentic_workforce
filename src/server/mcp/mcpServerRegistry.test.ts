import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MCPServerRegistry, getDefaultMCPServerRegistry, createMCPServerRegistry } from "./mcpServerRegistry";
import { createToolRegistry } from "../tools/registry";
import type { MCPServerConfig } from "./types";

describe("MCPServerRegistry", () => {
  let registry: MCPServerRegistry;

  beforeEach(() => {
    registry = new MCPServerRegistry();
  });

  afterEach(async () => {
    await registry.shutdown();
  });

  describe("addServer", () => {
    it("should add a server configuration", () => {
      const config: MCPServerConfig = {
        id: "test-server",
        name: "Test Server",
        transport: "stdio",
        command: "test-command",
        enabled: true,
      };

      registry.addServer(config);
      const retrieved = registry.getServer("test-server");

      expect(retrieved).toEqual(config);
    });

    it("should reject duplicate server IDs", () => {
      const config: MCPServerConfig = {
        id: "test-server",
        name: "Test Server",
        transport: "stdio",
        command: "test-command",
        enabled: true,
      };

      registry.addServer(config);

      expect(() => registry.addServer(config)).toThrow(
        'Server with id "test-server" already registered'
      );
    });
  });

  describe("addServers", () => {
    it("should add multiple server configurations", () => {
      const configs: MCPServerConfig[] = [
        {
          id: "server1",
          name: "Server 1",
          transport: "stdio",
          command: "cmd1",
          enabled: true,
        },
        {
          id: "server2",
          name: "Server 2",
          transport: "stdio",
          command: "cmd2",
          enabled: false,
        },
      ];

      registry.addServers(configs);
      const servers = registry.getServers();

      expect(servers).toHaveLength(2);
      expect(servers[0].id).toBe("server1");
      expect(servers[1].id).toBe("server2");
    });
  });

  describe("removeServer", () => {
    it("should remove a server configuration", () => {
      const config: MCPServerConfig = {
        id: "test-server",
        name: "Test Server",
        transport: "stdio",
        command: "test-command",
        enabled: true,
      };

      registry.addServer(config);
      registry.removeServer("test-server");

      expect(registry.getServer("test-server")).toBeUndefined();
    });

    it("should handle removal of non-existent server", () => {
      expect(() => registry.removeServer("non-existent")).not.toThrow();
    });
  });

  describe("getServer", () => {
    it("should return undefined for non-existent server", () => {
      expect(registry.getServer("non-existent")).toBeUndefined();
    });
  });

  describe("getServers", () => {
    it("should return empty array when no servers registered", () => {
      expect(registry.getServers()).toEqual([]);
    });

    it("should return all registered servers", () => {
      registry.addServer({
        id: "server1",
        name: "Server 1",
        transport: "stdio",
        command: "cmd1",
        enabled: true,
      });
      registry.addServer({
        id: "server2",
        name: "Server 2",
        transport: "stdio",
        command: "cmd2",
        enabled: false,
      });

      const servers = registry.getServers();
      expect(servers).toHaveLength(2);
    });
  });

  describe("getEnabledServers", () => {
    it("should return only enabled servers", () => {
      registry.addServer({
        id: "enabled",
        name: "Enabled Server",
        transport: "stdio",
        command: "cmd1",
        enabled: true,
      });
      registry.addServer({
        id: "disabled",
        name: "Disabled Server",
        transport: "stdio",
        command: "cmd2",
        enabled: false,
      });

      const enabled = registry.getEnabledServers();
      expect(enabled).toHaveLength(1);
      expect(enabled[0].id).toBe("enabled");
    });

    it("should return empty array when no servers enabled", () => {
      registry.addServer({
        id: "disabled",
        name: "Disabled Server",
        transport: "stdio",
        command: "cmd",
        enabled: false,
      });

      expect(registry.getEnabledServers()).toEqual([]);
    });
  });

  describe("connectAll", () => {
    it("should handle no enabled servers gracefully", async () => {
      const toolRegistry = createToolRegistry();
      await expect(registry.connectAll(toolRegistry)).resolves.toBeUndefined();
    });

    it("should handle no enabled servers gracefully in connectAll", async () => {
      const toolRegistry = createToolRegistry();

      // Add only disabled servers
      registry.addServer({
        id: "disabled-server",
        name: "Disabled Server",
        transport: "stdio",
        command: "some-command",
        enabled: false,
      });

      // Should not throw when no enabled servers exist
      await expect(registry.connectAll(toolRegistry)).resolves.toBeUndefined();
    });
  });

  describe("connect", () => {
    it("should reject connection to non-existent server", async () => {
      const toolRegistry = createToolRegistry();
      await expect(registry.connect("non-existent", toolRegistry)).rejects.toThrow(
        "Server configuration not found: non-existent"
      );
    });

    it("should reject connection to disabled server", async () => {
      const toolRegistry = createToolRegistry();

      registry.addServer({
        id: "disabled",
        name: "Disabled Server",
        transport: "stdio",
        command: "cmd",
        enabled: false,
      });

      await expect(registry.connect("disabled", toolRegistry)).rejects.toThrow(
        "Server is disabled: disabled"
      );
    });
  });

  describe("getStatuses", () => {
    it("should return status for registered servers even if not connected", () => {
      registry.addServer({
        id: "server1",
        name: "Server 1",
        transport: "stdio",
        command: "cmd1",
        enabled: true,
      });

      const statuses = registry.getStatuses();
      expect(statuses).toHaveLength(1);
      expect(statuses[0].id).toBe("server1");
      expect(statuses[0].connected).toBe(false);
      expect(statuses[0].toolCount).toBe(0);
      expect(statuses[0].resourceCount).toBe(0);
    });

    it("should return empty array when no servers registered", () => {
      expect(registry.getStatuses()).toEqual([]);
    });
  });

  describe("getClient", () => {
    it("should return the MCP client instance", () => {
      const client = registry.getClient();
      expect(client).toBeDefined();
      expect(typeof client.connect).toBe("function");
    });
  });

  describe("shutdown", () => {
    it("should not throw when no servers connected", async () => {
      await expect(registry.shutdown()).resolves.toBeUndefined();
    });
  });

  describe("replaceServers", () => {
    it("should replace all configs with new ones", async () => {
      registry.addServer({
        id: "old-server",
        name: "Old Server",
        transport: "stdio",
        command: "old-cmd",
        enabled: true,
      });

      const newConfigs: MCPServerConfig[] = [
        {
          id: "new-server",
          name: "New Server",
          transport: "stdio",
          command: "new-cmd",
          enabled: true,
        },
      ];

      await registry.replaceServers(newConfigs);

      const servers = registry.getServers();
      expect(servers).toHaveLength(1);
      expect(servers[0].id).toBe("new-server");
      expect(registry.getServer("old-server")).toBeUndefined();
    });

    it("should keep existing connection if config unchanged", async () => {
      const config: MCPServerConfig = {
        id: "stable",
        name: "Stable Server",
        transport: "stdio",
        command: "stable-cmd",
        enabled: true,
      };
      registry.addServer(config);

      // Replace with the same config
      await registry.replaceServers([config]);

      const servers = registry.getServers();
      expect(servers).toHaveLength(1);
      expect(servers[0].id).toBe("stable");
    });

    it("should disconnect server if config changed", async () => {
      const config: MCPServerConfig = {
        id: "changing",
        name: "Changing Server",
        transport: "stdio",
        command: "old-cmd",
        enabled: true,
      };
      registry.addServer(config);

      const updatedConfig: MCPServerConfig = {
        id: "changing",
        name: "Changing Server",
        transport: "stdio",
        command: "new-cmd",
        enabled: true,
      };

      await registry.replaceServers([updatedConfig]);

      const servers = registry.getServers();
      expect(servers).toHaveLength(1);
      expect(servers[0].command).toBe("new-cmd");
    });

    it("should accept optional toolRegistry parameter", async () => {
      const toolRegistry = createToolRegistry();
      await registry.replaceServers([], toolRegistry);

      const servers = registry.getServers();
      expect(servers).toHaveLength(0);
    });

    it("should deep copy args array", async () => {
      const originalArgs = ["--port", "3000"];
      const config: MCPServerConfig = {
        id: "with-args",
        name: "With Args",
        transport: "stdio",
        command: "cmd",
        args: originalArgs,
        enabled: true,
      };

      await registry.replaceServers([config]);
      originalArgs.push("--extra");

      const retrieved = registry.getServer("with-args");
      expect(retrieved?.args).toEqual(["--port", "3000"]);
    });
  });

  describe("reconnect", () => {
    it("should throw if no tool registry available", async () => {
      registry.addServer({
        id: "reconnect-test",
        name: "Reconnect Test",
        transport: "stdio",
        command: "cmd",
        enabled: true,
      });

      await expect(registry.reconnect("reconnect-test")).rejects.toThrow(
        "Tool registry is required to reconnect MCP server"
      );
    });
  });

  describe("disconnect", () => {
    it("should handle disconnect of a server without error", async () => {
      registry.addServer({
        id: "disconnect-test",
        name: "Disconnect Test",
        transport: "stdio",
        command: "cmd",
        enabled: true,
      });

      // disconnect should not throw even if not connected
      await expect(registry.disconnect("disconnect-test")).resolves.toBeUndefined();
    });
  });

  describe("listResources", () => {
    it("should delegate to client.listResources", async () => {
      const client = registry.getClient();
      const spy = vi.spyOn(client, "listResources").mockResolvedValue([]);

      await registry.listResources("some-server");
      expect(spy).toHaveBeenCalledWith("some-server");
      spy.mockRestore();
    });
  });

  describe("readResource", () => {
    it("should delegate to client.readResource", async () => {
      const client = registry.getClient();
      const spy = vi.spyOn(client, "readResource").mockResolvedValue({
        contents: [{ uri: "file://test.txt", text: "hello" }],
      });

      const result = await registry.readResource("some-server", "file://test.txt");
      expect(spy).toHaveBeenCalledWith("some-server", "file://test.txt");
      expect(result.contents).toHaveLength(1);
      spy.mockRestore();
    });
  });

  describe("connectAll with enabled servers (error handling)", () => {
    it("should log errors for servers that fail to connect", async () => {
      const toolRegistry = createToolRegistry();

      registry.addServer({
        id: "fail-server",
        name: "Fail Server",
        transport: "stdio",
        command: "test-cmd",
        enabled: true,
      });

      // Mock the client.connect to simulate connection failure
      const client = registry.getClient();
      vi.spyOn(client, "connect").mockRejectedValue(new Error("Connection refused"));

      // connectAll should not throw; failures are handled via allSettled
      await expect(registry.connectAll(toolRegistry)).resolves.toBeUndefined();
    });
  });

  describe("connect with already connected server", () => {
    it("should early return when server is already connected", async () => {
      const toolRegistry = createToolRegistry();

      registry.addServer({
        id: "already-connected",
        name: "Already Connected",
        transport: "stdio",
        command: "cmd",
        enabled: true,
      });

      // Mock the client to report this server as connected
      const client = registry.getClient();
      vi.spyOn(client, "getStatus").mockReturnValue([
        {
          id: "already-connected",
          name: "Already Connected",
          connected: true,
          toolCount: 1,
          resourceCount: 0,
        },
      ]);

      // Should return without trying to connect
      await expect(registry.connect("already-connected", toolRegistry)).resolves.toBeUndefined();
    });
  });
});

describe("module-level exports", () => {
  it("getDefaultMCPServerRegistry returns a singleton instance", () => {
    const a = getDefaultMCPServerRegistry();
    const b = getDefaultMCPServerRegistry();
    expect(a).toBe(b);
  });

  it("createMCPServerRegistry returns a new instance each time", () => {
    const a = createMCPServerRegistry();
    const b = createMCPServerRegistry();
    expect(a).not.toBe(b);
  });
});
