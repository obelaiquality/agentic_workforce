// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  getDesktopBridge,
  hasDesktopRepoPicker,
  pickRepoDirectory,
  listRecentRepoPaths,
  rememberRepoPath,
  openDesktopExternal,
} from "./desktopBridge";
import type { DesktopBridgeApi } from "./desktopBridge";

beforeEach(() => {
  delete (window as any).desktopBridge;
});

describe("getDesktopBridge", () => {
  it("returns undefined when no bridge on window", () => {
    expect(getDesktopBridge()).toBeUndefined();
  });

  it("returns bridge when set on window", () => {
    const bridge: DesktopBridgeApi = {};
    (window as any).desktopBridge = bridge;
    expect(getDesktopBridge()).toBe(bridge);
  });
});

describe("hasDesktopRepoPicker", () => {
  it("returns false when no bridge", () => {
    expect(hasDesktopRepoPicker()).toBe(false);
  });

  it("returns false when bridge has no pickRepoDirectory", () => {
    (window as any).desktopBridge = {};
    expect(hasDesktopRepoPicker()).toBe(false);
  });

  it("returns true when bridge has pickRepoDirectory", () => {
    (window as any).desktopBridge = {
      pickRepoDirectory: vi.fn(),
    };
    expect(hasDesktopRepoPicker()).toBe(true);
  });
});

describe("pickRepoDirectory", () => {
  it("returns { canceled: true } when no bridge", async () => {
    const result = await pickRepoDirectory();
    expect(result).toEqual({ canceled: true });
  });

  it("delegates to bridge when available", async () => {
    const expected = { canceled: false, path: "/home/user/project" };
    (window as any).desktopBridge = {
      pickRepoDirectory: vi.fn().mockResolvedValue(expected),
    };
    const result = await pickRepoDirectory();
    expect(result).toEqual(expected);
  });
});

describe("listRecentRepoPaths", () => {
  it("returns empty array when no bridge", async () => {
    const result = await listRecentRepoPaths();
    expect(result).toEqual([]);
  });

  it("delegates to bridge when available", async () => {
    const paths = [{ path: "/project", label: "My Project", lastUsedAt: "2024-01-01T00:00:00Z" }];
    (window as any).desktopBridge = {
      listRecentRepoPaths: vi.fn().mockResolvedValue(paths),
    };
    const result = await listRecentRepoPaths();
    expect(result).toEqual(paths);
  });
});

describe("rememberRepoPath", () => {
  it("is a no-op when no bridge", async () => {
    // Should not throw
    await rememberRepoPath("/some/path", "label");
  });

  it("delegates to bridge when available", async () => {
    const mockRemember = vi.fn().mockResolvedValue(undefined);
    (window as any).desktopBridge = {
      rememberRepoPath: mockRemember,
    };
    await rememberRepoPath("/some/path", "My Repo");
    expect(mockRemember).toHaveBeenCalledWith("/some/path", "My Repo");
  });
});

describe("openDesktopExternal", () => {
  it("calls window.open when no bridge", async () => {
    const mockOpen = vi.fn();
    vi.stubGlobal("open", mockOpen);
    await openDesktopExternal("https://example.com");
    expect(mockOpen).toHaveBeenCalledWith("https://example.com", "_blank", "noopener,noreferrer");
    vi.unstubAllGlobals();
  });

  it("delegates to bridge.openExternal when available", async () => {
    const mockOpenExternal = vi.fn().mockResolvedValue({ ok: true });
    (window as any).desktopBridge = {
      openExternal: mockOpenExternal,
    };
    await openDesktopExternal("https://example.com");
    expect(mockOpenExternal).toHaveBeenCalledWith("https://example.com");
  });
});
