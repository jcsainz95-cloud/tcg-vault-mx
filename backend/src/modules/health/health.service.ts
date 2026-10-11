import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

/** v1.84 (LIVE-7, API_CONTRACT §14.7): ¿la tienda cobra dinero real? Del PREFIJO de `STRIPE_SECRET_KEY`. */
export type StripeMode = 'live' | 'test' | 'none';

/**
 * `sk_live_`/`rk_live_` ⇒ `live`; `sk_test_`/`rk_test_` ⇒ `test`; vacía o ausente ⇒ `none`. Un prefijo que no es
 * ninguno de esos cuatro (no es una clave de Stripe) ⇒ `none` — el contrato no define un cuarto valor.
 * ⛔ Devuelve SOLO la etiqueta: ni la clave ni un fragmento (HLT-1).
 */
export function stripeModeOf(secretKey: string | undefined | null): StripeMode {
  const k = (secretKey ?? '').trim();
  if (k.startsWith('sk_live_') || k.startsWith('rk_live_')) return 'live';
  if (k.startsWith('sk_test_') || k.startsWith('rk_test_')) return 'test';
  return 'none';
}

export interface HealthResult {
  ok: boolean;
  status: 'ok' | 'degraded';
  uptime: number;
  timestamp: string;
  db: DependencyState;
  redis: DependencyState;
  /** v1.84 (LIVE-7): NO degrada la salud. */
  stripeMode: StripeMode;
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
    private readonly config: ConfigService,
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
      stripeMode: stripeModeOf(this.config.get<string>('STRIPE_SECRET_KEY')),
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
