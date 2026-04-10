import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  DEFAULT_QWEN_CLI_ARGS,
  normalizeQwenCliArgs,
  resolveQwenProfileHome,
  getQwenCliConfig,
} from "./qwenCliConfig";

vi.mock("../db", () => ({
  prisma: {
    appSetting: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from "../db";

// ---------------------------------------------------------------------------
// DEFAULT_QWEN_CLI_ARGS
// ---------------------------------------------------------------------------

describe("DEFAULT_QWEN_CLI_ARGS", () => {
  it("is the expected default array", () => {
    expect(DEFAULT_QWEN_CLI_ARGS).toEqual(["--auth-type", "qwen-oauth", "--output-format", "text"]);
  });
});

// ---------------------------------------------------------------------------
// normalizeQwenCliArgs
// ---------------------------------------------------------------------------

describe("normalizeQwenCliArgs", () => {
  it("returns a copy of defaults for empty array", () => {
    const result = normalizeQwenCliArgs([]);
    expect(result).toEqual(DEFAULT_QWEN_CLI_ARGS);
    // Ensure it's a copy, not the same reference
    expect(result).not.toBe(DEFAULT_QWEN_CLI_ARGS);
  });

  it('returns defaults for legacy pattern ["chat", "--prompt"]', () => {
    expect(normalizeQwenCliArgs(["chat", "--prompt"])).toEqual(DEFAULT_QWEN_CLI_ARGS);
  });

  it('returns defaults when first arg is "chat" (legacy pattern)', () => {
    expect(normalizeQwenCliArgs(["chat"])).toEqual(DEFAULT_QWEN_CLI_ARGS);
  });

  it("passes through custom args unchanged", () => {
    expect(normalizeQwenCliArgs(["--custom-arg"])).toEqual(["--custom-arg"]);
  });

  it("returns defaults when all elements are empty strings", () => {
    expect(normalizeQwenCliArgs(["", "", ""])).toEqual(DEFAULT_QWEN_CLI_ARGS);
  });
});

// ---------------------------------------------------------------------------
// resolveQwenProfileHome
// ---------------------------------------------------------------------------

describe("resolveQwenProfileHome", () => {
  it("strips .qwen suffix, returning parent directory", () => {
    expect(resolveQwenProfileHome("/home/user/.qwen")).toBe("/home/user");
  });

  it("passes through paths without .qwen suffix", () => {
    const result = resolveQwenProfileHome("/home/user/custom");
    expect(result).toMatch(/\/home\/user\/custom$/);
  });
});

// ---------------------------------------------------------------------------
// getQwenCliConfig
// ---------------------------------------------------------------------------

describe("getQwenCliConfig", () => {
  const mockFindUnique = prisma.appSetting.findUnique as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFindUnique.mockReset();
    delete process.env.QWEN_COMMAND;
    delete process.env.QWEN_ARGS;
  });

  it("returns env defaults when no DB setting exists", async () => {
    mockFindUnique.mockResolvedValue(null);

    const config = await getQwenCliConfig();
    expect(config.command).toBe("qwen");
    expect(config.args).toEqual(DEFAULT_QWEN_CLI_ARGS);
    expect(config.timeoutMs).toBe(120000);
  });

  it("uses QWEN_COMMAND env var when set", async () => {
    mockFindUnique.mockResolvedValue(null);
    process.env.QWEN_COMMAND = "/usr/local/bin/qwen";

    const config = await getQwenCliConfig();
    expect(config.command).toBe("/usr/local/bin/qwen");
  });

  it("reads config from DB when setting exists", async () => {
    mockFindUnique.mockResolvedValue({
      key: "qwen_cli_config",
      value: {
        command: "/opt/qwen",
        args: ["--verbose"],
        timeoutMs: 60000,
      },
    });

    const config = await getQwenCliConfig();
    expect(config.command).toBe("/opt/qwen");
    expect(config.args).toEqual(["--verbose"]);
    expect(config.timeoutMs).toBe(60000);
  });

  it("enforces minimum timeoutMs of 5000", async () => {
    mockFindUnique.mockResolvedValue({
      key: "qwen_cli_config",
      value: {
        command: "qwen",
        args: ["--fast"],
        timeoutMs: 100,
      },
    });

    const config = await getQwenCliConfig();
    expect(config.timeoutMs).toBe(5000);
  });
});
