import { describe, expect, it } from "vitest";
import {
  buildToolCallGrammar,
  buildJsonSchemaGrammar,
  jsonSchemaToBnf,
  validateJsonOutput,
  repairMalformedJson,
  validateAndRepairToolCallJson,
} from "./constrainedDecoding";
import type { ToolJsonSchema } from "../tools/types";

// ---------------------------------------------------------------------------
// buildToolCallGrammar
// ---------------------------------------------------------------------------

describe("buildToolCallGrammar", () => {
  const sampleTools: ToolJsonSchema[] = [
    {
      name: "read_file",
      description: "Read a file",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      },
    },
    {
      name: "write_file",
      description: "Write a file",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
  ];

  it("produces a json_schema grammar type", () => {
    const grammar = buildToolCallGrammar(sampleTools);
    expect(grammar.type).toBe("json_schema");
    expect(grammar.schema).toBeDefined();
  });

  it("requires tool_calls array property", () => {
    const grammar = buildToolCallGrammar(sampleTools);
    const schema = grammar.schema!;
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(["tool_calls"]);
    const props = schema.properties as Record<string, unknown>;
    expect(props.tool_calls).toBeDefined();
    const toolCallsProp = props.tool_calls as Record<string, unknown>;
    expect(toolCallsProp.type).toBe("array");
    expect(toolCallsProp.minItems).toBe(1);
  });

  it("creates oneOf for multiple tools", () => {
    const grammar = buildToolCallGrammar(sampleTools);
    const schema = grammar.schema!;
    const props = schema.properties as Record<string, unknown>;
    const items = (props.tool_calls as Record<string, unknown>).items as Record<string, unknown>;
    expect(items.oneOf).toBeDefined();
    const variants = items.oneOf as Record<string, unknown>[];
    expect(variants).toHaveLength(2);
  });

  it("uses direct schema (no oneOf) for a single tool", () => {
    const grammar = buildToolCallGrammar([sampleTools[0]]);
    const schema = grammar.schema!;
    const props = schema.properties as Record<string, unknown>;
    const items = (props.tool_calls as Record<string, unknown>).items as Record<string, unknown>;
    expect(items.oneOf).toBeUndefined();
    expect(items.type).toBe("object");
    const itemProps = items.properties as Record<string, unknown>;
    expect(itemProps.name).toEqual({ type: "string", const: "read_file" });
  });

  it("includes id, name, and input as required properties per tool", () => {
    const grammar = buildToolCallGrammar(sampleTools);
    const schema = grammar.schema!;
    const props = schema.properties as Record<string, unknown>;
    const items = (props.tool_calls as Record<string, unknown>).items as Record<string, unknown>;
    const variants = items.oneOf as Record<string, unknown>[];
    for (const variant of variants) {
      expect(variant.required).toEqual(["id", "name", "input"]);
      expect(variant.additionalProperties).toBe(false);
    }
  });

  it("maps each tool name as a const constraint", () => {
    const grammar = buildToolCallGrammar(sampleTools);
    const schema = grammar.schema!;
    const props = schema.properties as Record<string, unknown>;
    const items = (props.tool_calls as Record<string, unknown>).items as Record<string, unknown>;
    const variants = items.oneOf as Record<string, unknown>[];
    const names = variants.map(
      (v) => ((v.properties as Record<string, unknown>).name as Record<string, unknown>).const
    );
    expect(names).toEqual(["read_file", "write_file"]);
  });

  it("passes each tool's parameter schema as the input property", () => {
    const grammar = buildToolCallGrammar(sampleTools);
    const schema = grammar.schema!;
    const props = schema.properties as Record<string, unknown>;
    const items = (props.tool_calls as Record<string, unknown>).items as Record<string, unknown>;
    const variants = items.oneOf as Record<string, unknown>[];
    const readFileInput = (variants[0].properties as Record<string, unknown>).input;
    expect(readFileInput).toEqual(sampleTools[0].parameters);
  });

  it("validates a conforming tool call against the schema", () => {
    const grammar = buildToolCallGrammar(sampleTools);
    const validOutput = JSON.stringify({
      tool_calls: [
        { id: "call_1", name: "read_file", input: { path: "src/index.ts" } },
      ],
    });
    const result = validateJsonOutput(validOutput, grammar.schema);
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildJsonSchemaGrammar
// ---------------------------------------------------------------------------

describe("buildJsonSchemaGrammar", () => {
  it("wraps a schema in json_schema type", () => {
    const schema = { type: "object", properties: { name: { type: "string" } } };
    const grammar = buildJsonSchemaGrammar(schema);
    expect(grammar.type).toBe("json_schema");
    expect(grammar.schema).toBe(schema);
  });

  it("preserves complex nested schema", () => {
    const schema = {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: { type: "number" },
        },
      },
      required: ["items"],
    };
    const grammar = buildJsonSchemaGrammar(schema);
    expect(grammar.schema).toEqual(schema);
  });
});

// ---------------------------------------------------------------------------
// jsonSchemaToBnf
// ---------------------------------------------------------------------------

describe("jsonSchemaToBnf", () => {
  it("produces a root rule at the top", () => {
    const bnf = jsonSchemaToBnf({ type: "object", properties: {} });
    expect(bnf.startsWith("root ::=")).toBe(true);
  });

  it("includes primitive rules", () => {
    const bnf = jsonSchemaToBnf({ type: "string" });
    expect(bnf).toContain("json-string");
    expect(bnf).toContain("json-number");
    expect(bnf).toContain("json-boolean");
    expect(bnf).toContain("json-null");
    expect(bnf).toContain("ws");
  });

  it("references json-string for string type", () => {
    const bnf = jsonSchemaToBnf({ type: "string" });
    expect(bnf).toContain("root ::= json-string");
  });

  it("references json-number for number type", () => {
    const bnf = jsonSchemaToBnf({ type: "number" });
    expect(bnf).toContain("root ::= json-number");
  });

  it("references json-integer for integer type", () => {
    const bnf = jsonSchemaToBnf({ type: "integer" });
    expect(bnf).toContain("root ::= json-integer");
  });

  it("references json-boolean for boolean type", () => {
    const bnf = jsonSchemaToBnf({ type: "boolean" });
    expect(bnf).toContain("root ::= json-boolean");
  });

  it("generates array rule with items", () => {
    const bnf = jsonSchemaToBnf({
      type: "array",
      items: { type: "string" },
    });
    expect(bnf).toContain("[");
    expect(bnf).toContain("]");
    expect(bnf).toContain("json-string");
  });

  it("generates object rule with properties", () => {
    const bnf = jsonSchemaToBnf({
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "integer" },
      },
      required: ["name"],
    });
    expect(bnf).toContain("name");
    expect(bnf).toContain("age");
    expect(bnf).toContain("{");
    expect(bnf).toContain("}");
  });

  it("handles enum schema", () => {
    const bnf = jsonSchemaToBnf({
      type: "string",
      enum: ["red", "green", "blue"],
    });
    // Should contain the literal enum values
    expect(bnf).toContain("red");
    expect(bnf).toContain("green");
    expect(bnf).toContain("blue");
  });

  it("handles const schema", () => {
    const bnf = jsonSchemaToBnf({ const: "fixed_value" });
    expect(bnf).toContain("fixed_value");
  });

  it("handles empty object schema", () => {
    const bnf = jsonSchemaToBnf({ type: "object", properties: {} });
    expect(bnf).toContain("{");
    expect(bnf).toContain("}");
  });

  it("handles oneOf schema", () => {
    const bnf = jsonSchemaToBnf({
      oneOf: [{ type: "string" }, { type: "number" }],
    });
    expect(bnf).toContain("json-string");
    expect(bnf).toContain("json-number");
    expect(bnf).toContain("|");
  });
});

