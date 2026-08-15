import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { QueryModule } from './query/query.module';

@Module({
  imports: [HealthModule, QueryModule],
})
export class AppModule {}
