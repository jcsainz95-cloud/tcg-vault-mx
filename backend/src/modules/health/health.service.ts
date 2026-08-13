import { Inject, Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** Token opcional para un cliente Redis con método `ping()`. Hoy no hay ninguno
 * registrado en el AppModule (los jobs BullMQ aún no están cableados, ver
 * BACKEND_NOTES §3/§5). Si devops registra un provider con este token, el
 * health lo pingueará automáticamente. */
export const HEALTH_REDIS_CLIENT = 'HEALTH_REDIS_CLIENT';

/** Cliente Redis mínimo que necesita el health check. */
export interface HealthRedisClient {
  ping(): Promise<string>;
}

export type DependencyState = 'up' | 'down' | 'skipped';

export interface HealthResult {
  ok: boolean;
  status: 'ok' | 'degraded';
  uptime: number;
  timestamp: string;
  db: DependencyState;
  redis: DependencyState;
}

/**
 * Chequeo ligero de salud para el healthcheck de la plataforma (Railway).
 * - `SELECT 1` a Postgres vía PrismaService.
 * - `PING` a Redis solo si hay un cliente disponible; si no, se reporta `skipped`
 *   y NO degrada el estado (dependencia opcional en el MVP).
 * Debe ser barato: sin locks, sin escrituras, sin llamadas externas de negocio.
 */
@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(HEALTH_REDIS_CLIENT)
    private readonly redis?: HealthRedisClient,
  ) {}

  async check(): Promise<HealthResult> {
    const db = await this.checkDb();
    const redis = await this.checkRedis();

    // Solo una dependencia REALMENTE caída (down) degrada la salud.
    // `skipped` (dependencia no configurada) no cuenta como fallo.
    const ok = db !== 'down' && redis !== 'down';

    return {
      ok,
      status: ok ? 'ok' : 'degraded',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      db,
      redis,
    };
  }

  private async checkDb(): Promise<DependencyState> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'up';
    } catch {
      return 'down';
    }
  }

  private async checkRedis(): Promise<DependencyState> {
    if (!this.redis) return 'skipped';
    try {
      const pong = await this.redis.ping();
      return pong ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }
}
