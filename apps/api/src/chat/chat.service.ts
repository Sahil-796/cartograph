import { HttpException, Injectable, InternalServerErrorException, ServiceUnavailableException } from '@nestjs/common';
import { callGroq, llmApiKey } from './groq';
import { loadChatDeps } from './chat-graph-loader';
import { runChatLoop } from './loop';
import type { ChatRequest, ChatResponse } from './chat.types';

/**
 * Wires the pure `runChatLoop` to its real dependencies: the Groq client and
 * the ESM `@cartograph/graph` + `@cartograph/tools` packages (loaded across
 * the CJS boundary via `loadChatDeps`). Translates failure modes into the
 * frozen error contract — 503 when the key is unset, 500 on Groq/DB errors.
 */
@Injectable()
export class ChatService {
  async chat(request: ChatRequest): Promise<ChatResponse> {
    // 503 so the frontend can show "chat isn't configured" rather than a
    // generic failure. Checked before any DB/graph work.
    if (!llmApiKey()) {
      throw new ServiceUnavailableException('chat is not configured: LLM_API_KEY is unset');
    }

    let deps;
    try {
      const graphDeps = await loadChatDeps();
      deps = { callGroq, ...graphDeps };
    } catch (err) {
      throw new InternalServerErrorException(`failed to load query tools: ${messageOf(err)}`);
    }

    try {
      return await runChatLoop(deps, request.repoId, request.messages);
    } catch (err) {
      // Re-thrown Nest HTTP exceptions (shouldn't occur here) pass through.
      if (err instanceof HttpException) throw err;
      const msg = messageOf(err);
      // A provider rate limit is expected on free tiers — surface it as a clean
      // 429 with the wait time, not a 500 dumping the raw upstream JSON.
      const rateLimited = parseRateLimit(msg);
      if (rateLimited) throw new HttpException(rateLimited, 429);
      throw new InternalServerErrorException(`chat failed: ${msg}`);
    }
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * If `msg` is an upstream rate-limit error (Groq 429, Gemini `RESOURCE_EXHAUSTED`,
 * OpenAI-style `rate_limit`), return a short human message with the suggested
 * wait; otherwise `null`. Keeps the giant provider JSON out of the UI.
 */
function parseRateLimit(msg: string): string | null {
  const isRateLimit = /\b429\b|rate[_ ]?limit|RESOURCE_EXHAUSTED|quota/i.test(msg);
  if (!isRateLimit) return null;
  // Prefer a plain-seconds wait ("retry in 16.37s" → "~17s"); fall back to a
  // compound token ("try again in 12m40s").
  let wait: string | undefined;
  const secs = msg.match(/(?:retry|try again) in\s+([\d.]+)s\b/i);
  if (secs) {
    wait = `${Math.ceil(parseFloat(secs[1]))}s`;
  } else {
    wait = msg.match(/(?:retry|try again) in\s+([0-9hms.]+)/i)?.[1]?.replace(/\.+$/, '');
  }
  return wait
    ? `Rate limit reached on the free tier. Please wait ~${wait} and try again.`
    : 'Rate limit reached on the free tier. Please wait a moment and try again.';
}
