/**
 * `packages/tools` — renders every `QueryDef.params` zod schema into the
 * JSON-Schema-based "tool definition" shape that AI/MCP surfaces expect.
 *
 * Why this exists at all: `QueryDef.params` (defined once, per query, in
 * `@cartograph/graph`) is already the single source of truth for REST
 * validation. Chat function-calling (Groq's OpenAI-compatible tool
 * schema) and MCP's `inputSchema` both want the *same* shape, but as
 * JSON Schema rather than a zod object. Rather than hand-writing a
 * second, parallel JSON Schema per query — which WILL drift from the
 * zod schema the first time someone edits one and forgets the other —
 * this module generates it mechanically with `zod-to-json-schema`. There
 * is deliberately no hand-written JSON Schema anywhere in this system.
 *
 * This is transport-neutral on purpose: `ToolDefinition` is just
 * `{ name, description, parameters }`. `toOpenAITools()` and
 * `toMcpTools()` below are thin, ~one-line adapters onto that neutral
 * shape for the two concrete transports Phase 3+ needs; a third
 * transport is another one-liner, not a new generation path.
 */
import { zodToJsonSchema } from "zod-to-json-schema";
import type { JsonSchema7ObjectType } from "zod-to-json-schema";
import { queries, type QueryDef } from "@cartograph/graph";

/** The transport-neutral tool definition every adapter below wraps. */
export interface ToolDefinition {
  /** Same as `QueryDef.name` — the identifier a caller invokes the tool by. */
  name: string;
  /** Same as `QueryDef.description` — shown to the model choosing tools. */
  description: string;
  /** JSON Schema (object type) generated from `QueryDef.params`. */
  parameters: JsonSchema7ObjectType;
}

/**
 * Renders `defs` (defaults to the full registry) into `ToolDefinition`s.
 * Takes an explicit `defs` param (rather than always reading the live
 * `queries` export) so callers/tests can render a subset or fixture list
 * without touching the real registry.
 */
export function buildToolDefinitions(defs: QueryDef[] = queries): ToolDefinition[] {
  return defs.map((def) => ({
    name: def.name,
    description: def.description,
    // `$refStrategy: "none"` inlines everything into a single flat object
    // schema instead of emitting a `$ref`/`definitions` pair — every
    // consumer here (OpenAI function calling, MCP `inputSchema`) expects
    // one self-contained object, not a schema that needs its own resolver.
    parameters: zodToJsonSchema(def.params, {
      $refStrategy: "none",
    }) as JsonSchema7ObjectType,
  }));
}

/** The ready-made rendering of the full query registry. */
export const toolDefinitions: ToolDefinition[] = buildToolDefinitions();

/** OpenAI-compatible `{ type: "function", function: {...} }` wrapper — what Groq chat expects. */
export interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JsonSchema7ObjectType;
  };
}

/** Wraps tool definitions for Groq's OpenAI-compatible function-calling API. */
export function toOpenAITools(defs: ToolDefinition[] = toolDefinitions): OpenAITool[] {
  return defs.map((def) => ({
    type: "function",
    function: {
      name: def.name,
      description: def.description,
      parameters: def.parameters,
    },
  }));
}

/** MCP tool shape — `inputSchema` is MCP's name for the same JSON Schema. */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: JsonSchema7ObjectType;
}

/** Wraps tool definitions for an MCP server's `tools/list` response. */
export function toMcpTools(defs: ToolDefinition[] = toolDefinitions): McpTool[] {
  return defs.map((def) => ({
    name: def.name,
    description: def.description,
    inputSchema: def.parameters,
  }));
}
