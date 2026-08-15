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

import { useCallback, useState } from "react";
import { postChat, isChatNotConfigured } from "./chatApi";
import type { ChatMessage, ChatRole, Citation, ChatStep } from "./types";

export interface ChatTurn {
  id: string;
  role: ChatRole;
  content: string;
  /** Assistant turns only. */
  citations?: Citation[];
  steps?: ChatStep[];
}

export type ChatStatus = "idle" | "loading" | "notConfigured" | "error";

let turnSeq = 0;
const nextId = () => `t${++turnSeq}`;

export function useChat(repoId: string) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [error, setError] = useState<Error | null>(null);

  const run = useCallback(
    async (history: ChatTurn[]) => {
      setStatus("loading");
      setError(null);
      const wire: ChatMessage[] = history.map((t) => ({ role: t.role, content: t.content }));
      try {
        const res = await postChat(repoId, wire);
        setTurns((prev) => [
          ...prev,
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
        setStatus(isChatNotConfigured(err) ? "notConfigured" : "error");
      }
    },
    [repoId],
  );

  const send = useCallback(
    (content: string) => {
      const trimmed = content.trim();
      if (!trimmed || status === "loading") return;
      setTurns((prev) => {
        const next: ChatTurn[] = [...prev, { id: nextId(), role: "user", content: trimmed }];
        void run(next);
        return next;
      });
    },
    [run, status],
  );

  /** Resend the current history as-is (e.g. after a transient 500). */
  const retry = useCallback(() => {
    setTurns((prev) => {
      void run(prev);
      return prev;
    });
  }, [run]);

  return { turns, status, error, send, retry };
}
