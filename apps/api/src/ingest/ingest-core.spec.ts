import { describe, expect, it, vi } from 'vitest';
import {
  asRejection,
  describeJob,
  mapStatus,
  submitIngest,
  type JobView,
  type SubmitDeps,
} from './ingest-core';

/**
 * Pure unit tests — no live Redis, no DB, no network. The engine (precheck)
 * and the queue (enqueue) are injected and mocked, so this exercises the
 * graded core: the POST decision tree (400 reason mapping / 200 cached / 202
 * enqueue / 503 queue-down) and the GET job-state → response mapping
 * (queued/active/completed/failed incl. structured error).
 */

/** A fake `IngestRejected` — structurally what the engine throws across the CJS boundary. */
function rejection(reason: string, detail: string) {
  return { name: 'IngestRejected', reason, detail, message: detail };
}

function baseDeps(overrides: Partial<SubmitDeps> = {}): SubmitDeps {
  return {
    precheckRepo: vi.fn(async () => ({ repoId: 'honojs-hono', alreadyIngested: false })),
    asRejection,
    enqueue: vi.fn(async () => 'job-1'),
    ...overrides,
  };
}

describe('submitIngest', () => {
  it('enqueues a clean, not-yet-ingested repo and returns 202-shaped result', async () => {
    const enqueue = vi.fn(async () => 'job-42');
    const res = await submitIngest(baseDeps({ enqueue }), 'https://github.com/honojs/hono');
    expect(res).toEqual({ kind: 'queued', jobId: 'job-42' });
    expect(enqueue).toHaveBeenCalledWith('https://github.com/honojs/hono');
  });

  it('returns cached (200) without enqueueing when already ingested', async () => {
    const enqueue = vi.fn(async () => 'nope');
    const res = await submitIngest(
      baseDeps({
        precheckRepo: vi.fn(async () => ({ repoId: 'honojs-hono', alreadyIngested: true })),
        enqueue,
      }),
      'https://github.com/honojs/hono',
    );
    expect(res).toEqual({ kind: 'cached', repoId: 'honojs-hono' });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('maps a guardrail rejection to a 400-shaped result and never enqueues', async () => {
    const enqueue = vi.fn(async () => 'nope');
    const res = await submitIngest(
      baseDeps({
        precheckRepo: vi.fn(async () => {
          throw rejection('too_large', 'Repository is too large (max 50 MB).');
        }),
        enqueue,
      }),
      'https://github.com/big/repo',
    );
    expect(res).toEqual({
      kind: 'rejected',
      reason: 'too_large',
      message: 'Repository is too large (max 50 MB).',
    });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid_url', 'That is not a valid GitHub URL.'],
    ['not_found', 'Repository not found.'],
    ['unsupported_language', 'Only TypeScript/JavaScript repos are supported.'],
  ])('propagates the %s reason verbatim', async (reason, detail) => {
    const res = await submitIngest(
      baseDeps({
        precheckRepo: vi.fn(async () => {
          throw rejection(reason, detail);
        }),
      }),
      'https://github.com/x/y',
    );
    expect(res).toMatchObject({ kind: 'rejected', reason, message: detail });
  });

  it('returns unavailable (503) when the queue/Redis throws on enqueue', async () => {
    const res = await submitIngest(
      baseDeps({
        enqueue: vi.fn(async () => {
          throw new Error('ECONNREFUSED 127.0.0.1:6379');
        }),
      }),
      'https://github.com/honojs/hono',
    );
    expect(res).toEqual({ kind: 'unavailable', message: 'ECONNREFUSED 127.0.0.1:6379' });
  });

  it('rethrows an unexpected (non-rejection) precheck error for the controller to 500', async () => {
    await expect(
      submitIngest(
        baseDeps({
          precheckRepo: vi.fn(async () => {
            throw new Error('DNS meltdown');
          }),
        }),
        'https://github.com/x/y',
      ),
    ).rejects.toThrow('DNS meltdown');
  });
});

describe('asRejection', () => {
  it('narrows a structural IngestRejected', () => {
    expect(asRejection(rejection('not_found', 'nope'))).toEqual({ reason: 'not_found', message: 'nope' });
  });
  it('returns null for ordinary errors', () => {
    expect(asRejection(new Error('boom'))).toBeNull();
    expect(asRejection({ reason: 'not_found' })).toBeNull(); // missing name
    expect(asRejection(null)).toBeNull();
  });
});

describe('mapStatus', () => {
  it('maps BullMQ states to the frozen vocabulary', () => {
    expect(mapStatus('waiting')).toBe('queued');
    expect(mapStatus('delayed')).toBe('queued');
    expect(mapStatus('prioritized')).toBe('queued');
    expect(mapStatus('unknown')).toBe('queued');
    expect(mapStatus('active')).toBe('active');
    expect(mapStatus('completed')).toBe('completed');
    expect(mapStatus('failed')).toBe('failed');
  });
});

describe('describeJob', () => {
  const view = (over: Partial<JobView>): JobView => ({
    id: 'job-1',
    state: 'waiting',
    progress: undefined,
    returnvalue: undefined,
    ...over,
  });

  it('reports a queued job with the default phase', () => {
    expect(describeJob(view({ state: 'waiting' }))).toEqual({
      jobId: 'job-1',
      status: 'queued',
      phase: 'queued',
    });
  });

  it('reports the live phase + counts of an active job', () => {
    const res = describeJob(
      view({ state: 'active', progress: { phase: 'parsing', counts: { files: 12, symbols: 340 } } }),
    );
    expect(res).toEqual({
      jobId: 'job-1',
      status: 'active',
      phase: 'parsing',
      counts: { files: 12, symbols: 340 },
    });
  });

  it('omits counts when the progress object carries none', () => {
    const res = describeJob(view({ state: 'active', progress: { phase: 'cloning' } }));
    expect(res).toEqual({ jobId: 'job-1', status: 'active', phase: 'cloning' });
    expect(res).not.toHaveProperty('counts');
  });

  it('reports repoId + ready phase on completion', () => {
    const res = describeJob(
      view({
        state: 'completed',
        progress: { phase: 'ready', counts: { nodes: 900, edges: 1200 } },
        returnvalue: { repoId: 'honojs-hono', repoName: 'honojs/hono', nodes: 900, edges: 1200, cached: false },
      }),
    );
    expect(res).toMatchObject({
      jobId: 'job-1',
      status: 'completed',
      phase: 'ready',
      repoId: 'honojs-hono',
      counts: { nodes: 900, edges: 1200 },
    });
  });

  it('defaults phase to ready on completion even without a final progress event', () => {
    const res = describeJob(view({ state: 'completed', returnvalue: { repoId: 'x-y' } }));
    expect(res).toMatchObject({ status: 'completed', phase: 'ready', repoId: 'x-y' });
  });

  it('surfaces the structured error from stashed progress on failure', () => {
    const res = describeJob(
      view({
        state: 'failed',
        progress: { phase: 'failed', error: { reason: 'too_many_files', message: 'Too many source files.' } },
        failedReason: JSON.stringify({ reason: 'too_many_files', message: 'Too many source files.' }),
      }),
    );
    expect(res).toEqual({
      jobId: 'job-1',
      status: 'failed',
      phase: 'failed',
      error: { reason: 'too_many_files', message: 'Too many source files.' },
    });
  });

  it('decodes a JSON-encoded failedReason when no structured progress error exists', () => {
    const res = describeJob(
      view({
        state: 'failed',
        failedReason: JSON.stringify({ reason: 'not_found', message: 'Repository not found.' }),
      }),
    );
    expect(res.error).toEqual({ reason: 'not_found', message: 'Repository not found.' });
  });

  it('falls back to a plain failedReason string for non-guardrail failures', () => {
    const res = describeJob(view({ state: 'failed', failedReason: 'ingest timed out after 180s' }));
    expect(res.error).toEqual({ message: 'ingest timed out after 180s' });
    expect(res.error).not.toHaveProperty('reason');
  });
});
