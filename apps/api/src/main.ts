import 'reflect-metadata';
// Must precede `./app.module` (which pulls in `@cartograph/config`, validated
// from `process.env` at import time) so the root `.env` is loaded first.
import './env';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`cartograph-api listening on port ${port}`);
}

bootstrap();
