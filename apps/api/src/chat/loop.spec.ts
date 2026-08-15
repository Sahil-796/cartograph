import { describe, expect, it, vi } from 'vitest';
import { extractNodes } from './nodes';
import { MAX_TOOL_STEPS, runChatLoop, type LoopDeps } from './loop';
import type { GroqAssistantMessage, GroqMessage } from './groq';

/**
 * Pure unit tests — no live DB, no real Groq key. The loop's I/O (Groq call,
 * `getQuery`, `executeQuery`) is injected and mocked, so this exercises the
 * graded core: citation-id assignment, node extraction, the tool-message
 * shape fed back to the model, and the step cap.
 */

describe('extractNodes', () => {
  it('maps who_touched rows to author nodes', () => {
    const rows = [
      { name: 'Ada', email: 'ada@x.io', weight: 3, files: 2, lastTouch: 1 },
      { name: 'Bo', email: 'bo@x.io', weight: 1, files: 1, lastTouch: 1 },
    ];
    expect(extractNodes('who_touched', rows)).toEqual([
      { kind: 'author', ref: 'Ada' },
      { kind: 'author', ref: 'Bo' },
    ]);
  });

  it('maps search rows to file vs symbol by type, skipping entrypoints', () => {
    const rows = [
      { type: 'file', id: 'src/a.ts', name: 'src/a.ts', path: 'src/a.ts' },
      { type: 'symbol', id: 's1', name: 'handleRequest', path: 'src/router.ts' },
      { type: 'entrypoint', id: 'e1', name: '/health', path: '/health' },
    ];
    expect(extractNodes('search', rows)).toEqual([
      { kind: 'file', ref: 'src/a.ts' },
      { kind: 'symbol', ref: 'src/router.ts#handleRequest' },
    ]);
  });

  it('maps hidden_coupling both endpoints and dedupes', () => {
    const rows = [
      { a: 'src/a.ts', b: 'src/b.ts', count: 3, strength: 0.5 },
      { a: 'src/a.ts', b: 'src/c.ts', count: 2, strength: 0.4 },
    ];
    expect(extractNodes('hidden_coupling', rows)).toEqual([
      { kind: 'file', ref: 'src/a.ts' },
      { kind: 'file', ref: 'src/b.ts' },
      { kind: 'file', ref: 'src/c.ts' },
    ]);
  });

  it('drills into bus_factor contributors', () => {
    const rows = [{ busFactor: 2, contributors: [{ name: 'Ada' }, { name: 'Bo' }] }];
    expect(extractNodes('bus_factor', rows)).toEqual([
      { kind: 'author', ref: 'Ada' },
      { kind: 'author', ref: 'Bo' },
    ]);
  });

  it('handles file_graph node and edge rows', () => {
    const rows = [
      { kind: 'node', path: 'src/a.ts', ext: '.ts', loc: 10, isTest: false, isGenerated: false },
      { kind: 'edge', fromPath: 'src/a.ts', toPath: 'src/b.ts', weight: 1 },
    ];
    expect(extractNodes('file_graph', rows)).toEqual([
      { kind: 'file', ref: 'src/a.ts' },
      { kind: 'file', ref: 'src/b.ts' },
    ]);
  });

  it('is defensive: unknown query name or bad rows yield []', () => {
    expect(extractNodes('not_a_query', [{ path: 'x' }])).toEqual([]);
    expect(extractNodes('search', null)).toEqual([]);
    expect(extractNodes('who_touched', [null, 42, {}])).toEqual([]);
  });
});

/** Scripts a fake Groq that returns each queued assistant message in order. */
function scriptGroq(turns: GroqAssistantMessage[]) {
  const calls: { messages: GroqMessage[]; toolChoice: string; hadTools: boolean }[] = [];
  let i = 0;
  const callGroq = vi.fn(
    async (messages: GroqMessage[], tools: unknown, toolChoice: string): Promise<GroqAssistantMessage> => {
      calls.push({ messages: [...messages], toolChoice, hadTools: Array.isArray(tools) && tools.length > 0 });
      return turns[i++] ?? { role: 'assistant', content: 'done', tool_calls: undefined };
    },
  );
  return { callGroq, calls };
}

function baseDeps(callGroq: LoopDeps['callGroq'], executeQuery: LoopDeps['executeQuery']): LoopDeps {
  return {
    callGroq,
    executeQuery,
    getQuery: (name: string) => ({ name }),
    toOpenAITools: () => [
      { type: 'function', function: { name: 'who_touched', description: '', parameters: {} as never } },
    ],
  };
}

