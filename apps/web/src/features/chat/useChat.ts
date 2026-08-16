/**
 * `useChat` — owns the conversation for the `ChatPanel`.
 *
 * Keeps a display-level turn list (user + assistant, assistant turns carry
 * their `citations`/`steps`), sends the running history to `postChat` on each
 * new user turn, and exposes a `status` the panel renders states from:
 *   - "idle"          — nothing in flight, no error.
 *   - "loading"        — a request is in flight ("composing tools…").
 *   - "notConfigured"  — the backend answered 503 (no API key configured).
 *   - "error"          — any other failure (network/500/400); `error` holds it.
 */

import { useCallback, useRef, useState } from "react";
import { postChat, isChatNotConfigured, isChatRateLimited } from "./chatApi";
import type { ChatMessage, ChatRole, Citation, ChatStep } from "./types";

export interface ChatTurn {
  id: string;
  role: ChatRole;
  content: string;
  /** Assistant turns only. */
  citations?: Citation[];
  steps?: ChatStep[];
}

export type ChatStatus = "idle" | "loading" | "notConfigured" | "rateLimited" | "error";

let turnSeq = 0;
const nextId = () => `t${++turnSeq}`;

export function useChat(repoId: string) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [error, setError] = useState<Error | null>(null);

  // Mirror of `turns` for reads inside callbacks. `run` must be triggered
  // *outside* any `setTurns` updater: React StrictMode invokes state updaters
  // twice in dev to surface impurity, so a fetch launched from inside one fires
  // twice and produces a duplicate assistant turn. We keep the updaters pure
  // and drive the request from this ref instead.
  const turnsRef = useRef<ChatTurn[]>([]);
  const commit = useCallback((next: ChatTurn[]) => {
    turnsRef.current = next;
    setTurns(next);
  }, []);

  const run = useCallback(
    async (history: ChatTurn[]) => {
      setStatus("loading");
      setError(null);
      const wire: ChatMessage[] = history.map((t) => ({ role: t.role, content: t.content }));
      try {
        const res = await postChat(repoId, wire);
        commit([
          ...history,
          {
            id: nextId(),
            role: "assistant",
            content: res.answer,
            citations: res.citations,
            steps: res.steps,
          },
        ]);
        setStatus("idle");
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Chat failed."));
        setStatus(
          isChatNotConfigured(err)
            ? "notConfigured"
            : isChatRateLimited(err)
              ? "rateLimited"
              : "error",
        );
      }
    },
    [repoId, commit],
  );

  const send = useCallback(
    (content: string) => {
      const trimmed = content.trim();
      if (!trimmed || status === "loading") return;
      const next: ChatTurn[] = [...turnsRef.current, { id: nextId(), role: "user", content: trimmed }];
      commit(next);
      void run(next);
    },
    [run, status, commit],
  );

  /** Resend the current history as-is (e.g. after a transient 500). */
  const retry = useCallback(() => {
    if (status === "loading") return;
    void run(turnsRef.current);
  }, [run, status]);

  return { turns, status, error, send, retry };
}