// ---------------------------------------------------------------------------
// validateJsonOutput
// ---------------------------------------------------------------------------

describe("validateJsonOutput", () => {
  it("accepts valid JSON without schema", () => {
    const result = validateJsonOutput('{"key": "value"}');
    expect(result.valid).toBe(true);
    expect(result.parsed).toEqual({ key: "value" });
  });

  it("rejects invalid JSON", () => {
    const result = validateJsonOutput("{not valid json}");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid JSON");
  });

  it("accepts empty string as invalid JSON", () => {
    const result = validateJsonOutput("");
    expect(result.valid).toBe(false);
  });

  it("validates against a string schema", () => {
    const result = validateJsonOutput('"hello"', { type: "string" });
    expect(result.valid).toBe(true);
  });

  it("rejects type mismatch for string schema", () => {
    const result = validateJsonOutput("42", { type: "string" });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("expected string");
  });

  it("validates against a number schema", () => {
    expect(validateJsonOutput("3.14", { type: "number" }).valid).toBe(true);
    expect(validateJsonOutput('"text"', { type: "number" }).valid).toBe(false);
  });

  it("validates against an integer schema", () => {
    expect(validateJsonOutput("42", { type: "integer" }).valid).toBe(true);
    expect(validateJsonOutput("3.14", { type: "integer" }).valid).toBe(false);
  });

  it("validates against a boolean schema", () => {
    expect(validateJsonOutput("true", { type: "boolean" }).valid).toBe(true);
    expect(validateJsonOutput("1", { type: "boolean" }).valid).toBe(false);
  });

  it("validates against a null schema", () => {
    expect(validateJsonOutput("null", { type: "null" }).valid).toBe(true);
    expect(validateJsonOutput("0", { type: "null" }).valid).toBe(false);
  });

  it("validates against an object schema with required properties", () => {
    const schema = {
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "integer" },
      },
      required: ["name"],
    };
    expect(validateJsonOutput('{"name": "Alice", "age": 30}', schema).valid).toBe(true);
    expect(validateJsonOutput('{"name": "Bob"}', schema).valid).toBe(true);
    expect(validateJsonOutput('{"age": 30}', schema).valid).toBe(false);
  });

  it("validates missing required property", () => {
    const schema = {
      type: "object",
      properties: { x: { type: "number" } },
      required: ["x"],
    };
    const result = validateJsonOutput('{}', schema);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('missing required property "x"');
  });

  it("validates against an array schema", () => {
    const schema = {
      type: "array",
      items: { type: "string" },
    };
    expect(validateJsonOutput('["a", "b"]', schema).valid).toBe(true);
    expect(validateJsonOutput('[1, 2]', schema).valid).toBe(false);
  });

  it("validates array minItems", () => {
    const schema = {
      type: "array",
      items: { type: "number" },
      minItems: 2,
    };
    expect(validateJsonOutput("[1, 2, 3]", schema).valid).toBe(true);
    expect(validateJsonOutput("[1]", schema).valid).toBe(false);
  });

  it("validates enum schema", () => {
    const schema = { enum: ["red", "green", "blue"] };
    expect(validateJsonOutput('"red"', schema).valid).toBe(true);
    expect(validateJsonOutput('"yellow"', schema).valid).toBe(false);
  });

  it("validates const schema", () => {
    const schema = { const: "fixed" };
    expect(validateJsonOutput('"fixed"', schema).valid).toBe(true);
    expect(validateJsonOutput('"other"', schema).valid).toBe(false);
  });

  it("validates oneOf schema", () => {
    const schema = {
      oneOf: [{ type: "string" }, { type: "number" }],
    };
    expect(validateJsonOutput('"hello"', schema).valid).toBe(true);
    expect(validateJsonOutput("42", schema).valid).toBe(true);
    expect(validateJsonOutput("true", schema).valid).toBe(false);
  });

  it("validates nested object schema", () => {
    const schema = {
      type: "object",
      properties: {
        user: {
          type: "object",
          properties: {
            name: { type: "string" },
          },
          required: ["name"],
        },
      },
      required: ["user"],
    };
    expect(validateJsonOutput('{"user": {"name": "Alice"}}', schema).valid).toBe(true);
    expect(validateJsonOutput('{"user": {}}', schema).valid).toBe(false);
  });

  it("passes validation for schema without type", () => {
    const schema = {};
    expect(validateJsonOutput("42", schema).valid).toBe(true);
    expect(validateJsonOutput('"str"', schema).valid).toBe(true);
  });

  it("rejects non-array for array schema", () => {
    const result = validateJsonOutput('"string"', { type: "array" });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("expected array");
  });

  it("rejects non-object for object schema", () => {
    const result = validateJsonOutput("[1,2]", { type: "object" });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("expected object");
  });
});

