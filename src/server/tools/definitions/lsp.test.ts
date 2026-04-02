import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolContext } from "../types";

// Mock LSP dependencies before importing the tools
vi.mock("../../lsp/sharedClient", () => {
  const mockClient = {
    startServer: vi.fn(async () => {}),
    getDiagnostics: vi.fn(async () => []),
    getDefinition: vi.fn(async () => null),
    getReferences: vi.fn(async () => []),
    getDocumentSymbols: vi.fn(async () => []),
    stopAll: vi.fn(async () => {}),
  };
  return {
    getSharedLspClient: vi.fn(() => mockClient),
    shutdownSharedLspClient: vi.fn(async () => {}),
    __mockClient: mockClient,
  };
});

vi.mock("../../lsp/serverConfigs", () => ({
  getServerConfigForFile: vi.fn((filePath: string) => {
    if (filePath.endsWith(".ts") || filePath.endsWith(".tsx")) {
      return { language: "typescript", command: ["typescript-language-server"] };
    }
    if (filePath.endsWith(".py")) {
      return { language: "python", command: ["pylsp"] };
    }
    return null;
  }),
}));

import {
  lspTools,
  lspDiagnosticsTool,
  lspDefinitionTool,
  lspReferencesTool,
  lspSymbolsTool,
} from "./lsp";
import { getSharedLspClient } from "../../lsp/sharedClient";

function getMockClient() {
  return getSharedLspClient() as unknown as {
    startServer: ReturnType<typeof vi.fn>;
    getDiagnostics: ReturnType<typeof vi.fn>;
    getDefinition: ReturnType<typeof vi.fn>;
    getReferences: ReturnType<typeof vi.fn>;
    getDocumentSymbols: ReturnType<typeof vi.fn>;
  };
}

