import { describe, it, expect, vi, beforeEach } from 'vitest';

const req = vi.hoisted(() => vi.fn());
vi.mock('../api-client', async () => {
  const actual = await vi.importActual<typeof import('../api-client')>('../api-client');
  return { ...actual, apiRequest: req };
});

import { ApiClientError } from '../api-client';
import { runDecksMetaRefreshJob, decksMetaPoll, DecksMetaJobLostError, DecksMetaJobFailedError } from './decks-meta-jobs';

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