// ---------------------------------------------------------------------------
// repairMalformedJson
// ---------------------------------------------------------------------------

describe("repairMalformedJson", () => {
  it("returns valid JSON as-is", () => {
    const input = '{"key": "value"}';
    expect(repairMalformedJson(input)).toBe(input);
  });

  it("fixes trailing comma before closing brace", () => {
    const result = repairMalformedJson('{"key": "value",}');
    expect(result).not.toBeNull();
    expect(JSON.parse(result!)).toEqual({ key: "value" });
  });

  it("fixes trailing comma before closing bracket", () => {
    const result = repairMalformedJson('[1, 2, 3,]');
    expect(result).not.toBeNull();
    expect(JSON.parse(result!)).toEqual([1, 2, 3]);
  });

  it("fixes missing closing brace", () => {
    const result = repairMalformedJson('{"key": "value"');
    expect(result).not.toBeNull();
    expect(JSON.parse(result!)).toEqual({ key: "value" });
  });

  it("fixes missing closing bracket", () => {
    const result = repairMalformedJson('[1, 2, 3');
    expect(result).not.toBeNull();
    expect(JSON.parse(result!)).toEqual([1, 2, 3]);
  });

  it("fixes multiple missing closing brackets/braces", () => {
    const result = repairMalformedJson('{"items": [{"name": "a"');
    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!);
    expect(parsed.items).toBeDefined();
  });

  it("fixes single quotes to double quotes", () => {
    const result = repairMalformedJson("{'key': 'value'}");
    expect(result).not.toBeNull();
    expect(JSON.parse(result!)).toEqual({ key: "value" });
  });

  it("strips markdown code fences", () => {
    const result = repairMalformedJson('```json\n{"key": "value"}\n```');
    expect(result).not.toBeNull();
    expect(JSON.parse(result!)).toEqual({ key: "value" });
  });

  it("strips markdown code fences without language tag", () => {
    const result = repairMalformedJson('```\n{"key": "value"}\n```');
    expect(result).not.toBeNull();
    expect(JSON.parse(result!)).toEqual({ key: "value" });
  });

  it("fixes trailing comma combined with missing brace", () => {
    const result = repairMalformedJson('{"key": "value",');
    expect(result).not.toBeNull();
    expect(JSON.parse(result!)).toEqual({ key: "value" });
  });

  it("returns null for completely unparseable content", () => {
    const result = repairMalformedJson("this is not json at all");
    expect(result).toBeNull();
  });

  it("handles empty string", () => {
    const result = repairMalformedJson("");
    expect(result).toBeNull();
  });

  it("handles whitespace-only string", () => {
    const result = repairMalformedJson("   ");
    expect(result).toBeNull();
  });

  it("fixes unquoted property keys", () => {
    const result = repairMalformedJson('{name: "Alice", age: 30}');
    expect(result).not.toBeNull();
    expect(JSON.parse(result!)).toEqual({ name: "Alice", age: 30 });
  });
});

