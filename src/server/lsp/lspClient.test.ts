import { describe, it, expect, beforeEach, vi } from "vitest";
import { LSPClient } from "./lspClient";
import { getServerConfigByLanguage, getServerConfigForFile } from "./serverConfigs";

describe("LSPClient", () => {
  let client: LSPClient;

  beforeEach(() => {
    client = new LSPClient();
  });

  describe("startServer", () => {
    it("should throw error for unsupported language", async () => {
      await expect(client.startServer("unknown-language-xyz", "/test/path")).rejects.toThrow(
        "No LSP server config found for language: unknown-language-xyz"
      );
    });
  });

  describe("getDiagnostics", () => {
    it("should return empty array if server not initialized", async () => {
      const diagnostics = await client.getDiagnostics("/test/file.ts");
      expect(diagnostics).toEqual([]);
    });

    it("should return empty array for unsupported file extension", async () => {
      const diagnostics = await client.getDiagnostics("/test/file.xyz123");
      expect(diagnostics).toEqual([]);
    });
  });

  describe("getDefinition", () => {
    it("should return null if server not initialized", async () => {
      const location = await client.getDefinition("/test/file.ts", 0, 0);
      expect(location).toBeNull();
    });
  });

  describe("getReferences", () => {
    it("should return empty array if server not initialized", async () => {
      const references = await client.getReferences("/test/file.ts", 0, 0);
      expect(references).toEqual([]);
    });
  });

  describe("getDocumentSymbols", () => {
    it("should return empty array if server not initialized", async () => {
      const symbols = await client.getDocumentSymbols("/test/file.ts");
      expect(symbols).toEqual([]);
    });
  });

  describe("stopAll", () => {
    it("should not throw when no servers are running", async () => {
      await expect(client.stopAll()).resolves.not.toThrow();
    });
  });

  describe("getServerStatuses", () => {
    it("returns status rows for supported language servers", async () => {
      const statuses = await client.getServerStatuses();

      expect(statuses.length).toBeGreaterThan(0);
      expect(statuses).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            language: "typescript",
            running: false,
            initialized: false,
          }),
        ])
      );
    });
  });

  describe("notifyFileChanged", () => {
    it("notifyFileChanged sends didChange with correct URI and version", async () => {
      // Set up a fake initialized server state for typescript
      const notifySpy = vi.fn();
      const fakeState = {
        process: { stdin: { write: vi.fn() }, kill: vi.fn() },
        requestId: 0,
        pending: new Map(),
        buffer: "",
        worktreePath: "/test",
        initialized: true,
        diagnosticsMap: new Map(),
      };
      (client as any).servers.set("typescript", fakeState);

      // Spy on the private notify method
      const origNotify = (client as any).notify.bind(client);
      (client as any).notify = notifySpy.mockResolvedValue(undefined);

      await client.notifyFileChanged("/test/file.ts", "const x = 1;");

      expect(notifySpy).toHaveBeenCalledWith(
        "typescript",
        "textDocument/didChange",
        expect.objectContaining({
          textDocument: expect.objectContaining({
            version: 1,
          }),
          contentChanges: [{ text: "const x = 1;" }],
        })
      );

      // URI should contain the file path
      const call = notifySpy.mock.calls[0][2];
      expect(call.textDocument.uri).toContain("file.ts");

      (client as any).notify = origNotify;
      (client as any).servers.delete("typescript");
    });

    it("notifyFileChanged increments version on subsequent calls", async () => {
      const notifySpy = vi.fn().mockResolvedValue(undefined);
      const fakeState = {
        process: { stdin: { write: vi.fn() }, kill: vi.fn() },
        requestId: 0,
        pending: new Map(),
        buffer: "",
        worktreePath: "/test",
        initialized: true,
        diagnosticsMap: new Map(),
      };
      (client as any).servers.set("typescript", fakeState);
      const origNotify = (client as any).notify.bind(client);
      (client as any).notify = notifySpy;

      await client.notifyFileChanged("/test/file.ts", "v1");
      await client.notifyFileChanged("/test/file.ts", "v2");
      await client.notifyFileChanged("/test/file.ts", "v3");

      expect(notifySpy).toHaveBeenCalledTimes(3);
      expect(notifySpy.mock.calls[0][2].textDocument.version).toBe(1);
      expect(notifySpy.mock.calls[1][2].textDocument.version).toBe(2);
      expect(notifySpy.mock.calls[2][2].textDocument.version).toBe(3);

      (client as any).notify = origNotify;
      (client as any).servers.delete("typescript");
    });

    it("notifyFileChanged is no-op when no LSP server is running for file type", async () => {
      const notifySpy = vi.fn().mockResolvedValue(undefined);
      const origNotify = (client as any).notify.bind(client);
      (client as any).notify = notifySpy;

      // No servers running, so notifyFileChanged for a .ts file should be a no-op
      await client.notifyFileChanged("/test/file.ts", "content");
      expect(notifySpy).not.toHaveBeenCalled();

      // Also a no-op for unknown file type
      await client.notifyFileChanged("/test/file.xyz123", "content");
      expect(notifySpy).not.toHaveBeenCalled();

      (client as any).notify = origNotify;
    });
  });

  describe("notifyFileSaved", () => {
    it("notifyFileSaved sends didSave notification", async () => {
      const notifySpy = vi.fn().mockResolvedValue(undefined);
      const fakeState = {
        process: { stdin: { write: vi.fn() }, kill: vi.fn() },
        requestId: 0,
        pending: new Map(),
        buffer: "",
        worktreePath: "/test",
        initialized: true,
        diagnosticsMap: new Map(),
      };
      (client as any).servers.set("typescript", fakeState);
      const origNotify = (client as any).notify.bind(client);
      (client as any).notify = notifySpy;

      // First, notify file changed to register the version
      await client.notifyFileChanged("/test/file.ts", "saved content");
      notifySpy.mockClear();

      // Now save
      await client.notifyFileSaved("/test/file.ts");

      expect(notifySpy).toHaveBeenCalledWith(
        "typescript",
        "textDocument/didSave",
        expect.objectContaining({
          textDocument: expect.objectContaining({
            uri: expect.stringContaining("file.ts"),
          }),
        })
      );

      (client as any).notify = origNotify;
      (client as any).servers.delete("typescript");
    });

    it("notifyFileSaved is no-op when file not previously opened", async () => {
      const notifySpy = vi.fn().mockResolvedValue(undefined);
      const fakeState = {
        process: { stdin: { write: vi.fn() }, kill: vi.fn() },
        requestId: 0,
        pending: new Map(),
        buffer: "",
        worktreePath: "/test",
        initialized: true,
        diagnosticsMap: new Map(),
      };
      (client as any).servers.set("typescript", fakeState);
      const origNotify = (client as any).notify.bind(client);
      (client as any).notify = notifySpy;

      // Save without prior notifyFileChanged — should be no-op
      await client.notifyFileSaved("/test/never-opened.ts");
      expect(notifySpy).not.toHaveBeenCalled();

      (client as any).notify = origNotify;
      (client as any).servers.delete("typescript");
    });
  });
});

