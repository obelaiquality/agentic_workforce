import type { ToolJsonSchema } from "../tools/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GrammarConstraint {
  type: "json_schema" | "regex" | "bnf";
  schema?: Record<string, unknown>;
  pattern?: string;
}

// ---------------------------------------------------------------------------
// Tool-call grammar
// ---------------------------------------------------------------------------

/**
 * Build a grammar constraint for tool-call JSON output.
 * Used with vLLM/SGLang backends that support guided generation.
 *
 * Enforces:
 * ```json
 * {
 *   "tool_calls": [
 *     { "id": "<string>", "name": "<one of tool names>", "input": { ... } }
 *   ]
 * }
 * ```
 */
export function buildToolCallGrammar(toolSchemas: ToolJsonSchema[]): GrammarConstraint {
  const toolNames = toolSchemas.map((t) => t.name);

  // Build a oneOf for each tool with its specific input schema
  const toolCallItems = toolSchemas.map((tool) => ({
    type: "object" as const,
    properties: {
      id: { type: "string" as const },
      name: { type: "string" as const, const: tool.name },
      input: tool.parameters,
    },
    required: ["id", "name", "input"] as string[],
    additionalProperties: false,
  }));

  // If there is only one tool, no need for oneOf
  const itemSchema =
    toolCallItems.length === 1
      ? toolCallItems[0]
      : { oneOf: toolCallItems };

  const schema: Record<string, unknown> = {
    type: "object",
    properties: {
      tool_calls: {
        type: "array",
        items: itemSchema,
        minItems: 1,
      },
    },
    required: ["tool_calls"],
    additionalProperties: false,
  };

  return {
    type: "json_schema",
    schema,
  };
}

// ---------------------------------------------------------------------------
// Generic JSON schema grammar
// ---------------------------------------------------------------------------

/**
 * Build a grammar constraint for a specific JSON schema.
 */
export function buildJsonSchemaGrammar(schema: Record<string, unknown>): GrammarConstraint {
  return {
    type: "json_schema",
    schema,
  };
}

// ---------------------------------------------------------------------------
// JSON Schema to BNF conversion
// ---------------------------------------------------------------------------

/**
 * Convert a JSON Schema to a simplified BNF grammar for backends that
 * support GBNF-style constrained decoding (e.g. llama.cpp).
 *
 * This produces a subset of JSON BNF suitable for common schema patterns:
 * object, array, string, number, integer, boolean, null, enum/const.
 */
