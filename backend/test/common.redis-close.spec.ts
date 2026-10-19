/**
 * TD-HND-3 — un solo cierre de cliente Redis (`src/common/redis-close.ts`). Conducta del helper y candado de que nadie más llama
 * `.quit()` en `src/` (la comprobación de cierre de la ficha: `grep -c '\.quit()'` en `src` = 1).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { closeRedisClient } from '../src/common/redis-close';

const fake = (quit: () => Promise<unknown>, status = 'ready') => ({ quit: jest.fn(quit), disconnect: jest.fn(), status });

describe('TD-HND-3 · closeRedisClient', () => {
  it('quit que contesta ⇒ "quit", sin disconnect', async () => {
    const c = fake(async () => 'OK');
    await expect(closeRedisClient(c)).resolves.toBe('quit');
    expect(c.disconnect).not.toHaveBeenCalled();
  });

  it('quit que falla ⇒ disconnect y no lanza', async () => {
    const c = fake(async () => {
      throw new Error('ECONNRESET');
    });
    await expect(closeRedisClient(c)).resolves.toBe('disconnect');
    expect(c.disconnect).toHaveBeenCalledTimes(1);
  });

  it('quit que no contesta ⇒ disconnect al vencer el tope (y no deja el timer vivo)', async () => {
    jest.useFakeTimers();
    try {
      const c = fake(() => new Promise<never>(() => undefined));
      const done = closeRedisClient(c, { timeoutMs: 500 });
      await jest.advanceTimersByTimeAsync(499);
      expect(c.disconnect).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      await expect(done).resolves.toBe('disconnect');
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('requireReady con la conexión sin abrir ⇒ ni intenta quit (se encolaría offline)', async () => {
    const c = fake(async () => 'OK', 'connecting');
    await expect(closeRedisClient(c, { requireReady: true })).resolves.toBe('disconnect');
    expect(c.quit).not.toHaveBeenCalled();
  });
});

describe('TD-HND-3 · candado: `.quit()` vive solo en el helper', () => {
  it('en src/ hay exactamente una llamada `.quit()`, en common/redis-close.ts', () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith('.ts')) for (const _ of readFileSync(p, 'utf8').matchAll(/\.quit\(\)/g)) hits.push(p.slice(p.indexOf('src/')));
      }
    };
    walk(join(__dirname, '..', 'src'));
    expect(hits).toEqual(['src/common/redis-close.ts']);
  });
});
