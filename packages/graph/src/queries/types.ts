import type { Record as Neo4jRecord } from "neo4j-driver";
import type { ZodType } from "zod";
import { withSession } from "../driver.js";

/**
 * The shared contract every graph query is built against.
 *
 * This file is intentionally the ONLY thing this package exports about
 * queries in Phase 3 — the actual query definitions (search, neighbors,
 * path, who_touched, bus_factor, co_changed, hidden_coupling, cycles,
 * entrypoints) and the registry that indexes them by name live in sibling
 * files owned by a different agent. Keeping the contract isolated here
 * means that work can proceed against a stable type without waiting on
 * this loader/evict work, and vice versa.
 *
 * Each `QueryDef` is a single artifact reused by three surfaces (REST
 * controller, CLI, and the AI/MCP tool layer in `packages/tools`):
 *   - `params` is a zod schema — the SINGLE source of truth for input
 *     validation, REST request typing, and the JSON Schema handed to the
 *     AI model as a tool definition. There is deliberately no second,
 *     hand-written JSON Schema anywhere in the system.
 *   - `cypher` is a parameterised query string. It must NEVER be built by
 *     string concatenation of user input — all variable data flows in via
 *     Neo4j query parameters (`$paramName`), exactly like a prepared SQL
 *     statement. This is the only thing standing between this product and
 *     Cypher injection.
 *   - `map` turns raw driver `Record`s into plain JSON-serialisable rows,
 *     so callers never touch neo4j-driver's Node/Relationship wrapper
 *     types directly.
 */
export interface QueryDef<Params = unknown, Row = unknown> {
  /** Unique tool name, snake_case, e.g. "hidden_coupling". */
  name: string;
  /** One-sentence description — becomes the AI/MCP tool description. */
  description: string;
  /**
   * Zod schema: the SINGLE source of truth for REST validation and the
   * AI tool JSON schema. `executeQuery` runs `def.params.parse(...)`
   * against caller input before anything touches the database.
   */
  params: ZodType<Params>;
  /**
   * Parameterised Cypher. NEVER string-concatenated with caller input;
   * all inputs must flow in via `$`-prefixed query parameters that match
   * the shape validated by `params`.
   */
  cypher: string;
  /** Maps raw neo4j records to plain JSON rows. */
  map: (records: Neo4jRecord[]) => Row[];
}

/**
 * Identity helper whose only job is inference: writing
 * `defineQuery<Params, Row>({ ... })` lets TypeScript check the literal
 * object against `QueryDef<Params, Row>` while still preserving the
 * narrowed literal types (e.g. the exact `name` string) that a bare type
 * annotation on the object would erase.
 */
export function defineQuery<Params, Row>(def: QueryDef<Params, Row>): QueryDef<Params, Row> {
  return def;
}

/**
 * Runs `def` against CognoDB: validates `params` with `def.params`
 * (zod), executes `def.cypher` via `withSession`, and maps the resulting
 * records with `def.map`.
 *
 * Validation happens BEFORE the query ever reaches the database. A bad
 * param throws a `ZodError` — callers (the REST controller in
 * particular) are expected to catch that and turn it into a 400, rather
 * than letting an invalid query reach CognoDB and fail there.
 */
export async function executeQuery<Params, Row>(
  def: QueryDef<Params, Row>,
  params: Params,
): Promise<Row[]> {
  const validated = def.params.parse(params);
  const records = await withSession(async (session) => {
    const result = await session.run(def.cypher, validated as Record<string, unknown>);
    return result.records;
  });
  return def.map(records);
}
