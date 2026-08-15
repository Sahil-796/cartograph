import { useState, type FormEvent, type ReactNode } from "react";

import { useRepoStore } from "../../state/repoStore";
import { ApiError } from "../../lib/api";
import { CitationChip } from "./CitationChip";
import { useChat, type ChatTurn } from "./useChat";
import type { Citation } from "./types";
import "./chat.css";

export interface ChatPanelProps {
  /** The repo in view (from the `/r/:repoId` route param). */
  repoId: string;
}

const EXAMPLES = [
  "Who owns the router?",
  "If the top contributor left, which entrypoints are at risk?",
  "What's the most tightly coupled pair of files here?",
];

/** Splits an assistant answer on `[cN]` markers, rendering each as a
 * `CitationChip` when it resolves to a known citation (falls back to plain
 * text for a stray/unmatched marker). */
function renderAnswer(
  content: string,
  citations: Citation[],
  activeId: string | null,
  onCiteClick: (c: Citation) => void,
): ReactNode[] {
  const byId = new Map(citations.map((c) => [c.id, c]));
  const marker = /\[(c\d+)\]/g;
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(content)) !== null) {
    if (match.index > lastIndex) parts.push(content.slice(lastIndex, match.index));
    const citation = byId.get(match[1]);
    if (citation) {
      parts.push(
        <CitationChip
          key={`${match.index}-${match[1]}`}
          citation={citation}
          active={activeId === citation.id}
          onClick={() => onCiteClick(citation)}
        />,
      );
    } else {
      parts.push(match[0]);
    }
    lastIndex = marker.lastIndex;
  }
  if (lastIndex < content.length) parts.push(content.slice(lastIndex));
  return parts;
}

function StepsTrace({ steps }: { steps: NonNullable<ChatTurn["steps"]> }) {
  if (steps.length === 0) return null;
  return (
    <details className="chat-steps">
      <summary>
        Composed {steps.length} tool call{steps.length === 1 ? "" : "s"}
      </summary>
      <ul className="chat-steps__list">
        {steps.map((s, i) => (
          <li key={`${s.citationId}-${i}`} className="chat-steps__row">
            <span className="mono chat-steps__tool">{s.tool}</span>
            <span className="chat-steps__rows">
              {s.rowCount} row{s.rowCount === 1 ? "" : "s"}
            </span>
            <span className="chat-steps__cite">{s.citationId}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export default function ChatPanel({ repoId }: ChatPanelProps) {
  const { turns, status, error, send, retry } = useChat(repoId);
  const [draft, setDraft] = useState("");
  const [activeCitationId, setActiveCitationId] = useState<string | null>(null);
  const highlightNodes = useRepoStore((s) => s.highlightNodes);
  const clearHighlight = useRepoStore((s) => s.clearHighlight);

  const loading = status === "loading";
  const notConfigured = status === "notConfigured";

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim() || loading) return;
    send(draft);
    setDraft("");
  };

  const handleExample = (q: string) => {
    if (loading) return;
    send(q);
  };

  const handleCiteClick = (citation: Citation) => {
    if (activeCitationId === citation.id) {
      clearHighlight();
      setActiveCitationId(null);
    } else {
      highlightNodes(citation.nodes);
      setActiveCitationId(citation.id);
    }
  };

  const empty = turns.length === 0 && status === "idle";

  return (
    <div className="chat-panel">
      <header className="chat-panel__header">
        <div>
          <div className="chat-panel__eyebrow">Ask Cartograph</div>
          <div className="chat-panel__hint">Answers cite the tools that support them.</div>
        </div>
        {activeCitationId ? (
          <button
            type="button"
            className="chat-panel__clear"
            onClick={() => {
              clearHighlight();
              setActiveCitationId(null);
            }}
          >
            Clear highlight
          </button>
        ) : null}
      </header>

      <div className="chat-panel__body" role="log" aria-live="polite">
        {empty ? (
          <div className="chat-empty">
            <div className="chat-empty__icon" aria-hidden="true">
              ✦
            </div>
            <div className="chat-empty__title">Ask about this repo</div>
            <p className="chat-empty__body">
              Cartograph composes the fixed query tools and answers with citations —
              click one to highlight what it's talking about on the map.
            </p>
            <div className="chat-empty__examples">
              {EXAMPLES.map((q) => (
                <button
                  key={q}
                  type="button"
                  className="chat-example"
                  onClick={() => handleExample(q)}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {turns.map((t) => (
          <div key={t.id} className={`chat-turn chat-turn--${t.role}`}>
            <div className="chat-turn__bubble">
              {t.role === "assistant" && t.citations
                ? renderAnswer(t.content, t.citations, activeCitationId, handleCiteClick)
                : t.content}
            </div>
            {t.role === "assistant" && t.steps ? <StepsTrace steps={t.steps} /> : null}
          </div>
        ))}

        {loading ? (
          <div className="chat-turn chat-turn--assistant">
            <div className="chat-turn__bubble chat-turn__bubble--thinking">
              <span className="chat-thinking__dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              composing tools…
            </div>
          </div>
        ) : null}

        {notConfigured ? (
          <div className="chat-state chat-state--info">
            <div className="chat-state__title">Chat isn't configured</div>
            <p className="chat-state__body">
              This deployment hasn't set an API key for the chat backend. Ask an admin
              to configure one — the map and side panel still work without it.
            </p>
          </div>
        ) : null}

        {status === "error" ? (
          <div className="chat-state chat-state--error">
            <div className="chat-state__title">Something went wrong</div>
            <p className="chat-state__body">
              {error instanceof ApiError ? error.message : "The chat request failed."}
            </p>
            <button type="button" className="btn" onClick={retry}>
              Retry
            </button>
          </div>
        ) : null}
      </div>

      <form className="chat-panel__composer" onSubmit={handleSubmit}>
        <input
          className="chat-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={
            notConfigured ? "Chat isn't configured" : "Ask about owners, coupling, risk…"
          }
          disabled={notConfigured}
          aria-label="Ask a question about this repo"
        />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={notConfigured || loading || !draft.trim()}
        >
          Send
        </button>
      </form>
    </div>
  );
}
