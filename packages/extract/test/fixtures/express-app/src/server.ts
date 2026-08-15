// A minimal router shape stands in for Express/Hono/Elysia so the fixture
// type-checks without pulling in @types/express — the extractor matches the
// `.get`/`.post` call *shape*, not the concrete framework.
interface Res {
  json(body: unknown): void;
}
interface Router {
  get(path: string, handler: (req: unknown, res: Res) => void): void;
  post(path: string, handler: (req: unknown, res: Res) => void): void;
}
declare const app: Router;

// A named top-level handler — HandledByEdge should carry its symbolId.
export function createItem(_req: unknown, res: Res): void {
  res.json({ ok: true });
}

// Inline handler — HandledByEdge carries only the path, no symbolId.
app.get("/health", (_req, res) => res.json({ up: true }));

// Named handler reference.
app.post("/items", createItem);

// Not a route: a one-arg `.get` is filtered by the arity guard, proving we
// don't over-match ordinary `Map.get` calls.
const cache = new Map<string, number>();
cache.get("miss");
