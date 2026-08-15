/**
 * The chat tool-use loop — the graded core of the chat backend.
 *
 * An LLM (Groq, OpenAI-compatible) answers a natural-language question about
 * one repo by *composing the tested query tools* rather than inventing
 * Cypher. Every tool result becomes a numbered Citation (`c1`, `c2`, …), and
 * the model is instructed to cite every factual claim with the matching
 * `[cN]` marker. Each citation also carries the map-addressable nodes the
 * frontend highlights when its chip is clicked.
 *
 * All I/O is injected via `LoopDeps` (the Groq call, plus `getQuery` /
 * `executeQuery` / `toOpenAITools` from the ESM graph+tools packages) so the
 * loop is a pure function of its dependencies — unit-tested with a mocked
 * Groq fetch and mocked `executeQuery`, no live DB or real key required.
 */
import type { CallGroq, GroqMessage } from './groq';
import type { OpenAITool } from './chat-graph-loader';
import type { Citation, ChatMessage, ChatResponse, ChatStep } from './chat.types';
import { extractNodes } from './nodes';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type QueryDefLike = any;

export interface LoopDeps {
  callGroq: CallGroq;
  getQuery: (name: string) => QueryDefLike | undefined;
  executeQuery: (def: QueryDefLike, params: unknown) => Promise<unknown>;
  toOpenAITools: () => OpenAITool[];
}

/** Cap on the number of tool executions before we force a final, tool-less answer. */
export const MAX_TOOL_STEPS = 6;

/** Rows per tool message sent back to the model — keeps `file_graph` on a big repo from blowing context. */
const MAX_ROWS_TO_MODEL = 30;

/** Builds the system prompt: pins the repoId, enforces per-call repoId, citations, and no-invention. */
export function buildSystemPrompt(repoId: string): string {
  return [
    'You are Cartograph, a code-cartography assistant. You answer questions about ONE repository',
    `by calling query tools — never by guessing. The repository you operate on is repoId="${repoId}".`,
    `EVERY tool call you make MUST include "repoId": "${repoId}" in its arguments.`,
    '',
    'Each tool result is returned to you as a JSON object with a "citationId" field (e.g. "c3") and its',
    'rows. When you state a fact drawn from a tool result, you MUST cite it inline using that result\'s',
    'marker in square brackets, formatted EXACTLY as [c3] (or [c1], [c2], …). Put the marker right after',
    'the claim it supports. Compose multiple tools when needed and cite each claim with the tool result',
    'it came from.',
    '',
    'If the available tools cannot answer the question, say so plainly and do not invent an answer,',
    'file names, authors, or numbers. It is correct to reply that the tools do not expose that information.',
  ].join('\n');
}

/** Short human label for a citation chip, e.g. `who_touched(path=src/router) → 3 result(s)`. */
function summarize(name: string, args: Record<string, unknown>, rowCount: number): string {
  const parts = Object.entries(args)
    .filter(([k]) => k !== 'repoId')
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`);
  const argStr = parts.join(', ');
  return `${name}(${argStr}) → ${rowCount} result(s)`;
}

function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Runs the loop to completion and returns the frozen `ChatResponse` shape.
 * Groq/DB errors propagate to the caller (the service maps them to 500).
 */
export async function runChatLoop(deps: LoopDeps, repoId: string, history: ChatMessage[]): Promise<ChatResponse> {
  const tools = deps.toOpenAITools();
  const messages: GroqMessage[] = [
    { role: 'system', content: buildSystemPrompt(repoId) },
    ...history.map((m): GroqMessage => ({ role: m.role, content: m.content })),
  ];

  const citations: Citation[] = [];
  const steps: ChatStep[] = [];
  let executed = 0;

  // Loop until the model answers without tool calls, or we hit the cap and
  // force one final tool-less turn.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const useTools = executed < MAX_TOOL_STEPS;
    const assistant = await deps.callGroq(
      messages,
      useTools ? tools : undefined,
      useTools ? 'auto' : 'none',
    );

    messages.push({
      role: 'assistant',
      content: assistant.content ?? null,
      tool_calls: assistant.tool_calls,
    });

    const toolCalls = assistant.tool_calls ?? [];
    if (!useTools || toolCalls.length === 0) {
      return { answer: assistant.content ?? '', citations, steps };
    }

    for (const call of toolCalls) {
      const name = call.function.name;
      const args = parseArgs(call.function.arguments);
      const id = `c${citations.length + 1}`;

      let rows: unknown[] = [];
      let toolContent: string;

      const def = deps.getQuery(name);
      if (!def) {
        toolContent = JSON.stringify({ citationId: id, error: `unknown tool "${name}"` });
      } else {
        rows = (await deps.executeQuery(def, args)) as unknown[];
        const rowArray = Array.isArray(rows) ? rows : [];
        toolContent = JSON.stringify({
          citationId: id,
          rowCount: rowArray.length,
          rows: rowArray.slice(0, MAX_ROWS_TO_MODEL),
        });
      }

      const rowArray = Array.isArray(rows) ? rows : [];
      citations.push({
        id,
        tool: name,
        args,
        summary: summarize(name, args, rowArray.length),
        nodes: extractNodes(name, rowArray),
      });
      steps.push({ tool: name, args, citationId: id, rowCount: rowArray.length });
      executed += 1;

      messages.push({ role: 'tool', tool_call_id: call.id, content: toolContent });
    }
  }
}
