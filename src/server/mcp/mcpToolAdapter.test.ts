import { describe, it, expect, beforeEach, vi } from "vitest";
import { z } from "zod";
import { MCPClient } from "./mcpClient";
import { MCPToolAdapter } from "./mcpToolAdapter";
import type { MCPToolDescriptor } from "./types";

vi.mock("../telemetry/tracer", () => ({
  getTelemetry: vi.fn().mockReturnValue({
    incrementCounter: vi.fn(),
  }),
}));

vi.mock("../telemetry/metrics", () => ({
  METRICS: { MCP_TOOL_CALL_COUNT: "mcp.tool_call.count" },
  METRIC_LABELS: { MCP_SERVER: "mcp_server", TOOL_NAME: "tool_name" },
}));

describe("MCPToolAdapter", () => {
  let client: MCPClient;
  let adapter: MCPToolAdapter;

  beforeEach(() => {
    client = new MCPClient();
    adapter = new MCPToolAdapter(client);
  });

  describe("wrapTool", () => {
    it("should wrap a simple MCP tool", () => {
      const descriptor: MCPToolDescriptor = {
        serverId: "test-server",
        name: "test_tool",
        description: "A test tool",
        inputSchema: {
          type: "object",
          properties: {
            message: { type: "string", description: "A message" },
          },
          required: ["message"],
        },
      };

      const wrapped = adapter.wrapTool(descriptor);

      expect(wrapped.name).toBe("mcp__test-server__test_tool");
      expect(wrapped.description).toBe("A test tool");
      expect(wrapped.permission.scope).toBe("meta");
      expect(wrapped.alwaysLoad).toBe(false);
      expect(wrapped.searchHints).toContain("test-server");
      expect(wrapped.searchHints).toContain("test_tool");
      expect(wrapped.searchHints).toContain("mcp");
      expect(wrapped.concurrencySafe).toBe(true);

      // Verify input schema parsing
      const parseResult = wrapped.inputSchema.safeParse({ message: "hello" });
      expect(parseResult.success).toBe(true);

      const invalidParse = wrapped.inputSchema.safeParse({});
      expect(invalidParse.success).toBe(false);
    });

    it("should handle missing description", () => {
      const descriptor: MCPToolDescriptor = {
        serverId: "test-server",
        name: "test_tool",
        description: "",
        inputSchema: { type: "object" },
      };

      const wrapped = adapter.wrapTool(descriptor);
      expect(wrapped.description).toBe("MCP tool: test_tool");
    });
  });

  describe("JSON Schema to Zod conversion", () => {
    const testConversion = (schema: Record<string, unknown>, validInput: unknown, invalidInput?: unknown) => {
      const descriptor: MCPToolDescriptor = {
        serverId: "test",
        name: "test",
        description: "test",
        inputSchema: schema,
      };
      const wrapped = adapter.wrapTool(descriptor);

      const validParse = wrapped.inputSchema.safeParse(validInput);
      expect(validParse.success).toBe(true);

      if (invalidInput !== undefined) {
        const invalidParse = wrapped.inputSchema.safeParse(invalidInput);
        expect(invalidParse.success).toBe(false);
      }
    };

    it("should convert string schemas", () => {
      testConversion(
        { type: "string" },
        "hello",
        123
      );
    });

    it("should convert number schemas", () => {
      testConversion(
        { type: "number" },
        42,
        "not a number"
      );
    });

    it("should convert integer schemas", () => {
      testConversion(
        { type: "integer" },
        42,
        42.5
      );
    });

    it("should convert boolean schemas", () => {
      testConversion(
        { type: "boolean" },
        true,
        "not a boolean"
      );
    });

    it("should convert array schemas", () => {
      testConversion(
        { type: "array", items: { type: "string" } },
        ["hello", "world"],
        [123, 456]
      );
    });

    it("should convert enum schemas", () => {
      testConversion(
        { type: "string", enum: ["one", "two", "three"] },
        "one",
        "four"
      );
    });

    it("should convert object schemas with required fields", () => {
      testConversion(
        {
          type: "object",
          properties: {
            name: { type: "string" },
            age: { type: "number" },
          },
          required: ["name"],
        },
        { name: "John", age: 30 },
        { age: 30 } // Missing required field
      );
    });

    it("should convert object schemas with optional fields", () => {
      testConversion(
        {
          type: "object",
          properties: {
            name: { type: "string" },
            age: { type: "number" },
          },
          required: ["name"],
        },
        { name: "John" } // age is optional
      );
    });

    it("should handle nested objects", () => {
      testConversion(
        {
          type: "object",
          properties: {
            person: {
              type: "object",
              properties: {
                name: { type: "string" },
                age: { type: "number" },
              },
              required: ["name"],
            },
          },
          required: ["person"],
        },
        { person: { name: "John", age: 30 } }
      );
    });

    it("should handle arrays of objects", () => {
      testConversion(
        {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "number" },
              name: { type: "string" },
            },
            required: ["id"],
          },
        },
        [
          { id: 1, name: "First" },
          { id: 2, name: "Second" },
        ]
      );
    });

    it("should handle string constraints", () => {
      const descriptor: MCPToolDescriptor = {
        serverId: "test",
        name: "test",
        description: "test",
        inputSchema: {
          type: "string",
          minLength: 3,
          maxLength: 10,
        },
      };
      const wrapped = adapter.wrapTool(descriptor);

      expect(wrapped.inputSchema.safeParse("hello").success).toBe(true);
      expect(wrapped.inputSchema.safeParse("hi").success).toBe(false); // Too short
      expect(wrapped.inputSchema.safeParse("hello world!").success).toBe(false); // Too long
    });

    it("should handle number constraints", () => {
      const descriptor: MCPToolDescriptor = {
        serverId: "test",
        name: "test",
        description: "test",
        inputSchema: {
          type: "number",
          minimum: 0,
          maximum: 100,
        },
      };
      const wrapped = adapter.wrapTool(descriptor);

      expect(wrapped.inputSchema.safeParse(50).success).toBe(true);
      expect(wrapped.inputSchema.safeParse(-1).success).toBe(false);
      expect(wrapped.inputSchema.safeParse(101).success).toBe(false);
    });

    it("should handle anyOf (union)", () => {
      testConversion(
        {
          anyOf: [
            { type: "string" },
            { type: "number" },
          ],
        },
        "hello"
      );

      testConversion(
        {
          anyOf: [
            { type: "string" },
            { type: "number" },
          ],
        },
        42
      );
    });

    it("should handle const values", () => {
      testConversion(
        { const: "exact_value" },
        "exact_value",
        "other_value"
      );
    });

    it("should handle null type", () => {
      testConversion(
        { type: "null" },
        null,
        "not null"
      );
    });

    it("should fallback to unknown for unsupported schemas", () => {
      const descriptor: MCPToolDescriptor = {
        serverId: "test",
        name: "test",
        description: "test",
        inputSchema: { type: "unknown_type" } as Record<string, unknown>,
      };
      const wrapped = adapter.wrapTool(descriptor);

      // Should accept anything
      expect(wrapped.inputSchema.safeParse("anything").success).toBe(true);
      expect(wrapped.inputSchema.safeParse(123).success).toBe(true);
      expect(wrapped.inputSchema.safeParse({}).success).toBe(true);
    });
  });

  describe("wrapAllTools", () => {
    it("should wrap multiple tools", () => {
      const descriptors: MCPToolDescriptor[] = [
        {
          serverId: "test-server",
          name: "tool1",
          description: "Tool 1",
          inputSchema: { type: "object" },
        },
        {
          serverId: "test-server",
          name: "tool2",
          description: "Tool 2",
          inputSchema: { type: "object" },
        },
      ];

      const wrapped = adapter.wrapAllTools("test-server", descriptors);

      expect(wrapped).toHaveLength(2);
      expect(wrapped[0].name).toBe("mcp__test-server__tool1");
      expect(wrapped[1].name).toBe("mcp__test-server__tool2");
    });

    it("should handle empty tool list", () => {
      const wrapped = adapter.wrapAllTools("test-server", []);
      expect(wrapped).toHaveLength(0);
    });
  });

  describe("wrapTool execute", () => {
    it("should execute tool and return string result as-is", async () => {
      const mockClient = {
        callTool: vi.fn().mockResolvedValue("hello from tool"),
      } as unknown as MCPClient;
      const adapterWithMock = new MCPToolAdapter(mockClient);

      const descriptor: MCPToolDescriptor = {
        serverId: "srv",
        name: "echo",
        description: "Echoes input",
        inputSchema: { type: "object" },
      };

      const wrapped = adapterWithMock.wrapTool(descriptor);
      const result = await wrapped.execute!({ message: "hi" }, {} as any);

      expect(result).toEqual({
        type: "success",
        content: "hello from tool",
      });
    });

    it("should execute tool and stringify non-string result", async () => {
      const mockClient = {
        callTool: vi.fn().mockResolvedValue({ data: 42 }),
      } as unknown as MCPClient;
      const adapterWithMock = new MCPToolAdapter(mockClient);

      const descriptor: MCPToolDescriptor = {
        serverId: "srv",
        name: "compute",
        description: "Computes",
        inputSchema: { type: "object" },
      };

      const wrapped = adapterWithMock.wrapTool(descriptor);
      const result = await wrapped.execute!({}, {} as any);

      expect(result).toEqual({
        type: "success",
        content: JSON.stringify({ data: 42 }, null, 2),
      });
    });

    it("should return error result when tool throws Error", async () => {
      const mockClient = {
        callTool: vi.fn().mockRejectedValue(new Error("connection lost")),
      } as unknown as MCPClient;
      const adapterWithMock = new MCPToolAdapter(mockClient);

      const descriptor: MCPToolDescriptor = {
        serverId: "srv",
        name: "flaky",
        description: "Flaky tool",
        inputSchema: { type: "object" },
      };

      const wrapped = adapterWithMock.wrapTool(descriptor);
      const result = await wrapped.execute!({}, {} as any);

      expect(result).toEqual({
        type: "error",
        error: "MCP tool flaky failed: connection lost",
      });
    });

    it("should return error result when tool throws non-Error", async () => {
      const mockClient = {
        callTool: vi.fn().mockRejectedValue("string error"),
      } as unknown as MCPClient;
      const adapterWithMock = new MCPToolAdapter(mockClient);

      const descriptor: MCPToolDescriptor = {
        serverId: "srv",
        name: "bad",
        description: "Bad tool",
        inputSchema: { type: "object" },
      };

      const wrapped = adapterWithMock.wrapTool(descriptor);
      const result = await wrapped.execute!({}, {} as any);

      expect(result).toEqual({
        type: "error",
        error: "MCP tool bad failed: string error",
      });
    });
  });

  describe("jsonSchemaToZod edge cases", () => {
    it("should handle null schema input", () => {
      const descriptor: MCPToolDescriptor = {
        serverId: "test",
        name: "test",
        description: "test",
        inputSchema: null as unknown as Record<string, unknown>,
      };
      const wrapped = adapter.wrapTool(descriptor);
      // Should accept anything (z.unknown())
      expect(wrapped.inputSchema.safeParse("anything").success).toBe(true);
      expect(wrapped.inputSchema.safeParse(123).success).toBe(true);
    });

    it("should handle non-object schema input (primitive)", () => {
      const descriptor: MCPToolDescriptor = {
        serverId: "test",
        name: "test",
        description: "test",
        inputSchema: "not an object" as unknown as Record<string, unknown>,
      };
      const wrapped = adapter.wrapTool(descriptor);
      expect(wrapped.inputSchema.safeParse("anything").success).toBe(true);
    });

    it("should handle string with pattern constraint", () => {
      const descriptor: MCPToolDescriptor = {
        serverId: "test",
        name: "test",
        description: "test",
        inputSchema: {
          type: "string",
          pattern: "^[a-z]+$",
        },
      };
      const wrapped = adapter.wrapTool(descriptor);
      expect(wrapped.inputSchema.safeParse("hello").success).toBe(true);
      expect(wrapped.inputSchema.safeParse("HELLO").success).toBe(false);
    });

    it("should handle string with invalid regex pattern gracefully", () => {
      const descriptor: MCPToolDescriptor = {
        serverId: "test",
        name: "test",
        description: "test",
        inputSchema: {
          type: "string",
          pattern: "[invalid",
        },
      };
      const wrapped = adapter.wrapTool(descriptor);
      // Should still work as string, just skip the bad regex
      expect(wrapped.inputSchema.safeParse("hello").success).toBe(true);
    });

    it("should handle string with description", () => {
      const descriptor: MCPToolDescriptor = {
        serverId: "test",
        name: "test",
        description: "test",
        inputSchema: {
          type: "string",
          description: "A descriptive string",
        },
      };
      const wrapped = adapter.wrapTool(descriptor);
      expect(wrapped.inputSchema.safeParse("hello").success).toBe(true);
    });

    it("should handle number with description", () => {
      const descriptor: MCPToolDescriptor = {
        serverId: "test",
        name: "test",
        description: "test",
        inputSchema: {
          type: "number",
          description: "A descriptive number",
        },
      };
      const wrapped = adapter.wrapTool(descriptor);
      expect(wrapped.inputSchema.safeParse(42).success).toBe(true);
    });

    it("should handle integer with minimum and maximum", () => {
      const descriptor: MCPToolDescriptor = {
        serverId: "test",
        name: "test",
        description: "test",
        inputSchema: {
          type: "integer",
          minimum: 1,
          maximum: 10,
          description: "An integer",
        },
      };
      const wrapped = adapter.wrapTool(descriptor);
      expect(wrapped.inputSchema.safeParse(5).success).toBe(true);
      expect(wrapped.inputSchema.safeParse(0).success).toBe(false);
      expect(wrapped.inputSchema.safeParse(11).success).toBe(false);
      expect(wrapped.inputSchema.safeParse(1.5).success).toBe(false);
    });

    it("should handle boolean with description", () => {
      const descriptor: MCPToolDescriptor = {
        serverId: "test",
        name: "test",
        description: "test",
        inputSchema: {
          type: "boolean",
          description: "A flag",
        },
      };
      const wrapped = adapter.wrapTool(descriptor);
      expect(wrapped.inputSchema.safeParse(true).success).toBe(true);
      expect(wrapped.inputSchema.safeParse(false).success).toBe(true);
    });

    it("should handle array without items (defaults to z.unknown items)", () => {
      const descriptor: MCPToolDescriptor = {
        serverId: "test",
        name: "test",
        description: "test",
        inputSchema: {
          type: "array",
        },
      };
      const wrapped = adapter.wrapTool(descriptor);
      expect(wrapped.inputSchema.safeParse([1, "two", true]).success).toBe(true);
    });

    it("should handle array with description", () => {
      const descriptor: MCPToolDescriptor = {
        serverId: "test",
        name: "test",
        description: "test",
        inputSchema: {
          type: "array",
          items: { type: "number" },
          description: "A list of numbers",
        },
      };
      const wrapped = adapter.wrapTool(descriptor);
      expect(wrapped.inputSchema.safeParse([1, 2, 3]).success).toBe(true);
    });

    it("should handle object with description", () => {
      const descriptor: MCPToolDescriptor = {
        serverId: "test",
        name: "test",
        description: "test",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string" },
          },
          description: "A described object",
        },
      };
      const wrapped = adapter.wrapTool(descriptor);
      expect(wrapped.inputSchema.safeParse({ name: "x" }).success).toBe(true);
    });

    it("should handle enum with description", () => {
      const descriptor: MCPToolDescriptor = {
        serverId: "test",
        name: "test",
        description: "test",
        inputSchema: {
          type: "string",
          enum: ["a", "b"],
          description: "Pick one",
        },
      };
      const wrapped = adapter.wrapTool(descriptor);
      expect(wrapped.inputSchema.safeParse("a").success).toBe(true);
      expect(wrapped.inputSchema.safeParse("c").success).toBe(false);
    });

    it("should handle oneOf (union same as anyOf)", () => {
      const descriptor: MCPToolDescriptor = {
        serverId: "test",
        name: "test",
        description: "test",
        inputSchema: {
          oneOf: [{ type: "string" }, { type: "number" }],
        },
      };
      const wrapped = adapter.wrapTool(descriptor);
      expect(wrapped.inputSchema.safeParse("hello").success).toBe(true);
      expect(wrapped.inputSchema.safeParse(42).success).toBe(true);
    });

    it("should handle anyOf with empty array", () => {
      const descriptor: MCPToolDescriptor = {
        serverId: "test",
        name: "test",
        description: "test",
        inputSchema: { anyOf: [] },
      };
      const wrapped = adapter.wrapTool(descriptor);
      expect(wrapped.inputSchema.safeParse("anything").success).toBe(true);
    });

    it("should handle anyOf with single element", () => {
      const descriptor: MCPToolDescriptor = {
        serverId: "test",
        name: "test",
        description: "test",
        inputSchema: { anyOf: [{ type: "string" }] },
      };
      const wrapped = adapter.wrapTool(descriptor);
      expect(wrapped.inputSchema.safeParse("hello").success).toBe(true);
      expect(wrapped.inputSchema.safeParse(42).success).toBe(false);
    });

    it("should handle allOf (intersection)", () => {
      const descriptor: MCPToolDescriptor = {
        serverId: "test",
        name: "test",
        description: "test",
        inputSchema: {
          allOf: [
            { type: "object", properties: { a: { type: "string" } }, required: ["a"] },
            { type: "object", properties: { b: { type: "number" } }, required: ["b"] },
          ],
        },
      };
      const wrapped = adapter.wrapTool(descriptor);
      expect(wrapped.inputSchema.safeParse({ a: "x", b: 1 }).success).toBe(true);
    });

    it("should handle allOf with empty array", () => {
      const descriptor: MCPToolDescriptor = {
        serverId: "test",
        name: "test",
        description: "test",
        inputSchema: { allOf: [] },
      };
      const wrapped = adapter.wrapTool(descriptor);
      expect(wrapped.inputSchema.safeParse("anything").success).toBe(true);
    });

    it("should handle allOf with single element", () => {
      const descriptor: MCPToolDescriptor = {
        serverId: "test",
        name: "test",
        description: "test",
        inputSchema: { allOf: [{ type: "string" }] },
      };
      const wrapped = adapter.wrapTool(descriptor);
      expect(wrapped.inputSchema.safeParse("hello").success).toBe(true);
      expect(wrapped.inputSchema.safeParse(42).success).toBe(false);
    });

    it("should handle const with number value", () => {
      const descriptor: MCPToolDescriptor = {
        serverId: "test",
        name: "test",
        description: "test",
        inputSchema: { const: 42 },
      };
      const wrapped = adapter.wrapTool(descriptor);
      expect(wrapped.inputSchema.safeParse(42).success).toBe(true);
      expect(wrapped.inputSchema.safeParse(43).success).toBe(false);
    });

    it("should handle const with boolean value", () => {
      const descriptor: MCPToolDescriptor = {
        serverId: "test",
        name: "test",
        description: "test",
        inputSchema: { const: true },
      };
      const wrapped = adapter.wrapTool(descriptor);
      expect(wrapped.inputSchema.safeParse(true).success).toBe(true);
      expect(wrapped.inputSchema.safeParse(false).success).toBe(false);
    });

    it("should handle const with non-literal value (object)", () => {
      const descriptor: MCPToolDescriptor = {
        serverId: "test",
        name: "test",
        description: "test",
        inputSchema: { const: { complex: true } },
      };
      const wrapped = adapter.wrapTool(descriptor);
      // Falls back to z.unknown()
      expect(wrapped.inputSchema.safeParse("anything").success).toBe(true);
    });

    it("should handle object with property descriptions", () => {
      const descriptor: MCPToolDescriptor = {
        serverId: "test",
        name: "test",
        description: "test",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "The name" },
            age: { type: "number", description: "The age" },
          },
          required: ["name"],
        },
      };
      const wrapped = adapter.wrapTool(descriptor);
      expect(wrapped.inputSchema.safeParse({ name: "John" }).success).toBe(true);
    });
  });
});
