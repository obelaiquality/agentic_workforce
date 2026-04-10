import { describe, it, expect } from "vitest";
import path from "node:path";
import { isPathAllowed, createDefaultSandbox } from "./fileSandbox";
import type { SandboxConfig } from "./fileSandbox";

describe("isPathAllowed", () => {
  const worktree = "/tmp/test-project";
  const defaultConfig: SandboxConfig = {
    allowedRoots: [worktree],
  };

  // -----------------------------------------------------------------------
  // Allowed paths
  // -----------------------------------------------------------------------

  describe("allowed paths", () => {
    it("allows files directly under the root", () => {
      expect(isPathAllowed("/tmp/test-project/file.ts", defaultConfig)).toBe(true);
    });

    it("allows files in subdirectories", () => {
      expect(isPathAllowed("/tmp/test-project/src/index.ts", defaultConfig)).toBe(true);
    });

    it("allows deeply nested files", () => {
      expect(isPathAllowed("/tmp/test-project/src/server/permissions/types.ts", defaultConfig)).toBe(true);
    });

    it("allows the root directory itself", () => {
      expect(isPathAllowed("/tmp/test-project", defaultConfig)).toBe(true);
    });

    it("allows with multiple roots", () => {
      const config: SandboxConfig = {
        allowedRoots: ["/tmp/root-a", "/tmp/root-b"],
      };
      expect(isPathAllowed("/tmp/root-a/file.ts", config)).toBe(true);
      expect(isPathAllowed("/tmp/root-b/file.ts", config)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Blocked paths (outside allowed roots)
  // -----------------------------------------------------------------------

  describe("paths outside allowed roots", () => {
    it("blocks files outside the root", () => {
      expect(isPathAllowed("/etc/passwd", defaultConfig)).toBe(false);
    });

    it("blocks files in parent directories", () => {
      expect(isPathAllowed("/tmp/other-project/file.ts", defaultConfig)).toBe(false);
    });

    it("blocks files with path traversal", () => {
      // path.resolve normalizes "../" so /tmp/test-project/../other becomes /tmp/other
      expect(isPathAllowed("/tmp/test-project/../other/file.ts", defaultConfig)).toBe(false);
    });

    it("blocks paths that share a prefix but are not actually under the root", () => {
      // "/tmp/test-project-evil" starts with "/tmp/test-project" but is a different directory
      expect(isPathAllowed("/tmp/test-project-evil/file.ts", defaultConfig)).toBe(false);
    });

    it("blocks home directory files", () => {
      expect(isPathAllowed("~/.ssh/id_rsa", defaultConfig)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Blocked patterns (sensitive files)
  // -----------------------------------------------------------------------

  describe("blocked patterns (default)", () => {
    it("blocks .env files", () => {
      expect(isPathAllowed("/tmp/test-project/.env", defaultConfig)).toBe(false);
    });

    it("blocks .env.local files", () => {
      expect(isPathAllowed("/tmp/test-project/.env.local", defaultConfig)).toBe(false);
    });

    it("blocks .env.production files", () => {
      expect(isPathAllowed("/tmp/test-project/.env.production", defaultConfig)).toBe(false);
    });

    it("blocks .pem files", () => {
      expect(isPathAllowed("/tmp/test-project/certs/server.pem", defaultConfig)).toBe(false);
    });

    it("blocks .key files", () => {
      expect(isPathAllowed("/tmp/test-project/certs/private.key", defaultConfig)).toBe(false);
    });

    it("blocks id_rsa files", () => {
      expect(isPathAllowed("/tmp/test-project/id_rsa", defaultConfig)).toBe(false);
    });

    it("blocks id_rsa.pub files", () => {
      expect(isPathAllowed("/tmp/test-project/id_rsa.pub", defaultConfig)).toBe(false);
    });

    it("blocks id_ed25519 files", () => {
      expect(isPathAllowed("/tmp/test-project/id_ed25519", defaultConfig)).toBe(false);
    });

    it("blocks id_dsa files", () => {
      expect(isPathAllowed("/tmp/test-project/id_dsa", defaultConfig)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Custom blocked patterns
  // -----------------------------------------------------------------------

  describe("custom blocked patterns", () => {
    it("blocks files matching custom patterns", () => {
      const config: SandboxConfig = {
        allowedRoots: [worktree],
        blockedPatterns: ["*.secret"],
      };
      expect(isPathAllowed("/tmp/test-project/data.secret", config)).toBe(false);
    });

    it("allows files not matching custom patterns", () => {
      const config: SandboxConfig = {
        allowedRoots: [worktree],
        blockedPatterns: ["*.secret"],
      };
      expect(isPathAllowed("/tmp/test-project/data.txt", config)).toBe(true);
    });

    it("custom patterns replace default patterns", () => {
      const config: SandboxConfig = {
        allowedRoots: [worktree],
        blockedPatterns: ["*.secret"], // Only block .secret, not .env
      };
      // .env should be allowed since we replaced default patterns
      expect(isPathAllowed("/tmp/test-project/.env", config)).toBe(true);
    });

    it("handles **/ prefix in patterns", () => {
      const config: SandboxConfig = {
        allowedRoots: [worktree],
        blockedPatterns: ["**/.env"],
      };
      expect(isPathAllowed("/tmp/test-project/.env", config)).toBe(false);
      expect(isPathAllowed("/tmp/test-project/sub/.env", config)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Path normalization
  // -----------------------------------------------------------------------

  describe("path normalization", () => {
    it("resolves relative paths against cwd", () => {
      // This test just verifies path.resolve is being used
      const config: SandboxConfig = {
        allowedRoots: [process.cwd()],
      };
      // A relative path like "file.txt" resolves to cwd/file.txt
      const result = isPathAllowed("file.txt", config);
      // Should be allowed since it resolves to within cwd
      expect(result).toBe(true);
    });

    it("normalizes trailing slashes on roots", () => {
      const config: SandboxConfig = {
        allowedRoots: ["/tmp/test-project/"],
      };
      expect(isPathAllowed("/tmp/test-project/file.ts", config)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// createDefaultSandbox
// ---------------------------------------------------------------------------

describe("createDefaultSandbox", () => {
  it("creates a config with the worktree as allowed root", () => {
    const sandbox = createDefaultSandbox("/home/user/project");
    expect(sandbox.allowedRoots).toEqual([path.resolve("/home/user/project")]);
  });

  it("includes default blocked patterns", () => {
    const sandbox = createDefaultSandbox("/home/user/project");
    expect(sandbox.blockedPatterns).toBeDefined();
    expect(sandbox.blockedPatterns!.length).toBeGreaterThan(0);
    expect(sandbox.blockedPatterns).toContain(".env");
    expect(sandbox.blockedPatterns).toContain("*.pem");
    expect(sandbox.blockedPatterns).toContain("*.key");
    expect(sandbox.blockedPatterns).toContain("id_rsa");
  });

  it("resolves the worktree path", () => {
    const sandbox = createDefaultSandbox("relative/path");
    expect(path.isAbsolute(sandbox.allowedRoots[0])).toBe(true);
  });

  it("produces a config that blocks .env files inside the worktree", () => {
    const sandbox = createDefaultSandbox("/home/user/project");
    expect(isPathAllowed("/home/user/project/.env", sandbox)).toBe(false);
  });

  it("produces a config that allows normal files inside the worktree", () => {
    const sandbox = createDefaultSandbox("/home/user/project");
    expect(isPathAllowed("/home/user/project/src/index.ts", sandbox)).toBe(true);
  });

  it("produces a config that blocks files outside the worktree", () => {
    const sandbox = createDefaultSandbox("/home/user/project");
    expect(isPathAllowed("/etc/passwd", sandbox)).toBe(false);
  });
});
