/**
 * Unit tests for serverConfigs.ts
 * Tests LSP server configuration lookup and command availability checking.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  LSP_SERVER_CONFIGS,
  getServerConfigForFile,
  getServerConfigByLanguage,
  isLspCommandAvailable,
} from "./serverConfigs";

vi.mock("node:fs/promises", () => ({
  access: vi.fn(),
}));

import { access } from "node:fs/promises";

const mockedAccess = vi.mocked(access);

describe("LSP_SERVER_CONFIGS", () => {
  it("has 4 entries", () => {
    expect(LSP_SERVER_CONFIGS).toHaveLength(4);
  });
});

describe("getServerConfigForFile", () => {
  it('returns typescript config for "main.ts"', () => {
    const config = getServerConfigForFile("main.ts");
    expect(config).toBeDefined();
    expect(config!.language).toBe("typescript");
  });

  it('returns typescript config for "app.tsx"', () => {
    const config = getServerConfigForFile("app.tsx");
    expect(config).toBeDefined();
    expect(config!.language).toBe("typescript");
  });

  it('returns python config for "script.py"', () => {
    const config = getServerConfigForFile("script.py");
    expect(config).toBeDefined();
    expect(config!.language).toBe("python");
  });

  it('returns rust config for "lib.rs"', () => {
    const config = getServerConfigForFile("lib.rs");
    expect(config).toBeDefined();
    expect(config!.language).toBe("rust");
  });

  it('returns go config for "main.go"', () => {
    const config = getServerConfigForFile("main.go");
    expect(config).toBeDefined();
    expect(config!.language).toBe("go");
  });

  it('returns undefined for "unknown.xyz"', () => {
    const config = getServerConfigForFile("unknown.xyz");
    expect(config).toBeUndefined();
  });
});

describe("getServerConfigByLanguage", () => {
  it('returns config with .ts extensions for "typescript"', () => {
    const config = getServerConfigByLanguage("typescript");
    expect(config).toBeDefined();
    expect(config!.extensions).toContain(".ts");
    expect(config!.extensions).toContain(".tsx");
  });

  it('returns undefined for "unknown"', () => {
    const config = getServerConfigByLanguage("unknown");
    expect(config).toBeUndefined();
  });
});

describe("isLspCommandAvailable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false for ""', async () => {
    const result = await isLspCommandAvailable("");
    expect(result).toBe(false);
  });

  it('returns false for "  "', async () => {
    const result = await isLspCommandAvailable("  ");
    expect(result).toBe(false);
  });

  it("returns true when absolute path exists", async () => {
    mockedAccess.mockResolvedValueOnce(undefined);

    const result = await isLspCommandAvailable("/usr/local/bin/my-lsp");

    expect(result).toBe(true);
    expect(mockedAccess).toHaveBeenCalledWith("/usr/local/bin/my-lsp");
  });

  it("returns false when absolute path does not exist", async () => {
    mockedAccess.mockRejectedValueOnce(new Error("ENOENT"));

    const result = await isLspCommandAvailable("/usr/local/bin/nonexistent");

    expect(result).toBe(false);
  });

  it("searches PATH entries and returns true when command is found", async () => {
    const originalPATH = process.env.PATH;
    process.env.PATH = "/usr/bin:/usr/local/bin";

    // Reject first candidate, resolve second
    mockedAccess.mockRejectedValueOnce(new Error("ENOENT"));
    mockedAccess.mockResolvedValueOnce(undefined);

    const result = await isLspCommandAvailable("my-server");

    expect(result).toBe(true);
    process.env.PATH = originalPATH;
  });

  it("returns false when command is not found in any PATH entry", async () => {
    const originalPATH = process.env.PATH;
    process.env.PATH = "/usr/bin:/usr/local/bin";

    mockedAccess.mockRejectedValue(new Error("ENOENT"));

    const result = await isLspCommandAvailable("nonexistent-cmd");

    expect(result).toBe(false);
    process.env.PATH = originalPATH;
  });

  it("handles win32 PATHEXT-based executable resolution", async () => {
    const originalPlatform = process.platform;
    const originalPATH = process.env.PATH;
    const originalPATHEXT = process.env.PATHEXT;

    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    process.env.PATH = "C:\\Windows\\System32";
    process.env.PATHEXT = ".EXE;.CMD";

    mockedAccess.mockRejectedValueOnce(new Error("ENOENT"));
    mockedAccess.mockResolvedValueOnce(undefined);

    const result = await isLspCommandAvailable("my-tool");

    expect(result).toBe(true);

    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    process.env.PATH = originalPATH;
    process.env.PATHEXT = originalPATHEXT;
  });
});
