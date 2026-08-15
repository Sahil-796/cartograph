import { BadRequestException, Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ChatService } from './chat.service';
import type { ChatMessage, ChatRequest, ChatResponse } from './chat.types';

/**
 * The chat front door: `POST /api/chat`. Validates the request into the
 * frozen `ChatRequest` shape (400 on anything malformed) and hands off to
 * `ChatService`, which runs the Groq tool-use loop. Prefixed `api/` here to
 * match the plan's route (main.ts sets no global prefix — see QueryController).
 */
@Controller('api/chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  @HttpCode(200)
  async chat(@Body() body: unknown): Promise<ChatResponse> {
    return this.chatService.chat(validate(body));
  }
}

/** Enforces `{ repoId: string, messages: {role, content}[] }`, throwing a 400 otherwise. */
function validate(body: unknown): ChatRequest {
  if (!body || typeof body !== 'object') {
    throw new BadRequestException('request body must be a JSON object');
  }
  const { repoId, messages } = body as Record<string, unknown>;

  if (typeof repoId !== 'string' || repoId.length === 0) {
    throw new BadRequestException('repoId is required and must be a non-empty string');
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new BadRequestException('messages is required and must be a non-empty array');
  }

  const validated: ChatMessage[] = messages.map((m, i) => {
    if (!m || typeof m !== 'object') {
      throw new BadRequestException(`messages[${i}] must be an object`);
    }
    const { role, content } = m as Record<string, unknown>;
    if (role !== 'user' && role !== 'assistant') {
      throw new BadRequestException(`messages[${i}].role must be "user" or "assistant"`);
    }
    if (typeof content !== 'string') {
      throw new BadRequestException(`messages[${i}].content must be a string`);
    }
    return { role, content };
  });

  return { repoId, messages: validated };
}
