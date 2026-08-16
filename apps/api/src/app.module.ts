import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { QueryModule } from './query/query.module';
import { ChatModule } from './chat/chat.module';
import { IngestModule } from './ingest/ingest.module';
import { McpModule } from './mcp/mcp.module';

@Module({
  imports: [HealthModule, QueryModule, ChatModule, IngestModule, McpModule],
})
export class AppModule {}
