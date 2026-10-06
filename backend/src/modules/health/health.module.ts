import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { healthRedisProvider } from './health-redis.provider';
import { TelemetryController } from './telemetry.controller';

/**
 * Módulo de salud. PrismaService viene del PrismaModule @Global y ConfigService
 * del ConfigModule @Global (ver AppModule).
 *
 * El cliente Redis (HEALTH_REDIS_CLIENT) lo aporta `healthRedisProvider` usando
 * ConfigService: con `REDIS_URL` es un cliente IORedis real (health → `up`/`down`);
 * sin `REDIS_URL` el provider resuelve a `null` y el health reporta `skipped`.
 */
@Module({
  // v1.84 (LIVE-7): `POST /telemetry/csp` y `/telemetry/client-error` viven aquí (API_CONTRACT §14.12: `modules/health/*`).
  controllers: [HealthController, TelemetryController],
  providers: [HealthService, healthRedisProvider],
})
export class HealthModule {}
