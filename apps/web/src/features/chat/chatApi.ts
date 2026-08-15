/**
 * Typed client for `POST /api/chat` (Phase 5 / Unit C).
 *
 * Mirrors `lib/api.ts`'s fetch/error style so the rest of the UI can key off
 * the same `ApiError`/`isConnectionError` helpers, without modifying that
 * file. The one wrinkle vs. `runQuery`: the chat contract has a THIRD failure
 * mode — `503 { message }` when chat isn't configured (no API key) — which we
 * surface as `kind: "server"` with `status === 503` so callers can tell it
 * apart from a real `500` with `isChatNotConfigured()`.
 */

import { ApiError, type ApiIssue } from "../../lib/api";
import type { ChatMessage, ChatResponse } from "./types";

/** True when the failure means "chat isn't configured" (503), not a real
 * backend/db failure. The UI should render a friendly notice, not a crash. */
export function isChatNotConfigured(err: unknown): boolean {
  return err instanceof ApiError && err.status === 503;
}

/**
 * POST a conversation to `/api/chat` and return the parsed {@link ChatResponse}.
 * Throws {@link ApiError} on any non-2xx response or transport failure.
 */
export async function postChat(
  repoId: string,
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<ChatResponse> {
  let res: Response;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoId, messages }),
      signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ApiError(
      "network",
      "Could not reach the Cartograph API. Is the server running?",
    );
  }

  if (res.ok) {
    return (await res.json()) as ChatResponse;
  }

  let body: { message?: string; issues?: ApiIssue[] } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    /* ignore — fall back to status-based messaging */
  }

  if (res.status === 400) {
    throw new ApiError(
      "validation",
      body.message ?? "Invalid chat request.",
      400,
      body.issues,
    );
  }
  if (res.status === 503) {
    throw new ApiError(
      "server",
      body.message ?? "Chat isn't configured for this deployment.",
      503,
    );
  }
  throw new ApiError(
    "server",
    body.message ?? `Chat failed (HTTP ${res.status}).`,
    res.status,
  );
}
