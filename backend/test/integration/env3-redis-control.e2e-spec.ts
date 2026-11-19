/** §ENV3 ENV3-3 — el disyuntor y el tope de Skydropx son GLOBALES (Redis real), no por instancia. */
import IORedis from 'ioredis';
import { MemoryShipQuoteControl, RedisShipQuoteControl, ShipQuoteControl } from '../../src/modules/shipping-quote/ship-quote-control';

const url = process.env.REDIS_URL as string;
const mk = (prefix: string, kind: 'redis' | 'memory'): ShipQuoteControl => (kind === 'redis' ? new RedisShipQuoteControl(new IORedis(url), prefix) : new MemoryShipQuoteControl());

describe.each(['redis'] as const)('ShipQuoteControl (%s) entre DOS instancias', (kind) => {
  const prefix = `t:${Date.now()}:${kind}:`;
  const a = mk(prefix, kind);
  const b = mk(prefix, kind);
  afterAll(async () => {
    for (const c of [a, b]) await (c as { onModuleDestroy?: () => Promise<void> }).onModuleDestroy?.();
  });
  // (Rojo visto: con kind='memory' la misma prueba falla 2/2: cada instancia cuenta aparte.)
  it('tope por minuto: 3 llamadas EN TOTAL entre las dos instancias', async () => {
    const got = [await a.acquire(3), await b.acquire(3), await a.acquire(3), await b.acquire(3), await a.acquire(3)];
    for (let i = 0; i < 5; i++) { await a.release(); await b.release(); }
    expect(got.filter(Boolean).length).toBe(3);
  });

  it('disyuntor: 5 fallos repartidos en las dos instancias lo abren para AMBAS', async () => {
    for (let i = 0; i < 5; i++) await (i % 2 ? a : b).recordFailure();
    expect(await a.isOpen()).toBe(true);
    expect(await b.isOpen()).toBe(true);
  });
});
