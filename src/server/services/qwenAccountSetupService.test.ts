import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QwenAccountSetupService } from "./qwenAccountSetupService";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";

const mockPrisma = vi.hoisted(() => ({
  providerAccount: {
    findUniqueOrThrow: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
}));

vi.mock("../db", () => ({
  prisma: mockPrisma,
}));

vi.mock("../eventBus", () => ({
  publishEvent: vi.fn(),
}));

const mockGetQwenCliConfig = vi.hoisted(() => vi.fn());
const mockResolveQwenProfileHome = vi.hoisted(() => vi.fn());

vi.mock("../providers/qwenCliConfig", () => ({
  getQwenCliConfig: mockGetQwenCliConfig,
  resolveQwenProfileHome: mockResolveQwenProfileHome,
}));

const mockProviderOrchestrator = {
  createQwenAccount: vi.fn(),
  updateQwenAccount: vi.fn(),
  markQwenAccountReauthed: vi.fn(),
};

let mockSpawnChild: EventEmitter & {
  pid?: number;
  kill: ReturnType<typeof vi.fn>;
  stdout: EventEmitter;
  stderr: EventEmitter;
};

const mockSpawn = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: mockSpawn,
}));

describe("QwenAccountSetupService", () => {
  let service: QwenAccountSetupService;
  let tmpDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create temp directory for testing
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "qwen-test-"));
    process.env.QWEN_PROFILE_ROOT = tmpDir;

    // Setup mock spawn child
    const stdoutEmitter = new EventEmitter();
    const stderrEmitter = new EventEmitter();

    Object.assign(stdoutEmitter, {
      setEncoding: vi.fn(),
    });
    Object.assign(stderrEmitter, {
      setEncoding: vi.fn(),
    });

    mockSpawnChild = Object.assign(new EventEmitter(), {
      pid: 12345,
      kill: vi.fn(),
      stdout: stdoutEmitter,
      stderr: stderrEmitter,
    });

    mockSpawn.mockReturnValue(mockSpawnChild);

    mockResolveQwenProfileHome.mockImplementation((profilePath: string) => profilePath);
    mockGetQwenCliConfig.mockResolvedValue({
      command: "qwen",
      args: ["chat"],
    });

    // @ts-expect-error - mock types
    service = new QwenAccountSetupService(mockProviderOrchestrator);
  });

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
    delete process.env.QWEN_PROFILE_ROOT;
  });

  describe("bootstrapAccount", () => {
    it("creates profile directory and account", async () => {
      const mockAccount = {
        id: "account-1",
        providerId: "qwen-cli",
        profilePath: expect.stringContaining("test-label"),
        state: "ready",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockProviderOrchestrator.createQwenAccount.mockResolvedValue(mockAccount);
      mockPrisma.providerAccount.findUniqueOrThrow.mockResolvedValue(mockAccount);

      const result = await service.bootstrapAccount({
        label: "Test Label",
      });

      expect(mockProviderOrchestrator.createQwenAccount).toHaveBeenCalledWith({
        label: "Test Label",
        profilePath: expect.stringContaining("test-label"),
      });

      expect(result.id).toBe("account-1");
    });

    it("slugifies label correctly", async () => {
      const mockAccount = {
        id: "account-2",
        providerId: "qwen-cli",
        profilePath: "/path",
        state: "ready",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockProviderOrchestrator.createQwenAccount.mockResolvedValue(mockAccount);
      mockPrisma.providerAccount.findUniqueOrThrow.mockResolvedValue(mockAccount);

      await service.bootstrapAccount({
        label: "My Test@Account#123",
      });

      const call = mockProviderOrchestrator.createQwenAccount.mock.calls[0][0];
      expect(call.profilePath).toMatch(/my-test-account-123-\d+/);
    });

    it("updates account state to auth_required when no auth credentials exist", async () => {
      const mockAccount = {
        id: "account-3",
        providerId: "qwen-cli",
        profilePath: path.join(tmpDir, "profile-no-auth"),
        state: "ready",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockProviderOrchestrator.createQwenAccount.mockResolvedValue(mockAccount);
      mockPrisma.providerAccount.findUniqueOrThrow.mockResolvedValue(mockAccount);

      await service.bootstrapAccount({
        label: "No Auth Account",
      });

      expect(mockProviderOrchestrator.updateQwenAccount).toHaveBeenCalledWith(
        "account-3",
        { state: "auth_required" }
      );
    });

    it("does not update state when auth credentials exist", async () => {
      // Set up global qwen dir with auth so copySeedFiles can copy it
      const globalQwenDir = path.join(os.homedir(), ".qwen");
      await fs.mkdir(globalQwenDir, { recursive: true });
      await fs.writeFile(path.join(globalQwenDir, "oauth_creds.json"), "{}");

      const mockAccount = {
        id: "account-4",
        providerId: "qwen-cli",
        profilePath: path.join(tmpDir, "profile-with-auth"),
        state: "ready",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockProviderOrchestrator.createQwenAccount.mockResolvedValue(mockAccount);
      mockPrisma.providerAccount.findUniqueOrThrow.mockResolvedValue(mockAccount);

      await service.bootstrapAccount({
        label: "Auth Account",
        importCurrentAuth: true,
      });

      expect(mockProviderOrchestrator.updateQwenAccount).not.toHaveBeenCalled();

      // Clean up the global auth file
      await fs.rm(path.join(globalQwenDir, "oauth_creds.json"), { force: true });
    });

    it("handles importCurrentAuth flag correctly", async () => {
      const profilePath = path.join(tmpDir, "profile-import");

      const mockAccount = {
        id: "account-5",
        providerId: "qwen-cli",
        profilePath,
        state: "ready",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockProviderOrchestrator.createQwenAccount.mockResolvedValue(mockAccount);
      mockPrisma.providerAccount.findUniqueOrThrow.mockResolvedValue(mockAccount);

      await service.bootstrapAccount({
        label: "Import Account",
        importCurrentAuth: true,
      });

      // Verify the account was created with the importCurrentAuth flag
      // The service will attempt to copy seed files including auth if flag is true
      expect(mockProviderOrchestrator.createQwenAccount).toHaveBeenCalledWith({
        label: "Import Account",
        profilePath: expect.stringContaining("import-account"),
      });
    });
  });

  describe("accountHasAuth", () => {
    it("returns true when oauth_creds.json exists", async () => {
      const profilePath = path.join(tmpDir, "profile-has-auth");
      await fs.mkdir(path.join(profilePath, ".qwen"), { recursive: true });
      await fs.writeFile(path.join(profilePath, ".qwen", "oauth_creds.json"), "{}");

      const result = await service.accountHasAuth(profilePath);

      expect(result).toBe(true);
    });

    it("returns false when oauth_creds.json does not exist", async () => {
      const profilePath = path.join(tmpDir, "profile-no-auth");

      const result = await service.accountHasAuth(profilePath);

      expect(result).toBe(false);
    });
  });

  describe("listAuthSessions", () => {
    it("returns auth sessions for all qwen-cli accounts", async () => {
      const mockAccounts = [
        {
          id: "account-1",
          providerId: "qwen-cli",
          profilePath: "/path1",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "account-2",
          providerId: "qwen-cli",
          profilePath: "/path2",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockPrisma.providerAccount.findMany.mockResolvedValue(mockAccounts);

      const result = await service.listAuthSessions();

      expect(result).toHaveLength(2);
      expect(result[0].accountId).toBe("account-1");
      expect(result[0].status).toBe("idle");
      expect(result[1].accountId).toBe("account-2");
    });

    it("returns running session status for active auth flows", async () => {
      const mockAccounts = [
        {
          id: "account-1",
          providerId: "qwen-cli",
          profilePath: "/path1",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockPrisma.providerAccount.findMany.mockResolvedValue(mockAccounts);
      mockPrisma.providerAccount.findUniqueOrThrow.mockResolvedValue(mockAccounts[0]);

      // Start an auth flow
      await service.startAuth("account-1");

      const result = await service.listAuthSessions();

      expect(result[0].status).toBe("running");
      expect(result[0].pid).toBe(12345);
    });

    it("includes appropriate message based on auth status", async () => {
      const profileWithAuth = path.join(tmpDir, "profile-with-auth");
      const profileNoAuth = path.join(tmpDir, "profile-no-auth");

      await fs.mkdir(path.join(profileWithAuth, ".qwen"), { recursive: true });
      await fs.writeFile(path.join(profileWithAuth, ".qwen", "oauth_creds.json"), "{}");

      const mockAccounts = [
        {
          id: "account-1",
          providerId: "qwen-cli",
          profilePath: profileWithAuth,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "account-2",
          providerId: "qwen-cli",
          profilePath: profileNoAuth,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockPrisma.providerAccount.findMany.mockResolvedValue(mockAccounts);

      const result = await service.listAuthSessions();

      expect(result[0].message).toBe("credentials detected");
      expect(result[1].message).toBe("authentication required");
    });
  });

  describe("startAuth", () => {
    it("spawns qwen auth process with correct environment", async () => {
      const mockAccount = {
        id: "account-1",
        providerId: "qwen-cli",
        profilePath: "/test/profile",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.providerAccount.findUniqueOrThrow.mockResolvedValue(mockAccount);
      mockResolveQwenProfileHome.mockReturnValue("/test/profile");

      await service.startAuth("account-1");

      expect(mockSpawn).toHaveBeenCalledWith(
        "qwen",
        ["chat", "Reply with exactly QWEN_AUTH_FLOW_OK"],
        expect.objectContaining({
          env: expect.objectContaining({
            HOME: "/test/profile",
            USERPROFILE: "/test/profile",
          }),
        })
      );
    });

    it("returns existing session if already running", async () => {
      const mockAccount = {
        id: "account-1",
        providerId: "qwen-cli",
        profilePath: "/test/profile",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.providerAccount.findUniqueOrThrow.mockResolvedValue(mockAccount);

      const first = await service.startAuth("account-1");
      const second = await service.startAuth("account-1");

      expect(first.accountId).toBe(second.accountId);
      expect(second.status).toBe("running");
    });

    it("updates provider account to auth_required state", async () => {
      const mockAccount = {
        id: "account-1",
        providerId: "qwen-cli",
        profilePath: "/test/profile",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.providerAccount.findUniqueOrThrow.mockResolvedValue(mockAccount);

      await service.startAuth("account-1");

      expect(mockProviderOrchestrator.updateQwenAccount).toHaveBeenCalledWith(
        "account-1",
        { state: "auth_required" }
      );
    });

    it("tracks auth session with correct initial state", async () => {
      const mockAccount = {
        id: "account-1",
        providerId: "qwen-cli",
        profilePath: "/test/profile",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.providerAccount.findUniqueOrThrow.mockResolvedValue(mockAccount);

      const result = await service.startAuth("account-1");

      expect(result.status).toBe("running");
      expect(result.message).toBe("starting qwen auth flow");
      expect(result.pid).toBe(12345);
      expect(result.log).toEqual([]);
    });

    it("captures stdout and stderr output", async () => {
      const mockAccount = {
        id: "account-1",
        providerId: "qwen-cli",
        profilePath: "/test/profile",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.providerAccount.findUniqueOrThrow.mockResolvedValue(mockAccount);

      await service.startAuth("account-1");

      // Verify that event listeners were set up
      expect(mockSpawnChild.stdout.setEncoding).toHaveBeenCalledWith("utf-8");
      expect(mockSpawnChild.stderr.setEncoding).toHaveBeenCalledWith("utf-8");
    });

    it("marks auth as succeeded when process completes successfully with credentials", async () => {
      const profilePath = path.join(tmpDir, "profile-success");
      await fs.mkdir(path.join(profilePath, ".qwen"), { recursive: true });

      const mockAccount = {
        id: "account-1",
        providerId: "qwen-cli",
        profilePath,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.providerAccount.findUniqueOrThrow.mockResolvedValue(mockAccount);

      await service.startAuth("account-1");

      // Create auth file
      await fs.writeFile(path.join(profilePath, ".qwen", "oauth_creds.json"), "{}");

      // Simulate process completion
      mockSpawnChild.emit("close", 0);

      // Wait a bit for async handlers
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockProviderOrchestrator.markQwenAccountReauthed).toHaveBeenCalledWith("account-1");
    });

    it("marks auth as failed when process exits with error", async () => {
      const profilePath = path.join(tmpDir, "profile-failed");

      const mockAccount = {
        id: "account-1",
        providerId: "qwen-cli",
        profilePath,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.providerAccount.findUniqueOrThrow.mockResolvedValue(mockAccount);

      await service.startAuth("account-1");

      // Simulate process failure
      mockSpawnChild.emit("close", 1);

      // Wait a bit for async handlers
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockProviderOrchestrator.updateQwenAccount).toHaveBeenCalledWith(
        "account-1",
        { state: "auth_required" }
      );
    });

    it("kills process after timeout", async () => {
      vi.useFakeTimers();

      const mockAccount = {
        id: "account-1",
        providerId: "qwen-cli",
        profilePath: "/test/profile",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.providerAccount.findUniqueOrThrow.mockResolvedValue(mockAccount);

      await service.startAuth("account-1");

      // Fast-forward time by 15 minutes
      vi.advanceTimersByTime(15 * 60 * 1000);

      expect(mockSpawnChild.kill).toHaveBeenCalledWith("SIGTERM");

      vi.useRealTimers();
    });
  });
});