describe('runChatLoop', () => {
  it('assigns citation ids in call order and feeds each id back in the tool message', async () => {
    const { callGroq, calls } = scriptGroq([
      // Turn 1: two tool calls.
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'tc1', type: 'function', function: { name: 'who_touched', arguments: JSON.stringify({ repoId: 'hono', path: 'src/router' }) } },
          { id: 'tc2', type: 'function', function: { name: 'search', arguments: JSON.stringify({ repoId: 'hono', term: 'router' }) } },
        ],
      },
      // Turn 2: final answer citing both.
      { role: 'assistant', content: 'Ada owns it [c1]; router.ts matches [c2].', tool_calls: undefined },
    ]);

    const executeQuery = vi.fn(async (def: { name: string }) => {
      if (def.name === 'who_touched') return [{ name: 'Ada', email: 'a@x', weight: 1, files: 1, lastTouch: 1 }];
      return [{ type: 'file', id: 'src/router.ts', name: 'src/router.ts', path: 'src/router.ts' }];
    });

    const res = await runChatLoop(baseDeps(callGroq, executeQuery), 'hono', [
      { role: 'user', content: 'who owns the router?' },
    ]);

    expect(res.answer).toBe('Ada owns it [c1]; router.ts matches [c2].');
    expect(res.citations.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(res.citations[0]).toMatchObject({
      id: 'c1',
      tool: 'who_touched',
      args: { repoId: 'hono', path: 'src/router' },
      nodes: [{ kind: 'author', ref: 'Ada' }],
    });
    expect(res.citations[0].summary).toContain('who_touched');
    expect(res.citations[1].nodes).toEqual([{ kind: 'file', ref: 'src/router.ts' }]);
    expect(res.steps).toEqual([
      { tool: 'who_touched', args: { repoId: 'hono', path: 'src/router' }, citationId: 'c1', rowCount: 1 },
      { tool: 'search', args: { repoId: 'hono', term: 'router' }, citationId: 'c2', rowCount: 1 },
    ]);

    // The tool messages fed back to the model carry the assigned citation id.
    const secondCallMessages = calls[1].messages;
    const toolMessages = secondCallMessages.filter((m) => m.role === 'tool');
    expect(toolMessages).toHaveLength(2);
    expect(JSON.parse(toolMessages[0].content as string).citationId).toBe('c1');
    expect(JSON.parse(toolMessages[1].content as string).citationId).toBe('c2');
  });

  it('returns immediately when the model answers with no tool calls', async () => {
    const { callGroq } = scriptGroq([{ role: 'assistant', content: 'The tools do not expose that.', tool_calls: undefined }]);
    const executeQuery = vi.fn();
    const res = await runChatLoop(baseDeps(callGroq, executeQuery), 'hono', [{ role: 'user', content: 'hi' }]);
    expect(res.answer).toBe('The tools do not expose that.');
    expect(res.citations).toEqual([]);
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it('pins every tool invocation to the repository requested by the user', async () => {
    const { callGroq } = scriptGroq([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'tc1', type: 'function', function: { name: 'search', arguments: JSON.stringify({ repoId: 'another-repo', term: 'router' }) } },
        ],
      },
      { role: 'assistant', content: 'done [c1]', tool_calls: undefined },
    ]);
    const executeQuery = vi.fn(async () => []);

    await runChatLoop(baseDeps(callGroq, executeQuery), 'hono', [{ role: 'user', content: 'search' }]);

    expect(executeQuery).toHaveBeenCalledWith(expect.anything(), { repoId: 'hono', term: 'router' });
  });

  it('caps tool execution at MAX_TOOL_STEPS then forces a tool-less final turn', async () => {
    // Every turn asks for one more tool call; the loop must stop offering
    // tools after the cap and force a final answer.
    const turns: GroqAssistantMessage[] = Array.from({ length: MAX_TOOL_STEPS }, (_, k) => ({
      role: 'assistant' as const,
      content: null,
      tool_calls: [
        { id: `tc${k}`, type: 'function' as const, function: { name: 'who_touched', arguments: JSON.stringify({ repoId: 'hono' }) } },
      ],
    }));
    turns.push({ role: 'assistant', content: 'final', tool_calls: undefined });

    const { callGroq, calls } = scriptGroq(turns);
    const executeQuery = vi.fn(async () => [{ name: 'Ada', email: 'a@x', weight: 1, files: 1, lastTouch: 1 }]);

    const res = await runChatLoop(baseDeps(callGroq, executeQuery), 'hono', [{ role: 'user', content: 'go' }]);

    expect(executeQuery).toHaveBeenCalledTimes(MAX_TOOL_STEPS);
    expect(res.citations).toHaveLength(MAX_TOOL_STEPS);
    expect(res.answer).toBe('final');
    // The final call must have been made with no tools offered (tool_choice none).
    const lastCall = calls[calls.length - 1];
    expect(lastCall.hadTools).toBe(false);
    expect(lastCall.toolChoice).toBe('none');
  });
});
