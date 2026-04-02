import { z } from "zod";
import type { ToolDefinition } from "../tools/types";
import type { MCPClient } from "./mcpClient";
import type { MCPToolDescriptor } from "./types";
import { getTelemetry } from "../telemetry/tracer";
import { METRICS, METRIC_LABELS } from "../telemetry/metrics";

// ---------------------------------------------------------------------------
// MCP Tool Adapter — wraps MCP tools as native ToolDefinitions
// ---------------------------------------------------------------------------

export class MCPToolAdapter {
  constructor(private client: MCPClient) {}

  /**
   * Convert an MCP tool descriptor to a native ToolDefinition.
   */
  wrapTool(descriptor: MCPToolDescriptor): ToolDefinition {
    return {
      name: `mcp__${descriptor.serverId}__${descriptor.name}`,
      description: descriptor.description || `MCP tool: ${descriptor.name}`,
      inputSchema: this.jsonSchemaToZod(descriptor.inputSchema),
      permission: { scope: "meta" }, // MCP tools use meta scope
      alwaysLoad: false, // MCP tools are deferred by default
      searchHints: [descriptor.serverId, descriptor.name, "mcp"],
      concurrencySafe: true,
      execute: async (input, ctx) => {
        getTelemetry().incrementCounter(METRICS.MCP_TOOL_CALL_COUNT, { [METRIC_LABELS.MCP_SERVER]: descriptor.serverId, [METRIC_LABELS.TOOL_NAME]: descriptor.name });
        try {
          const result = await this.client.callTool(descriptor.serverId, descriptor.name, input);
          return {
            type: "success",
            content: typeof result === "string" ? result : JSON.stringify(result, null, 2),
          };
        } catch (err) {
          return {
            type: "error",
            error: `MCP tool ${descriptor.name} failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    };
  }

  /**
   * Convert all tools from a server.
   */
  wrapAllTools(serverId: string, descriptors: MCPToolDescriptor[]): ToolDefinition[] {
    return descriptors.map((d) => this.wrapTool(d));
  }

  /**
   * Convert JSON Schema to Zod (best effort).
   * Handles common types and patterns used in MCP tool schemas.
   */
  private jsonSchemaToZod(schema: Record<string, unknown>): z.ZodType<unknown> {
    // Handle null/undefined
    if (!schema || typeof schema !== "object") {
      return z.unknown();
    }

    const type = schema.type as string | string[] | undefined;
    const description = schema.description as string | undefined;

    // Handle object type
    if (type === "object") {
      const properties = (schema.properties || {}) as Record<string, Record<string, unknown>>;
      const required = (schema.required || []) as string[];

      const shape: Record<string, z.ZodType<unknown>> = {};
      for (const [key, propSchema] of Object.entries(properties)) {
        let fieldSchema = this.jsonSchemaToZod(propSchema);

        // Add description if present
        const propDescription = propSchema.description as string | undefined;
        if (propDescription) {
          fieldSchema = fieldSchema.describe(propDescription);
        }

        // Make optional if not in required array
        if (!required.includes(key)) {
          fieldSchema = fieldSchema.optional();
        }

        shape[key] = fieldSchema;
      }

      let objectSchema = z.object(shape);
      if (description) {
        objectSchema = objectSchema.describe(description) as z.ZodObject<
          Record<string, z.ZodType<unknown>>
        >;
      }
      return objectSchema;
    }

    // Handle array type
    if (type === "array") {
      const items = schema.items as Record<string, unknown> | undefined;
      const itemSchema = items ? this.jsonSchemaToZod(items) : z.unknown();
      let arraySchema = z.array(itemSchema);
      if (description) {
        arraySchema = arraySchema.describe(description);
      }
      return arraySchema;
    }

    // Handle string type
    if (type === "string") {
      // Check for enum
      const enumValues = schema.enum as string[] | undefined;
      if (enumValues && enumValues.length > 0) {
        let enumSchema = z.enum([enumValues[0], ...enumValues.slice(1)]);
        if (description) {
          enumSchema = enumSchema.describe(description);
        }
        return enumSchema;
      }

      let stringSchema = z.string();
      if (description) {
        stringSchema = stringSchema.describe(description);
      }

      // Apply string constraints
      const minLength = schema.minLength as number | undefined;
      const maxLength = schema.maxLength as number | undefined;
      const pattern = schema.pattern as string | undefined;

      if (minLength !== undefined) {
        stringSchema = stringSchema.min(minLength);
      }
      if (maxLength !== undefined) {
        stringSchema = stringSchema.max(maxLength);
      }
      if (pattern) {
        try {
          stringSchema = stringSchema.regex(new RegExp(pattern));
        } catch {
          // Invalid regex, ignore
        }
      }

      return stringSchema;
    }

    // Handle number type (includes integer)
    if (type === "number" || type === "integer") {
      let numberSchema = type === "integer" ? z.number().int() : z.number();
      if (description) {
        numberSchema = numberSchema.describe(description);
      }

      // Apply number constraints
      const minimum = schema.minimum as number | undefined;
      const maximum = schema.maximum as number | undefined;

      if (minimum !== undefined) {
        numberSchema = numberSchema.min(minimum);
      }
      if (maximum !== undefined) {
        numberSchema = numberSchema.max(maximum);
      }

      return numberSchema;
    }

    // Handle boolean type
    if (type === "boolean") {
      let booleanSchema = z.boolean();
      if (description) {
        booleanSchema = booleanSchema.describe(description);
      }
      return booleanSchema;
    }

    // Handle null type
    if (type === "null") {
      return z.null();
    }

    // Handle union types (anyOf, oneOf)
    if (schema.anyOf || schema.oneOf) {
      const unionSchemas = ((schema.anyOf || schema.oneOf) as Record<string, unknown>[]).map((s) =>
        this.jsonSchemaToZod(s)
      );
      if (unionSchemas.length === 0) {
        return z.unknown();
      }
      if (unionSchemas.length === 1) {
        return unionSchemas[0];
      }
      return z.union([unionSchemas[0], unionSchemas[1], ...unionSchemas.slice(2)] as [
        z.ZodType<unknown>,
        z.ZodType<unknown>,
        ...z.ZodType<unknown>[]
      ]);
    }

    // Handle allOf (intersection)
    if (schema.allOf) {
      const allSchemas = (schema.allOf as Record<string, unknown>[]).map((s) =>
        this.jsonSchemaToZod(s)
      );
      if (allSchemas.length === 0) {
        return z.unknown();
      }
      if (allSchemas.length === 1) {
        return allSchemas[0];
      }
      // Use intersection for allOf
      let result = allSchemas[0];
      for (let i = 1; i < allSchemas.length; i++) {
        result = result.and(allSchemas[i]);
      }
      return result;
    }

    // Handle const
    if ("const" in schema) {
      const constValue = schema.const;
      if (typeof constValue === "string") {
        return z.literal(constValue);
      }
      if (typeof constValue === "number") {
        return z.literal(constValue);
      }
      if (typeof constValue === "boolean") {
        return z.literal(constValue);
      }
      return z.unknown();
    }

    // Fallback to unknown for unsupported types
    return z.unknown();
  }
}
