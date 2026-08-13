import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { json } from 'express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  // Prefijo global de la API (API_CONTRACT §0).
  app.setGlobalPrefix('api/v1');

  // Raw body para el webhook de Stripe (firma). Resto de rutas: JSON normal.
  app.use('/api/v1/webhooks/stripe', json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  }));
  app.use(json());

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  app.enableCors({ origin: true, credentials: true });

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
  await app.listen(port);
  new Logger('Bootstrap').log(`Backend escuchando en http://localhost:${port}/api/v1`);
}

bootstrap();
