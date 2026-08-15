import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { QueryModule } from './query/query.module';
import { ChatModule } from './chat/chat.module';

@Module({
  imports: [HealthModule, QueryModule, ChatModule],
})
export class AppModule {}
