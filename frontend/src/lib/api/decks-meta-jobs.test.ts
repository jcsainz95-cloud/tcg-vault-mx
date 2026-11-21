import { describe, it, expect, vi, beforeEach } from 'vitest';

const req = vi.hoisted(() => vi.fn());
vi.mock('../api-client', async () => {
  const actual = await vi.importActual<typeof import('../api-client')>('../api-client');
  return { ...actual, apiRequest: req };
});

import { ApiClientError } from '../api-client';
import { runDecksMetaRefreshJob, decksMetaPoll, DecksMetaJobLostError, DecksMetaJobFailedError, DecksMetaBusyError, DecksMetaJobTimeoutError } from './decks-meta-jobs';

const st = (over: object) => ({ jobId: 'j1', status: 'running', dryRun: false, enqueuedAt: '', startedAt: null, finishedAt: null, result: null, error: null, ...over });

beforeEach(() => {
  req.mockReset();
  decksMetaPoll.ms = 1;
});

describe('runDecksMetaRefreshJob', () => {
  it('sondea hasta done y devuelve result; avisa deduped', async () => {
    const result = { skipped: true, reason: 'DIAL_OFF', mode: 'off' };
    req
      .mockResolvedValueOnce({ jobId: 'j1', status: 'queued', deduped: true })
      .mockResolvedValueOnce(st({ status: 'running' }))
      .mockResolvedValueOnce(st({ status: 'done', result }));
    const onEnqueued = vi.fn();
    await expect(runDecksMetaRefreshJob({ onEnqueued })).resolves.toEqual(result);
    expect(onEnqueued).toHaveBeenCalledWith(expect.objectContaining({ deduped: true }));
    expect(req).toHaveBeenCalledTimes(3);
    expect(req.mock.calls[2][0]).toBe('/admin/jobs/decks-meta-refresh/j1');
  });
  it('failed ⇒ lanza con el error', async () => {
    req.mockResolvedValueOnce({ jobId: 'j1', status: 'queued', deduped: false }).mockResolvedValueOnce(st({ status: 'failed', error: 'boom' }));
    await expect(runDecksMetaRefreshJob()).rejects.toMatchObject({ name: 'DecksMetaJobFailedError', message: 'boom' });
    expect(DecksMetaJobFailedError).toBeDefined();
  });
  it('404 ⇒ DecksMetaJobLostError', async () => {
    req
      .mockResolvedValueOnce({ jobId: 'j1', status: 'queued', deduped: false })
      .mockRejectedValueOnce(new ApiClientError(404, { code: 'NOT_FOUND', message: 'x' }));
    await expect(runDecksMetaRefreshJob()).rejects.toBeInstanceOf(DecksMetaJobLostError);
  });
});

describe('runDecksMetaRefreshJob · robustez', () => {
  const q = { jobId: 'j1', status: 'queued', deduped: false };
  it('fallo de red en el sondeo reintenta y luego completa', async () => {
    req.mockResolvedValueOnce(q).mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce(st({ status: 'done', result: { ok: 1 } }));
    await expect(runDecksMetaRefreshJob()).resolves.toEqual({ ok: 1 });
  });
  it('red caída y luego 404 ⇒ DecksMetaJobLostError (no error de red)', async () => {
    req.mockResolvedValueOnce(q).mockRejectedValueOnce(new TypeError('network')).mockRejectedValueOnce(new ApiClientError(404, { code: 'NOT_FOUND', message: 'x' }));
    await expect(runDecksMetaRefreshJob()).rejects.toBeInstanceOf(DecksMetaJobLostError);
  });
  it('tope de 5 min ⇒ DecksMetaJobTimeoutError', async () => {
    const prev = decksMetaPoll.maxMs;
    decksMetaPoll.maxMs = 5;
    req.mockResolvedValueOnce(q).mockResolvedValue(st({ status: 'running' }));
    await expect(runDecksMetaRefreshJob()).rejects.toBeInstanceOf(DecksMetaJobTimeoutError);
    decksMetaPoll.maxMs = prev;
  });
  it('cancelar (salir de la página) detiene el sondeo', async () => {
    const ac = new AbortController();
    req.mockResolvedValueOnce(q).mockResolvedValue(st({ status: 'running' }));
    const p = runDecksMetaRefreshJob({ signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('409 REFRESH_BUSY ⇒ DecksMetaBusyError con runningDryRun', async () => {
    req.mockRejectedValueOnce(new ApiClientError(409, { code: 'REFRESH_BUSY', message: 'x', details: { runningDryRun: true } }));
    await expect(runDecksMetaRefreshJob({ dryRun: false })).rejects.toMatchObject({ name: 'DecksMetaBusyError', runningDryRun: true });
    expect(DecksMetaBusyError).toBeDefined();
  });
});
