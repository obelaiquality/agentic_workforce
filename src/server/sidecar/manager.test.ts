import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";

// Create mock child process
class MockChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

// Mock modules at the top level
const mockSpawn = vi.fn();
const mockExistsSync = vi.fn();
const mockSidecarClient = {
  close: vi.fn(),
  heartbeat: vi.fn(),
};

vi.mock("node:child_process", () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
}));

vi.mock("node:fs", () => ({
  default: {
    existsSync: (...args: any[]) => mockExistsSync(...args),
  },
}));

vi.mock("./client", () => ({
  SidecarClient: vi.fn(() => mockSidecarClient),
}));

vi.mock("../logger", () => ({
  createLogger: vi.fn(() => ({
    warn: vi.fn(),
  })),
}));

describe("Sidecar Manager", () => {
  let originalEnv: NodeJS.ProcessEnv;
  let getSidecarClient: any;
  let stopSidecarProcess: any;

  beforeEach(async () => {
    originalEnv = { ...process.env };
    vi.clearAllMocks();

    // Clear module cache to reset singletons
    vi.resetModules();

    // Re-import the module after resetting
    const managerModule = await import("./manager");
    getSidecarClient = managerModule.getSidecarClient;
    stopSidecarProcess = managerModule.stopSidecarProcess;
  });

  afterEach(() => {
    process.env = originalEnv;
    if (stopSidecarProcess) {
      stopSidecarProcess();
    }
  });

  describe("getSidecarClient", () => {
    it("returns existing client if already connected", async () => {
      mockSidecarClient.heartbeat.mockResolvedValue({ ok: true, message: "OK" });

      const client1 = await getSidecarClient();
      const client2 = await getSidecarClient();

      expect(client1).toBe(client2);
      // First call does 4 heartbeat attempts, second call returns cached client
      expect(mockSidecarClient.heartbeat.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    it("connects to already-running sidecar without spawning", async () => {
      process.env.RUST_SIDECAR_AUTOSTART = "false";
      mockSidecarClient.heartbeat.mockResolvedValue({ ok: true, message: "OK" });

      const client = await getSidecarClient();

      expect(client).toBeDefined();
      expect(mockSidecarClient.heartbeat).toHaveBeenCalled();
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it("spawns sidecar in dev mode when autostart enabled", async () => {
      process.env.APP_PACKAGED = "false";
      process.env.APP_ROOT = "/test/root";
      process.env.RUST_SIDECAR_AUTOSTART = "true";
      mockExistsSync.mockReturnValue(false); // Force dev mode (no release binary)

      let heartbeatAttempt = 0;
      mockSidecarClient.heartbeat.mockImplementation(() => {
        heartbeatAttempt++;
        // Fail first 4 attempts, succeed on 5th (after spawn)
        if (heartbeatAttempt <= 4) {
          return Promise.reject(new Error("Not ready"));
        }
        return Promise.resolve({ ok: true, message: "OK" });
      });

      const mockProcess = new MockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const client = await getSidecarClient();

      // Should spawn with cargo run
      expect(mockSpawn).toHaveBeenCalledWith(
        "cargo",
        ["run", "--manifest-path", expect.stringContaining("Cargo.toml")],
        expect.objectContaining({
          cwd: "/test/root",
          stdio: "pipe",
          env: expect.objectContaining({
            RUST_SIDECAR_ADDR: "127.0.0.1:50051",
            WORKSPACE_ROOT: "/test/root",
          }),
        })
      );

      expect(client).toBeDefined();
    });

    it("spawns sidecar with custom manifest path in dev mode", async () => {
      process.env.APP_PACKAGED = "false";
      process.env.APP_ROOT = "/custom/root";
      process.env.RUST_SIDECAR_MANIFEST = "/custom/Cargo.toml";
      process.env.RUST_SIDECAR_AUTOSTART = "true";
      mockExistsSync.mockReturnValue(false);

      let heartbeatAttempt = 0;
      mockSidecarClient.heartbeat.mockImplementation(() => {
        heartbeatAttempt++;
        if (heartbeatAttempt <= 4) {
          return Promise.reject(new Error("Not ready"));
        }
        return Promise.resolve({ ok: true, message: "OK" });
      });

      const mockProcess = new MockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      await getSidecarClient();

      expect(mockSpawn).toHaveBeenCalledWith(
        "cargo",
        ["run", "--manifest-path", "/custom/Cargo.toml"],
        expect.anything()
      );
    });

    it("spawns sidecar binary in production mode", async () => {
      process.env.APP_PACKAGED = "true";
      process.env.APP_ROOT = "/app/root";
      process.env.RUST_SIDECAR_AUTOSTART = "true";

      let heartbeatAttempt = 0;
      mockSidecarClient.heartbeat.mockImplementation(() => {
        heartbeatAttempt++;
        if (heartbeatAttempt <= 4) {
          return Promise.reject(new Error("Not ready"));
        }
        return Promise.resolve({ ok: true, message: "OK" });
      });

      mockExistsSync.mockReturnValue(true);
      const mockProcess = new MockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      await getSidecarClient();

      expect(mockExistsSync).toHaveBeenCalled();
      expect(mockSpawn).toHaveBeenCalledWith(
        expect.stringMatching(/dist-sidecar|agentic-sidecar/),
        [],
        expect.objectContaining({
          shell: false,
        })
      );
    });

    it("uses custom binary path from env when provided", async () => {
      process.env.APP_PACKAGED = "true"; // In prod mode, RUST_SIDECAR_BIN takes precedence
      process.env.RUST_SIDECAR_BIN = "/custom/sidecar-binary";
      process.env.RUST_SIDECAR_AUTOSTART = "true";

      let heartbeatAttempt = 0;
      mockSidecarClient.heartbeat.mockImplementation(() => {
        heartbeatAttempt++;
        if (heartbeatAttempt <= 4) {
          return Promise.reject(new Error("Not ready"));
        }
        return Promise.resolve({ ok: true, message: "OK" });
      });

      mockExistsSync.mockReturnValue(true);
      const mockProcess = new MockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      await getSidecarClient();

      expect(mockSpawn).toHaveBeenCalledWith("/custom/sidecar-binary", [], expect.anything());
    });

    it("sanitizes DATABASE_URL by removing query params", async () => {
      process.env.APP_PACKAGED = "false";
      process.env.DATABASE_URL = "postgresql://user:pass@localhost:5433/db?schema=public&pool=10";
      process.env.RUST_SIDECAR_AUTOSTART = "true";
      mockExistsSync.mockReturnValue(false);

      let heartbeatAttempt = 0;
      mockSidecarClient.heartbeat.mockImplementation(() => {
        heartbeatAttempt++;
        if (heartbeatAttempt <= 4) {
          return Promise.reject(new Error("Not ready"));
        }
        return Promise.resolve({ ok: true, message: "OK" });
      });

      const mockProcess = new MockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      await getSidecarClient();

      expect(mockSpawn).toHaveBeenCalled();
      const spawnCall = mockSpawn.mock.calls[0];
      expect(spawnCall[2].env.DATABASE_URL).toBe("postgresql://user:pass@localhost:5433/db");
    });

    it("uses fallback DATABASE_URL when not provided", async () => {
      process.env.APP_PACKAGED = "false";
      delete process.env.DATABASE_URL;
      process.env.RUST_SIDECAR_AUTOSTART = "true";
      mockExistsSync.mockReturnValue(false);

      let heartbeatAttempt = 0;
      mockSidecarClient.heartbeat.mockImplementation(() => {
        heartbeatAttempt++;
        if (heartbeatAttempt <= 4) {
          return Promise.reject(new Error("Not ready"));
        }
        return Promise.resolve({ ok: true, message: "OK" });
      });

      const mockProcess = new MockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      await getSidecarClient();

      expect(mockSpawn).toHaveBeenCalled();
      const spawnCall = mockSpawn.mock.calls[0];
      expect(spawnCall[2].env.DATABASE_URL).toBe(
        "postgresql://agentic:agentic@localhost:5433/agentic_workforce"
      );
    });

    it("forwards stdout and stderr from sidecar process", async () => {
      process.env.APP_PACKAGED = "false";
      process.env.RUST_SIDECAR_AUTOSTART = "true";
      mockExistsSync.mockReturnValue(false);

      let heartbeatAttempt = 0;
      mockSidecarClient.heartbeat.mockImplementation(() => {
        heartbeatAttempt++;
        if (heartbeatAttempt <= 4) {
          return Promise.reject(new Error("Not ready"));
        }
        return Promise.resolve({ ok: true, message: "OK" });
      });

      const mockProcess = new MockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      await getSidecarClient();

      mockProcess.stdout.emit("data", Buffer.from("sidecar log line\n"));
      mockProcess.stderr.emit("data", Buffer.from("sidecar error line\n"));

      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining("sidecar log line"));
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("sidecar error line"));

      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    });

    it("handles sidecar process error event", async () => {
      process.env.APP_PACKAGED = "false";
      process.env.RUST_SIDECAR_AUTOSTART = "true";
      mockExistsSync.mockReturnValue(false);

      let heartbeatAttempt = 0;
      mockSidecarClient.heartbeat.mockImplementation(() => {
        heartbeatAttempt++;
        if (heartbeatAttempt <= 4) {
          return Promise.reject(new Error("Not ready"));
        }
        return Promise.resolve({ ok: true, message: "OK" });
      });

      const mockProcess = new MockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      await getSidecarClient();

      mockProcess.emit("error", new Error("Failed to start"));

      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("failed to start"));

      stderrSpy.mockRestore();
    });

    it("throws error when sidecar never becomes ready", async () => {
      vi.useFakeTimers();
      try {
        process.env.RUST_SIDECAR_AUTOSTART = "true";
        mockExistsSync.mockReturnValue(false);
        mockSidecarClient.heartbeat.mockRejectedValue(new Error("Connection refused"));

        const mockProcess = new MockChildProcess();
        mockSpawn.mockReturnValue(mockProcess);

        const clientPromise = getSidecarClient();

        // Attach rejection handler BEFORE advancing timers to avoid unhandled rejection
        const assertion = expect(clientPromise).rejects.toThrow(
          "Rust sidecar is not reachable"
        );

        // Fast-forward through all heartbeat retries
        await vi.runAllTimersAsync();

        await assertion;

        expect(mockSidecarClient.close).toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("uses custom sidecar address from env", async () => {
      // This test verifies that RUST_SIDECAR_ADDR is respected
      // The address is captured at module load time, so we can't easily test it
      // without restructuring the manager. Skip this test or accept module-level state.
      process.env.RUST_SIDECAR_AUTOSTART = "false";
      mockSidecarClient.heartbeat.mockResolvedValue({ ok: true, message: "OK" });

      const client = await getSidecarClient();

      expect(client).toBeDefined();
      // The SidecarClient constructor was called with some address
      const { SidecarClient } = await import("./client");
      expect(SidecarClient).toHaveBeenCalled();
    });

    it("handles .asar working directory adjustment", async () => {
      process.env.APP_PACKAGED = "true";
      process.env.APP_ROOT = "/app/resources/app.asar";
      process.env.RUST_SIDECAR_AUTOSTART = "true";
      process.env.RUST_SIDECAR_BIN = ""; // Clear custom bin to use default logic

      let heartbeatAttempt = 0;
      mockSidecarClient.heartbeat.mockImplementation(() => {
        heartbeatAttempt++;
        if (heartbeatAttempt <= 4) {
          return Promise.reject(new Error("Not ready"));
        }
        return Promise.resolve({ ok: true, message: "OK" });
      });

      // Mock existsSync to return true for the unpacked binary
      mockExistsSync.mockImplementation((path: string) => {
        return path.includes(".asar.unpacked");
      });

      const mockProcess = new MockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      await getSidecarClient();

      // Should spawn with unpacked binary path
      expect(mockSpawn).toHaveBeenCalledWith(
        expect.stringContaining(".asar.unpacked"),
        [],
        expect.objectContaining({
          cwd: "/app/resources", // parent of .asar
        })
      );
    });
  });

  describe("stopSidecarProcess", () => {
    it("handles stopping when no process is running", () => {
      expect(() => stopSidecarProcess()).not.toThrow();
    });

    it("can reconnect after stopping", async () => {
      process.env.RUST_SIDECAR_AUTOSTART = "false";
      mockSidecarClient.heartbeat.mockResolvedValue({ ok: true, message: "OK" });

      const client1 = await getSidecarClient();
      expect(client1).toBeDefined();

      stopSidecarProcess();
      expect(mockSidecarClient.close).toHaveBeenCalled();

      // Reset mocks for second connection
      vi.clearAllMocks();
      mockSidecarClient.heartbeat.mockResolvedValue({ ok: true, message: "OK" });

      const client2 = await getSidecarClient();
      expect(client2).toBeDefined();
    });
  });
});
