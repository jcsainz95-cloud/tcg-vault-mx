import { describe, it, expect, vi, afterEach } from 'vitest';
import { ApiClientError } from '../api-client';
import { retryAfterToMs, withRateLimitRetry } from './rate-limit-retry';

const NOW = Date.parse('2026-11-24T12:00:00Z');
const e429 = (retryAfter?: string, details?: Record<string, unknown>) => {
  const e = new ApiClientError(429, { code: 'RATE_LIMITED', message: 'x', details });
  if (retryAfter) e.retryAfter = retryAfter;
  return e;
};

describe('retryAfterToMs', () => {
  it.each([
    ['20', 20_000], ['0', 1_000], ['-5', 1_000], ['1e9', 60_000], ['600', 60_000], ['60', 60_000], ['61', 60_000],
    ['abc', 15_000], ['Infinity', 15_000], ['', 15_000], [undefined, 15_000],
    ['Tue, 24 Nov 2026 12:00:30 GMT', 30_000], ['Tue, 24 Nov 2026 11:00:00 GMT', 1_000], ['Fri, 01 Jan 2100 00:00:00 GMT', 60_000],
  ])('%s → %s ms', (h, ms) => expect(retryAfterToMs(h as string | undefined, NOW)).toBe(ms));
});

describe('withRateLimitRetry', () => {
  afterEach(() => vi.useRealTimers());

  it('usa details.retryAfterSeconds del cuerpo cuando falta la cabecera (m-4)', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValueOnce(e429(undefined, { retryAfterSeconds: 30 })).mockResolvedValue('ok');
    const p = withRateLimitRetry(fn);
    await vi.advanceTimersByTimeAsync(29_000);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_500);
    await expect(p).resolves.toBe('ok');
  });

  it('avisa onWait(hasta) al esperar y onWait(null) al reanudar', async () => {
    vi.useFakeTimers();
    const onWait = vi.fn();
    const fn = vi.fn().mockRejectedValueOnce(e429('3')).mockResolvedValue('ok');
    const p = withRateLimitRetry(fn, { onWait });
    await vi.advanceTimersByTimeAsync(3_100);
    await p;
    expect(onWait.mock.calls.map((c) => (c[0] === null ? null : 'until'))).toEqual(['until', null]);
  });

  it('solo reintenta 429: otros errores y no-ApiClientError se relanzan al primer intento', async () => {
    const fn = vi.fn().mockRejectedValue(new ApiClientError(503, { code: 'X', message: 'x' }));
    await expect(withRateLimitRetry(fn)).rejects.toMatchObject({ status: 503 });
    expect(fn).toHaveBeenCalledTimes(1);
    const g = vi.fn().mockRejectedValue(new Error('red'));
    await expect(withRateLimitRetry(g)).rejects.toThrow('red');
    expect(g).toHaveBeenCalledTimes(1);
  });

  it('máx. 3 reintentos: 4 llamadas y relanza el 429', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValue(e429('1'));
    const p = withRateLimitRetry(fn);
    const caught = p.catch((e) => e);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await caught).toMatchObject({ status: 429 });
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('abortar cancela la espera, no reintenta y limpia onWait', async () => {
    vi.useFakeTimers();
    const ac = new AbortController();
    const onWait = vi.fn();
    const fn = vi.fn().mockRejectedValue(e429('30'));
    const caught = withRateLimitRetry(fn, { onWait, signal: ac.signal }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(100);
    ac.abort(new Error('cancel'));
    expect(await caught).toMatchObject({ message: 'cancel' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(onWait).toHaveBeenLastCalledWith(null);
  });
});