export function jsonSchemaToBnf(schema: Record<string, unknown>): string {
  const rules: string[] = [];
  let ruleCounter = 0;

  function nextRuleName(hint: string): string {
    return `${hint}${ruleCounter++}`;
  }

  function emitRule(name: string, body: string): string {
    rules.push(`${name} ::= ${body}`);
    return name;
  }

  function schemaToRule(s: Record<string, unknown>, hint: string): string {
    // const — literal value
    if ("const" in s) {
      const ruleName = nextRuleName(hint);
      const literal = JSON.stringify(s.const);
      return emitRule(ruleName, `"${escBnf(literal)}"`);
    }

    // enum — alternatives of literal values
    if (Array.isArray(s.enum)) {
      const ruleName = nextRuleName(hint);
      const alts = (s.enum as unknown[]).map((v) => `"${escBnf(JSON.stringify(v))}"`).join(" | ");
      return emitRule(ruleName, alts);
    }

    // oneOf
    if (Array.isArray(s.oneOf)) {
      const ruleName = nextRuleName(hint);
      const alts = (s.oneOf as Record<string, unknown>[]).map((sub, i) =>
        schemaToRule(sub, `${hint}_alt${i}_`)
      );
      return emitRule(ruleName, alts.join(" | "));
    }

    const type = s.type as string | undefined;

    switch (type) {
      case "string":
        return "json-string";
      case "number":
        return "json-number";
      case "integer":
        return "json-integer";
      case "boolean":
        return "json-boolean";
      case "null":
        return "json-null";
      case "array": {
        const ruleName = nextRuleName(hint);
        const itemSchema = (s.items ?? {}) as Record<string, unknown>;
        const itemRule = schemaToRule(itemSchema, `${hint}_item_`);
        return emitRule(
          ruleName,
          `"[" ws (${itemRule} ("," ws ${itemRule})*)? ws "]"`
        );
      }
      case "object": {
        const ruleName = nextRuleName(hint);
        const props = (s.properties ?? {}) as Record<string, Record<string, unknown>>;
        const required = new Set(Array.isArray(s.required) ? (s.required as string[]) : []);
        const propEntries = Object.entries(props);

        if (propEntries.length === 0) {
          return emitRule(ruleName, `"{" ws "}"` );
        }

        // Build property rules: required properties are always present,
        // optional ones are wrapped in (...)?
        const fieldRules: string[] = [];
        for (const [key, propSchema] of propEntries) {
          const valRule = schemaToRule(propSchema, `${hint}_${key}_`);
          const fieldExpr = `"\\"${escBnf(key)}\\"" ws ":" ws ${valRule}`;
          if (required.has(key)) {
            fieldRules.push(fieldExpr);
          } else {
            fieldRules.push(`(${fieldExpr})?`);
          }
        }

        // Join with comma separators
        const body = fieldRules.join(` "," ws `);
        return emitRule(ruleName, `"{" ws ${body} ws "}"`);
      }
      default:
        // Fallback to any JSON value
        return "json-value";
    }
  }

  function escBnf(s: string): string {
    return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  // Primitive rules
  const primitives = [
    `json-string ::= "\\"" ([^"\\\\] | "\\\\" .)* "\\""`,
    `json-number ::= "-"? ("0" | [1-9] [0-9]*) ("." [0-9]+)? (("e" | "E") ("+" | "-")? [0-9]+)?`,
    `json-integer ::= "-"? ("0" | [1-9] [0-9]*)`,
    `json-boolean ::= "true" | "false"`,
    `json-null ::= "null"`,
    `json-value ::= json-string | json-number | json-boolean | json-null`,
    `ws ::= [ \\t\\n]*`,
  ];

  const rootRule = schemaToRule(schema, "root_");
  const rootLine = `root ::= ${rootRule}`;

  return [rootLine, ...rules, ...primitives].join("\n");
}

// ---------------------------------------------------------------------------
// JSON output validation & repair
// ---------------------------------------------------------------------------

/**
 * Validate that a string is valid JSON and optionally matches a schema.
 * Uses lightweight structural checks when a schema is provided.
 */
export function validateJsonOutput(
  output: string,
  schema?: Record<string, unknown>
): { valid: boolean; parsed?: unknown; error?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch (err) {
    return {
      valid: false,
      error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!schema) {
    return { valid: true, parsed };
  }

  // Lightweight structural validation
  const schemaError = checkSchemaMatch(parsed, schema, "root");
  if (schemaError) {
    return { valid: false, parsed, error: schemaError };
  }

  return { valid: true, parsed };
}

function checkSchemaMatch(
  value: unknown,
  schema: Record<string, unknown>,
  path: string
): string | null {
  const type = schema.type as string | undefined;

  // const check
  if ("const" in schema) {
    if (JSON.stringify(value) !== JSON.stringify(schema.const)) {
      return `${path}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`;
    }
    return null;
  }

  // enum check
  if (Array.isArray(schema.enum)) {
    const enumValues = schema.enum as unknown[];
    const found = enumValues.some((e) => JSON.stringify(e) === JSON.stringify(value));
    if (!found) {
      return `${path}: value ${JSON.stringify(value)} not in enum [${enumValues.map((e) => JSON.stringify(e)).join(", ")}]`;
    }
    return null;
  }

  // oneOf check
  if (Array.isArray(schema.oneOf)) {
    const variants = schema.oneOf as Record<string, unknown>[];
    const anyMatch = variants.some((v) => checkSchemaMatch(value, v, path) === null);
    if (!anyMatch) {
      return `${path}: value does not match any oneOf variant`;
    }
    return null;
  }

  if (!type) {
    return null; // No type constraint — pass
  }

  switch (type) {
    case "string":
      if (typeof value !== "string") {
        return `${path}: expected string, got ${typeof value}`;
      }
      return null;
    case "number":
      if (typeof value !== "number") {
        return `${path}: expected number, got ${typeof value}`;
      }
      return null;
    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value)) {
        return `${path}: expected integer, got ${typeof value}`;
      }
      return null;
    case "boolean":
      if (typeof value !== "boolean") {
        return `${path}: expected boolean, got ${typeof value}`;
      }
      return null;
    case "null":
      if (value !== null) {
        return `${path}: expected null, got ${typeof value}`;
      }
      return null;
    case "array": {
      if (!Array.isArray(value)) {
        return `${path}: expected array, got ${typeof value}`;
      }
      const itemSchema = schema.items as Record<string, unknown> | undefined;
      if (itemSchema) {
        for (let i = 0; i < value.length; i++) {
          const err = checkSchemaMatch(value[i], itemSchema, `${path}[${i}]`);
          if (err) return err;
        }
      }
      const minItems = schema.minItems as number | undefined;
      if (typeof minItems === "number" && value.length < minItems) {
        return `${path}: expected at least ${minItems} items, got ${value.length}`;
      }
      return null;
    }
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return `${path}: expected object, got ${Array.isArray(value) ? "array" : typeof value}`;
      }
      const record = value as Record<string, unknown>;
      const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
      for (const key of required) {
        if (!(key in record)) {
          return `${path}: missing required property "${key}"`;
        }
      }
      const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
      for (const [key, propSchema] of Object.entries(properties)) {
        if (key in record) {
          const err = checkSchemaMatch(record[key], propSchema, `${path}.${key}`);
          if (err) return err;
        }
      }
      return null;
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// JSON repair utilities (for CLI adapter post-processing)
// ---------------------------------------------------------------------------

/**
 * Attempt to repair common JSON malformations produced by local models.
 * Returns the repaired string or null if repair was not possible.
 */
export function repairMalformedJson(raw: string): string | null {
  let text = raw.trim();

  // Strip markdown code fences that models sometimes wrap output in
  text = stripMarkdownCodeFences(text);

  // Attempt direct parse first
  try {
    JSON.parse(text);
    return text;
  } catch {
    // Continue with repair strategies
  }

  // Strategy 1: Remove trailing commas before } or ]
  let repaired = text.replace(/,\s*([}\]])/g, "$1");
  if (tryParse(repaired)) return repaired;

  // Strategy 2: Add missing closing braces/brackets
  repaired = balanceBrackets(repaired);
  if (tryParse(repaired)) return repaired;

  // Strategy 3: Remove trailing commas AND balance brackets
  repaired = balanceBrackets(text.replace(/,\s*([}\]])/g, "$1"));
  if (tryParse(repaired)) return repaired;

  // Strategy 4: Fix unquoted property keys — e.g. { name: "foo" } → { "name": "foo" }
  repaired = fixUnquotedKeys(text);
  if (tryParse(repaired)) return repaired;

  // Strategy 5: Fix single-quoted strings → double-quoted
  repaired = text.replace(/'/g, '"');
  if (tryParse(repaired)) return repaired;

  // Strategy 6: Combined — trailing commas + balance + single quotes
  repaired = balanceBrackets(text.replace(/,\s*([}\]])/g, "$1").replace(/'/g, '"'));
  if (tryParse(repaired)) return repaired;

  return null;
}

