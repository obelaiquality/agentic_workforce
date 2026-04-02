import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { MCPClient } from "./mcpClient";
import { MCPToolAdapter } from "./mcpToolAdapter";
import type { MCPToolDescriptor } from "./types";

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
});
