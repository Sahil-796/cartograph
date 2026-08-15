/**
 * Typed client for the Cartograph query API.
 *
 * The backend exposes exactly one generic endpoint — `POST /api/query/:name`
 * with a JSON body of params — returning `{ name, rows }`. Everything the web
 * app knows about the graph flows through `runQuery` below.
 *
 * Error model (this is the contract the UI's state components key off):
 *   - `kind: "network"`  — the request never got a response (API process
 *                          down, DNS/connection failure). `fetch` rejected.
 *   - `kind: "server"`   — HTTP 5xx. The API is up but the query blew up,
 *                          most commonly because CognoDB is unreachable.
 *   - `kind: "validation"` — HTTP 400. Bad params; `.issues` carries zod's
 *                          structured issues so the UI can point at a field.
 *   - `kind: "notFound"` — HTTP 404. Unknown query name.
 *
 * `network` and `server` are the two "can't reach the database" cases the
 * `<ErrorBanner>` shows with a Retry button — use `isConnectionError()` to
 * detect them. `validation`/`notFound` are programmer/param errors the UI
 * should surface inline, not as a global banner.
 */

export type ApiErrorKind = "network" | "server" | "validation" | "notFound";

/** A zod issue as surfaced in a 400 body (`{ message, issues }`). */
export interface ApiIssue {
  path: (string | number)[];
  message: string;
  code?: string;
  [key: string]: unknown;
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  /** HTTP status, or 0 when the request never reached the server. */
  readonly status: number;
  /** Present only for `kind: "validation"` (zod issues from the 400 body). */
  readonly issues?: ApiIssue[];

  constructor(
    kind: ApiErrorKind,
    message: string,
    status = 0,
    issues?: ApiIssue[],
  ) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.issues = issues;
  }
}

/**
 * True for the two failure modes that mean "the data layer is unreachable"
 * (transport failure or a 5xx). The `<ErrorBanner>` retry UI is meant for
 * exactly these; 400/404 are param/name bugs and should be handled inline.
 */
export function isConnectionError(err: unknown): boolean {
  return err instanceof ApiError && (err.kind === "network" || err.kind === "server");
}

/** Shape of a successful `POST /api/query/:name` response. */
interface QueryEnvelope<T> {
  name: string;
  rows: T[];
}

/**
 * POST params to `/api/query/:name` and return the `rows` array typed as `T[]`.
 * Throws {@link ApiError} on any non-2xx response or transport failure — the
 * caller never has to inspect `res.ok` or parse error bodies itself.
 *
 * @typeParam T   the row shape for this query (see `queries.ts` for the map).
 * @param name    the query name, e.g. `"who_touched"`.
 * @param params  the query params object (validated server-side by zod).
 * @param signal  optional AbortSignal to cancel an in-flight request.
 */
export async function runQuery<T>(
  name: string,
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T[]> {
  let res: Response;
  try {
    res = await fetch(`/api/query/${encodeURIComponent(name)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params ?? {}),
      signal,
    });
  } catch (cause) {
    // fetch only rejects on transport-level failure (or an abort).
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ApiError(
      "network",
      "Could not reach the Cartograph API. Is the server running?",
    );
  }

  if (res.ok) {
    const body = (await res.json()) as QueryEnvelope<T>;
    return body.rows;
  }

  // Try to read a structured error body; tolerate empty/non-JSON bodies.
  let body: { message?: string; issues?: ApiIssue[] } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    /* ignore — fall back to status-based messaging */
  }

  if (res.status === 404) {
    throw new ApiError("notFound", body.message ?? `Unknown query "${name}".`, 404);
  }
  if (res.status === 400) {
    throw new ApiError(
      "validation",
      body.message ?? "Invalid query parameters.",
      400,
      body.issues,
    );
  }
  throw new ApiError(
    "server",
    body.message ?? `The query failed (HTTP ${res.status}). The database may be unreachable.`,
    res.status,
  );
}
