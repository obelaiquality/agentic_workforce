/**
 * Unit tests for shellDetect.ts
 * Tests cross-platform shell detection with caching.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";

// Mock execSync before importing detectShell
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

describe("detectShell", () => {
  let originalPlatform: PropertyDescriptor | undefined;
  let originalShell: string | undefined;

  beforeEach(() => {
    // Reset module cache to clear cachedShell
    vi.resetModules();

    // Save original values
    originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    originalShell = process.env.SHELL;

    // Reset mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore original values
    if (originalPlatform) {
      Object.defineProperty(process, "platform", originalPlatform);
    }
    if (originalShell !== undefined) {
      process.env.SHELL = originalShell;
    } else {
      delete process.env.SHELL;
    }
  });

  it("returns a valid shell string", async () => {
    process.env.SHELL = "/bin/zsh";

    const { detectShell } = await import("./shellDetect");
    const shell = detectShell();

    expect(typeof shell).toBe("string");
    expect(shell.length).toBeGreaterThan(0);
  });

  it("caches the shell after first detection", async () => {
    process.env.SHELL = "/bin/bash";

    const { detectShell } = await import("./shellDetect");
    const first = detectShell();
    const second = detectShell();

    expect(first).toBe(second);
  });

  it("returns cmd.exe on Windows", async () => {
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });

    const { detectShell } = await import("./shellDetect");
    const shell = detectShell();

    expect(shell).toBe("cmd.exe");
  });

  it("uses SHELL environment variable on Unix", async () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true,
    });
    process.env.SHELL = "/bin/zsh";

    const { detectShell } = await import("./shellDetect");
    const shell = detectShell();

    expect(shell).toBe("/bin/zsh");
  });

  it("handles missing SHELL environment variable by checking for bash", async () => {
    Object.defineProperty(process, "platform", {
      value: "linux",
      configurable: true,
    });
    delete process.env.SHELL;

    vi.mocked(execSync).mockImplementation(() => Buffer.from(""));

    const { detectShell } = await import("./shellDetect");
    const shell = detectShell();

    expect(shell).toBe("/bin/bash");
    expect(execSync).toHaveBeenCalledWith("which bash", { stdio: "ignore" });
  });

  it("falls back to /bin/sh when bash is not available", async () => {
    Object.defineProperty(process, "platform", {
      value: "linux",
      configurable: true,
    });
    delete process.env.SHELL;

    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("bash not found");
    });

    const { detectShell } = await import("./shellDetect");
    const shell = detectShell();

    expect(shell).toBe("/bin/sh");
  });

  it("returns a Unix shell path on macOS/Linux", async () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true,
    });
    process.env.SHELL = "/usr/local/bin/fish";

    const { detectShell } = await import("./shellDetect");
    const shell = detectShell();

    expect(shell).toMatch(/^\//); // Unix paths start with /
    expect(shell).toBe("/usr/local/bin/fish");
  });

  it("prefers SHELL env over which bash", async () => {
    Object.defineProperty(process, "platform", {
      value: "linux",
      configurable: true,
    });
    process.env.SHELL = "/usr/bin/fish";

    const { detectShell } = await import("./shellDetect");
    const shell = detectShell();

    expect(shell).toBe("/usr/bin/fish");
    expect(execSync).not.toHaveBeenCalled();
  });
});