// ---------------------------------------------------------------------------
// validateAndRepairToolCallJson
// ---------------------------------------------------------------------------

describe("validateAndRepairToolCallJson", () => {
  it("returns valid=true, repaired=false for well-formed JSON", () => {
    const result = validateAndRepairToolCallJson('{"tool_calls": []}');
    expect(result.valid).toBe(true);
    expect(result.repaired).toBe(false);
    expect(result.parsed).toEqual({ tool_calls: [] });
  });

  it("repairs and flags trailing comma", () => {
    const result = validateAndRepairToolCallJson('{"tool_calls": [{"id": "1", "name": "test",}]}');
    expect(result.valid).toBe(true);
    expect(result.repaired).toBe(true);
  });

  it("repairs and flags missing closing brace", () => {
    const result = validateAndRepairToolCallJson('{"tool_calls": [{"id": "1"}]');
    expect(result.valid).toBe(true);
    expect(result.repaired).toBe(true);
  });

  it("returns valid=false for unrepairable input", () => {
    const result = validateAndRepairToolCallJson("not json at all");
    expect(result.valid).toBe(false);
    expect(result.repaired).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("handles input wrapped in markdown fences", () => {
    const input = '```json\n{"tool_calls": [{"id": "1", "name": "test", "input": {}}]}\n```';
    const result = validateAndRepairToolCallJson(input);
    expect(result.valid).toBe(true);
    expect(result.repaired).toBe(true);
  });

  it("trims whitespace before parsing", () => {
    const result = validateAndRepairToolCallJson('  {"key": "value"}  ');
    expect(result.valid).toBe(true);
    expect(result.repaired).toBe(false);
  });
});
