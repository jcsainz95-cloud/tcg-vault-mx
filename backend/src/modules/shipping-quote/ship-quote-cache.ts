/**
 * ship-quote-cache.ts — caché de cotizaciones vivas por (CP, perfil de UNA caja) con TTL (DECISIONES punto 4: Redis
 * `shipq:v1:{cp}:{perfil}` 6 h). Redis con plazo corto; sin `REDIS_URL` o con Redis caído ⇒ el servicio sigue (sin caché).
 */
import { Logger, OnModuleDestroy, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis, { Redis } from 'ioredis';
import { closeRedisClient } from '../../common/redis-close';
import { resolveRedisFamily } from '../../jobs/redis-connection.util';

export const SHIP_QUOTE_CACHE = Symbol('SHIP_QUOTE_CACHE');

export interface ShipQuoteCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlS: number): Promise<void>;
}

export class MemoryShipQuoteCache implements ShipQuoteCache {
  private readonly m = new Map<string, { v: string; exp: number }>();
  async get(key: string): Promise<string | null> {
    const e = this.m.get(key);
    if (!e) return null;
    if (e.exp <= Date.now()) {
      this.m.delete(key);
      return null;
    }
    return e.v;
  }
  async set(key: string, value: string, ttlS: number): Promise<void> {
    this.m.set(key, { v: value, exp: Date.now() + ttlS * 1000 });
  }
  clear(): void {
    this.m.clear();
  }
}

export class RedisShipQuoteCache implements ShipQuoteCache, OnModuleDestroy {
  private readonly logger = new Logger('ShipQuoteCache');
  constructor(private readonly client: Redis) {}
  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (e) {
      this.logger.warn(`ship_quote_cache get falló: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }
  async set(key: string, value: string, ttlS: number): Promise<void> {
    try {
      await this.client.set(key, value, 'EX', ttlS);
    } catch (e) {
      this.logger.warn(`ship_quote_cache set falló: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  async onModuleDestroy(): Promise<void> {
    await closeRedisClient(this.client);
  }
}

export const shipQuoteCacheProvider: Provider = {
  provide: SHIP_QUOTE_CACHE,
  inject: [ConfigService],
  useFactory: (config: ConfigService): ShipQuoteCache => {
    const url = config.get<string>('REDIS_URL');
    if (!url) {
      new Logger('ShipQuoteCache').warn('REDIS_URL ausente → caché de cotizaciones en MEMORIA (solo dev/CI).');
      return new MemoryShipQuoteCache();
    }
    const family = resolveRedisFamily(url, config.get<string>('REDIS_FAMILY'));
    const client = new IORedis(url, {
      commandTimeout: 250,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      ...(family !== undefined ? { family } : {}),
    });
    client.on('error', () => undefined);
    return new RedisShipQuoteCache(client);
  },
};
