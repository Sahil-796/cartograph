import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { QueryModule } from './query/query.module';
import { ChatModule } from './chat/chat.module';
import { IngestModule } from './ingest/ingest.module';

@Module({
  imports: [HealthModule, QueryModule, ChatModule, IngestModule],
})
export class AppModule {}
