import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  prisma: {
    appSetting: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

import { prisma } from "../db";
import {
  normalizeMcpServerConfigs,
  loadPersistedMcpServerConfigs,
} from "./integrationSettings";

describe("integrationSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // normalizeMcpServerConfigs
  // -----------------------------------------------------------------------

  it("returns empty array for non-array input", () => {
    expect(normalizeMcpServerConfigs(null)).toEqual([]);
    expect(normalizeMcpServerConfigs(undefined)).toEqual([]);
    expect(normalizeMcpServerConfigs("string")).toEqual([]);
    expect(normalizeMcpServerConfigs(42)).toEqual([]);
    expect(normalizeMcpServerConfigs({})).toEqual([]);
  });

  it("parses a valid stdio config", () => {
    const raw = [
      {
        id: "s1",
        name: "Server One",
        transport: "stdio",
        command: "/usr/bin/node",
        args: ["index.js"],
        enabled: true,
      },
    ];

    const result = normalizeMcpServerConfigs(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: "s1",
      name: "Server One",
      transport: "stdio",
      command: "/usr/bin/node",
      args: ["index.js"],
      url: undefined,
      env: undefined,
      enabled: true,
    });
  });

  it("parses a valid sse config", () => {
    const raw = [
      {
        id: "sse1",
        name: "SSE Server",
        transport: "sse",
        url: "http://localhost:3000/sse",
        enabled: true,
      },
    ];

    const result = normalizeMcpServerConfigs(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "sse1",
      transport: "sse",
      url: "http://localhost:3000/sse",
      enabled: true,
    });
  });

  it("skips entries with missing required fields", () => {
    const raw = [
      { id: "x" }, // missing name, transport
      { name: "No ID", transport: "stdio", command: "cmd" }, // missing id
      { id: "y", name: "No Transport", command: "cmd" }, // missing transport
    ];

    expect(normalizeMcpServerConfigs(raw)).toEqual([]);
  });

  it("skips stdio config without command", () => {
    const raw = [
      {
        id: "s2",
        name: "No Command",
        transport: "stdio",
        enabled: true,
      },
    ];

    expect(normalizeMcpServerConfigs(raw)).toEqual([]);
  });

  it("skips sse config without url", () => {
    const raw = [
      {
        id: "sse2",
        name: "No URL",
        transport: "sse",
        enabled: true,
      },
    ];

    expect(normalizeMcpServerConfigs(raw)).toEqual([]);
  });

  it("deduplicates by id keeping the last entry", () => {
    const raw = [
      {
        id: "dup",
        name: "First",
        transport: "stdio",
        command: "cmd1",
        enabled: true,
      },
      {
        id: "dup",
        name: "Second",
        transport: "stdio",
        command: "cmd2",
        enabled: false,
      },
    ];

    const result = normalizeMcpServerConfigs(raw);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Second");
    expect(result[0].command).toBe("cmd2");
    expect(result[0].enabled).toBe(false);
  });

  it("filters empty strings from args", () => {
    const raw = [
      {
        id: "s3",
        name: "With blanks",
        transport: "stdio",
        command: "node",
        args: ["index.js", "", "  ", "serve"],
        enabled: true,
      },
    ];

    const result = normalizeMcpServerConfigs(raw);
    expect(result[0].args).toEqual(["index.js", "serve"]);
  });

  // -----------------------------------------------------------------------
  // loadPersistedMcpServerConfigs
  // -----------------------------------------------------------------------

  it("returns empty array when no setting row exists", async () => {
    vi.mocked(prisma.appSetting.findUnique).mockResolvedValue(null);

    const result = await loadPersistedMcpServerConfigs();
    expect(result).toEqual([]);
    expect(prisma.appSetting.findUnique).toHaveBeenCalledWith({
      where: { key: "mcp_server_configs" },
    });
  });

  it("returns normalized configs loaded from DB", async () => {
    const stored = [
      {
        id: "db1",
        name: "DB Server",
        transport: "stdio",
        command: "python",
        args: ["server.py"],
        enabled: true,
      },
    ];

    vi.mocked(prisma.appSetting.findUnique).mockResolvedValue({
      key: "mcp_server_configs",
      value: stored,
      updatedAt: new Date(),
    } as any);

    const result = await loadPersistedMcpServerConfigs();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "db1",
      name: "DB Server",
      transport: "stdio",
      command: "python",
    });
  });
});
