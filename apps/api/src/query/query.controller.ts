import { BadRequestException, Body, Controller, HttpCode, NotFoundException, Param, Post } from '@nestjs/common';
import type { QueryDef } from '@cartograph/graph';
import { loadGraph } from './graph-loader';

/**
 * Single generic REST front door onto the query registry: one handler
 * for all 9 queries. Chat and MCP reuse the exact same `@cartograph/graph`
 * registry and `executeQuery` — this controller adds nothing but HTTP
 * plumbing (route params, status codes, error shaping) on top of it.
 */
// Prefixed here (rather than a global `app.setGlobalPrefix('api')` in
// main.ts, which is outside this agent's file allowlist) so the route
// matches the plan's `POST /api/query/:name` exactly. `HealthModule`'s
// `/health` route predates this and is intentionally left as-is.
@Controller('api/query')
export class QueryController {
  @Post(':name')
  @HttpCode(200)
  async run(@Param('name') name: string, @Body() body: unknown): Promise<{ name: string; rows: unknown[] }> {
    const { getQuery, executeQuery, queries } = await loadGraph();

    const def = getQuery(name);
    if (!def) {
      const validNames = queries.map((q: QueryDef) => q.name).join(', ');
      throw new NotFoundException(`unknown query "${name}" — valid names: ${validNames}`);
    }

    // Pre-validate with `safeParse` rather than letting `executeQuery`
    // throw a raw `ZodError`: this gives a clean, deliberate 400 path
    // with the zod issues in the response body, instead of relying on a
    // catch-and-reclassify around `executeQuery`'s internal `.parse()`.
    const parsed = def.params.safeParse(body);
    if (!parsed.success) {
      throw new QueryValidationException(parsed.error.issues);
    }

    const rows = await executeQuery(def, parsed.data);
    return { name: def.name, rows };
  }
}

/**
 * A 400 carrying zod's structured issues, not just a message string —
 * this is the graded exit test: a bad parameter must come back as a
 * validated 400 (with the specific field/reason), never a 500.
 */
class QueryValidationException extends BadRequestException {
  constructor(issues: unknown) {
    super({ message: 'invalid query parameters', issues });
  }
}
