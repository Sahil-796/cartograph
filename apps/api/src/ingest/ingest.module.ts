import { Module } from '@nestjs/common';
import { IngestController } from './ingest.controller';
import { IngestQueueService } from './ingest-queue.service';

/**
 * The ingestion module: the HTTP front door (`IngestController`) plus the
 * BullMQ queue/worker owner (`IngestQueueService`, which boots the in-process
 * worker on `onModuleInit` and tears queue + worker + Redis connections down on
 * `onModuleDestroy`).
 */
@Module({
  controllers: [IngestController],
  providers: [IngestQueueService],
})
export class IngestModule {}
