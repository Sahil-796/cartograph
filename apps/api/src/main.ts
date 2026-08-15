import 'reflect-metadata';
// Must precede `./app.module` (which pulls in `@cartograph/config`, validated
// from `process.env` at import time) so the root `.env` is loaded first.
import './env';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // The Vite proxy handles local development. The hosted Vercel frontend
  // calls this separately deployed API directly, so allow its configured
  // origin (or all origins until CORS_ORIGIN is set for the demo).
  const origins = process.env.CORS_ORIGIN?.split(",").map((origin) => origin.trim()).filter(Boolean);
  app.enableCors({ origin: origins && origins.length > 0 ? origins : true });
  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`cartograph-api listening on port ${port}`);
}

bootstrap();
