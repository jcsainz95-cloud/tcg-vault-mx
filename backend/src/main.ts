import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { json } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

/**
 * Orígenes permitidos por CORS (S-M2). Se toma de `APP_BASE_URL` (lista separada por comas
 * si hay varios orígenes válidos). Nunca se refleja un origin arbitrario (`origin: true`).
 * Fallback seguro si `APP_BASE_URL` no está seteada: solo orígenes de desarrollo local
 * (`http://localhost:3000`, `http://localhost:5173`) — jamás un comodín. En staging/prod
 * `APP_BASE_URL` DEBE fijarse (ver docs/BACKEND_NOTES.md).
 */
function resolveCorsOrigins(): string[] {
  const raw = process.env.APP_BASE_URL;
  const origins = (raw ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  if (origins.length > 0) return origins;
  return ['http://localhost:3000', 'http://localhost:5173'];
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  // S-B4: cabeceras de seguridad (CSP por defecto, HSTS, noSniff, frameguard, etc.).
  app.use(helmet());

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

  // S-M2: allow-list de orígenes desde `APP_BASE_URL` (nunca `origin: true` con credenciales).
  const corsOrigins = resolveCorsOrigins();
  app.enableCors({ origin: corsOrigins, credentials: true });
  new Logger('Bootstrap').log(`CORS allow-list: ${corsOrigins.join(', ')}`);

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
  await app.listen(port);
  new Logger('Bootstrap').log(`Backend escuchando en http://localhost:${port}/api/v1`);
}

bootstrap();
