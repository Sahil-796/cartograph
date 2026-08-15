import { HttpException, Injectable, InternalServerErrorException, ServiceUnavailableException } from '@nestjs/common';
import { callGroq } from './groq';
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
    if (!process.env.GROQ_API_KEY) {
      throw new ServiceUnavailableException('chat is not configured: GROQ_API_KEY is unset');
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
      // Re-thrown Nest HTTP exceptions (shouldn't occur here) pass through;
      // everything else — Groq failures, DB/Cypher errors — is a 500.
      if (err instanceof HttpException) throw err;
      throw new InternalServerErrorException(`chat failed: ${messageOf(err)}`);
    }
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
