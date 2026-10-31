import { describe, it, expect } from 'vitest';
import { withAbortBudget, withBudget } from './ssr-budget';

/** TL-MKT2-1: los dos topes de SSR. Ninguno lanza; `withAbortBudget` además aborta la lectura al vencer. */
const never = <T,>() => new Promise<T>(() => {});

describe('ssr-budget', () => {
  it('withBudget: valor a tiempo, null si tarda o falla', async () => {
    expect(await withBudget(Promise.resolve(1), 50)).toBe(1);
    expect(await withBudget(never<number>(), 10)).toBeNull();
    expect(await withBudget(Promise.reject(new Error('x')), 50)).toBeNull();
  });

  it('withAbortBudget: al vencer devuelve null y la señal queda abortada', async () => {
    let seen: AbortSignal | undefined;
    const r = await withAbortBudget((signal) => {
      seen = signal;
      return never<number>();
    }, 10);
    expect(r).toBeNull();
    expect(seen?.aborted).toBe(true);
  });

  it('withAbortBudget: a tiempo devuelve el valor sin abortar; si `run` falla o lanza, null', async () => {
    let seen: AbortSignal | undefined;
    expect(
      await withAbortBudget((signal) => {
        seen = signal;
        return Promise.resolve('ok');
      }, 50),
    ).toBe('ok');
    expect(seen?.aborted).toBe(false);
    expect(await withAbortBudget(() => Promise.reject(new Error('x')), 50)).toBeNull();
    expect(
      await withAbortBudget(() => {
        throw new Error('sync');
      }, 50),
    ).toBeNull();
  });
});
