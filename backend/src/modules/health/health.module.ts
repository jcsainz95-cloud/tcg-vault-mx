import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { healthRedisProvider } from './health-redis.provider';

/**
 * Módulo de salud. PrismaService viene del PrismaModule @Global y ConfigService
 * del ConfigModule @Global (ver AppModule).
 *
 * El cliente Redis (HEALTH_REDIS_CLIENT) lo aporta `healthRedisProvider` usando
 * ConfigService: con `REDIS_URL` es un cliente IORedis real (health → `up`/`down`);
 * sin `REDIS_URL` el provider resuelve a `null` y el health reporta `skipped`.
 */
@Module({
  controllers: [HealthController],
  providers: [HealthService, healthRedisProvider],
})
export class HealthModule {}
