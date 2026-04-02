import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MCPServerRegistry } from "./mcpServerRegistry";
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
});
