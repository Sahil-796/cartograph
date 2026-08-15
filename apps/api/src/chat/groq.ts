/**
 * Minimal Groq chat client.
 *
 * Groq exposes an OpenAI-compatible Chat Completions API, so we speak that
 * wire shape directly with Node's global `fetch` — no OpenAI SDK dependency
 * (which would drag ESM-in-CJS pain into this CommonJS Nest app). Only the
 * fields this loop actually uses are typed.
 */
import type { OpenAITool } from './chat-graph-loader';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'openai/gpt-oss-120b';

/** One OpenAI-style tool call the assistant asks us to execute. */
export interface GroqToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** A message in the Groq conversation (superset covering every role we send). */
export interface GroqMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: GroqToolCall[];
  tool_call_id?: string;
}

/** The assistant turn we read back off each completion. */
export interface GroqAssistantMessage {
  role: 'assistant';
  content: string | null;
  tool_calls?: GroqToolCall[];
}

type ToolChoice = 'auto' | 'none';

/** The narrow slice of the Groq client the loop depends on (mocked in tests). */
export type CallGroq = (
  messages: GroqMessage[],
  tools: OpenAITool[] | undefined,
  toolChoice: ToolChoice,
) => Promise<GroqAssistantMessage>;

/** Reads the model id from env, falling back to an open gpt-oss model on Groq. */
export function groqModel(): string {
  return process.env.GROQ_MODEL?.trim() || DEFAULT_MODEL;
}

/**
 * Real Groq call. Sends `messages` (+ optional tools) and returns the first
 * choice's assistant message. Throws on a missing key or a non-2xx response
 * — the service maps those to 503/500.
 */
export const callGroq: CallGroq = async (messages, tools, toolChoice) => {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY is not set');

  const body: Record<string, unknown> = {
    model: groqModel(),
    messages,
    temperature: 0,
  };
  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = toolChoice;
  }

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Groq request failed (${res.status}): ${detail.slice(0, 500)}`);
  }

  const json = (await res.json()) as {
    choices?: { message?: GroqAssistantMessage }[];
  };
  const message = json.choices?.[0]?.message;
  if (!message) throw new Error('Groq response contained no message');
  return {
    role: 'assistant',
    content: message.content ?? null,
    tool_calls: message.tool_calls,
  };
};
