/**
 * The FROZEN wire contract for `POST /api/chat`, shared by the controller,
 * service, and loop. The frontend unit builds against these exact field
 * names — do not rename anything here.
 */

/** A map-addressable node the frontend highlights when a citation chip is clicked. */
export interface CitationNode {
  /** `file` → path; `author` → name; `symbol` → "path#name". */
  kind: 'file' | 'author' | 'symbol';
  ref: string;
}

/** One tool result produced during the loop. */
export interface Citation {
  /** "c1","c2",… stable within this response, in tool-call order. */
  id: string;
  /** The query/tool name, e.g. "who_touched". */
  tool: string;
  args: Record<string, unknown>;
  /** One-line human label, e.g. "who_touched(path=src/router) → 3 result(s)". */
  summary: string;
  /** Map-addressable nodes to highlight (may be empty). */
  nodes: CitationNode[];
}

/** A single step in the transparency trace. */
export interface ChatStep {
  tool: string;
  args: Record<string, unknown>;
  citationId: string;
  rowCount: number;
}

/** The success body (HTTP 200). */
export interface ChatResponse {
  /** Final assistant text; contains inline citation markers like [c1] [c3]. */
  answer: string;
  /** One per tool result, in call order. */
  citations: Citation[];
  /** Trace for transparency. */
  steps: ChatStep[];
}

/** An inbound chat message from the client (only user/assistant turns). */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** The request body for `POST /api/chat`. */
export interface ChatRequest {
  repoId: string;
  messages: ChatMessage[];
}