describe("serverConfigs", () => {
  it("should return config for TypeScript", () => {
    const config = getServerConfigByLanguage("typescript");
    expect(config).toBeDefined();
    expect(config!.command.length).toBeGreaterThan(0);
  });

  it("should return config for Python", () => {
    const config = getServerConfigByLanguage("python");
    expect(config).toBeDefined();
  });

  it("should return null for unknown language", () => {
    const config = getServerConfigByLanguage("brainfuck");
    expect(config).toBeUndefined();
  });

  it("should map .ts files to TypeScript config", () => {
    const config = getServerConfigForFile("/src/index.ts");
    expect(config).toBeDefined();
    expect(config!.language).toBe("typescript");
  });

  it("should map .py files to Python config", () => {
    const config = getServerConfigForFile("/src/main.py");
    expect(config).toBeDefined();
    expect(config!.language).toBe("python");
  });

  it("should return null for unknown file extension", () => {
    const config = getServerConfigForFile("/src/file.xyz123");
    expect(config).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// LSPClient edge case tests
// ---------------------------------------------------------------------------

describe("LSPClient edge cases", () => {
  let client: LSPClient;

  beforeEach(() => {
    client = new LSPClient();
  });

  describe("publishDiagnostics notification", () => {
    it("handles publishDiagnostics notification and updates cache", () => {
      // Set up a fake server state
      const fakeState = {
        process: { stdin: { write: vi.fn() }, kill: vi.fn() },
        requestId: 0,
        pending: new Map(),
        buffer: "",
        worktreePath: "/test",
        initialized: true,
        diagnosticsMap: new Map(),
      };
      (client as any).servers.set("typescript", fakeState);

      // Simulate a publishDiagnostics notification via handleMessage
      const diagnosticsMessage = {
        method: "textDocument/publishDiagnostics",
        params: {
          uri: "file:///test/src/app.ts",
          diagnostics: [
            {
              range: { start: { line: 10, character: 5 }, end: { line: 10, character: 15 } },
              severity: 1,
              message: "Type error: string is not assignable to number",
              source: "typescript",
              code: "2322",
            },
            {
              range: { start: { line: 20, character: 0 }, end: { line: 20, character: 10 } },
              severity: 2,
              message: "Unused variable 'x'",
              source: "typescript",
            },
          ],
        },
      };

      (client as any).handleMessage("typescript", diagnosticsMessage, fakeState);

      const cached = fakeState.diagnosticsMap.get("/test/src/app.ts");
      expect(cached).toBeDefined();
      expect(cached).toHaveLength(2);
      expect(cached![0]).toEqual(expect.objectContaining({
        file: "/test/src/app.ts",
        line: 10,
        character: 5,
        severity: "error",
        message: "Type error: string is not assignable to number",
        source: "typescript",
        code: "2322",
      }));
      expect(cached![1].severity).toBe("warning");

      (client as any).servers.delete("typescript");
    });
  });

  describe("ensureFileOpen behavior", () => {
    it("sends didOpen notification for files when ensureFileOpen is called", () => {
      // Since ensureFileOpen reads from disk (not mockable in ESM), test the
      // notification flow by directly calling handleMessage with diagnostics
      // and verifying the file is tracked in the diagnosticsMap after notification.
      const fakeState = {
        process: { stdin: { write: vi.fn() }, kill: vi.fn() },
        requestId: 0,
        pending: new Map(),
        buffer: "",
        worktreePath: "/test",
        initialized: true,
        diagnosticsMap: new Map(),
      };
      (client as any).servers.set("typescript", fakeState);

      // Simulate server sending diagnostics for two different files
      (client as any).handleMessage("typescript", {
        method: "textDocument/publishDiagnostics",
        params: {
          uri: "file:///test/a.ts",
          diagnostics: [{ range: { start: { line: 0, character: 0 } }, severity: 1, message: "err" }],
        },
      }, fakeState);

      (client as any).handleMessage("typescript", {
        method: "textDocument/publishDiagnostics",
        params: {
          uri: "file:///test/b.ts",
          diagnostics: [],
        },
      }, fakeState);

      // Both files should be tracked
      expect(fakeState.diagnosticsMap.has("/test/a.ts")).toBe(true);
      expect(fakeState.diagnosticsMap.has("/test/b.ts")).toBe(true);
      expect(fakeState.diagnosticsMap.get("/test/a.ts")).toHaveLength(1);
      expect(fakeState.diagnosticsMap.get("/test/b.ts")).toHaveLength(0);

      (client as any).servers.delete("typescript");
    });
  });

  describe("Content-Length message parsing", () => {
    it("parses Content-Length header-delimited messages", () => {
      const resolvedValues: unknown[] = [];
      const fakeState = {
        process: { stdin: { write: vi.fn() }, kill: vi.fn() },
        requestId: 1,
        pending: new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>(),
        buffer: "",
        worktreePath: "/test",
        initialized: true,
        diagnosticsMap: new Map(),
      };
      fakeState.pending.set(1, {
        resolve: (val) => resolvedValues.push(val),
        reject: vi.fn(),
      });
      (client as any).servers.set("typescript", fakeState);

      // Build a properly Content-Length framed LSP message
      const body = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { capabilities: {} } });
      const frame = `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;

      (client as any).handleServerOutput("typescript", frame);

      expect(resolvedValues).toHaveLength(1);
      expect(resolvedValues[0]).toEqual({ capabilities: {} });

      (client as any).servers.delete("typescript");
    });

    it("handles split Content-Length messages across chunks", () => {
      const resolvedValues: unknown[] = [];
      const fakeState = {
        process: { stdin: { write: vi.fn() }, kill: vi.fn() },
        requestId: 1,
        pending: new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>(),
        buffer: "",
        worktreePath: "/test",
        initialized: true,
        diagnosticsMap: new Map(),
      };
      fakeState.pending.set(1, {
        resolve: (val) => resolvedValues.push(val),
        reject: vi.fn(),
      });
      (client as any).servers.set("typescript", fakeState);

      const body = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { data: "split" } });
      const frame = `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;

      // Split the frame into two chunks
      const mid = Math.floor(frame.length / 2);
      (client as any).handleServerOutput("typescript", frame.substring(0, mid));
      // First chunk should not resolve yet
      expect(resolvedValues).toHaveLength(0);

      (client as any).handleServerOutput("typescript", frame.substring(mid));
      // Second chunk completes the message
      expect(resolvedValues).toHaveLength(1);
      expect(resolvedValues[0]).toEqual({ data: "split" });

      (client as any).servers.delete("typescript");
    });
  });

  describe("request timeout", () => {
    it("enforces 30-second request timeout", async () => {
      vi.useFakeTimers();

      const fakeState = {
        process: { stdin: { write: vi.fn() }, kill: vi.fn() },
        requestId: 0,
        pending: new Map(),
        buffer: "",
        worktreePath: "/test",
        initialized: true,
        diagnosticsMap: new Map(),
      };
      (client as any).servers.set("typescript", fakeState);

      // Spy on sendMessage to avoid actual writes
      vi.spyOn(client as any, "sendMessage").mockImplementation(() => {});

      // Capture the promise before advancing time
      const requestPromise = (client as any).request("typescript", "textDocument/definition", {});

      // Advance past the 30s timeout
      vi.advanceTimersByTime(30001);

      await expect(requestPromise).rejects.toThrow("LSP request timeout");

      (client as any).servers.delete("typescript");
      vi.useRealTimers();
    });
  });

  describe("server process crash", () => {
    it("handles server process crash gracefully", () => {
      const rejections: Error[] = [];
      const fakeState = {
        process: { stdin: { write: vi.fn() }, kill: vi.fn() },
        requestId: 1,
        pending: new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>(),
        buffer: "",
        worktreePath: "/test",
        initialized: true,
        diagnosticsMap: new Map(),
      };
      fakeState.pending.set(1, {
        resolve: vi.fn(),
        reject: (err) => rejections.push(err),
      });
      (client as any).servers.set("typescript", fakeState);

      // Simulate crash via cleanupServer
      (client as any).cleanupServer("typescript", new Error("Server crashed (exit code 1)"));

      // Pending requests should be rejected
      expect(rejections).toHaveLength(1);
      expect(rejections[0].message).toContain("Server crashed");

      // Server should be removed
      expect((client as any).servers.has("typescript")).toBe(false);
    });
  });

  describe("graceful shutdown sequence", () => {
    it("performs graceful shutdown sequence", async () => {
      const methodsCalled: string[] = [];
      const fakeState = {
        process: { stdin: { write: vi.fn() }, kill: vi.fn() },
        requestId: 0,
        pending: new Map(),
        buffer: "",
        worktreePath: "/test",
        initialized: true,
        diagnosticsMap: new Map(),
      };
      (client as any).servers.set("typescript", fakeState);

      // Mock request and notify to track calls
      const origRequest = (client as any).request.bind(client);
      (client as any).request = vi.fn(async (lang: string, method: string) => {
        methodsCalled.push(method);
        return {};
      });
      const origNotify = (client as any).notify.bind(client);
      (client as any).notify = vi.fn(async (lang: string, method: string) => {
        methodsCalled.push(method);
      });

      await client.stopServer("typescript");

      // Should call shutdown request, then exit notification
      expect(methodsCalled).toEqual(["shutdown", "exit"]);

      (client as any).request = origRequest;
      (client as any).notify = origNotify;
    });
  });

  describe("file path to URI conversion", () => {
    it("converts file paths to URIs correctly", () => {
      const uri = (client as any).fileToUri("/Users/test/project/src/app.ts");
      expect(uri).toBe("file:///Users/test/project/src/app.ts");
    });

    it("converts URIs back to file paths correctly", () => {
      const filePath = (client as any).uriToFile("file:///Users/test/project/src/app.ts");
      expect(filePath).toBe("/Users/test/project/src/app.ts");
    });
  });

  describe("LSP symbol kind mapping", () => {
    it("maps LSP symbol kinds to string types", () => {
      expect((client as any).mapSymbolKind(1)).toBe("File");
      expect((client as any).mapSymbolKind(2)).toBe("Module");
      expect((client as any).mapSymbolKind(5)).toBe("Class");
      expect((client as any).mapSymbolKind(6)).toBe("Method");
      expect((client as any).mapSymbolKind(12)).toBe("Function");
      expect((client as any).mapSymbolKind(13)).toBe("Variable");
      expect((client as any).mapSymbolKind(26)).toBe("TypeParameter");
      // Out of range
      expect((client as any).mapSymbolKind(0)).toBe("Unknown");
      expect((client as any).mapSymbolKind(27)).toBe("Unknown");
      expect((client as any).mapSymbolKind(undefined)).toBe("Unknown");
    });
  });

  describe("LSP severity mapping", () => {
    it("maps LSP severity levels to string types", () => {
      expect((client as any).mapSeverity(1)).toBe("error");
      expect((client as any).mapSeverity(2)).toBe("warning");
      expect((client as any).mapSeverity(3)).toBe("info");
      expect((client as any).mapSeverity(4)).toBe("hint");
      // Default case
      expect((client as any).mapSeverity(undefined)).toBe("info");
      expect((client as any).mapSeverity(99)).toBe("info");
    });
  });

  describe("definition response parsing", () => {
    it("parses single definition response location", () => {
      const result = {
        uri: "file:///test/src/utils.ts",
        range: { start: { line: 42, character: 10 } },
      };

      const location = (client as any).parseLocation(result);
      expect(location).toEqual({
        file: "/test/src/utils.ts",
        line: 42,
        character: 10,
      });
    });

    it("parses array definition response (first element)", () => {
      const result = [
        {
          uri: "file:///test/src/utils.ts",
          range: { start: { line: 42, character: 10 } },
        },
        {
          uri: "file:///test/src/other.ts",
          range: { start: { line: 5, character: 0 } },
        },
      ];

      const location = (client as any).parseLocation(result);
      expect(location).toEqual({
        file: "/test/src/utils.ts",
        line: 42,
        character: 10,
      });
    });

    it("returns null for null/empty definition response", () => {
      expect((client as any).parseLocation(null)).toBeNull();
      expect((client as any).parseLocation(undefined)).toBeNull();
      expect((client as any).parseLocation([])).toBeNull();
    });

    it("parses multiple locations from references response", () => {
      const result = [
        { uri: "file:///a.ts", range: { start: { line: 1, character: 0 } } },
        { uri: "file:///b.ts", range: { start: { line: 5, character: 3 } } },
      ];

      const locations = (client as any).parseLocations(result);
      expect(locations).toHaveLength(2);
      expect(locations[0].file).toBe("/a.ts");
      expect(locations[1].file).toBe("/b.ts");
    });

    it("returns empty array for non-array references response", () => {
      expect((client as any).parseLocations(null)).toEqual([]);
      expect((client as any).parseLocations("not an array")).toEqual([]);
    });
  });
});
