import { Injectable, OnModuleDestroy, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis, { Redis } from 'ioredis';
import { resolveRedisFamily } from '../../jobs/redis-connection.util';
import { HEALTH_REDIS_CLIENT, HealthRedisClient } from './health.service';

/**
 * Cliente Redis ligero y dedicado para el health check.
 *
 * Es INDEPENDIENTE de la conexión BullMQ del SchedulerService (a propósito): el
 * health no debe competir por, ni depender de, la conexión de los workers. Es una
 * conexión mínima (solo `PING`) con `lazyConnect` para no abrir el socket hasta el
 * primer chequeo, y `maxRetriesPerRequest: null` para no acumular reintentos ni
 * bloquear el ping si Redis está caído (dejamos que la promesa falle → `down`).
 *
 * Cierra el socket en `onModuleDestroy` para no fugar conexiones.
 */
@Injectable()
export class HealthRedisClientProvider implements HealthRedisClient, OnModuleDestroy {
  private readonly client: Redis;

  constructor(url: string, envFamily?: string) {
    // Auditoría de precios 2026-08-17: mismo `family` dual-stack que el scheduler (Railway
    // private networking es IPv6-only; con el default IPv4 de ioredis el ping fallaba y el
    // health reportaba `down` aunque el Redis estuviera sano). Ver redis-connection.util.ts.
    const family = resolveRedisFamily(url, envFamily);
    this.client = new IORedis(url, {
      // BullMQ/ioredis: no acumular reintentos por request; dejamos que un Redis
      // caído haga fallar el `ping()` (→ `down`) en vez de colgar el health check.
      maxRetriesPerRequest: null,
      // No abrir el socket hasta el primer `ping()`; el health es una sonda liviana.
      lazyConnect: true,
      ...(family !== undefined ? { family } : {}),
    });
    // Sin listener de 'error', ioredis emite un evento no capturado que puede tumbar
    // el proceso cuando Redis está caído. Lo tragamos: el estado real lo determina
    // el resultado del `ping()` en HealthService.checkRedis().
    this.client.on('error', () => undefined);
  }

  ping(): Promise<string> {
    return this.client.ping();
  }

  async onModuleDestroy(): Promise<void> {
    // `quit()` cierra limpio; si el socket nunca se abrió (lazyConnect) también es seguro.
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}

/**
 * Provider factory para el token `HEALTH_REDIS_CLIENT`.
 * - Con `REDIS_URL`: provee un cliente real → el health reporta `up`/`down`.
 * - Sin `REDIS_URL` (local/tests/CI sin infra): provee `null` → el health reporta `skipped`
 *   (comportamiento preservado; el token queda opcional vía `@Optional()`).
 */
export const healthRedisProvider: Provider = {
  provide: HEALTH_REDIS_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): HealthRedisClient | null => {
    const url = config.get<string>('REDIS_URL');
    if (!url) return null;
    return new HealthRedisClientProvider(url, config.get<string>('REDIS_FAMILY'));
  },
};