describe("LSP tool definitions", () => {
  let mockContext: ToolContext;

  beforeEach(() => {
    vi.clearAllMocks();

    mockContext = {
      runId: "test-run",
      repoId: "test-repo",
      ticketId: "test-ticket",
      worktreePath: "/tmp/test-project",
      actor: "agent:coder_default",
      stage: "build",
      conversationHistory: [],
      createApproval: vi.fn(async () => ({ id: "approval-1" })),
      recordEvent: vi.fn(async () => {}),
    };
  });

  describe("lspTools array", () => {
    it("exports 4 tools", () => {
      expect(lspTools).toHaveLength(4);
    });

    it("each tool has alwaysLoad: false (deferred)", () => {
      for (const tool of lspTools) {
        expect(tool.alwaysLoad).toBe(false);
      }
    });
  });

  describe("lsp_diagnostics", () => {
    it("has correct name and permission metadata", () => {
      expect(lspDiagnosticsTool.name).toBe("lsp_diagnostics");
      expect(lspDiagnosticsTool.permission.scope).toBe("repo.verify");
      expect(lspDiagnosticsTool.permission.readOnly).toBe(true);
    });

    it("returns clean message when no diagnostics found", async () => {
      const client = getMockClient();
      client.getDiagnostics.mockResolvedValue([]);

      const result = await lspDiagnosticsTool.execute(
        { path: "/tmp/test-project/src/index.ts" },
        mockContext,
      );

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toContain("No diagnostics found");
        expect(result.metadata?.diagnosticsCount).toBe(0);
      }
    });

    it("formats diagnostics grouped by severity", async () => {
      const client = getMockClient();
      client.getDiagnostics.mockResolvedValue([
        { severity: "error", line: 5, character: 10, message: "Type mismatch", source: "ts" },
        { severity: "warning", line: 12, character: 0, message: "Unused variable", source: "ts" },
        { severity: "error", line: 20, character: 3, message: "Missing return", source: "ts" },
        { severity: "hint", line: 1, character: 0, message: "Consider const", source: "ts" },
      ]);

      const result = await lspDiagnosticsTool.execute(
        { path: "/tmp/test-project/src/index.ts" },
        mockContext,
      );

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toContain("Errors (2):");
        expect(result.content).toContain("Warnings (1):");
        expect(result.content).toContain("Hints (1):");
        expect(result.content).toContain("Type mismatch");
        expect(result.content).toContain("Line 6"); // 0-indexed + 1
        expect(result.metadata?.errorCount).toBe(2);
        expect(result.metadata?.warningCount).toBe(1);
        expect(result.metadata?.hintCount).toBe(1);
      }
    });

    it("returns error for unsupported file type", async () => {
      const result = await lspDiagnosticsTool.execute(
        { path: "/tmp/test-project/data.csv" },
        mockContext,
      );

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error).toContain("No LSP server configured");
      }
    });

    it("handles LSP client throwing an error", async () => {
      const client = getMockClient();
      client.getDiagnostics.mockRejectedValue(new Error("Connection lost"));

      const result = await lspDiagnosticsTool.execute(
        { path: "/tmp/test-project/src/index.ts" },
        mockContext,
      );

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error).toContain("LSP diagnostics failed");
        expect(result.error).toContain("Connection lost");
      }
    });
  });

  describe("lsp_definition", () => {
    it("has correct name and permission metadata", () => {
      expect(lspDefinitionTool.name).toBe("lsp_definition");
      expect(lspDefinitionTool.permission.scope).toBe("repo.read");
      expect(lspDefinitionTool.permission.readOnly).toBe(true);
    });

    it("returns location when definition is found", async () => {
      const client = getMockClient();
      client.getDefinition.mockResolvedValue({
        file: "/tmp/test-project/src/utils.ts",
        line: 42,
        character: 16,
      });

      const result = await lspDefinitionTool.execute(
        { path: "/tmp/test-project/src/index.ts", line: 10, character: 5 },
        mockContext,
      );

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toContain("Definition found");
        expect(result.content).toContain("/tmp/test-project/src/utils.ts");
        expect(result.content).toContain("Line: 43"); // 0-indexed + 1
        expect(result.metadata?.found).toBe(true);
        expect(result.metadata?.location).toEqual({
          file: "/tmp/test-project/src/utils.ts",
          line: 42,
          character: 16,
        });
      }
    });

    it("handles no definition found", async () => {
      const client = getMockClient();
      client.getDefinition.mockResolvedValue(null);

      const result = await lspDefinitionTool.execute(
        { path: "/tmp/test-project/src/index.ts", line: 10, character: 5 },
        mockContext,
      );

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toContain("No definition found");
        expect(result.metadata?.found).toBe(false);
      }
    });
  });

  describe("lsp_references", () => {
    it("has correct name and permission metadata", () => {
      expect(lspReferencesTool.name).toBe("lsp_references");
      expect(lspReferencesTool.permission.scope).toBe("repo.read");
      expect(lspReferencesTool.permission.readOnly).toBe(true);
    });

    it("returns locations when references are found", async () => {
      const client = getMockClient();
      client.getReferences.mockResolvedValue([
        { file: "/tmp/test-project/src/a.ts", line: 3, character: 0 },
        { file: "/tmp/test-project/src/b.ts", line: 15, character: 8 },
      ]);

      const result = await lspReferencesTool.execute(
        { path: "/tmp/test-project/src/index.ts", line: 10, character: 5 },
        mockContext,
      );

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toContain("Found 2 reference(s)");
        expect(result.content).toContain("/tmp/test-project/src/a.ts:4:1");
        expect(result.content).toContain("/tmp/test-project/src/b.ts:16:9");
        expect(result.metadata?.referencesCount).toBe(2);
      }
    });

    it("handles no references found", async () => {
      const client = getMockClient();
      client.getReferences.mockResolvedValue([]);

      const result = await lspReferencesTool.execute(
        { path: "/tmp/test-project/src/index.ts", line: 10, character: 5 },
        mockContext,
      );

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toContain("No references found");
        expect(result.metadata?.referencesCount).toBe(0);
      }
    });
  });

  describe("lsp_symbols", () => {
    it("has correct name and permission metadata", () => {
      expect(lspSymbolsTool.name).toBe("lsp_symbols");
      expect(lspSymbolsTool.permission.scope).toBe("repo.read");
      expect(lspSymbolsTool.permission.readOnly).toBe(true);
    });

    it("returns symbols grouped by kind", async () => {
      const client = getMockClient();
      client.getDocumentSymbols.mockResolvedValue([
        { name: "MyClass", kind: "Class", line: 5 },
        { name: "myFunction", kind: "Function", line: 20 },
        { name: "helperFunction", kind: "Function", line: 35 },
        { name: "MAX_SIZE", kind: "Variable", line: 1 },
      ]);

      const result = await lspSymbolsTool.execute(
        { path: "/tmp/test-project/src/index.ts" },
        mockContext,
      );

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toContain("Class (1):");
        expect(result.content).toContain("MyClass (line 6)");
        expect(result.content).toContain("Function (2):");
        expect(result.content).toContain("myFunction (line 21)");
        expect(result.content).toContain("Variable (1):");
        expect(result.metadata?.symbolCount).toBe(4);
      }
    });

    it("handles no symbols found", async () => {
      const client = getMockClient();
      client.getDocumentSymbols.mockResolvedValue([]);

      const result = await lspSymbolsTool.execute(
        { path: "/tmp/test-project/src/index.ts" },
        mockContext,
      );

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toContain("No symbols found");
        expect(result.metadata?.symbolCount).toBe(0);
      }
    });

    it("handles LSP client error", async () => {
      const client = getMockClient();
      client.getDocumentSymbols.mockRejectedValue(new Error("Server crashed"));

      const result = await lspSymbolsTool.execute(
        { path: "/tmp/test-project/src/index.ts" },
        mockContext,
      );

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error).toContain("LSP symbols lookup failed");
        expect(result.error).toContain("Server crashed");
      }
    });
  });
});
