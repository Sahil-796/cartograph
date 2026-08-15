import {
  BadRequestException,
  Body,
  Controller,
  Get,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Post,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Response } from 'express';
import { IngestQueueService } from './ingest-queue.service';
import { loadIngest } from './ingest-loader';
import { asRejection, describeJob, submitIngest, type SubmitDeps } from './ingest-core';
import type { JobStatusResponse } from './ingest.types';

/**
 * The ingestion front door. `POST /api/ingest` runs the fast precheck gate
 * synchronously (rejecting bad repos before the user waits), returns the cached
 * repo when it's already ingested, else enqueues a job (202). `GET
 * /api/ingest/:jobId` reports the live phase a web UI polls. Prefixed `api/`
 * like the other controllers (main.ts sets no global prefix).
 *
 * The route decisions live in the pure `ingest-core` module (tested directly);
 * this controller only wires the real engine + queue and maps the discriminated
 * outcome to the frozen HTTP statuses.
 */
@Controller('api/ingest')
export class IngestController {
  constructor(private readonly queue: IngestQueueService) {}

  @Post()
  async ingest(@Body() body: unknown, @Res({ passthrough: true }) res: Response): Promise<unknown> {
    const url = validateUrl(body);

    let engine: Awaited<ReturnType<typeof loadIngest>>;
    try {
      engine = await loadIngest();
    } catch (err) {
      throw new InternalServerErrorException(`failed to load ingest engine: ${messageOf(err)}`);
    }

    const deps: SubmitDeps = {
      precheckRepo: (u) => engine.precheckRepo(u),
      asRejection,
      enqueue: (u) => this.queue.enqueue(u),
    };

    let result;
    try {
      result = await submitIngest(deps, url);
    } catch (err) {
      // Unexpected precheck failure (network/DB) — not a guardrail rejection.
      throw new InternalServerErrorException(`ingest precheck failed: ${messageOf(err)}`);
    }

    switch (result.kind) {
      case 'rejected':
        throw new BadRequestException({ reason: result.reason, message: result.message });
      case 'unavailable':
        throw new ServiceUnavailableException({ message: result.message });
      case 'cached':
        res.status(200);
        return { repoId: result.repoId, cached: true };
      case 'queued':
        res.status(202);
        return { jobId: result.jobId };
    }
  }

  @Get(':jobId')
  async status(@Param('jobId') jobId: string): Promise<JobStatusResponse> {
    let view;
    try {
      view = await this.queue.getJobView(jobId);
    } catch (err) {
      throw new ServiceUnavailableException({ message: messageOf(err) });
    }
    if (!view) throw new NotFoundException(`unknown jobId: ${jobId}`);
    return describeJob(view);
  }
}

/** Enforces `{ url: string }`, throwing a 400 otherwise. */
function validateUrl(body: unknown): string {
  if (!body || typeof body !== 'object') {
    throw new BadRequestException('request body must be a JSON object');
  }
  const { url } = body as Record<string, unknown>;
  if (typeof url !== 'string' || url.trim().length === 0) {
    throw new BadRequestException('url is required and must be a non-empty string');
  }
  return url;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
