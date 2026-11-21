/**
 * §DECKS-TOP-FUENTE — «Publicar ahora» asíncrono (API_CONTRACT_DECKS_META §1-2).
 * POST ⇒ 202 `{jobId,status,deduped}`; se sondea el GET cada 3 s hasta `done|failed`.
 * 404 ⇒ `DecksMetaJobLostError` (el servidor reinició; la cola es en proceso).
 */
import { apiRequest, ApiClientError } from '../api-client';
import type { DecksMetaJobEnqueued, DecksMetaJobStatus, DecksMetaPreviewResponse } from '@/types/contract';

export const decksMetaPoll = { ms: 3000 };

export class DecksMetaJobLostError extends Error {
  constructor() {
    super('DECKS_META_JOB_LOST');
    this.name = 'DecksMetaJobLostError';
  }
}

export class DecksMetaJobFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecksMetaJobFailedError';
  }
}

export function enqueueDecksMetaRefresh(dryRun = false): Promise<DecksMetaJobEnqueued> {
  return apiRequest<DecksMetaJobEnqueued>('/admin/jobs/decks-meta-refresh', { method: 'POST', body: { dryRun } });
}

export function getDecksMetaJob(jobId: string): Promise<DecksMetaJobStatus> {
  return apiRequest<DecksMetaJobStatus>(`/admin/jobs/decks-meta-refresh/${jobId}`);
}

/** Encola y espera el resultado. `onEnqueued` avisa si se reutilizó una corrida en curso. */
export async function runDecksMetaRefreshJob(
  opts: { dryRun?: boolean; onEnqueued?: (e: DecksMetaJobEnqueued) => void } = {},
): Promise<DecksMetaPreviewResponse> {
  const job = await enqueueDecksMetaRefresh(opts.dryRun ?? false);
  opts.onEnqueued?.(job);
  for (;;) {
    await new Promise((r) => setTimeout(r, decksMetaPoll.ms));
    let st: DecksMetaJobStatus;
    try {
      st = await getDecksMetaJob(job.jobId);
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 404) throw new DecksMetaJobLostError();
      throw e;
    }
    if (st.status === 'failed') throw new DecksMetaJobFailedError(st.error ?? '');
    if (st.status === 'done') {
      if (!st.result) throw new DecksMetaJobFailedError('');
      return st.result;
    }
  }
}
