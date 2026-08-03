import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import compression from 'compression';
import { json, urlencoded } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(json({ limit: '2mb' }));
  app.use(urlencoded({ extended: true, limit: '2mb' }));
  app.use(compression());
  app.enableCors({
    origin: process.env.FRONTEND_URL?.split(',').map((origin) =>
      origin.trim(),
    ) ?? ['http://localhost:3000'],
    credentials: true,
    allowedHeaders: [
      'Accept',
      'Authorization',
      'Cache-Control',
      'Content-Type',
      'Pragma',
      'X-Repositorio-App-Version',
      'X-Repo-User-Id',
      'X-GBox-Authorization',
    ],
  });
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
