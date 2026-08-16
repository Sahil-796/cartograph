/**
 * Minimal OpenAI-compatible chat client.
 *
 * Groq, Gemini (`/v1beta/openai`), Cerebras, OpenRouter and friends all expose
 * the same OpenAI Chat Completions wire shape, so we speak it directly with
 * Node's global `fetch` — no SDK dependency (which would drag ESM-in-CJS pain
 * into this CommonJS Nest app). Only the fields this loop actually uses are
 * typed. The provider is chosen entirely by env (see `llmBaseUrl`/`llmApiKey`/
 * `llmModel`), so switching is a `.env` edit, never a code change.
 */
import type { OpenAITool } from './chat-graph-loader';

/**
 * Base URL of the OpenAI-compatible endpoint, WITHOUT the trailing
 * `/chat/completions`. Defaults to Groq for backward compatibility. Examples:
 *   - Groq:       https://api.groq.com/openai/v1
 *   - Gemini:     https://generativelanguage.googleapis.com/v1beta/openai
 *   - Cerebras:   https://api.cerebras.ai/v1
 *   - OpenRouter: https://openrouter.ai/api/v1
 */
function llmBaseUrl(): string {
  const base = process.env.LLM_BASE_URL?.trim() || 'https://api.groq.com/openai/v1';
  return base.replace(/\/+$/, ''); // tolerate a trailing slash in the env value
}

/** Resolved chat-completions endpoint. */
function llmEndpoint(): string {
  return `${llmBaseUrl()}/chat/completions`;
}

/** API key for the chosen provider. `LLM_API_KEY` wins; `GROQ_API_KEY` is the
 * legacy fallback so existing Groq setups keep working untouched. */
export function llmApiKey(): string | undefined {
  return process.env.LLM_API_KEY?.trim() || process.env.GROQ_API_KEY?.trim() || undefined;
}

const DEFAULT_MODEL = 'openai/gpt-oss-120b';

/** How many times to retry a rate-limited / transiently-failed Groq call before giving up. */
const MAX_RETRIES = 3;
/**
 * Longest server-advised `retry-after` we auto-wait inside a single request. A
 * brief blip (a token burst, an upstream 5xx — a few seconds) is worth waiting
 * out silently; anything longer (a per-minute request cap answers "retry in
 * ~16s", a daily cap answers "try again in 12m") we do NOT sit on — a long
 * in-request wait just turns a clear "rate limited, wait ~16s" message into a
 * blank multi-second spinner. We bail fast and let the caller surface it.
 */
const MAX_BACKOFF_MS = 5_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Groq's free tier rate-limits with 429 (plus a `retry-after` header in
 * seconds); 503/502/500 are transient upstream blips. Short waits are retried
 * with the server-advised delay (or an exponential backoff when none is given);
 * a `retry-after` longer than `MAX_BACKOFF_MS` — i.e. the daily-budget wall — is
 * returned straight away rather than waited out. Returns the settled `Response`;
 * the caller handles non-2xx.
 */
async function fetchWithRetry(body: string, apiKey: string): Promise<Response> {
  let lastRes: Response | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const res = await fetch(llmEndpoint(), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body,
    });

    if (res.ok || (res.status !== 429 && res.status < 500)) return res;
    lastRes = res;
    if (attempt === MAX_RETRIES) break;

    // Prefer the server's advice; fall back to exponential backoff (1s, 2s, 4s…).
    const retryAfter = Number(res.headers.get('retry-after'));
    const backoff =
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000;
    // A wait longer than the ceiling is a daily-budget block, not a transient
    // burst — don't sit on it, fail fast so the user sees the real message.
    if (backoff > MAX_BACKOFF_MS) break;
    await sleep(backoff);
  }
  return lastRes as Response;
}

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

/** Reads the model id from env. `LLM_MODEL` wins; `GROQ_MODEL` is the legacy
 * fallback; finally an open gpt-oss model on Groq. */
export function llmModel(): string {
  return process.env.LLM_MODEL?.trim() || process.env.GROQ_MODEL?.trim() || DEFAULT_MODEL;
}

/** Temperatures tried in order when the model emits a schema-invalid tool call (see below). */
const TOOL_RETRY_TEMPERATURES = [0, 0.4, 0.7];

/** True when a Groq 400 body is the "model produced a tool call that fails schema validation" error. */
function isToolUseFailed(status: number, detail: string): boolean {
  return status === 400 && detail.includes('tool_use_failed');
}

/** Fires one Groq completion at the given temperature and returns the raw Response. */
async function postCompletion(
  messages: GroqMessage[],
  tools: OpenAITool[] | undefined,
  toolChoice: ToolChoice,
  temperature: number,
  apiKey: string,
): Promise<Response> {
  const body: Record<string, unknown> = { model: llmModel(), messages, temperature };
  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = toolChoice;
  }
  return fetchWithRetry(JSON.stringify(body), apiKey);
}

/**
 * Real Groq call. Sends `messages` (+ optional tools) and returns the first
 * choice's assistant message.
 *
 * Two upstream failure modes are handled here so the chat surface stays usable
 * on Groq's free tier instead of 500-ing:
 *  - Rate limits / transient 5xx are retried by `fetchWithRetry` (honouring
 *    `retry-after`).
 *  - `tool_use_failed` (HTTP 400): the model sometimes emits a tool call whose
 *    arguments violate the tool's JSON schema (e.g. `search` with an empty
 *    `term`), and Groq rejects the *entire* completion. At `temperature: 0`
 *    this is deterministic, so we re-ask at increasing temperatures to shake
 *    the model off the bad generation, and — if it still won't produce a valid
 *    call — fall back to a tools-disabled completion so the user gets a plain
 *    answer rather than an error.
 *
 * Still throws on a missing key or an unrecoverable non-2xx response — the
 * service maps those to 503/500.
 */
export const callGroq: CallGroq = async (messages, tools, toolChoice) => {
  const apiKey = llmApiKey();
  if (!apiKey) throw new Error('LLM_API_KEY (or GROQ_API_KEY) is not set');

  let lastDetail = '';
  for (const temperature of TOOL_RETRY_TEMPERATURES) {
    const res = await postCompletion(messages, tools, toolChoice, temperature, apiKey);
    if (res.ok) return readAssistant(await res.json());

    lastDetail = await res.text().catch(() => '');
    // Only tool_use_failed is worth re-asking; any other non-2xx is terminal.
    if (!isToolUseFailed(res.status, lastDetail)) {
      throw new Error(`Groq request failed (${res.status}): ${lastDetail.slice(0, 500)}`);
    }
  }

  // The model never produced a schema-valid tool call. Ask once more with tools
  // off so it must answer in prose — better a plain reply than a 500.
  const fallback = await postCompletion(messages, undefined, 'none', 0, apiKey);
  if (fallback.ok) return readAssistant(await fallback.json());
  const detail = (await fallback.text().catch(() => '')) || lastDetail;
  throw new Error(`Groq request failed (${fallback.status}): ${detail.slice(0, 500)}`);
};

/** Pulls the first choice's assistant message off a Groq completion body. */
function readAssistant(json: unknown): GroqAssistantMessage {
  const message = (json as { choices?: { message?: GroqAssistantMessage }[] }).choices?.[0]?.message;
  if (!message) throw new Error('Groq response contained no message');
  return {
    role: 'assistant',
    content: message.content ?? null,
    tool_calls: message.tool_calls,
  };
}
