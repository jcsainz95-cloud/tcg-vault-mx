import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

/**
 * Módulo de salud. PrismaService viene del PrismaModule @Global.
 * El cliente Redis (HEALTH_REDIS_CLIENT) es opcional: si no está registrado,
 * el health lo reporta como `skipped` (ver HealthService).
 */
@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
