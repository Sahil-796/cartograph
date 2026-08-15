/**
 * Local copy of the FROZEN `POST /api/chat` contract (Phase 5 / Unit C).
 * Do NOT import these from the backend package — this file is the web app's
 * own pinned copy so the UI can be built and typechecked independently.
 */

/** One turn in the conversation, as sent to / echoed by the backend. */
export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** What a citation points at on the map: a file path, an author name, or a
 * symbol ref formatted as `"path#name"`. */
export type CitationNodeKind = "file" | "author" | "symbol";

export interface CitationNode {
  kind: CitationNodeKind;
  ref: string;
}

/** One citation `[cN]` referenced inline in `ChatResponse.answer`. */
export interface Citation {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  summary: string;
  nodes: CitationNode[];
}

/** One tool call in the composition trace, tying back to its citation. */
export interface ChatStep {
  tool: string;
  args: Record<string, unknown>;
  citationId: string;
  rowCount: number;
}

export interface ChatRequest {
  repoId: string;
  messages: ChatMessage[];
}

/** Success (200) body. `answer` contains inline `[c1]`, `[c2]`, … markers,
 * each matching a `Citation.id` in `citations`. */
export interface ChatResponse {
  answer: string;
  citations: Citation[];
  steps: ChatStep[];
}