function stripMarkdownCodeFences(text: string): string {
  // ```json\n...\n``` or ```\n...\n```
  const fenceMatch = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n\s*```\s*$/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }
  return text;
}

function tryParse(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function balanceBrackets(text: string): string {
  // Track the order of open brackets/braces so we close them in reverse
  const stack: string[] = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    // Skip characters inside strings
    if (ch === '"') {
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\') i++; // skip escaped char
        i++;
      }
      continue;
    }
    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }

  if (stack.length === 0) return text;

  let result = text;
  // Remove any trailing comma before appending closing chars
  result = result.replace(/,\s*$/, "");
  // Close in reverse order (LIFO)
  while (stack.length > 0) {
    result += stack.pop();
  }
  return result;
}

function fixUnquotedKeys(text: string): string {
  // Match unquoted keys: { key: or , key:
  // This regex is intentionally conservative to avoid breaking quoted values
  return text.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":');
}

/**
 * Validate and optionally repair a tool-call JSON string.
 * Returns the parsed result with a flag indicating whether repair was needed.
 */
export function validateAndRepairToolCallJson(
  raw: string
): { valid: boolean; repaired: boolean; parsed?: unknown; error?: string } {
  const trimmed = raw.trim();

  // Try direct parse
  try {
    const parsed = JSON.parse(trimmed);
    return { valid: true, repaired: false, parsed };
  } catch {
    // Continue to repair
  }

  const repaired = repairMalformedJson(trimmed);
  if (repaired !== null) {
    try {
      const parsed = JSON.parse(repaired);
      return { valid: true, repaired: true, parsed };
    } catch {
      // Should not happen since repairMalformedJson validates
    }
  }

  return {
    valid: false,
    repaired: false,
    error: "Unable to parse or repair JSON output",
  };
}
